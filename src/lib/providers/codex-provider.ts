/**
 * Codex provider implementation.
 *
 * Implements the AgentProvider interface for the Codex backend, communicating
 * with the Rust backend via Tauri invoke/listen. Refactored from the original
 * codex-adapter.ts to conform to the unified provider abstraction.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ChatModelRunResult } from "@assistant-ui/react";

import type { AgentProvider, DevEvent, RunContext } from "@/lib/providers/types";
import { useCodexApprovalStore } from "@/lib/codex-approval-store";
import { CODEX_MODELS } from "@/lib/models";
import { log } from "@/lib/providers/shared";

// ---------------------------------------------------------------------------
// Protocol types (match Rust AgentEvent serde output with snake_case)
// ---------------------------------------------------------------------------

type CodexItemType =
  | "agent_message"
  | "user_message"
  | "reasoning"
  | "file_change"
  | "command_execution"
  | "web_search"
  | "plan_update"
  | "mcp_tool_call"
  | "unknown";

interface CodexItem {
  type: string;
  [key: string]: unknown;
}

interface CommandAction {
  command: string;
  name?: string;
  path?: string;
  type?: string;
}

interface CommandExecutionToolArgs {
  type: "command_execution";
  command: string;
  cwd?: string;
  exitCode?: number;
  durationMs?: number;
  aggregatedOutput?: string;
  commandActions?: CommandAction[];
}

type AgentEvent =
  | { type: "turn_started"; thread_id: string; turn_id: string }
  | { type: "item_delta"; thread_id: string; item_id: string; delta: string }
  | {
      type: "item_completed";
      thread_id: string;
      item_id: string;
      item: CodexItem;
    }
  | {
      type: "turn_completed";
      thread_id: string;
      turn_id: string;
      usage: { input_tokens: number; output_tokens: number };
    }
  | {
      type: "approval_needed";
      thread_id: string;
      approval_id: string;
      command: string;
      reason?: string;
    }
  | { type: "auth_changed"; auth_mode: string; username?: string }
  | { type: "process_error"; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ContentPart = NonNullable<ChatModelRunResult["content"]>[number];

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeCodexItemType(rawType: unknown): CodexItemType {
  switch (rawType) {
    case "agent_message":
    case "agentMessage":
      return "agent_message";
    case "user_message":
    case "userMessage":
      return "user_message";
    case "reasoning":
      return "reasoning";
    case "file_change":
    case "fileChange":
      return "file_change";
    case "command_execution":
    case "commandExecution":
      return "command_execution";
    case "web_search":
    case "webSearch":
      return "web_search";
    case "plan_update":
    case "planUpdate":
      return "plan_update";
    case "mcp_tool_call":
    case "mcpToolCall":
      return "mcp_tool_call";
    default:
      return "unknown";
  }
}

function normalizeCommandActions(raw: unknown): CommandAction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const actions = raw
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => ({
      command: asString(entry.command) ?? "",
      name: asString(entry.name),
      path: asString(entry.path),
      type: asString(entry.type),
    }))
    .filter(
      (entry) =>
        entry.command.length > 0 || entry.name || entry.path || entry.type,
    );
  return actions.length > 0 ? actions : undefined;
}

function mapCodexItemToToolArgs(item: CodexItem): {
  toolName: string;
  args: Record<string, unknown>;
} {
  const normalizedType = normalizeCodexItemType(item.type);
  const source = asObject(item) ?? {};

  if (normalizedType === "command_execution") {
    const args: CommandExecutionToolArgs = {
      type: "command_execution",
      command: asString(source.command) ?? "",
      cwd: asString(source.cwd),
      exitCode: asNumber(source.exitCode ?? source.exit_code),
      durationMs: asNumber(source.durationMs ?? source.duration_ms),
      aggregatedOutput: asString(source.aggregatedOutput ?? source.output),
      commandActions: normalizeCommandActions(
        source.commandActions ?? source.command_actions,
      ),
    };
    return {
      toolName: "command_execution",
      args: args as unknown as Record<string, unknown>,
    };
  }

  return {
    toolName:
      normalizedType === "unknown"
        ? (asString(source.type) ?? "unknown")
        : normalizedType,
    args: source,
  };
}

function mapItemToToolCall(
  itemId: string,
  item: CodexItem,
): {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
} {
  const mapped = mapCodexItemToToolArgs(item);
  return {
    toolCallId: itemId,
    toolName: mapped.toolName,
    args: mapped.args,
    argsText: JSON.stringify(mapped.args),
  };
}

function emitDevEvent(
  onDevEvent: ((event: DevEvent) => void) | undefined,
  category: string,
  data: unknown,
): void {
  if (onDevEvent) {
    onDevEvent({ category, data, timestamp: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// PID helper
// ---------------------------------------------------------------------------

/**
 * Retrieve the PID of the running `codex app-server` process.
 * Returns `null` if the service is not running.
 */
export async function getCodexPid(): Promise<number | null> {
  return invoke<number | null>("codex_get_pid");
}

// ---------------------------------------------------------------------------
// createCodexProvider
// ---------------------------------------------------------------------------

export function createCodexProvider(): AgentProvider {
  return {
    id: "codex",
    displayName: "Codex",
    capabilities: {
      supportsResume: false,
      supportsApproval: true,
      supportsSubAgents: false,
      supportsMcp: false,
      supportsEffort: true,
    },
    supportedModels: CODEX_MODELS.map((m) => m.id),

    async *run(ctx: RunContext): AsyncGenerator<ChatModelRunResult, void> {
      const { prompt, model, effort, abortSignal, threadId, onDevEvent } = ctx;

      if (!prompt.trim()) return;

      log("codex-provider", "Starting thread", { model, effort, threadId });
      emitDevEvent(onDevEvent, "codex:start", { model, effort, threadId });

      // Start a Codex thread via Rust backend
      const codexThreadId = await invoke<string>("codex_start_thread", {
        model: model ?? null,
        reasoningEffort: effort ?? null,
      });

      log("codex-provider", "Thread started", { codexThreadId });
      emitDevEvent(onDevEvent, "codex:thread_created", { codexThreadId });

      const pendingContent: ContentPart[] = [];
      let currentTextIdx: number | null = null;
      let closed = false;

      // Queue-based event processing for the async generator
      const queue: Array<AgentEvent | { _done: true } | { _error: string }> =
        [];
      let notify: (() => void) | null = null;

      function push(item: (typeof queue)[number]) {
        queue.push(item);
        notify?.();
        notify = null;
      }

      // Subscribe to Tauri events BEFORE starting the turn
      const unlistenPromise: Promise<UnlistenFn> = listen<AgentEvent>(
        "agent:event",
        ({ payload }) => {
          if (
            "thread_id" in payload &&
            typeof payload.thread_id === "string" &&
            payload.thread_id.length > 0 &&
            payload.thread_id !== codexThreadId
          ) {
            return;
          }
          push(payload);
        },
      );
      await unlistenPromise;

      // Start the turn via Rust backend
      const turnId = await invoke<string>("codex_send_turn", {
        threadId: codexThreadId,
        input: prompt,
        cwd: ctx.cwd || undefined,
      });

      emitDevEvent(onDevEvent, "codex:turn_started", { turnId });

      // Handle abort
      const onAbort = () => {
        invoke("codex_interrupt_turn", {
          threadId: codexThreadId,
          turnId,
        }).catch(console.error);
        push({ _done: true });
      };

      if (abortSignal.aborted) {
        onAbort();
      } else {
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        while (!closed) {
          if (queue.length === 0) {
            await new Promise<void>((r) => {
              notify = r;
            });
            continue;
          }

          const event = queue.shift()!;

          if ("_done" in event) {
            closed = true;
            break;
          }

          if ("_error" in event) {
            throw new Error(event._error);
          }

          emitDevEvent(onDevEvent, `codex:${event.type}`, event);

          switch (event.type) {
            case "item_delta": {
              if (currentTextIdx === null) {
                currentTextIdx = pendingContent.length;
                pendingContent.push({ type: "text", text: event.delta });
              } else {
                const existing = pendingContent[currentTextIdx] as {
                  type: "text";
                  text: string;
                };
                pendingContent[currentTextIdx] = {
                  type: "text",
                  text: existing.text + event.delta,
                };
              }
              yield { content: [...pendingContent] } satisfies ChatModelRunResult;
              break;
            }

            case "item_completed": {
              const skipTypes = new Set<CodexItemType>([
                "agent_message",
                "user_message",
              ]);
              const normalizedType = normalizeCodexItemType(event.item.type);
              if (!skipTypes.has(normalizedType)) {
                currentTextIdx = null;
                const mapped = mapItemToToolCall(event.item_id, event.item);
                pendingContent.push({
                  type: "tool-call" as const,
                  ...mapped,
                } as ContentPart);
                yield {
                  content: [...pendingContent],
                } satisfies ChatModelRunResult;
              }
              break;
            }

            case "turn_completed": {
              closed = true;
              yield {
                content: [...pendingContent],
                status: { type: "complete", reason: "stop" },
              } satisfies ChatModelRunResult;
              break;
            }

            case "approval_needed": {
              useCodexApprovalStore.getState().push({
                thread_id: event.thread_id,
                approval_id: event.approval_id,
                command: event.command,
                reason: event.reason,
              });
              // Note: thread status is managed by the orchestrated adapter, not here
              break;
            }

            case "process_error": {
              throw new Error(`Codex process error: ${event.message}`);
            }

            default:
              break;
          }
        }
      } catch (err) {
        if (abortSignal.aborted) {
          yield {
            content: [],
            status: { type: "incomplete", reason: "cancelled" },
          } satisfies ChatModelRunResult;
        } else {
          throw err;
        }
      } finally {
        abortSignal.removeEventListener("abort", onAbort);
        const unlisten = await unlistenPromise;
        unlisten();
      }
    },

    async interrupt(threadId: string): Promise<void> {
      log("codex-provider", "Interrupting thread", { threadId });
      await invoke("codex_interrupt_turn", {
        threadId,
        turnId: "", // Rust backend handles empty turn_id as "interrupt current"
      });
    },
  };
}

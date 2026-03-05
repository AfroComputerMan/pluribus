/**
 * Codex App Server adapter for assistant-ui.
 *
 * Implements ChatModelAdapter by communicating with the Tauri Rust backend
 * via invoke() / listen(). The Rust backend manages the long-lived
 * `codex app-server` process and routes JSONL messages.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ChatModelAdapter,
  ChatModelRunResult,
} from "@assistant-ui/react";
import { db } from "@/lib/db";
import { useCodexApprovalStore } from "@/lib/codex-approval-store";
import { useThreadStatusStore } from "@/lib/thread-status-store";
import { getModelById, isCodexModel } from "@/lib/models";

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

type ToolCallMapping = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
};

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

function extractUserText(
  messages: Parameters<ChatModelAdapter["run"]>[0]["messages"],
): string {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) return "";
  return lastUserMsg.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
    .filter((entry) => entry.command.length > 0 || entry.name || entry.path || entry.type);
  return actions.length > 0 ? actions : undefined;
}

function mapCodexItemToToolArgs(item: CodexItem): { toolName: string; args: Record<string, unknown> } {
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
      commandActions: normalizeCommandActions(source.commandActions ?? source.command_actions),
    };
    return {
      toolName: "command_execution",
      args: args as unknown as Record<string, unknown>,
    };
  }

  return {
    toolName: normalizedType === "unknown" ? asString(source.type) ?? "unknown" : normalizedType,
    args: source,
  };
}

async function getOrCreateCodexThread(
  threadKey: string,
  model?: string,
  reasoningEffort?: string | null,
): Promise<string> {
  const existing = await db.sessions.get(threadKey);
  if (existing?.session_id) return existing.session_id;

  // Build invoke args; omit reasoningEffort if the model doesn't support it
  const modelDef = model ? getModelById(model) : undefined;
  const effortArg =
    reasoningEffort && modelDef?.supportsEffort && isCodexModel(model ?? "")
      ? reasoningEffort
      : undefined;

  const codexThreadId = await invoke<string>("codex_start_thread", {
    model: model ?? null,
    reasoningEffort: effortArg ?? null,
  });
  await db.sessions.upsert({
    thread_id: threadKey,
    session_id: codexThreadId,
    status: "active",
    last_updated_at: new Date().toISOString(),
  });
  return codexThreadId;
}

function mapItemToToolCall(
  itemId: string,
  item: CodexItem,
): ToolCallMapping {
  const mapped = mapCodexItemToToolArgs(item);
  return {
    toolCallId: itemId,
    toolName: mapped.toolName,
    args: mapped.args,
    argsText: JSON.stringify(mapped.args),
  };
}

// ---------------------------------------------------------------------------
// createCodexAdapter
// ---------------------------------------------------------------------------

export function createCodexAdapter(): ChatModelAdapter {
  return {
    async *run(options): AsyncGenerator<ChatModelRunResult, void> {
      const { messages, abortSignal } = options;
      const threadKey =
        (options as { unstable_threadId?: string }).unstable_threadId?.trim() ??
        "__global__";

      // Resolve thread settings from DB
      const threadRow = await db.threads.get(threadKey);
      const model = threadRow?.model ?? undefined;
      const effort = threadRow?.effort ?? undefined;

      const codexThreadId = await getOrCreateCodexThread(threadKey, model, effort);
      const userText = extractUserText(messages);
      if (!userText.trim()) return;

      const cwd = threadRow?.cwd ?? undefined;

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

      // Subscribe to Tauri events BEFORE starting the turn so no early
      // events (deltas, turn_completed) are missed.
      const unlistenPromise: Promise<UnlistenFn> = listen<AgentEvent>(
        "agent:event",
        ({ payload }) => {
          // Filter events for this thread
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

      // Start the turn via Rust backend (listener is already active)
      const turnId = await invoke<string>("codex_send_turn", {
        threadId: codexThreadId,
        input: userText,
        cwd,
      });

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

          switch (event.type) {
            case "item_delta": {
              // Accumulate text deltas into a single text content part
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
              // agentMessage text was already streamed via item_delta.
              // userMessage is an echo of the user's own input — skip both.
              const skipTypes = new Set<CodexItemType>(["agent_message", "user_message"]);
              const normalizedType = normalizeCodexItemType(event.item.type);
              if (!skipTypes.has(normalizedType)) {
                currentTextIdx = null;
                const mapped = mapItemToToolCall(event.item_id, event.item);
                pendingContent.push({
                  type: "tool-call" as const,
                  ...mapped,
                } as ContentPart);
                yield { content: [...pendingContent] } satisfies ChatModelRunResult;
              }
              break;
            }

            case "turn_completed": {
              closed = true;
              if (pendingContent.length > 0) {
                yield {
                  content: [...pendingContent],
                  status: { type: "complete", reason: "stop" },
                } satisfies ChatModelRunResult;
              }
              break;
            }

            case "approval_needed": {
              useCodexApprovalStore.getState().push({
                thread_id: event.thread_id,
                approval_id: event.approval_id,
                command: event.command,
                reason: event.reason,
              });
              useThreadStatusStore.getState().setStatus(event.thread_id, "waiting-approval");
              break;
            }

            case "process_error": {
              throw new Error(`Codex process error: ${event.message}`);
            }

            // turn_started, auth_changed — no UI action needed in the stream
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
  };
}

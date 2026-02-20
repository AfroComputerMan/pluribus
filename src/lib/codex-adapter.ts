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
import { getModelById, isCodexModel } from "@/lib/models";

// ---------------------------------------------------------------------------
// Protocol types (match Rust AgentEvent serde output with snake_case)
// ---------------------------------------------------------------------------

interface CodexItem {
  type:
    | "agent_message"
    | "reasoning"
    | "file_change"
    | "command_execution"
    | "web_search"
    | "plan_update"
    | "mcp_tool_call";
  [key: string]: unknown;
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
): { toolCallId: string; toolName: string; args: Record<string, never>; argsText: string } {
  return {
    toolCallId: itemId,
    toolName: item.type,
    args: item as unknown as Record<string, never>,
    argsText: JSON.stringify(item),
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

      // Start the turn via Rust backend
      const turnId = await invoke<string>("codex_send_turn", {
        threadId: codexThreadId,
        input: userText,
        cwd,
      });

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

      // Subscribe to Tauri events
      const unlistenPromise: Promise<UnlistenFn> = listen<AgentEvent>(
        "agent:event",
        ({ payload }) => {
          // Filter events for this thread
          if ("thread_id" in payload && payload.thread_id !== codexThreadId)
            return;
          push(payload);
        },
      );

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
              if (event.item.type !== "agent_message") {
                // Reset text accumulation for tool calls
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

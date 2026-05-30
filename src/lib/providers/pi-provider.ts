/**
 * Pi provider implementation.
 *
 * Implements the AgentProvider interface for the Pi backend (`pi --mode rpc`),
 * communicating with the Rust backend (`src-tauri/src/pi/`) via Tauri
 * invoke/listen. Mirrors codex-provider.ts but diverges on protocol:
 *
 *  - Pi is type-framed JSONL (NOT JSON-RPC); no initialize handshake.
 *  - Rust owns PID tracking — DO NOT call `ctx.onProcessStarted` (ADR 0003).
 *  - The terminator is `agent_end` (NOT `turn_end`).
 *  - Pi events carry NO session id; the Rust reader injects `session_id` into
 *    every `PiEvent`, and this provider filters incoming `pi:event` by it.
 *  - Streaming deltas: `text_delta` -> visible text, `thinking_delta` ->
 *    reasoning. `content_index` indexes the *current* assistant message and
 *    resets per turn, so we map it through per-turn index maps and reset on
 *    `turn_start`.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ChatModelRunResult } from "@assistant-ui/react";

import type { AgentProvider, DevEvent, RunContext } from "@/lib/providers/types";
import { PI_MODELS } from "@/lib/models";
import { log } from "@/lib/providers/shared";

// ---------------------------------------------------------------------------
// Protocol types — match the Rust `PiEvent` enum serde output.
//
// `#[serde(tag = "type", rename_all = "snake_case")]` => variant names become
// the `type` discriminator: AgentStart -> "agent_start", ToolStart ->
// "tool_start", etc. (NOT the raw Pi `tool_execution_*` names — the Rust
// reader already normalizes those.) Every variant carries `session_id`.
// ---------------------------------------------------------------------------

type PiEvent =
  | { type: "agent_start"; session_id: string }
  | { type: "turn_start"; session_id: string }
  | { type: "text_delta"; session_id: string; content_index: number; delta: string }
  | {
      type: "thinking_delta";
      session_id: string;
      content_index: number;
      delta: string;
    }
  | {
      type: "tool_start";
      session_id: string;
      tool_call_id: string;
      tool_name: string;
      args: unknown;
    }
  | {
      type: "tool_end";
      session_id: string;
      tool_call_id: string;
      tool_name: string;
      result: unknown;
      is_error: boolean;
    }
  | { type: "turn_end"; session_id: string }
  | { type: "agent_end"; session_id: string }
  | { type: "process_exit"; session_id: string; code: number | null }
  | { type: "process_error"; session_id: string; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ContentPart = NonNullable<ChatModelRunResult["content"]>[number];

function emitDevEvent(
  onDevEvent: ((event: DevEvent) => void) | undefined,
  category: string,
  data: unknown,
): void {
  if (onDevEvent) {
    onDevEvent({ category, data, timestamp: Date.now() });
  }
}

/** Derive the Pi provider name from a provider-prefixed model id. */
function providerFromModelId(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(0, slash) : modelId;
}

// ---------------------------------------------------------------------------
// createPiProvider
// ---------------------------------------------------------------------------

export function createPiProvider(): AgentProvider {
  return {
    id: "pi",
    displayName: "Pi",
    capabilities: {
      supportsResume: false,
      supportsApproval: false,
      supportsSubAgents: false,
      supportsMcp: false,
      supportsEffort: false,
    },
    supportedModels: PI_MODELS.map((m) => m.id),

    async *run(ctx: RunContext): AsyncGenerator<ChatModelRunResult, void> {
      const { prompt, model, abortSignal, threadId, onDevEvent } = ctx;

      if (!prompt.trim()) return;

      // 1:1 session_id == threadId for #17 (no clone/branch yet).
      const sessionId = threadId;
      const provider = providerFromModelId(model);

      log("pi-provider", "Starting session", { model, provider, sessionId });
      emitDevEvent(onDevEvent, "pi:start", { model, provider, sessionId });

      // Spawn (idempotent) the pi --mode rpc child for this session.
      await invoke("pi_start_session", { sessionId, provider, model });

      // NOTE: DO NOT call ctx.onProcessStarted — Rust owns PID tracking (ADR 0003).

      // Cumulative content yielded to assistant-ui (it diffs internally).
      const pendingContent: ContentPart[] = [];
      // Pi `content_index` -> pendingContent index (per content kind). These
      // reset on `turn_start` because content indices restart per turn/message.
      const textIdxByContentIndex = new Map<number, number>();
      const reasoningIdxByContentIndex = new Map<number, number>();
      const toolIdxById = new Map<string, number>();
      let closed = false;

      // Queue-based event processing for the async generator (verbatim codex idiom).
      const queue: Array<PiEvent | { _done: true } | { _error: string }> = [];
      let notify: (() => void) | null = null;

      function push(item: (typeof queue)[number]) {
        queue.push(item);
        notify?.();
        notify = null;
      }

      // Subscribe to Tauri events BEFORE prompting. Filter by injected session_id.
      const unlistenPromise: Promise<UnlistenFn> = listen<PiEvent>(
        "pi:event",
        ({ payload }) => {
          if (payload.session_id !== sessionId) return;
          push(payload);
        },
      );
      await unlistenPromise;

      // Send the prompt (fire-and-forget; events stream back on "pi:event").
      await invoke("pi_prompt", { sessionId, message: prompt });

      emitDevEvent(onDevEvent, "pi:prompt", { sessionId });

      // Handle abort: mid-turn cancel via pi_abort; the loop drains until
      // agent_end (~6ms). push _done as a safety net in case no event follows.
      const onAbort = () => {
        invoke("pi_abort", { sessionId }).catch(console.error);
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
            // Abort safety-net fired (pushed by onAbort) and won the race vs the
            // real agent_end. Emit a terminal status so assistant-ui doesn't leave
            // the message stuck in a running state.
            closed = true;
            yield {
              content: [...pendingContent],
              status: { type: "incomplete", reason: "cancelled" },
            } satisfies ChatModelRunResult;
            break;
          }

          if ("_error" in event) {
            throw new Error(event._error);
          }

          emitDevEvent(onDevEvent, `pi:${event.type}`, event);

          switch (event.type) {
            case "turn_start": {
              // Content indices restart per turn — reset the maps so a new
              // turn's content_index 0 maps to a fresh pendingContent slot.
              textIdxByContentIndex.clear();
              reasoningIdxByContentIndex.clear();
              break;
            }

            case "text_delta": {
              let idx = textIdxByContentIndex.get(event.content_index);
              if (idx === undefined) {
                idx = pendingContent.length;
                textIdxByContentIndex.set(event.content_index, idx);
                pendingContent.push({ type: "text", text: event.delta });
              } else {
                const existing = pendingContent[idx] as {
                  type: "text";
                  text: string;
                };
                pendingContent[idx] = {
                  type: "text",
                  text: existing.text + event.delta,
                };
              }
              yield { content: [...pendingContent] } satisfies ChatModelRunResult;
              break;
            }

            case "thinking_delta": {
              let idx = reasoningIdxByContentIndex.get(event.content_index);
              if (idx === undefined) {
                idx = pendingContent.length;
                reasoningIdxByContentIndex.set(event.content_index, idx);
                pendingContent.push({
                  type: "reasoning",
                  text: event.delta,
                } as ContentPart);
              } else {
                const existing = pendingContent[idx] as {
                  type: "reasoning";
                  text: string;
                };
                pendingContent[idx] = {
                  type: "reasoning",
                  text: existing.text + event.delta,
                } as ContentPart;
              }
              yield { content: [...pendingContent] } satisfies ChatModelRunResult;
              break;
            }

            case "tool_start": {
              const argsObj =
                event.args && typeof event.args === "object"
                  ? (event.args as Record<string, unknown>)
                  : {};
              const idx = pendingContent.length;
              toolIdxById.set(event.tool_call_id, idx);
              pendingContent.push({
                type: "tool-call",
                toolCallId: event.tool_call_id,
                toolName: event.tool_name,
                args: argsObj,
                argsText: JSON.stringify(argsObj),
              } as ContentPart);
              yield { content: [...pendingContent] } satisfies ChatModelRunResult;
              break;
            }

            case "tool_end": {
              const idx = toolIdxById.get(event.tool_call_id);
              if (idx !== undefined) {
                const existing = pendingContent[idx] as {
                  type: "tool-call";
                  toolCallId: string;
                  toolName: string;
                  args: Record<string, unknown>;
                  argsText?: string;
                };
                pendingContent[idx] = {
                  ...existing,
                  result: event.result,
                  isError: event.is_error,
                } as ContentPart;
                yield {
                  content: [...pendingContent],
                } satisfies ChatModelRunResult;
              }
              break;
            }

            case "turn_end": {
              // Intermediate — Pi may run multiple turns per prompt. Loop continues.
              break;
            }

            case "agent_end": {
              // TERMINATOR for the prompt (NOT turn_end).
              closed = true;
              yield {
                content: [...pendingContent],
                status: { type: "complete", reason: "stop" },
              } satisfies ChatModelRunResult;
              break;
            }

            case "process_error": {
              throw new Error(`Pi process error: ${event.message}`);
            }

            case "process_exit": {
              // Exit code 0 is normal (stdin EOF / abort). A non-zero code
              // mid-stream means the process died unexpectedly.
              if (event.code !== null && event.code !== 0) {
                throw new Error(`pi exited unexpectedly (code ${event.code})`);
              }
              // Clean exit (stdin EOF / pi_stop) before an agent_end was seen.
              // Emit a terminal status so the message doesn't hang in 'running'.
              closed = true;
              yield {
                content: [...pendingContent],
                status: abortSignal.aborted
                  ? { type: "incomplete", reason: "cancelled" }
                  : { type: "complete", reason: "stop" },
              } satisfies ChatModelRunResult;
              break;
            }

            case "agent_start":
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
      log("pi-provider", "Interrupting session", { threadId });
      // session_id == threadId for #17.
      await invoke("pi_abort", { sessionId: threadId });
    },
  };
}

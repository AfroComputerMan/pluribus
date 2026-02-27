/**
 * Agent SDK adapter for assistant-ui.
 *
 * Implements ChatModelAdapter by communicating with the agent-sdk-bridge
 * Bun sidecar over NDJSON on stdin/stdout via Tauri's shell plugin.
 *
 * The sidecar is spawned once (lazily on first query) and kept alive.
 * All queries are multiplexed over one channel using a per-query UUID.
 */
import { Command, type Child } from "@tauri-apps/plugin-shell";
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import { db } from "@/lib/db";
import {
  extractUserPrompt,
  pushClaudeDevEvent,
  type ClaudeDevEventCategory,
  type SidecarSdkMessage,
} from "@/lib/claude-adapter";
import { resolveModel, getModelById, resolveEffort } from "@/lib/models";
import { homeDir } from "@tauri-apps/api/path";

const GLOBAL_THREAD_KEY = "__global__";
const LOG_PREFIX = "[agent-sdk-adapter]";
const DEV_LOGS = import.meta.env.DEV;

function log(...args: unknown[]): void {
  if (DEV_LOGS) console.log(LOG_PREFIX, ...args);
}

// ---------------------------------------------------------------------------
// Sidecar protocol types
// ---------------------------------------------------------------------------

type SidecarInbound =
  | { type: "query"; id: string; prompt: string; sessionId?: string; model?: string; cwd?: string; maxTurns?: number }
  | { type: "interrupt"; queryId: string }
  | { type: "ping" };

type SidecarOutbound =
  | { type: "pong" }
  | { type: "message"; queryId: string; message: SidecarSdkMessage }
  | { type: "done"; queryId: string; sessionId: string; costUsd: number }
  | { type: "error"; queryId: string; error: string };

// ---------------------------------------------------------------------------
// AgentSdkSidecar — manages the long-running sidecar process
// ---------------------------------------------------------------------------

class AgentSdkSidecar {
  private child: Child | null = null;
  private starting: Promise<Child> | null = null;
  private lineBuffer = "";

  /** Map from queryId → callbacks for routing stdout events. */
  private handlers = new Map<string, {
    onMessage: (msg: SidecarSdkMessage) => void;
    onDone: (sessionId: string, costUsd: number) => void;
    onError: (error: string) => void;
  }>();

  /** Per-thread mutex: a chained promise so queries on the same thread serialize. */
  private threadLocks = new Map<string, Promise<void>>();

  /** Acquire the per-thread lock. Returns a release function. */
  async acquireLock(threadKey: string): Promise<() => void> {
    const previous = this.threadLocks.get(threadKey) ?? Promise.resolve();
    let releaseFn!: () => void;
    const next = previous.then(() => new Promise<void>((resolve) => {
      releaseFn = resolve;
    }));
    this.threadLocks.set(threadKey, next);
    await previous;
    return releaseFn;
  }

  /** Ensure the sidecar is running. Returns the child process. */
  async ensureRunning(): Promise<Child> {
    if (this.child) return this.child;
    if (this.starting) return this.starting;

    this.starting = this._start();
    try {
      this.child = await this.starting;
      return this.child;
    } finally {
      this.starting = null;
    }
  }

  private async _start(): Promise<Child> {
    log("starting sidecar...");
    const command = Command.sidecar("binaries/agent-sdk-bridge");

    command.stdout.on("data", (data: string) => {
      this.lineBuffer += data;
      let idx = this.lineBuffer.indexOf("\n");
      while (idx >= 0) {
        const line = this.lineBuffer.slice(0, idx).trim();
        this.lineBuffer = this.lineBuffer.slice(idx + 1);
        if (line) this.handleLine(line);
        idx = this.lineBuffer.indexOf("\n");
      }
    });

    command.stderr.on("data", (data: string) => {
      log("sidecar stderr:", data.trim());
    });

    command.on("close", () => {
      log("sidecar process closed — will restart on next query");
      this.child = null;
      for (const [queryId, h] of this.handlers) {
        h.onError("Sidecar process exited unexpectedly");
        this.handlers.delete(queryId);
      }
    });

    command.on("error", (err: string) => {
      console.error(LOG_PREFIX, "sidecar spawn error:", err);
      this.child = null;
    });

    const child = await command.spawn();
    log("sidecar started, pid:", child.pid);
    return child;
  }

  private handleLine(line: string): void {
    let msg: SidecarOutbound;
    try {
      msg = JSON.parse(line) as SidecarOutbound;
    } catch {
      log("non-JSON stdout line:", line.slice(0, 120));
      return;
    }

    if (msg.type === "pong") {
      log("pong received");
      return;
    }

    if (msg.type === "message" || msg.type === "done" || msg.type === "error") {
      const h = this.handlers.get(msg.queryId);
      if (!h) {
        log("no handler for queryId:", msg.queryId);
        return;
      }

      if (msg.type === "message") {
        h.onMessage(msg.message);
      } else if (msg.type === "done") {
        this.handlers.delete(msg.queryId);
        h.onDone(msg.sessionId, msg.costUsd);
      } else {
        this.handlers.delete(msg.queryId);
        h.onError(msg.error);
      }
    }
  }

  /** Send a message to the sidecar stdin. */
  async send(msg: SidecarInbound): Promise<void> {
    const child = await this.ensureRunning();
    await child.write(JSON.stringify(msg) + "\n");
  }

  /**
   * High-level: send a query and yield messages via an AsyncGenerator.
   */
  async *runQuery(params: {
    id: string;
    prompt: string;
    sessionId?: string;
    model?: string;
    cwd?: string;
    abortSignal: AbortSignal;
  }): AsyncGenerator<
    { message: SidecarSdkMessage } | { done: true; sessionId: string; costUsd: number },
    void
  > {
    const { id, prompt, sessionId, model, cwd, abortSignal } = params;

    const queue: Array<
      { message: SidecarSdkMessage }
      | { done: true; sessionId: string; costUsd: number }
      | { error: string }
    > = [];
    let notify: (() => void) | null = null;
    let finished = false;

    function push(item: (typeof queue)[number]) {
      queue.push(item);
      notify?.();
      notify = null;
    }

    this.handlers.set(id, {
      onMessage: (msg) => push({ message: msg }),
      onDone: (sid, cost) => { push({ done: true, sessionId: sid, costUsd: cost }); finished = true; },
      onError: (err) => { push({ error: err }); finished = true; },
    });

    const onAbort = () => {
      void this.send({ type: "interrupt", queryId: id });
    };
    if (abortSignal.aborted) {
      onAbort();
    } else {
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      await this.send({ type: "query", id, prompt, sessionId, model, cwd });

      while (true) {
        if (queue.length === 0) {
          if (finished) break;
          await new Promise<void>((r) => { notify = r; });
          continue;
        }

        const item = queue.shift()!;

        if ("error" in item) {
          throw new Error(item.error);
        }

        yield item;

        if ("done" in item) break;
      }
    } finally {
      abortSignal.removeEventListener("abort", onAbort);
      this.handlers.delete(id);
    }
  }
}

// Singleton sidecar — shared across all adapter instances
const sidecar = new AgentSdkSidecar();

// ---------------------------------------------------------------------------
// Content part types
// ---------------------------------------------------------------------------

/**
 * Alias so we can build a mutable array that still satisfies the readonly
 * constraint expected by ChatModelRunResult["content"].
 */
type ContentPart = NonNullable<ChatModelRunResult["content"]>[number];

/**
 * A single item in a sub-agent's activity log stored in the Task tool call's
 * `artifact` field. Mirrors what claude-tool-display.tsx renders.
 */
type SubAgentItem =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; toolCallId: string; toolName: string; args: Record<string, unknown>; argsText: string; result?: string; isError?: boolean };

/**
 * Extract a plain-text string from a tool_result content field, which can be
 * either a raw string or an array of typed content blocks.
 */
function extractToolResultText(
  content: Array<{ type: string; text?: string }> | string | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((c) => (c.type === "text" ? (c.text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

function sdkMessageCategory(msg: SidecarSdkMessage): ClaudeDevEventCategory {
  if (msg.type === "system") return "other";
  if (msg.type === "assistant" || msg.type === "user") return "messages";
  if (msg.type === "result") return "usage";
  return "other";
}

// ---------------------------------------------------------------------------
// createAgentSdkAdapter
// ---------------------------------------------------------------------------

export function createAgentSdkAdapter(): ChatModelAdapter {
  const cwdByThread = new Map<string, string>();
  const loadedThreadConfig = new Set<string>();

  return {
    async *run(options): AsyncGenerator<ChatModelRunResult, void> {
      const { messages, abortSignal } = options;
      const threadKey =
        (options as { unstable_threadId?: string }).unstable_threadId?.trim() ??
        GLOBAL_THREAD_KEY;

      if (!loadedThreadConfig.has(threadKey)) {
        const thread = await db.threads.get(threadKey);
        const storedCwd = thread?.cwd?.trim();
        if (storedCwd) cwdByThread.set(threadKey, storedCwd);
        loadedThreadConfig.add(threadKey);
      }

      const prompt = extractUserPrompt(messages);
      if (!prompt.trim()) return;

      const sessionRow = await db.sessions.get(threadKey);
      const sessionId = sessionRow?.session_id ?? undefined;

      const threadRow = await db.threads.get(threadKey);
      const model = resolveModel(threadRow?.model ?? null);
      const modelDef = getModelById(model);
      const effort = resolveEffort(threadRow?.effort ?? null);
      void effort;

      let cwd = cwdByThread.get(threadKey);
      if (!cwd) {
        try { cwd = await homeDir(); } catch { /* leave undefined */ }
      }

      const release = await sidecar.acquireLock(threadKey);

      try {
        const queryId = crypto.randomUUID();
        log("starting query:", queryId, { sessionId, model, cwd });

        // All content parts accumulated across every SDK turn for this run.
        // Each yield sends the full snapshot so assistant-ui replaces rather
        // than discards previous parts.
        const pendingContent: ContentPart[] = [];

        // Maps toolCallId → index in pendingContent for O(1) result injection
        // when the subsequent user turn arrives with tool_result blocks.
        const toolCallIdxById = new Map<string, number>();

        // Sub-agent activity: keyed by the parent_tool_use_id of the Task call.
        // Items accumulate as the sub-agent runs and are stored in the Task
        // tool call's `artifact` field so TaskTool can render them nested.
        const subAgentItemsByParent = new Map<string, SubAgentItem[]>();
        // Maps parent_tool_use_id → (subAgentToolCallId → index in subAgentItems)
        // for injecting tool results into sub-agent tool items.
        const subAgentToolIdxByParent = new Map<string, Map<string, number>>();

        let devSeq = 0;

        for await (const item of sidecar.runQuery({
          id: queryId,
          prompt,
          sessionId,
          model: modelDef ? model : undefined,
          cwd,
          abortSignal,
        })) {
          if ("done" in item) {
            const finalSessionId = item.sessionId || null;

            if (pendingContent.length > 0) {
              yield {
                content: pendingContent,
                status: { type: "complete", reason: "stop" },
              } satisfies ChatModelRunResult;
            }

            if (finalSessionId) {
              await db.sessions.upsert({
                thread_id: threadKey,
                session_id: finalSessionId,
                status: "active",
                last_updated_at: new Date().toISOString(),
              });
            }
            break;
          }

          const sdkMsg = item.message;

          pushClaudeDevEvent({
            id: `sdk-${queryId}-${devSeq++}`,
            at: Date.now(),
            threadKey,
            raw: JSON.stringify(sdkMsg),
            parsed: {
              type: sdkMsg.type as "assistant" | "user" | "result" | "system",
              subtype: sdkMsg.subtype,
              session_id: sdkMsg.session_id,
              result: sdkMsg.result,
              total_cost_usd: sdkMsg.total_cost_usd,
              usage: sdkMsg.usage,
            } as never,
            category: sdkMessageCategory(sdkMsg),
            sdkMessage: sdkMsg,
          });

          // ── assistant turn ──────────────────────────────────────────────
          if (sdkMsg.type === "assistant" && sdkMsg.message?.content) {
            const parentId = sdkMsg.parent_tool_use_id ?? null;

            if (parentId) {
              // Sub-agent message: accumulate into the parent Task's artifact.
              const items = subAgentItemsByParent.get(parentId) ?? [];
              const toolIdx = subAgentToolIdxByParent.get(parentId) ?? new Map<string, number>();

              for (const block of sdkMsg.message.content) {
                if (block.type === "thinking" && block.thinking) {
                  items.push({ type: "thinking", text: block.thinking });
                } else if (block.type === "text" && block.text) {
                  items.push({ type: "text", text: block.text });
                } else if (block.type === "tool_use" && block.id && block.name) {
                  const argsText = JSON.stringify(block.input ?? {});
                  let args: Record<string, unknown> = {};
                  try { args = JSON.parse(argsText) as Record<string, unknown>; } catch { /* empty */ }
                  toolIdx.set(block.id, items.length);
                  items.push({ type: "tool", toolCallId: block.id, toolName: block.name, args, argsText });
                }
              }

              subAgentItemsByParent.set(parentId, items);
              subAgentToolIdxByParent.set(parentId, toolIdx);

              // Push updated sub-agent items into the parent Task tool call's artifact.
              const parentTaskIdx = toolCallIdxById.get(parentId);
              if (parentTaskIdx !== undefined) {
                pendingContent[parentTaskIdx] = {
                  ...pendingContent[parentTaskIdx],
                  artifact: { subAgent: [...items] },
                } as ContentPart;
                yield { content: [...pendingContent] } satisfies ChatModelRunResult;
              }
            } else {
              // Top-level message: accumulate into pendingContent.
              let changed = false;
              for (const block of sdkMsg.message.content) {
                if (block.type === "thinking" && block.thinking) {
                  pendingContent.push({ type: "reasoning", text: block.thinking } as ContentPart);
                  changed = true;
                } else if (block.type === "text" && block.text) {
                  pendingContent.push({ type: "text", text: block.text });
                  changed = true;
                } else if (block.type === "tool_use" && block.id && block.name) {
                  const argsText = JSON.stringify(block.input ?? {});
                  let args: Record<string, never> = {};
                  try { args = JSON.parse(argsText) as Record<string, never>; } catch { /* empty */ }
                  toolCallIdxById.set(block.id, pendingContent.length);
                  pendingContent.push({
                    type: "tool-call" as const,
                    toolCallId: block.id,
                    toolName: block.name,
                    args,
                    argsText,
                  } as ContentPart);
                  changed = true;
                }
              }
              if (changed) {
                yield { content: [...pendingContent] } satisfies ChatModelRunResult;
              }
            }
          }

          // ── user turn ────────────────────────────────────────────────────
          if (sdkMsg.type === "user" && sdkMsg.message?.content) {
            const parentId = sdkMsg.parent_tool_use_id ?? null;

            if (parentId) {
              // Sub-agent tool results: inject into sub-agent items in the artifact.
              const items = subAgentItemsByParent.get(parentId);
              const toolIdx = subAgentToolIdxByParent.get(parentId);
              if (items && toolIdx) {
                let changed = false;
                for (const block of sdkMsg.message.content) {
                  if (block.type === "tool_result" && block.tool_use_id) {
                    const idx = toolIdx.get(block.tool_use_id);
                    if (idx !== undefined) {
                      const existing = items[idx];
                      if (existing?.type === "tool") {
                        items[idx] = {
                          ...existing,
                          result: extractToolResultText(block.content),
                          isError: block.is_error === true,
                        };
                        changed = true;
                      }
                    }
                  }
                }
                if (changed) {
                  const parentTaskIdx = toolCallIdxById.get(parentId);
                  if (parentTaskIdx !== undefined) {
                    pendingContent[parentTaskIdx] = {
                      ...pendingContent[parentTaskIdx],
                      artifact: { subAgent: [...items] },
                    } as ContentPart;
                    yield { content: [...pendingContent] } satisfies ChatModelRunResult;
                  }
                }
              }
            } else {
              // Top-level tool results: inject into pendingContent tool-call parts.
              let changed = false;
              for (const block of sdkMsg.message.content) {
                if (block.type === "tool_result" && block.tool_use_id) {
                  const idx = toolCallIdxById.get(block.tool_use_id);
                  if (idx !== undefined) {
                    pendingContent[idx] = {
                      ...pendingContent[idx],
                      result: extractToolResultText(block.content),
                      isError: block.is_error === true,
                    } as ContentPart;
                    changed = true;
                  }
                }
              }
              if (changed) {
                yield { content: [...pendingContent] } satisfies ChatModelRunResult;
              }
            }
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
        release();
      }
    },
  };
}

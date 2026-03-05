/**
 * Agent SDK Provider — implements AgentProvider for the Agent SDK sidecar.
 *
 * This is a FRESH implementation (not extracted from agent-sdk-adapter.ts).
 * The provider delegates protocol translation only; process lifecycle is
 * owned by the AgentProcessManager.
 */
import { Command, type Child } from "@tauri-apps/plugin-shell";
import type { ChatModelRunResult } from "@assistant-ui/react";
import type {
  AgentProvider,
  ProviderCapabilities,
  RunContext,
} from "@/lib/providers/types";
import { log } from "@/lib/providers/shared";
import { db } from "@/lib/db";
import { CLAUDE_MODELS } from "@/lib/models";

const LOG_PREFIX = "agent-sdk";

// ---------------------------------------------------------------------------
// Sidecar protocol types
// ---------------------------------------------------------------------------

/** Messages sent TO the sidecar via stdin. */
type SidecarInbound =
  | {
      type: "query";
      id: string;
      prompt: string;
      sessionId?: string;
      model?: string;
      cwd?: string;
      maxTurns?: number;
      configDir?: string;
    }
  | { type: "interrupt"; queryId: string }
  | { type: "ping" }
  | { type: "shutdown" };

/** Minimal shape of an SDK message forwarded from the sidecar. */
interface SidecarSdkMessage {
  type: "assistant" | "user" | "result" | "system" | "stream_event";
  subtype?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  message?: {
    content: Array<{
      type: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      is_error?: boolean;
      content?: Array<{ type: string; text?: string }> | string;
    }>;
  };
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
  tools?: string[];
  model?: string;
  cwd?: string;
}

/** Messages received FROM the sidecar via stdout. */
type SidecarOutbound =
  | { type: "pong" }
  | { type: "message"; queryId: string; message: SidecarSdkMessage }
  | { type: "done"; queryId: string; sessionId: string; costUsd: number }
  | { type: "error"; queryId: string; error: string };

// ---------------------------------------------------------------------------
// Content part type alias (matches assistant-ui's internal shape)
// ---------------------------------------------------------------------------

type ContentPart = NonNullable<ChatModelRunResult["content"]>[number];

// ---------------------------------------------------------------------------
// Sub-agent activity types (mirrors claude-tool-display.tsx rendering)
// ---------------------------------------------------------------------------

type SubAgentItem =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | {
      type: "tool";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      argsText: string;
      result?: string;
      isError?: boolean;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// AgentSdkSidecar — wraps the sidecar child process
// ---------------------------------------------------------------------------

interface MessageHandler {
  onMessage: (msg: SidecarSdkMessage) => void;
  onDone: (sessionId: string, costUsd: number) => void;
  onError: (error: string) => void;
}

export class AgentSdkSidecar {
  private child: Child | null = null;
  private starting: Promise<Child> | null = null;
  private lineBuffer = "";
  private alive = false;

  /** Per-queryId message routing. */
  private handlers = new Map<string, MessageHandler>();

  /** Health check interval handle. */
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private pongPending = false;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Public API ───────────────────────────────────────────────────────────

  /** Spawn the sidecar process and set up stdout NDJSON parsing. */
  async start(): Promise<Child> {
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

  /** Write an NDJSON line to the sidecar's stdin. */
  send(msg: SidecarInbound): void {
    if (!this.child) {
      log(LOG_PREFIX, "send() called but sidecar is not running");
      return;
    }
    // Child.write returns a Promise but we fire-and-forget here;
    // errors will surface via the close/error handlers.
    void this.child.write(JSON.stringify(msg) + "\n");
  }

  /**
   * Graceful shutdown: send shutdown message, wait for process close (max 3s),
   * then kill if still alive.
   */
  async shutdown(): Promise<void> {
    this.stopHealthCheck();

    if (!this.child) return;

    const child = this.child;

    // Send shutdown command
    this.send({ type: "shutdown" });

    // Wait for process to close (max 3s)
    const closed = await Promise.race([
      new Promise<boolean>((resolve) => {
        const check = setInterval(() => {
          if (!this.alive) {
            clearInterval(check);
            resolve(true);
          }
        }, 100);
        // Safety: clear interval after deadline
        setTimeout(() => {
          clearInterval(check);
          resolve(false);
        }, 3000);
      }),
    ]);

    if (!closed && this.alive) {
      log(LOG_PREFIX, "Sidecar did not exit within 3s, killing");
      try {
        await child.kill();
      } catch {
        // Process may have already exited
      }
    }

    this.child = null;
    this.alive = false;
  }

  /** Whether the sidecar child process is currently alive. */
  isAlive(): boolean {
    return this.alive;
  }

  /**
   * Register a handler for messages matching a specific queryId.
   * Returns an unsubscribe function.
   */
  onMessage(queryId: string, handler: MessageHandler): () => void {
    this.handlers.set(queryId, handler);
    return () => {
      this.handlers.delete(queryId);
    };
  }

  /** Get the Child handle (for process manager PID tracking). */
  getChild(): Child | null {
    return this.child;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async _start(): Promise<Child> {
    log(LOG_PREFIX, "starting sidecar...");
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
      log(LOG_PREFIX, "sidecar stderr:", data.trim());
    });

    command.on("close", () => {
      log(LOG_PREFIX, "sidecar process closed");
      this.alive = false;
      this.child = null;
      // Notify all pending handlers that the sidecar died
      for (const [queryId, h] of this.handlers) {
        h.onError("Sidecar process exited unexpectedly");
        this.handlers.delete(queryId);
      }
    });

    command.on("error", (err: string) => {
      log(LOG_PREFIX, "sidecar spawn error:", err);
      this.alive = false;
      this.child = null;
    });

    const child = await command.spawn();
    this.alive = true;
    log(LOG_PREFIX, "sidecar started, pid:", child.pid);

    // Start periodic health checks
    this.startHealthCheck();

    return child;
  }

  private handleLine(line: string): void {
    let msg: SidecarOutbound;
    try {
      msg = JSON.parse(line) as SidecarOutbound;
    } catch {
      log(LOG_PREFIX, "non-JSON stdout line:", line.slice(0, 120));
      return;
    }

    if (msg.type === "pong") {
      this.pongPending = false;
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
      }
      return;
    }

    if (msg.type === "message" || msg.type === "done" || msg.type === "error") {
      const h = this.handlers.get(msg.queryId);
      if (!h) {
        log(LOG_PREFIX, "no handler for queryId:", msg.queryId);
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

  /** Ping every 30s. If no pong within 5s, restart the sidecar. */
  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckInterval = setInterval(() => {
      if (!this.alive) return;

      this.pongPending = true;
      this.send({ type: "ping" });

      this.pongTimeout = setTimeout(() => {
        if (this.pongPending && this.alive) {
          log(LOG_PREFIX, "Health check failed — no pong within 5s, restarting sidecar");
          this.alive = false;
          // Kill the unresponsive process
          if (this.child) {
            void this.child.kill().catch(() => {});
          }
          this.child = null;
          // Restart on next query via start()
        }
      }, 5000);
    }, 30_000);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

const AGENT_SDK_CAPABILITIES: ProviderCapabilities = {
  supportsResume: true,
  supportsApproval: false,
  supportsSubAgents: true,
  supportsMcp: true,
  supportsEffort: true,
};

/**
 * Create an Agent SDK provider.
 *
 * The provider receives a sidecar accessor function -- it does NOT own or
 * spawn the sidecar process. The process manager is responsible for the
 * sidecar lifecycle.
 */
export function createAgentSdkProvider(
  getSidecar: () => AgentSdkSidecar,
): AgentProvider {
  /** Track active queryIds per thread for interrupt support. */
  const activeQueries = new Map<string, string>();

  return {
    id: "agent-sdk" as const,
    displayName: "Agent SDK",
    capabilities: AGENT_SDK_CAPABILITIES,
    supportedModels: CLAUDE_MODELS.map((m) => m.id),

    async *run(ctx: RunContext): AsyncGenerator<ChatModelRunResult, void> {
      const sidecar = getSidecar();
      // Ensure the sidecar process is running before sending queries
      await sidecar.start();
      const queryId = crypto.randomUUID();
      activeQueries.set(ctx.threadId, queryId);

      log(LOG_PREFIX, "starting query:", queryId, {
        sessionId: ctx.sessionId,
        model: ctx.model,
        threadId: ctx.threadId,
      });

      // Content accumulation across all SDK turns
      const pendingContent: ContentPart[] = [];
      const toolCallIdxById = new Map<string, number>();

      // Sub-agent activity tracking
      const subAgentItemsByParent = new Map<string, SubAgentItem[]>();
      const subAgentToolIdxByParent = new Map<string, Map<string, number>>();

      // Set up abort signal handler
      const onAbort = () => {
        sidecar.send({ type: "interrupt", queryId });
      };
      if (ctx.abortSignal.aborted) {
        onAbort();
      } else {
        ctx.abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      // Promise-based message queue
      const queue: Array<
        | { kind: "message"; message: SidecarSdkMessage }
        | { kind: "done"; sessionId: string; costUsd: number }
        | { kind: "error"; error: string }
      > = [];
      let notify: (() => void) | null = null;
      let finished = false;

      function push(item: (typeof queue)[number]) {
        queue.push(item);
        notify?.();
        notify = null;
      }

      const unsubscribe = sidecar.onMessage(queryId, {
        onMessage: (msg) => push({ kind: "message", message: msg }),
        onDone: (sid, cost) => {
          push({ kind: "done", sessionId: sid, costUsd: cost });
          finished = true;
        },
        onError: (err) => {
          push({ kind: "error", error: err });
          finished = true;
        },
      });

      try {
        // Send the query
        sidecar.send({
          type: "query",
          id: queryId,
          prompt: ctx.prompt,
          ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
          model: ctx.model,
          cwd: ctx.cwd,
        });

        // Process messages from the queue
        while (true) {
          if (queue.length === 0) {
            if (finished) break;
            await new Promise<void>((r) => {
              notify = r;
            });
            continue;
          }

          const item = queue.shift()!;

          if (item.kind === "error") {
            throw new Error(item.error);
          }

          if (item.kind === "done") {
            const finalSessionId = item.sessionId || null;

            if (pendingContent.length > 0) {
              yield {
                content: pendingContent,
                status: { type: "complete", reason: "stop" },
              } satisfies ChatModelRunResult;
            }

            if (finalSessionId) {
              await db.sessions.upsert({
                thread_id: ctx.threadId,
                session_id: finalSessionId,
                status: "active",
                last_updated_at: new Date().toISOString(),
              });
            }
            break;
          }

          // item.kind === "message"
          const sdkMsg = item.message;

          // Fire dev event
          ctx.onDevEvent?.({
            category: sdkMsg.type === "system"
              ? "other"
              : sdkMsg.type === "result"
                ? "usage"
                : "sidecar",
            data: sdkMsg,
            timestamp: Date.now(),
          });

          // ── assistant turn ────────────────────────────────────────────
          if (sdkMsg.type === "assistant" && sdkMsg.message?.content) {
            const parentId = sdkMsg.parent_tool_use_id ?? null;

            if (parentId) {
              // Sub-agent message
              const items = subAgentItemsByParent.get(parentId) ?? [];
              const toolIdx =
                subAgentToolIdxByParent.get(parentId) ??
                new Map<string, number>();

              for (const block of sdkMsg.message.content) {
                if (block.type === "thinking" && block.thinking) {
                  items.push({ type: "thinking", text: block.thinking });
                } else if (block.type === "text" && block.text) {
                  items.push({ type: "text", text: block.text });
                } else if (block.type === "tool_use" && block.id && block.name) {
                  const argsText = JSON.stringify(block.input ?? {});
                  let args: Record<string, unknown> = {};
                  try {
                    args = JSON.parse(argsText) as Record<string, unknown>;
                  } catch {
                    /* empty */
                  }
                  toolIdx.set(block.id, items.length);
                  items.push({
                    type: "tool",
                    toolCallId: block.id,
                    toolName: block.name,
                    args,
                    argsText,
                  });
                }
              }

              subAgentItemsByParent.set(parentId, items);
              subAgentToolIdxByParent.set(parentId, toolIdx);

              const parentTaskIdx = toolCallIdxById.get(parentId);
              if (parentTaskIdx !== undefined) {
                pendingContent[parentTaskIdx] = {
                  ...pendingContent[parentTaskIdx],
                  artifact: { subAgent: [...items] },
                } as ContentPart;
                yield {
                  content: [...pendingContent],
                } satisfies ChatModelRunResult;
              }
            } else {
              // Top-level message
              let changed = false;
              for (const block of sdkMsg.message.content) {
                if (block.type === "thinking" && block.thinking) {
                  pendingContent.push({
                    type: "reasoning",
                    text: block.thinking,
                  } as ContentPart);
                  changed = true;
                } else if (block.type === "text" && block.text) {
                  pendingContent.push({ type: "text", text: block.text });
                  changed = true;
                } else if (
                  block.type === "tool_use" &&
                  block.id &&
                  block.name
                ) {
                  const argsText = JSON.stringify(block.input ?? {});
                  let args: Record<string, never> = {};
                  try {
                    args = JSON.parse(argsText) as Record<string, never>;
                  } catch {
                    /* empty */
                  }
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
                yield {
                  content: [...pendingContent],
                } satisfies ChatModelRunResult;
              }
            }
          }

          // ── user turn (tool results) ──────────────────────────────────
          if (sdkMsg.type === "user" && sdkMsg.message?.content) {
            const parentId = sdkMsg.parent_tool_use_id ?? null;

            if (parentId) {
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
                    yield {
                      content: [...pendingContent],
                    } satisfies ChatModelRunResult;
                  }
                }
              }
            } else {
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
                yield {
                  content: [...pendingContent],
                } satisfies ChatModelRunResult;
              }
            }
          }
        }
      } catch (err) {
        if (ctx.abortSignal.aborted) {
          yield {
            content: [],
            status: { type: "incomplete", reason: "cancelled" },
          } satisfies ChatModelRunResult;
        } else {
          throw err;
        }
      } finally {
        ctx.abortSignal.removeEventListener("abort", onAbort);
        unsubscribe();
        activeQueries.delete(ctx.threadId);
      }
    },

    async interrupt(threadId: string): Promise<void> {
      const queryId = activeQueries.get(threadId);
      if (queryId) {
        const sidecar = getSidecar();
        sidecar.send({ type: "interrupt", queryId });
      }
    },
  };
}

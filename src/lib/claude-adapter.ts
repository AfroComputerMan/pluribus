import { Command } from "@tauri-apps/plugin-shell";
import type { ChatModelAdapter } from "@assistant-ui/react";

/**
 * Event shape emitted by `claude --output-format stream-json`.
 *
 * The CLI emits newline-delimited JSON with these event types:
 * - `system`    – session metadata (session_id)
 * - `assistant` – incremental content blocks (full text per block, not deltas)
 * - `result`    – final complete response text
 */
interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  message?: { content: Array<{ type: string; text?: string }> };
  result?: string;
  cost_usd?: number;
  session_id?: string;
  thread_id?: string;
  tools?: string[];
  mcp_servers?: Array<{ name?: string; status?: string }>;
  slash_commands?: string[];
  skills?: string[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  modelUsage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      contextWindow?: number;
      costUSD?: number;
    }
  >;
  total_cost_usd?: number;
}

/** Tracks Claude session IDs by assistant-ui thread ID (plus a global fallback). */
const sessionByThread = new Map<string, string>();
const GLOBAL_THREAD_KEY = "__global__";
const STORAGE_KEY_PREFIX = "claude-adapter:session:";
const activeThreadRuns = new Set<string>();
const pendingThreadRunWaiters = new Map<string, Array<() => void>>();
const MAX_DEV_EVENTS = 500;

export type ClaudeDevEventCategory =
  | "hooks"
  | "mcp"
  | "commands"
  | "skills"
  | "usage"
  | "messages"
  | "other";

export interface ClaudeDevEvent {
  id: string;
  at: number;
  threadKey: string;
  raw: string;
  parsed: ClaudeStreamEvent;
  category: ClaudeDevEventCategory;
}

export interface ClaudeDevSnapshot {
  events: ClaudeDevEvent[];
  latestInitEvent: ClaudeDevEvent | null;
  latestUsageEvent: ClaudeDevEvent | null;
  latestSessionId: string | null;
}

const devListeners = new Set<() => void>();
let devEventSeq = 0;
let devSnapshot: ClaudeDevSnapshot = {
  events: [],
  latestInitEvent: null,
  latestUsageEvent: null,
  latestSessionId: null,
};

/** Whether we've already run the one-time PATH diagnostic. */
let diagRan = false;

/**
 * Runs a one-time diagnostic to log the Tauri process PATH,
 * locate the `claude` binary, and verify it responds to --version.
 */
async function runDiagnostics(): Promise<void> {
  if (diagRan) return;
  diagRan = true;

  console.log("[claude-diag] Running environment diagnostics...");

  // 1. Print PATH and locate claude
  const pathCmd = Command.create("sh", [
    "-c",
    "echo PATH=$PATH && echo '---' && which claude 2>&1 && echo '---' && claude --version 2>&1",
  ]);

  pathCmd.stdout.on("data", (line: string) => {
    console.log("[claude-diag] stdout:", line);
  });
  pathCmd.stderr.on("data", (line: string) => {
    console.warn("[claude-diag] stderr:", line);
  });
  pathCmd.on("close", (data) => {
    console.log("[claude-diag] closed:", JSON.stringify(data));
  });
  pathCmd.on("error", (err: string) => {
    console.error("[claude-diag] error:", err);
  });

  try {
    await pathCmd.spawn();
  } catch (err) {
    console.error("[claude-diag] spawn failed:", err);
  }
}

/**
 * Resets the stored Claude CLI session ID.
 * Call this when starting a fresh conversation thread.
 */
export function resetClaudeSession(): void {
  sessionByThread.clear();
  clearPersistedSession(GLOBAL_THREAD_KEY);
}

function getThreadKey(threadId?: string | null): string {
  return threadId?.trim() || GLOBAL_THREAD_KEY;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getStorageKey(threadKey: string): string {
  return `${STORAGE_KEY_PREFIX}${threadKey}`;
}

function readPersistedSession(threadKey: string): string | null {
  if (!canUseStorage()) return null;
  try {
    const value = window.localStorage.getItem(getStorageKey(threadKey));
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function persistSession(threadKey: string, id: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(getStorageKey(threadKey), id);
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

function clearPersistedSession(threadKey: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(getStorageKey(threadKey));
  } catch {
    // Ignore storage failures.
  }
}

function getSessionForThread(threadKey: string): string | null {
  const inMemory = sessionByThread.get(threadKey);
  if (inMemory) return inMemory;

  const persisted = readPersistedSession(threadKey);
  if (persisted) {
    sessionByThread.set(threadKey, persisted);
    return persisted;
  }

  if (threadKey !== GLOBAL_THREAD_KEY) {
    const globalInMemory = sessionByThread.get(GLOBAL_THREAD_KEY);
    if (globalInMemory) return globalInMemory;

    const globalPersisted = readPersistedSession(GLOBAL_THREAD_KEY);
    if (globalPersisted) {
      sessionByThread.set(GLOBAL_THREAD_KEY, globalPersisted);
      return globalPersisted;
    }
  }

  return null;
}

function setSessionForThread(threadKey: string, id: string): void {
  sessionByThread.set(threadKey, id);
  persistSession(threadKey, id);
  if (threadKey !== GLOBAL_THREAD_KEY && !sessionByThread.has(GLOBAL_THREAD_KEY)) {
    sessionByThread.set(GLOBAL_THREAD_KEY, id);
    persistSession(GLOBAL_THREAD_KEY, id);
  }
}

function getEventCategory(event: ClaudeStreamEvent): ClaudeDevEventCategory {
  if (event.type === "system" && event.subtype?.startsWith("hook_")) return "hooks";
  if (event.type === "system" && event.subtype === "init") return "mcp";
  if (event.type === "assistant") return "messages";
  if (event.type === "result") return "usage";
  if (event.slash_commands?.length) return "commands";
  if (event.skills?.length) return "skills";
  return "other";
}

function notifyDevListeners(): void {
  for (const listener of devListeners) {
    listener();
  }
}

function pushDevEvent(raw: string, parsed: ClaudeStreamEvent, threadKey: string): void {
  const category = getEventCategory(parsed);
  const event: ClaudeDevEvent = {
    id: `${Date.now()}-${devEventSeq++}`,
    at: Date.now(),
    threadKey,
    raw,
    parsed,
    category,
  };

  const nextEvents =
    devSnapshot.events.length >= MAX_DEV_EVENTS
      ? [...devSnapshot.events.slice(1), event]
      : [...devSnapshot.events, event];

  devSnapshot = {
    events: nextEvents,
    latestInitEvent:
      parsed.type === "system" && parsed.subtype === "init"
        ? event
        : devSnapshot.latestInitEvent,
    latestUsageEvent:
      parsed.type === "result" && parsed.usage
        ? event
        : parsed.type === "assistant" && parsed.message?.content && parsed.usage
          ? event
          : devSnapshot.latestUsageEvent,
    latestSessionId: parsed.session_id ?? devSnapshot.latestSessionId,
  };

  notifyDevListeners();
}

export function getClaudeDevSnapshot(): ClaudeDevSnapshot {
  return devSnapshot;
}

export function subscribeClaudeDevSnapshot(listener: () => void): () => void {
  devListeners.add(listener);
  return () => {
    devListeners.delete(listener);
  };
}

export function clearClaudeDevSnapshot(): void {
  devSnapshot = {
    events: [],
    latestInitEvent: null,
    latestUsageEvent: null,
    latestSessionId: null,
  };
  notifyDevListeners();
}

async function acquireThreadRunLock(threadKey: string): Promise<void> {
  if (!activeThreadRuns.has(threadKey)) {
    activeThreadRuns.add(threadKey);
    return;
  }

  await new Promise<void>((resolve) => {
    const waiters = pendingThreadRunWaiters.get(threadKey) ?? [];
    waiters.push(resolve);
    pendingThreadRunWaiters.set(threadKey, waiters);
  });
}

function releaseThreadRunLock(threadKey: string): void {
  const waiters = pendingThreadRunWaiters.get(threadKey);
  if (waiters && waiters.length > 0) {
    const next = waiters.shift();
    if (!waiters.length) {
      pendingThreadRunWaiters.delete(threadKey);
    }
    next?.();
    return;
  }
  activeThreadRuns.delete(threadKey);
}

/**
 * Extracts the text content from the last user message in assistant-ui's
 * ThreadMessage format, concatenating all text parts.
 */
function extractUserPrompt(
  messages: Parameters<ChatModelAdapter["run"]>[0]["messages"],
): string {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) return "";

  return lastUserMsg.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/**
 * Item type for the async bridge queue between Tauri's event-based
 * stdout and the generator's pull-based consumption.
 */
type QueueItem = { text: string } | { done: true } | { error: Error };

/**
 * Creates a simple push/pull async queue.
 * The producer (stdout event handler) pushes items,
 * the consumer (async generator) pulls them.
 */
function createAsyncQueue() {
  const buffer: QueueItem[] = [];
  let waiting: ((item: QueueItem) => void) | null = null;

  const push = (item: QueueItem) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(item);
    } else {
      buffer.push(item);
    }
  };

  const pull = (): Promise<QueueItem> => {
    if (buffer.length > 0) {
      return Promise.resolve(buffer.shift()!);
    }
    return new Promise((resolve) => {
      waiting = resolve;
    });
  };

  return { push, pull };
}

/**
 * ChatModelAdapter that bridges the Claude CLI (via Tauri shell plugin)
 * into assistant-ui's LocalRuntime streaming interface.
 *
 * - Spawns `claude -p <prompt> --output-format stream-json`
 * - Uses `--resume <session_id>` for conversation continuity
 * - Parses newline-delimited JSON events from stdout
 * - Yields incremental text content to the runtime
 * - Supports cancellation via AbortSignal → child.kill()
 */
export const claudeAdapter: ChatModelAdapter = {
  async *run(options) {
    const { messages, abortSignal } = options;
    const threadId = (options as { unstable_threadId?: string }).unstable_threadId ?? null;
    const threadKey = getThreadKey(threadId);
    await acquireThreadRunLock(threadKey);

    try {
      // First invocation: dump PATH, which claude, and claude --version
      await runDiagnostics();

      const prompt = extractUserPrompt(messages);
      if (!prompt.trim()) return;

      // Spawn through `sh -c` — Tauri's direct process spawning (no shell/PTY)
      // causes Claude CLI to hang silently. Running via shell resolves this.
      const shellEscape = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
      const existingSessionId = getSessionForThread(threadKey);
      const cmdParts = ["claude", "-p", shellEscape(prompt), "--output-format", "stream-json", "--verbose"];
      if (existingSessionId) {
        // Reattach to the previous conversation for this thread.
        cmdParts.push("--resume", shellEscape(existingSessionId));
      }
      // H1a fix: redirect stdin from /dev/null to prevent Claude CLI from
      // blocking on an open stdin pipe (Tauri shell plugin keeps stdin open).
      const shellCmd = cmdParts.join(" ") + " < /dev/null";

      console.log("[claude-adapter] spawning:", shellCmd);
      const command = Command.create("sh", ["-c", shellCmd]);
      const { push, pull } = createAsyncQueue();

      // --- Wire up stdout event parsing (mirrors useClaude.ts logic) ---
      const handleStreamLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const event: ClaudeStreamEvent = JSON.parse(trimmed);
          pushDevEvent(trimmed, event, threadKey);
          if (event.session_id?.trim()) {
            setSessionForThread(threadKey, event.session_id);
          }

          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                push({ text: block.text });
              }
            }
          } else if (event.type === "result" && event.result) {
            push({ text: event.result });
          }
        } catch {
          // Skip unparseable lines (e.g. partial JSON)
        }
      };

      let stdoutBuffer = "";
      command.stdout.on("data", (chunk: string) => {
        console.log("[claude-adapter] stdout:", chunk);
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          handleStreamLine(line);
        }
      });

      // Capture stderr — Claude CLI may log errors/prompts here
      command.stderr.on("data", (line: string) => {
        console.warn("[claude-adapter] stderr:", line);
      });

      command.on("close", (data) => {
        if (stdoutBuffer.trim()) {
          handleStreamLine(stdoutBuffer);
        }
        stdoutBuffer = "";
        console.log("[claude-adapter] process closed:", JSON.stringify(data));
        push({ done: true });
      });
      command.on("error", (err: string) => {
        console.error("[claude-adapter] process error:", err);
        push({ error: new Error(`Claude CLI error: ${err}`) });
      });

      // Spawn the process
      let child;
      try {
        child = await command.spawn();
        console.log("[claude-adapter] spawned pid:", child.pid);
      } catch (err) {
        console.error("[claude-adapter] spawn failed:", err);
        throw err;
      }

      // Handle user cancellation (cancel button / Escape key)
      const onAbort = () => {
        child.kill();
        push({ done: true });
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });

      try {
        // Pull from the queue and yield to LocalRuntime
        while (true) {
          const item = await pull();
          if ("done" in item) break;
          if ("error" in item) throw item.error;

          yield {
            content: [{ type: "text" as const, text: item.text }],
          };
        }
      } finally {
        abortSignal.removeEventListener("abort", onAbort);
      }
    } finally {
      releaseThreadRunLock(threadKey);
    }
  },
};

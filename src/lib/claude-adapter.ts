import { Command } from "@tauri-apps/plugin-shell";
import type { ChatModelAdapter } from "@assistant-ui/react";

interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  message?: { content: Array<{ type: string; text?: string }> };
  result?: string;
  cost_usd?: number;
  session_id?: string;
  thread_id?: string;
  cwd?: string;
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
  errors?: string[];
}

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

export interface ClaudeAdapterOptions {
  threadKey?: string;
  onUserPrompt?: (prompt: string) => void;
}

export type ClaudeSessionStatus =
  | "unknown"
  | "resume_ok"
  | "stale"
  | "in_use"
  | "session_id_ok"
  | "fallback_new"
  | "error";

export type ClaudeSessionLocalCache = "unknown" | "present" | "missing";

export interface ClaudeSessionRecord {
  threadKey: string;
  sessionId: string;
  status: ClaudeSessionStatus;
  localCache: ClaudeSessionLocalCache;
  strategy: "resume" | "session-id" | "none";
  lastCheckedAt: number | null;
  lastUpdatedAt: number;
  lastError: string | null;
}

const devListeners = new Set<() => void>();
let devEventSeq = 0;
let devSnapshot: ClaudeDevSnapshot = {
  events: [],
  latestInitEvent: null,
  latestUsageEvent: null,
  latestSessionId: null,
};

const sessionRecords = new Map<string, ClaudeSessionRecord>();
const sessionListeners = new Set<() => void>();
const cwdByThread = new Map<string, string>();
let sessionRecordsSnapshot: ClaudeSessionRecord[] = [];

let diagRan = false;

async function runDiagnostics(): Promise<void> {
  if (diagRan) return;
  diagRan = true;

  console.log("[claude-diag] Running environment diagnostics...");

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
    // ignore
  }
}

function clearPersistedSession(threadKey: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(getStorageKey(threadKey));
  } catch {
    // ignore
  }
}

function notifySessionListeners(): void {
  sessionRecordsSnapshot = Array.from(sessionRecords.values()).sort(
    (a, b) => b.lastUpdatedAt - a.lastUpdatedAt,
  );
  for (const listener of sessionListeners) {
    listener();
  }
}

function upsertSessionRecord(
  threadKey: string,
  sessionId: string,
  patch: Partial<ClaudeSessionRecord>,
): void {
  const current = sessionRecords.get(threadKey);
  const next: ClaudeSessionRecord = {
    threadKey,
    sessionId,
    status: current?.status ?? "unknown",
    localCache: current?.localCache ?? "unknown",
    strategy: current?.strategy ?? "none",
    lastCheckedAt: current?.lastCheckedAt ?? null,
    lastUpdatedAt: Date.now(),
    lastError: current?.lastError ?? null,
    ...patch,
  };
  sessionRecords.set(threadKey, next);
  notifySessionListeners();
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

  upsertSessionRecord(threadKey, id, {
    status: "unknown",
    localCache: "unknown",
    strategy: "none",
    lastError: null,
  });
}

function clearSessionForThread(threadKey: string): void {
  const prior = sessionByThread.get(threadKey) ?? readPersistedSession(threadKey) ?? null;

  sessionByThread.delete(threadKey);
  clearPersistedSession(threadKey);

  const global =
    sessionByThread.get(GLOBAL_THREAD_KEY) ?? readPersistedSession(GLOBAL_THREAD_KEY) ?? null;

  if (threadKey === GLOBAL_THREAD_KEY || (prior && global === prior)) {
    sessionByThread.delete(GLOBAL_THREAD_KEY);
    clearPersistedSession(GLOBAL_THREAD_KEY);
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

export function getClaudeSessionRecords(): ClaudeSessionRecord[] {
  return sessionRecordsSnapshot;
}

export function subscribeClaudeSessionRecords(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

async function checkSessionExistsInLocalCache(sessionId: string, cwd: string): Promise<boolean> {
  const shellEscape = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const script = [
    `sid=${shellEscape(sessionId)}`,
    `dir=${shellEscape(cwd)}`,
    'while [ "$dir" != "/" ] && [ -n "$dir" ]; do',
    '  key=$(printf "%s" "$dir" | sed "s#/#-#g")',
    '  path="$HOME/.claude/projects/$key/$sid.jsonl"',
    '  if [ -f "$path" ]; then',
    '    echo "present"',
    "    exit 0",
    "  fi",
    '  parent=$(dirname "$dir")',
    '  if [ "$parent" = "$dir" ]; then',
    "    break",
    "  fi",
    '  dir="$parent"',
    "done",
    'echo "missing"',
  ].join("\n");

  return await new Promise<boolean>((resolve) => {
    let output = "";
    const cmd = Command.create("sh", ["-c", script]);
    cmd.stdout.on("data", (line: string) => {
      output += line;
    });
    cmd.stderr.on("data", () => {
      // ignore
    });
    cmd.on("close", () => {
      resolve(output.includes("present"));
    });
    cmd.on("error", () => {
      resolve(false);
    });
    cmd.spawn().catch(() => resolve(false));
  });
}

export async function refreshClaudeSessionRecords(): Promise<void> {
  const entries = Array.from(sessionRecords.values());
  for (const record of entries) {
    const cwd = cwdByThread.get(record.threadKey);
    if (!cwd) {
      upsertSessionRecord(record.threadKey, record.sessionId, {
        localCache: "unknown",
        lastCheckedAt: Date.now(),
      });
      continue;
    }

    const exists = await checkSessionExistsInLocalCache(record.sessionId, cwd);
    upsertSessionRecord(record.threadKey, record.sessionId, {
      localCache: exists ? "present" : "missing",
      status: exists ? record.status : "stale",
      lastCheckedAt: Date.now(),
      lastError: exists ? record.lastError : "Session missing from local cache index",
    });
  }
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

type QueueItem = { text: string } | { done: true } | { error: Error };

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

function chooseSessionStrategy(threadKey: string, sessionId: string | null): {
  strategy: "resume" | "session-id" | "none";
  sessionId: string | null;
} {
  if (!sessionId) {
    return { strategy: "none", sessionId: null };
  }

  const record = sessionRecords.get(threadKey);
  if (record?.localCache === "missing" || record?.status === "stale") {
    return { strategy: "session-id", sessionId };
  }

  return { strategy: "resume", sessionId };
}

export function createClaudeAdapter(adapterOptions?: ClaudeAdapterOptions): ChatModelAdapter {
  return {
    async *run(options) {
      const { messages, abortSignal } = options;
      const threadId = (options as { unstable_threadId?: string }).unstable_threadId ?? null;
      const threadKey = adapterOptions?.threadKey ?? getThreadKey(threadId);
      await acquireThreadRunLock(threadKey);

      try {
        await runDiagnostics();

        const prompt = extractUserPrompt(messages);
        if (!prompt.trim()) return;
        adapterOptions?.onUserPrompt?.(prompt);

        const shellEscape = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

        let knownSessionId = getSessionForThread(threadKey);
        let lastAttempt = 0;

        while (lastAttempt < 3) {
          lastAttempt += 1;

          const { strategy, sessionId } = chooseSessionStrategy(threadKey, knownSessionId);
          const cmdParts = ["claude", "-p", shellEscape(prompt), "--output-format", "stream-json", "--verbose"];

          if (strategy === "resume" && sessionId) {
            cmdParts.push("--resume", shellEscape(sessionId));
          } else if (strategy === "session-id" && sessionId) {
            cmdParts.push("--session-id", shellEscape(sessionId));
          }

          const shellCmd = cmdParts.join(" ") + " < /dev/null";
          console.log("[claude-adapter] spawning:", shellCmd);

          const command = Command.create("sh", ["-c", shellCmd]);
          const { push, pull } = createAsyncQueue();

          let missingConversation = false;
          let sessionInUse = false;

          const handleStreamLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;

            try {
              const event: ClaudeStreamEvent = JSON.parse(trimmed);
              pushDevEvent(trimmed, event, threadKey);

              if (event.type === "system" && event.subtype === "init" && typeof event.cwd === "string") {
                cwdByThread.set(threadKey, event.cwd);
              }

              if (event.session_id?.trim()) {
                setSessionForThread(threadKey, event.session_id);
                knownSessionId = event.session_id;
              }

              if (
                event.type === "result" &&
                event.subtype === "error_during_execution" &&
                event.errors?.some((e) => e.includes("No conversation found with session ID"))
              ) {
                missingConversation = true;
                if (knownSessionId) {
                  upsertSessionRecord(threadKey, knownSessionId, {
                    status: "stale",
                    localCache: "missing",
                    strategy,
                    lastCheckedAt: Date.now(),
                    lastError: "No conversation found with session ID",
                  });
                }
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
              // ignore parse errors
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

          command.stderr.on("data", (line: string) => {
            console.warn("[claude-adapter] stderr:", line);
            if (line.includes("No conversation found with session ID")) {
              missingConversation = true;
              if (knownSessionId) {
                upsertSessionRecord(threadKey, knownSessionId, {
                  status: "stale",
                  localCache: "missing",
                  strategy,
                  lastCheckedAt: Date.now(),
                  lastError: "No conversation found with session ID",
                });
              }
            }
            if (line.includes("already in use")) {
              sessionInUse = true;
              if (knownSessionId) {
                upsertSessionRecord(threadKey, knownSessionId, {
                  status: "in_use",
                  strategy,
                  lastCheckedAt: Date.now(),
                  lastError: line.trim(),
                });
              }
            }
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

          let child;
          try {
            child = await command.spawn();
            console.log("[claude-adapter] spawned pid:", child.pid);
          } catch (err) {
            console.error("[claude-adapter] spawn failed:", err);
            throw err;
          }

          const onAbort = () => {
            child.kill();
            push({ done: true });
          };
          abortSignal.addEventListener("abort", onAbort, { once: true });

          try {
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

          if (knownSessionId) {
            upsertSessionRecord(threadKey, knownSessionId, {
              status:
                strategy === "resume"
                  ? "resume_ok"
                  : strategy === "session-id"
                    ? "session_id_ok"
                    : "fallback_new",
              strategy,
              localCache:
                strategy === "session-id"
                  ? "present"
                  : sessionRecords.get(threadKey)?.localCache ?? "unknown",
              lastCheckedAt: Date.now(),
              lastError: null,
            });
          }

          if (missingConversation && strategy === "resume" && knownSessionId) {
            clearSessionForThread(threadKey);
            sessionByThread.set(threadKey, knownSessionId);
            persistSession(threadKey, knownSessionId);
            upsertSessionRecord(threadKey, knownSessionId, {
              status: "stale",
              localCache: "missing",
              strategy: "session-id",
              lastCheckedAt: Date.now(),
              lastError: "Resume failed; retrying with --session-id",
            });
            continue;
          }

          if (sessionInUse && strategy === "session-id") {
            clearSessionForThread(threadKey);
            knownSessionId = null;
            continue;
          }

          break;
        }
      } finally {
        releaseThreadRunLock(threadKey);
      }
    },
  };
}

export const claudeAdapter: ChatModelAdapter = createClaudeAdapter();

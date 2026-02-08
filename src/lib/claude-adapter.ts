import { Command, type Child } from "@tauri-apps/plugin-shell";
import type { ChatModelAdapter } from "@assistant-ui/react";

type ClaudeStreamEventBase = {
  subtype?: string;
  is_error?: boolean;
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
};

type ClaudeSystemEvent = ClaudeStreamEventBase & {
  type: "system";
};

type ClaudeAssistantEvent = ClaudeStreamEventBase & {
  type: "assistant";
  message?: { content: Array<{ type: string; text?: string }> };
};

type ClaudeResultEvent = ClaudeStreamEventBase & {
  type: "result";
  result?: string;
};

type ClaudeStreamEvent = ClaudeSystemEvent | ClaudeAssistantEvent | ClaudeResultEvent;

const sessionByThread = new Map<string, string>();
const GLOBAL_THREAD_KEY = "__global__";
const STORAGE_KEY_PREFIX = "claude-adapter:session:";
const activeThreadRuns = new Set<string>();
const pendingThreadRunWaiters = new Map<string, Array<() => void>>();
const MAX_DEV_EVENTS = 500;
const THREAD_LOCK_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 120_000;
const DEV_LOGS = import.meta.env.DEV;
const CLAUDE_SHELL_SCRIPT =
  'if [ "$CLAUDE_MODE" = "resume" ]; then exec claude -p "$CLAUDE_PROMPT" --output-format stream-json --verbose --resume "$CLAUDE_SESSION_ID" < /dev/null; elif [ "$CLAUDE_MODE" = "session-id" ]; then exec claude -p "$CLAUDE_PROMPT" --output-format stream-json --verbose --session-id "$CLAUDE_SESSION_ID" < /dev/null; else exec claude -p "$CLAUDE_PROMPT" --output-format stream-json --verbose < /dev/null; fi';

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
let devSnapshot: Omit<ClaudeDevSnapshot, "events"> = {
  latestInitEvent: null,
  latestUsageEvent: null,
  latestSessionId: null,
};
const devEventsBuffer: Array<ClaudeDevEvent | undefined> = new Array(MAX_DEV_EVENTS);
let devEventsHead = 0;
let devEventsCount = 0;
let devEventsVersion = 0;
let devEventsSnapshotVersion = -1;
let devEventsSnapshot: ClaudeDevEvent[] = [];
let devSnapshotVersion = 0;
let cachedDevSnapshotVersion = -1;
let cachedDevSnapshot: ClaudeDevSnapshot = {
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

function devLog(...args: unknown[]): void {
  if (DEV_LOGS) {
    console.log(...args);
  }
}

function devWarn(...args: unknown[]): void {
  if (DEV_LOGS) {
    console.warn(...args);
  }
}

function devError(...args: unknown[]): void {
  console.error(...args);
}

async function runDiagnostics(): Promise<void> {
  if (!DEV_LOGS || diagRan) return;
  diagRan = true;

  devLog("[claude-diag] Running environment diagnostics...");

  const pathCmd = Command.create("claude", ["--version"]);

  pathCmd.stdout.on("data", (line: string) => {
    devLog("[claude-diag] stdout:", line);
  });
  pathCmd.stderr.on("data", (line: string) => {
    devWarn("[claude-diag] stderr:", line);
  });
  pathCmd.on("close", (data) => {
    devLog("[claude-diag] closed:", JSON.stringify(data));
  });
  pathCmd.on("error", (err: string) => {
    devError("[claude-diag] error:", err);
  });

  try {
    await pathCmd.spawn();
  } catch (err) {
    devError("[claude-diag] spawn failed:", err);
  }
}

export function resetClaudeSession(): void {
  if (canUseStorage()) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key?.startsWith(STORAGE_KEY_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }
  sessionByThread.clear();
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

  return null;
}

function setSessionForThread(threadKey: string, id: string): void {
  sessionByThread.set(threadKey, id);
  persistSession(threadKey, id);

  upsertSessionRecord(threadKey, id, {
    status: "unknown",
    localCache: "unknown",
    strategy: "none",
    lastError: null,
  });
}

function clearSessionForThread(threadKey: string): void {
  sessionByThread.delete(threadKey);
  clearPersistedSession(threadKey);
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

function pushDevEventToBuffer(event: ClaudeDevEvent): void {
  if (devEventsCount < MAX_DEV_EVENTS) {
    const index = (devEventsHead + devEventsCount) % MAX_DEV_EVENTS;
    devEventsBuffer[index] = event;
    devEventsCount += 1;
  } else {
    devEventsBuffer[devEventsHead] = event;
    devEventsHead = (devEventsHead + 1) % MAX_DEV_EVENTS;
  }
  devEventsVersion += 1;
}

function getDevEventsSnapshot(): ClaudeDevEvent[] {
  if (devEventsSnapshotVersion === devEventsVersion) {
    return devEventsSnapshot;
  }

  const next: ClaudeDevEvent[] = new Array(devEventsCount);
  for (let i = 0; i < devEventsCount; i += 1) {
    next[i] = devEventsBuffer[(devEventsHead + i) % MAX_DEV_EVENTS]!;
  }
  devEventsSnapshot = next;
  devEventsSnapshotVersion = devEventsVersion;
  return next;
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

  pushDevEventToBuffer(event);

  devSnapshot = {
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
  devSnapshotVersion += 1;

  notifyDevListeners();
}

export function getClaudeDevSnapshot(): ClaudeDevSnapshot {
  if (cachedDevSnapshotVersion === devSnapshotVersion) {
    return cachedDevSnapshot;
  }
  cachedDevSnapshot = {
    ...devSnapshot,
    events: getDevEventsSnapshot(),
  };
  cachedDevSnapshotVersion = devSnapshotVersion;
  return cachedDevSnapshot;
}

export function subscribeClaudeDevSnapshot(listener: () => void): () => void {
  devListeners.add(listener);
  return () => {
    devListeners.delete(listener);
  };
}

export function clearClaudeDevSnapshot(): void {
  devEventsHead = 0;
  devEventsCount = 0;
  devEventsVersion += 1;
  devSnapshot = {
    latestInitEvent: null,
    latestUsageEvent: null,
    latestSessionId: null,
  };
  devSnapshotVersion += 1;
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
    upsertSessionRecord(record.threadKey, record.sessionId, {
      localCache: "unknown",
      status: record.status,
      lastCheckedAt: Date.now(),
      lastError: record.lastError,
    });
  }
}

async function acquireThreadRunLock(threadKey: string): Promise<void> {
  if (!activeThreadRuns.has(threadKey)) {
    activeThreadRuns.add(threadKey);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const waiters = pendingThreadRunWaiters.get(threadKey) ?? [];

    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const currentWaiters = pendingThreadRunWaiters.get(threadKey);
      if (currentWaiters) {
        const idx = currentWaiters.indexOf(release);
        if (idx >= 0) currentWaiters.splice(idx, 1);
        if (!currentWaiters.length) pendingThreadRunWaiters.delete(threadKey);
      }
      reject(new Error(`Timed out waiting for thread lock: ${threadKey}`));
    }, THREAD_LOCK_TIMEOUT_MS);

    waiters.push(release);
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
  const waiters: Array<(item: QueueItem) => void> = [];

  const push = (item: QueueItem) => {
    const resolve = waiters.shift();
    if (resolve) {
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
      waiters.push(resolve);
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
      const threadKey =
        adapterOptions?.threadKey ?? options.unstable_threadId?.trim() ?? GLOBAL_THREAD_KEY;
      await acquireThreadRunLock(threadKey);

      try {
        await runDiagnostics();

        const prompt = extractUserPrompt(messages);
        if (!prompt.trim()) return;
        adapterOptions?.onUserPrompt?.(prompt);

        let knownSessionId = getSessionForThread(threadKey);
        let lastAttempt = 0;

        while (lastAttempt < 3) {
          lastAttempt += 1;

          const { strategy, sessionId } = chooseSessionStrategy(threadKey, knownSessionId);
          const attemptedSessionId = sessionId;
          const sessionMode = strategy === "resume" ? "resume" : strategy === "session-id" ? "session-id" : "none";
          const debugArgs = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
          if (sessionMode === "resume" && sessionId) {
            debugArgs.push("--resume", sessionId);
          } else if (sessionMode === "session-id" && sessionId) {
            debugArgs.push("--session-id", sessionId);
          }

          devLog("[claude-adapter] spawning:", ["claude", ...debugArgs].join(" "));
          const command = Command.create("claude-stream-sh", ["-c", CLAUDE_SHELL_SCRIPT], {
            env: {
              CLAUDE_MODE: sessionMode,
              CLAUDE_PROMPT: prompt,
              CLAUDE_SESSION_ID: sessionId ?? "",
            },
          });
          const { push, pull } = createAsyncQueue();

          let missingConversation = false;
          let sessionInUse = false;
          let latestSessionId: string | null = null;
          let sawAssistantText = false;
          let exitCode: number | null = null;
          let exitSignal: number | null = null;
          let timedOut = false;
          let wasAborted = abortSignal.aborted;

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
                knownSessionId = event.session_id;
                latestSessionId = event.session_id;
              }

              if (
                event.type === "result" &&
                event.subtype === "error_during_execution" &&
                event.errors?.some((e) => e.includes("No conversation found with session ID"))
              ) {
                missingConversation = true;
                const staleSessionId = attemptedSessionId ?? knownSessionId;
                if (staleSessionId) {
                  upsertSessionRecord(threadKey, staleSessionId, {
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
                    sawAssistantText = true;
                    push({ text: block.text });
                  }
                }
              } else if (event.type === "result" && event.result && !sawAssistantText) {
                push({ text: event.result });
              }
            } catch {
              // ignore parse errors
            }
          };

          let stdoutBuffer = "";
          command.stdout.on("data", (chunk: string) => {
            devLog("[claude-adapter] stdout:", chunk);
            stdoutBuffer += chunk;
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop() ?? "";
            for (const line of lines) {
              handleStreamLine(line);
            }
          });

          command.stderr.on("data", (line: string) => {
            devWarn("[claude-adapter] stderr:", line);
            if (line.includes("No conversation found with session ID")) {
              missingConversation = true;
              const staleSessionId = attemptedSessionId ?? knownSessionId;
              if (staleSessionId) {
                upsertSessionRecord(threadKey, staleSessionId, {
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
            exitCode = data.code;
            exitSignal = data.signal;
            if (stdoutBuffer.trim()) {
              handleStreamLine(stdoutBuffer);
            }
            stdoutBuffer = "";
            if (data.code === 0 && latestSessionId && !missingConversation && !sessionInUse) {
              setSessionForThread(threadKey, latestSessionId);
            }
            devLog("[claude-adapter] process closed:", JSON.stringify(data));
            push({ done: true });
          });

          command.on("error", (err: string) => {
            devError("[claude-adapter] process error:", err);
            push({ error: new Error(`Claude CLI error: ${err}`) });
          });

          let child: Child;
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
          try {
            child = await command.spawn();
            devLog("[claude-adapter] spawned pid:", child.pid);
            timeoutHandle = setTimeout(() => {
              timedOut = true;
              void child.kill();
            }, RUN_TIMEOUT_MS);
          } catch (err) {
            devError("[claude-adapter] spawn failed:", err);
            throw err;
          }

          const onAbort = () => {
            wasAborted = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            void child.kill();
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
            if (timeoutHandle) clearTimeout(timeoutHandle);
          }

          if (timedOut) {
            throw new Error(`Claude CLI timed out after ${RUN_TIMEOUT_MS}ms`);
          }

          if (
            !wasAborted &&
            exitCode !== null &&
            exitCode !== 0 &&
            !missingConversation &&
            !sessionInUse
          ) {
            const signalSuffix = exitSignal !== null ? ` (signal ${exitSignal})` : "";
            throw new Error(`Claude CLI exited with code ${exitCode}${signalSuffix}`);
          }

          if (knownSessionId && !missingConversation && !sessionInUse) {
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

          if (missingConversation && strategy === "resume") {
            const staleSessionId = attemptedSessionId ?? knownSessionId;
            clearSessionForThread(threadKey);
            if (staleSessionId) {
              upsertSessionRecord(threadKey, staleSessionId, {
                status: "stale",
                localCache: "missing",
                strategy: "none",
                lastCheckedAt: Date.now(),
                lastError: "Resume failed; retrying with a fresh session",
              });
            }
            knownSessionId = null;
            continue;
          }

          if (missingConversation && strategy === "session-id") {
            clearSessionForThread(threadKey);
            knownSessionId = null;
            continue;
          }

          if (sessionInUse && (strategy === "session-id" || strategy === "resume")) {
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeThreadRuns.clear();
    pendingThreadRunWaiters.clear();
    sessionByThread.clear();
    cwdByThread.clear();
    sessionRecords.clear();
    sessionRecordsSnapshot = [];
    devListeners.clear();
    sessionListeners.clear();
    devEventsHead = 0;
    devEventsCount = 0;
  });
}

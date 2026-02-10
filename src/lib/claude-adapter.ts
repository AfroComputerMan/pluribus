import { Command } from "@tauri-apps/plugin-shell";
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import { db } from "@/lib/db";
import { queueDevEventForArchive } from "@/lib/dev-event-batcher";
import { prefetchTitle } from "@/lib/sqlite-thread-list-adapter";

type ClaudeStreamEventBase = {
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    tool_name?: string;
    text?: string;
    thinking?: string;
    input?: unknown;
  };
  subtype?: string;
  is_error?: boolean;
  message?: {
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      tool_name?: string;
      input?: unknown;
      thinking?: string;
      tool_use_id?: string;
      content?: unknown;
      result?: unknown;
      is_error?: boolean;
      error?: string;
    }>;
  };
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
  message?: ClaudeStreamEventBase["message"];
};

type ClaudeResultEvent = ClaudeStreamEventBase & {
  type: "result";
  result?: string;
};

type ClaudeStreamEvent =
  | ClaudeSystemEvent
  | ClaudeAssistantEvent
  | ClaudeResultEvent;

const sessionByThread = new Map<string, string>();
const GLOBAL_THREAD_KEY = "__global__";
const activeThreadRuns = new Set<string>();
const pendingThreadRunWaiters = new Map<string, Array<() => void>>();
const MAX_DEV_EVENTS = 500;
const THREAD_LOCK_TIMEOUT_MS = 60_000;
const DEV_LOGS = import.meta.env.DEV;
const ADAPTER_REV = "claude-adapter-reset-baseline-v2";

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

export interface ClaudePermissionRequest {
  id: string;
  threadKey: string;
  prompt: string;
  createdAt: number;
  resolved: boolean;
}

const devListeners = new Set<() => void>();
let devEventSeq = 0;
let devSnapshot: Omit<ClaudeDevSnapshot, "events"> = {
  latestInitEvent: null,
  latestUsageEvent: null,
  latestSessionId: null,
};
const devEventsBuffer: Array<ClaudeDevEvent | undefined> = new Array(
  MAX_DEV_EVENTS,
);
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
const gitBranchByThread = new Map<string, string>();
const loadedThreadConfig = new Set<string>();
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

const EMPTY_PERMISSION_REQUESTS: ClaudePermissionRequest[] = [];

export function getClaudePermissionRequests(
  _threadKey: string | null,
): ClaudePermissionRequest[] {
  return EMPTY_PERMISSION_REQUESTS;
}

export function subscribeClaudePermissionRequests(
  _listener: () => void,
): () => void {
  return () => {};
}

export async function respondToClaudePermissionRequest(
  _requestId: string,
  _approved: boolean,
): Promise<void> {
  return;
}

async function runDiagnostics(): Promise<void> {
  if (!DEV_LOGS || diagRan) return;
  diagRan = true;

  devLog("[claude-diag] Running environment diagnostics...");
  devLog("[claude-adapter] revision:", ADAPTER_REV);

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
  sessionByThread.clear();
}

/** Hydrate the in-memory session cache from SQLite for a given thread. */
async function hydrateSessionCache(threadKey: string): Promise<void> {
  if (sessionByThread.has(threadKey)) return;
  const row = await db.sessions.get(threadKey);
  if (row) {
    sessionByThread.set(threadKey, row.session_id);
    sessionRecords.set(threadKey, {
      threadKey,
      sessionId: row.session_id,
      status: row.status as ClaudeSessionStatus,
      localCache: row.local_cache as ClaudeSessionLocalCache,
      strategy: row.strategy as "resume" | "session-id" | "none",
      lastCheckedAt: row.last_checked_at
        ? new Date(row.last_checked_at).getTime()
        : null,
      lastUpdatedAt: new Date(row.last_updated_at).getTime(),
      lastError: row.last_error,
    });
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

  // Write-through to SQLite (fire-and-forget)
  void db.sessions.upsert({
    thread_id: threadKey,
    session_id: sessionId,
    status: next.status,
    local_cache: next.localCache,
    strategy: next.strategy,
    last_checked_at: next.lastCheckedAt
      ? new Date(next.lastCheckedAt).toISOString()
      : null,
    last_updated_at: new Date(next.lastUpdatedAt).toISOString(),
    last_error: next.lastError,
  });
}

function getSessionForThread(threadKey: string): string | null {
  return sessionByThread.get(threadKey) ?? null;
}

function setSessionForThread(threadKey: string, id: string): void {
  sessionByThread.set(threadKey, id);

  upsertSessionRecord(threadKey, id, {
    status: "unknown",
    localCache: "unknown",
    strategy: "none",
    lastError: null,
  });
}

function clearSessionForThread(threadKey: string): void {
  sessionByThread.delete(threadKey);
  void db.sessions.delete(threadKey);
}

function getEventCategory(event: ClaudeStreamEvent): ClaudeDevEventCategory {
  if (event.type === "system" && event.subtype?.startsWith("hook_"))
    return "hooks";
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

function pushDevEvent(
  raw: string,
  parsed: ClaudeStreamEvent,
  threadKey: string,
): void {
  const category = getEventCategory(parsed);
  const seq = devEventSeq++;
  const event: ClaudeDevEvent = {
    id: `${Date.now()}-${seq}`,
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

  // Archive to SQLite via batch queue
  queueDevEventForArchive({
    id: event.id,
    thread_id: threadKey,
    seq,
    category,
    raw,
    created_at: new Date(event.at).toISOString(),
  });
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

export function subscribeClaudeSessionRecords(
  listener: () => void,
): () => void {
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

function chooseSessionStrategy(
  threadKey: string,
  sessionId: string | null,
): {
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

type ClaudeJsonResult = {
  type: "result";
  subtype?: string;
  result?: string;
  session_id?: string;
  is_error?: boolean;
  errors?: string[];
  total_cost_usd?: number;
  cost_usd?: number;
  model?: string;
};

function extractResultEvent(payload: unknown): ClaudeJsonResult | null {
  if (!payload || typeof payload !== "object") return null;

  if (Array.isArray(payload)) {
    for (let i = payload.length - 1; i >= 0; i -= 1) {
      const extracted = extractResultEvent(payload[i]);
      if (extracted) return extracted;
    }
    return null;
  }

  const candidate = payload as Partial<ClaudeJsonResult>;
  if (candidate.type === "result") {
    return candidate as ClaudeJsonResult;
  }
  return null;
}

function parseClaudeJsonResult(
  stdout: string,
  stderr: string,
): { raw: string; parsed: ClaudeJsonResult } | null {
  const trimmedStdout = stdout.trim();
  if (trimmedStdout) {
    try {
      const parsedPayload = JSON.parse(trimmedStdout) as unknown;
      const parsed = extractResultEvent(parsedPayload);
      if (parsed) {
        return { raw: trimmedStdout, parsed };
      }
    } catch {
      // Fall through to line-wise scanning.
    }
  }

  const candidates = [...stdout.split(/\r?\n/), ...stderr.split(/\r?\n/)]
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  for (const candidate of candidates) {
    try {
      const parsedPayload = JSON.parse(candidate) as unknown;
      const parsed = extractResultEvent(parsedPayload);
      if (parsed) {
        return { raw: candidate, parsed };
      }
    } catch {
      // Keep scanning.
    }
  }

  return null;
}

export function createClaudeAdapter(
  adapterOptions?: ClaudeAdapterOptions,
): ChatModelAdapter {
  return {
    async *run(options) {
      const { messages, abortSignal } = options;
      const threadKey =
        adapterOptions?.threadKey ??
        options.unstable_threadId?.trim() ??
        GLOBAL_THREAD_KEY;
      await hydrateSessionCache(threadKey);
      await acquireThreadRunLock(threadKey);

      try {
        await runDiagnostics();

        if (!loadedThreadConfig.has(threadKey)) {
          const thread = await db.threads.get(threadKey);
          const storedCwd = thread?.cwd?.trim();
          if (storedCwd) {
            cwdByThread.set(threadKey, storedCwd);
          }
          const storedGitBranch = thread?.git_branch?.trim();
          if (storedGitBranch) {
            gitBranchByThread.set(threadKey, storedGitBranch);
          } else {
            gitBranchByThread.delete(threadKey);
          }
          loadedThreadConfig.add(threadKey);
        }

        const prompt = extractUserPrompt(messages);
        if (!prompt.trim()) return;
        adapterOptions?.onUserPrompt?.(prompt);

        let knownSessionId = getSessionForThread(threadKey);

        // First message on a new thread — start title generation concurrently
        if (!knownSessionId) {
          prefetchTitle(threadKey, prompt);
        }

        let lastAttempt = 0;

        while (lastAttempt < 3) {
          lastAttempt += 1;

          const { strategy, sessionId } = chooseSessionStrategy(
            threadKey,
            knownSessionId,
          );
          const attemptedSessionId = sessionId;
          const sessionMode =
            strategy === "resume"
              ? "resume"
              : strategy === "session-id"
                ? "session-id"
                : "none";
          const debugArgs = [
            "-p",
            prompt,
            "--output-format",
            "json",
            "--verbose",
          ];
          if (sessionMode === "resume" && sessionId) {
            debugArgs.push("--resume", sessionId);
          } else if (sessionMode === "session-id" && sessionId) {
            debugArgs.push("--session-id", sessionId);
          }

          const configuredCwd = cwdByThread.get(threadKey);
          const configuredGitBranch = gitBranchByThread.get(threadKey);

          devLog(
            "[claude-adapter] spawning:",
            `[${ADAPTER_REV}]`,
            ["claude", ...debugArgs].join(" "),
          );

          let missingConversation = false;
          let sessionInUse = false;
          let latestSessionId: string | null = null;
          let wasAborted = abortSignal.aborted;
          const onAbort = () => {
            wasAborted = true;
          };
          abortSignal.addEventListener("abort", onAbort, { once: true });

          const command = Command.create("claude", debugArgs, {
            cwd: configuredCwd,
          });

          if (configuredGitBranch?.trim()) {
            devLog(
              "[claude-adapter] skipping auto git checkout:",
              configuredGitBranch,
            );
          }

          let commandResult: Awaited<ReturnType<typeof command.execute>>;
          try {
            commandResult = await command.execute();
            devLog(
              "[claude-adapter] process closed:",
              JSON.stringify({
                code: commandResult.code,
                signal: commandResult.signal,
                stdoutBytes: (commandResult.stdout ?? "").length,
                stderrBytes: (commandResult.stderr ?? "").length,
              }),
            );
          } finally {
            abortSignal.removeEventListener("abort", onAbort);
          }

          if (wasAborted) {
            break;
          }

          for (const line of (commandResult.stderr ?? "").split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            devWarn("[claude-adapter] stderr:", trimmed);
            if (trimmed.includes("No conversation found with session ID")) {
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
            if (trimmed.includes("already in use")) {
              sessionInUse = true;
              if (knownSessionId) {
                upsertSessionRecord(threadKey, knownSessionId, {
                  status: "in_use",
                  strategy,
                  lastCheckedAt: Date.now(),
                  lastError: trimmed,
                });
              }
            }
          }

          const stdoutText = commandResult.stdout ?? "";
          const stderrText = commandResult.stderr ?? "";
          const parsedResult = parseClaudeJsonResult(stdoutText, stderrText);
          if (parsedResult) {
            try {
              const result = parsedResult.parsed;

              pushDevEvent(
                parsedResult.raw,
                result as unknown as ClaudeStreamEvent,
                threadKey,
              );

              if (result.session_id?.trim()) {
                knownSessionId = result.session_id;
                latestSessionId = result.session_id;
              }

              void db.usageSnapshots.insert({
                id: crypto.randomUUID(),
                thread_id: threadKey,
                session_id: latestSessionId,
                input_tokens: null,
                output_tokens: null,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                total_cost_usd:
                  result.total_cost_usd ?? result.cost_usd ?? null,
                model_id: result.model ?? null,
                context_window: null,
                captured_at: new Date().toISOString(),
              });

              if (
                result.subtype === "error_during_execution" &&
                result.errors?.some((e) =>
                  e.includes("No conversation found with session ID"),
                )
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

              if (!result.is_error && result.result) {
                yield {
                  content: [{ type: "text", text: result.result }],
                } satisfies ChatModelRunResult;
              } else if (result.is_error && result.result) {
                yield {
                  content: [{ type: "text", text: `Error: ${result.result}` }],
                } satisfies ChatModelRunResult;
              }
            } catch (e) {
              devError(
                "[claude-adapter] failed to parse JSON result:",
                e,
                parsedResult.raw.slice(0, 200),
              );
            }
          } else {
            const fallbackText = stdoutText.trim() || stderrText.trim();
            if (fallbackText) {
              devWarn(
                "[claude-adapter] no JSON result found; emitting fallback text",
              );
              yield {
                content: [{ type: "text", text: fallbackText }],
              } satisfies ChatModelRunResult;
            }
          }

          if (
            commandResult.code !== null &&
            commandResult.code !== 0 &&
            !missingConversation &&
            !sessionInUse
          ) {
            const signalSuffix =
              commandResult.signal !== null
                ? ` (signal ${commandResult.signal})`
                : "";
            throw new Error(
              `Claude CLI exited with code ${commandResult.code}${signalSuffix}`,
            );
          }

          if (
            commandResult.code === 0 &&
            latestSessionId &&
            !missingConversation &&
            !sessionInUse
          ) {
            setSessionForThread(threadKey, latestSessionId);
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
                  : (sessionRecords.get(threadKey)?.localCache ?? "unknown"),
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

          if (
            sessionInUse &&
            (strategy === "session-id" || strategy === "resume")
          ) {
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
    gitBranchByThread.clear();
    loadedThreadConfig.clear();
    sessionRecords.clear();
    sessionRecordsSnapshot = [];
    devListeners.clear();
    sessionListeners.clear();
    devEventsHead = 0;
    devEventsCount = 0;
  });
}

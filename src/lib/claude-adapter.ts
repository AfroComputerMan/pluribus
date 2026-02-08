import { Command, type Child } from "@tauri-apps/plugin-shell";
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import type { ReadonlyJSONObject } from "assistant-stream/utils";
import { db } from "@/lib/db";
import { queueDevEventForArchive } from "@/lib/dev-event-batcher";
import { prefetchTitle } from "@/lib/sqlite-thread-list-adapter";

type JsonRecord = Record<string, unknown>;

type ClaudeMessageMetrics = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  contextWindow: number | null;
  contextUsedTokens: number | null;
  contextLeftBeforeCompaction: number | null;
  totalTokens: number | null;
};

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

type ClaudeContentBlockStartEvent = ClaudeStreamEventBase & {
  type: "content_block_start";
};

type ClaudeContentBlockDeltaEvent = ClaudeStreamEventBase & {
  type: "content_block_delta";
};

type ClaudeContentBlockStopEvent = ClaudeStreamEventBase & {
  type: "content_block_stop";
};

type ClaudeStreamEvent =
  | ClaudeSystemEvent
  | ClaudeAssistantEvent
  | ClaudeResultEvent
  | ClaudeContentBlockStartEvent
  | ClaudeContentBlockDeltaEvent
  | ClaudeContentBlockStopEvent;

const sessionByThread = new Map<string, string>();
const GLOBAL_THREAD_KEY = "__global__";
const activeThreadRuns = new Set<string>();
const pendingThreadRunWaiters = new Map<string, Array<() => void>>();
const MAX_DEV_EVENTS = 500;
const THREAD_LOCK_TIMEOUT_MS = 60_000;
const RUN_IDLE_TIMEOUT_MS = 300_000;
const DEV_LOGS = import.meta.env.DEV;
const CLAUDE_SHELL_SCRIPT =
  'if [ -n "$CLAUDE_GIT_BRANCH" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git checkout "$CLAUDE_GIT_BRANCH" 1>&2; fi; if [ "$CLAUDE_MODE" = "resume" ]; then exec claude -p "$CLAUDE_PROMPT" --output-format stream-json --include-partial-messages --permission-mode default --verbose --resume "$CLAUDE_SESSION_ID"; elif [ "$CLAUDE_MODE" = "session-id" ]; then exec claude -p "$CLAUDE_PROMPT" --output-format stream-json --include-partial-messages --permission-mode default --verbose --session-id "$CLAUDE_SESSION_ID"; else exec claude -p "$CLAUDE_PROMPT" --output-format stream-json --include-partial-messages --permission-mode default --verbose; fi';

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
const gitBranchByThread = new Map<string, string>();
const loadedThreadConfig = new Set<string>();
const seenMcpToolUseIds = new Set<string>();
const activeChildByThread = new Map<string, Child>();
const permissionRequestById = new Map<string, ClaudePermissionRequest>();
const permissionRequestsByThread = new Map<string, ClaudePermissionRequest[]>();
const permissionRequestListeners = new Set<() => void>();
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

function notifyPermissionRequestListeners(): void {
  for (const listener of permissionRequestListeners) {
    listener();
  }
}

function detectPermissionPrompt(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/\b(y\/n|yes\/no)\b/i.test(trimmed)) return trimmed;
  if (/allow .*tool/i.test(trimmed)) return trimmed;
  if (/approve .*request/i.test(trimmed)) return trimmed;
  if (/permission/i.test(trimmed) && trimmed.endsWith("?")) return trimmed;
  return null;
}

function pushPermissionRequest(threadKey: string, prompt: string): void {
  const existing = permissionRequestsByThread.get(threadKey) ?? [];
  const hasMatchingPending = existing.some((r) => !r.resolved && r.prompt === prompt);
  if (hasMatchingPending) return;

  const request: ClaudePermissionRequest = {
    id: `${threadKey}:${Date.now()}:${existing.length}`,
    threadKey,
    prompt,
    createdAt: Date.now(),
    resolved: false,
  };
  permissionRequestById.set(request.id, request);
  permissionRequestsByThread.set(threadKey, [...existing, request]);
  notifyPermissionRequestListeners();
}

function hasPendingPermissionRequests(threadKey: string): boolean {
  const entries = permissionRequestsByThread.get(threadKey) ?? [];
  return entries.some((entry) => !entry.resolved);
}

function resolveAllPermissionRequestsForThread(threadKey: string): void {
  const entries = permissionRequestsByThread.get(threadKey) ?? [];
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.resolved) return entry;
    changed = true;
    const updated = { ...entry, resolved: true };
    permissionRequestById.set(updated.id, updated);
    return updated;
  });
  if (!changed) return;
  permissionRequestsByThread.set(threadKey, next);
  notifyPermissionRequestListeners();
}

function resolvePermissionRequest(requestId: string): void {
  const request = permissionRequestById.get(requestId);
  if (!request || request.resolved) return;

  const updated: ClaudePermissionRequest = {
    ...request,
    resolved: true,
  };
  permissionRequestById.set(requestId, updated);
  const current = permissionRequestsByThread.get(request.threadKey) ?? [];
  permissionRequestsByThread.set(
    request.threadKey,
    current.map((item) => (item.id === requestId ? updated : item)),
  );
  notifyPermissionRequestListeners();
}

const EMPTY_PERMISSION_REQUESTS: ClaudePermissionRequest[] = [];
const permissionSnapshotCache = new Map<string, ClaudePermissionRequest[]>();

export function getClaudePermissionRequests(threadKey: string | null): ClaudePermissionRequest[] {
  if (!threadKey) return EMPTY_PERMISSION_REQUESTS;
  const entries = permissionRequestsByThread.get(threadKey);
  if (!entries) return EMPTY_PERMISSION_REQUESTS;
  const pending = entries.filter((entry) => !entry.resolved);
  if (pending.length === 0) return EMPTY_PERMISSION_REQUESTS;

  // Return cached array if contents haven't changed (same length + same IDs)
  const cached = permissionSnapshotCache.get(threadKey);
  if (
    cached &&
    cached.length === pending.length &&
    cached.every((item, i) => item.id === pending[i]!.id && item.resolved === pending[i]!.resolved)
  ) {
    return cached;
  }
  permissionSnapshotCache.set(threadKey, pending);
  return pending;
}

export function subscribeClaudePermissionRequests(listener: () => void): () => void {
  permissionRequestListeners.add(listener);
  return () => {
    permissionRequestListeners.delete(listener);
  };
}

export async function respondToClaudePermissionRequest(
  requestId: string,
  approved: boolean,
): Promise<void> {
  const request = permissionRequestById.get(requestId);
  if (!request || request.resolved) return;
  const child = activeChildByThread.get(request.threadKey);
  if (!child) return;
  await child.write(`${approved ? "y" : "n"}\n`);
  resolvePermissionRequest(requestId);
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

function extractMcpServerName(toolName: string): string | null {
  if (!toolName.startsWith("mcp__")) return null;
  const afterPrefix = toolName.slice("mcp__".length);
  const splitAt = afterPrefix.indexOf("__");
  if (splitAt <= 0) return null;
  return afterPrefix.slice(0, splitAt);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asReadonlyJSONObject(value: unknown): ReadonlyJSONObject {
  const record = asRecord(value);
  return (record ?? {}) as ReadonlyJSONObject;
}

function computeMessageMetrics(event: ClaudeStreamEvent): ClaudeMessageMetrics | null {
  if (!event.usage && !event.modelUsage) return null;

  const usage = event.usage;
  const modelEntry = event.modelUsage ? Object.entries(event.modelUsage)[0] : undefined;
  const modelUsage = modelEntry?.[1];

  const inputTokens = asNumber(usage?.input_tokens) ?? asNumber(modelUsage?.inputTokens);
  const outputTokens = asNumber(usage?.output_tokens) ?? asNumber(modelUsage?.outputTokens);
  const cacheReadInputTokens =
    asNumber(usage?.cache_read_input_tokens) ?? asNumber(modelUsage?.cacheReadInputTokens);
  const cacheCreationInputTokens =
    asNumber(usage?.cache_creation_input_tokens) ?? asNumber(modelUsage?.cacheCreationInputTokens);
  const contextWindow = asNumber(modelUsage?.contextWindow);

  const contextUsedTokens =
    inputTokens !== null || cacheReadInputTokens !== null || cacheCreationInputTokens !== null
      ? (inputTokens ?? 0) + (cacheReadInputTokens ?? 0) + (cacheCreationInputTokens ?? 0)
      : null;
  const contextLeftBeforeCompaction =
    contextWindow !== null && contextUsedTokens !== null
      ? Math.max(0, contextWindow - contextUsedTokens)
      : null;
  const totalTokens =
    inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null;

  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    contextWindow,
    contextUsedTokens,
    contextLeftBeforeCompaction,
    totalTokens,
  };
}

function persistMcpInvocationsFromEvent(
  event: ClaudeStreamEvent,
  threadKey: string,
  sessionId: string | null,
): void {
  if (event.type !== "assistant") return;
  const blocks = event.message?.content ?? [];

  for (const block of blocks) {
    if (block.type !== "tool_use") continue;

    const toolName =
      typeof block.name === "string"
        ? block.name
        : typeof block.tool_name === "string"
          ? block.tool_name
          : null;
    if (!toolName || !toolName.startsWith("mcp__")) continue;

    if (typeof block.id === "string") {
      const dedupeKey = `${threadKey}:${sessionId ?? "none"}:${block.id}`;
      if (seenMcpToolUseIds.has(dedupeKey)) continue;
      seenMcpToolUseIds.add(dedupeKey);
    }

    void db.mcpInvocations.insert({
      id: crypto.randomUUID(),
      thread_id: threadKey,
      session_id: sessionId,
      tool_name: toolName,
      server_name: extractMcpServerName(toolName),
      input_tokens: null,
      output_tokens: null,
      cost_usd: typeof event.cost_usd === "number" ? event.cost_usd : null,
      duration_ms: null,
      success: block.is_error ? 0 : 1,
      error: block.is_error ? (typeof block.error === "string" ? block.error : "tool_use_error") : null,
      created_at: new Date().toISOString(),
    }).catch((error) => {
      console.error("[mcp-invocation] insert failed:", error);
    });
  }
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

type QueueItem =
  | {
      chunk: ChatModelRunResult;
    }
  | { done: true }
  | { error: Error };

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
          resolveAllPermissionRequestsForThread(threadKey);

          const { strategy, sessionId } = chooseSessionStrategy(threadKey, knownSessionId);
          const attemptedSessionId = sessionId;
          const sessionMode = strategy === "resume" ? "resume" : strategy === "session-id" ? "session-id" : "none";
          const debugArgs = [
            "-p",
            prompt,
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--permission-mode",
            "default",
            "--verbose",
          ];
          if (sessionMode === "resume" && sessionId) {
            debugArgs.push("--resume", sessionId);
          } else if (sessionMode === "session-id" && sessionId) {
            debugArgs.push("--session-id", sessionId);
          }

          const configuredCwd = cwdByThread.get(threadKey);
          const configuredGitBranch = gitBranchByThread.get(threadKey);

          devLog("[claude-adapter] spawning:", ["claude", ...debugArgs].join(" "));
          const command = Command.create("claude-stream-sh", ["-c", CLAUDE_SHELL_SCRIPT], {
            cwd: configuredCwd,
            env: {
              CLAUDE_MODE: sessionMode,
              CLAUDE_PROMPT: prompt,
              CLAUDE_SESSION_ID: sessionId ?? "",
              CLAUDE_GIT_BRANCH: configuredGitBranch ?? "",
            },
          });
          const { push, pull } = createAsyncQueue();

          let missingConversation = false;
          let sessionInUse = false;
          let latestSessionId: string | null = null;
          let sawAssistantText = false;
          let sawPartialTextOrReasoning = false;
          let sawPartialToolCall = false;
          const emittedToolCallIds = new Set<string>();
          const partialToolCallByIndex = new Map<
            number,
            { toolCallId: string; toolName: string; inputJson: string }
          >();
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

              if (event.type === "system" && event.subtype === "init") {
                if (typeof event.cwd === "string") {
                  cwdByThread.set(threadKey, event.cwd);
                  void db.threads.updateCwd(threadKey, event.cwd);
                }

                // Capture MCP snapshot
                const allTools = event.tools ?? [];
                const mcpTools = allTools.filter((t) => t.startsWith("mcp__"));
                const builtinTools = allTools.filter((t) => !t.startsWith("mcp__"));
                void db.mcpSnapshots.insert({
                  id: crypto.randomUUID(),
                  thread_id: threadKey,
                  session_id: event.session_id ?? latestSessionId,
                  servers: JSON.stringify(event.mcp_servers ?? []),
                  tools: JSON.stringify(allTools),
                  mcp_tools: JSON.stringify(mcpTools),
                  builtin_tools: JSON.stringify(builtinTools),
                  skills: event.skills ? JSON.stringify(event.skills) : null,
                  slash_commands: event.slash_commands ? JSON.stringify(event.slash_commands) : null,
                  captured_at: new Date().toISOString(),
                });
              }

              if (event.type === "content_block_start") {
                const block = event.content_block;
                const blockIndex = typeof event.index === "number" ? event.index : -1;

                if (block?.type === "text" && typeof block.text === "string" && block.text) {
                  sawPartialTextOrReasoning = true;
                  sawAssistantText = true;
                  push({
                    chunk: {
                      content: [{ type: "text", text: block.text }],
                    },
                  });
                } else if (
                  (block?.type === "thinking" || block?.type === "reasoning") &&
                  (typeof block.thinking === "string" || typeof block.text === "string")
                ) {
                  sawPartialTextOrReasoning = true;
                  const reasoningText =
                    typeof block.thinking === "string"
                      ? block.thinking
                      : typeof block.text === "string"
                        ? block.text
                        : "";
                  if (reasoningText) {
                    sawAssistantText = true;
                    push({
                      chunk: {
                        content: [{ type: "reasoning", text: reasoningText }],
                      },
                    });
                  }
                } else if (block?.type === "tool_use") {
                  sawPartialToolCall = true;
                  const toolCallId = block.id ?? crypto.randomUUID();
                  const toolName =
                    typeof block.name === "string"
                      ? block.name
                      : typeof block.tool_name === "string"
                        ? block.tool_name
                        : "tool";
                  const args = asReadonlyJSONObject(block.input);
                  const inputJson = JSON.stringify(args);
                  partialToolCallByIndex.set(blockIndex, { toolCallId, toolName, inputJson });
                  emittedToolCallIds.add(toolCallId);
                  push({
                    chunk: {
                      content: [
                        {
                          type: "tool-call",
                          toolCallId,
                          toolName,
                          args,
                          argsText: JSON.stringify(args, null, 2),
                        },
                      ],
                    },
                  });
                }
              } else if (event.type === "content_block_delta") {
                const deltaType = event.delta?.type;
                if (deltaType === "text_delta" && typeof event.delta?.text === "string") {
                  sawPartialTextOrReasoning = true;
                  sawAssistantText = true;
                  push({
                    chunk: {
                      content: [{ type: "text", text: event.delta.text }],
                    },
                  });
                } else if (
                  deltaType === "thinking_delta" &&
                  (typeof event.delta?.thinking === "string" || typeof event.delta?.text === "string")
                ) {
                  sawPartialTextOrReasoning = true;
                  const reasoningText =
                    typeof event.delta?.thinking === "string"
                      ? event.delta.thinking
                      : typeof event.delta?.text === "string"
                        ? event.delta.text
                        : "";
                  if (reasoningText) {
                    sawAssistantText = true;
                    push({
                      chunk: {
                        content: [{ type: "reasoning", text: reasoningText }],
                      },
                    });
                  }
                } else if (
                  deltaType === "input_json_delta" &&
                  typeof event.delta?.partial_json === "string"
                ) {
                  const blockIndex = typeof event.index === "number" ? event.index : -1;
                  const existing = partialToolCallByIndex.get(blockIndex);
                  if (existing) {
                    existing.inputJson += event.delta.partial_json;
                    partialToolCallByIndex.set(blockIndex, existing);
                  }
                }
              } else if (event.type === "content_block_stop") {
                const blockIndex = typeof event.index === "number" ? event.index : -1;
                partialToolCallByIndex.delete(blockIndex);
              }

              // Capture usage snapshots
              if (event.usage || event.modelUsage) {
                const usage = event.usage;
                const modelEntry = event.modelUsage
                  ? Object.entries(event.modelUsage)[0]
                  : undefined;
                void db.usageSnapshots.insert({
                  id: crypto.randomUUID(),
                  thread_id: threadKey,
                  session_id: latestSessionId,
                  input_tokens: usage?.input_tokens ?? modelEntry?.[1]?.inputTokens ?? null,
                  output_tokens: usage?.output_tokens ?? modelEntry?.[1]?.outputTokens ?? null,
                  cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? null,
                  cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
                  total_cost_usd: event.total_cost_usd ?? modelEntry?.[1]?.costUSD ?? null,
                  model_id: modelEntry?.[0] ?? null,
                  context_window: modelEntry?.[1]?.contextWindow ?? null,
                  captured_at: new Date().toISOString(),
                });

                const metrics = computeMessageMetrics(event);
                if (metrics) {
                  push({
                    chunk: {
                      metadata: {
                        custom: {
                          claudeMessageMetrics: metrics,
                        },
                      },
                    },
                  });
                }
              }

              persistMcpInvocationsFromEvent(event, threadKey, event.session_id ?? latestSessionId);

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
                    if (sawPartialTextOrReasoning) continue;
                    sawAssistantText = true;
                    push({
                      chunk: {
                        content: [{ type: "text", text: block.text }],
                      },
                    });
                    continue;
                  }

                  if (
                    (block.type === "reasoning" || block.type === "thinking") &&
                    (block.text || block.thinking)
                  ) {
                    if (sawPartialTextOrReasoning) continue;
                    const reasoningText = block.text ?? block.thinking ?? "";
                    if (!reasoningText) continue;
                    sawAssistantText = true;
                    push({
                      chunk: {
                        content: [
                          {
                            type: "reasoning",
                            text: reasoningText,
                            ...(block.id ? { parentId: block.id } : {}),
                          },
                        ],
                      },
                    });
                    continue;
                  }

                  if (block.type === "tool_use") {
                    if (sawPartialToolCall) continue;
                    const toolCallId = block.id ?? crypto.randomUUID();
                    if (emittedToolCallIds.has(toolCallId)) continue;
                    const toolName =
                      typeof block.name === "string"
                        ? block.name
                        : typeof block.tool_name === "string"
                          ? block.tool_name
                          : "tool";
                    const args = asReadonlyJSONObject(block.input);
                    const argsText = JSON.stringify(args, null, 2);

                    push({
                      chunk: {
                        content: [
                          {
                            type: "tool-call",
                            toolCallId,
                            toolName,
                            args,
                            argsText,
                          },
                        ],
                      },
                    });
                    continue;
                  }
                }
              } else if (event.type === "result" && event.result && !sawAssistantText) {
                push({
                  chunk: {
                    content: [{ type: "text", text: event.result }],
                  },
                });
              }
            } catch {
              // Non-JSON lines can include permission prompts.
              const permissionPrompt = detectPermissionPrompt(trimmed);
              if (permissionPrompt) {
                pushPermissionRequest(threadKey, permissionPrompt);
              }
            }
          };

          let child: Child | null = null;
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
          let lastActivityAt = Date.now();
          let lastStdoutAt: number | null = null;
          let lastStderrAt: number | null = null;
          let lastStderrLine: string | null = null;
          let idleTimeoutDetails: string | null = null;
          const refreshIdleTimeout = () => {
            if (!child) return;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            timeoutHandle = setTimeout(() => {
              if (hasPendingPermissionRequests(threadKey)) {
                devWarn(
                  "[claude-adapter] idle timeout deferred; waiting on pending permission request",
                );
                refreshIdleTimeout();
                return;
              }
              timedOut = true;
              const idleForMs = Date.now() - lastActivityAt;
              idleTimeoutDetails =
                `No stdout/stderr activity for ${idleForMs}ms` +
                ` (lastStdoutAt=${lastStdoutAt ?? "never"},` +
                ` lastStderrAt=${lastStderrAt ?? "never"},` +
                ` lastStderr=${JSON.stringify(lastStderrLine)})`;
              devWarn("[claude-adapter] idle timeout:", idleTimeoutDetails);
              void child?.kill();
            }, RUN_IDLE_TIMEOUT_MS);
          };

          let stdoutBuffer = "";
          command.stdout.on("data", (chunk: string) => {
            devLog("[claude-adapter] stdout:", chunk);
            lastActivityAt = Date.now();
            lastStdoutAt = lastActivityAt;
            refreshIdleTimeout();
            stdoutBuffer += chunk;
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop() ?? "";
            for (const line of lines) {
              handleStreamLine(line);
            }
          });

          command.stderr.on("data", (line: string) => {
            devWarn("[claude-adapter] stderr:", line);
            lastActivityAt = Date.now();
            lastStderrAt = lastActivityAt;
            lastStderrLine = line.trim() || lastStderrLine;
            refreshIdleTimeout();
            const permissionPrompt = detectPermissionPrompt(line);
            if (permissionPrompt) {
              pushPermissionRequest(threadKey, permissionPrompt);
            }
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
            resolveAllPermissionRequestsForThread(threadKey);
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
            resolveAllPermissionRequestsForThread(threadKey);
            push({ error: new Error(`Claude CLI error: ${err}`) });
          });

          try {
            child = await command.spawn();
            devLog("[claude-adapter] spawned pid:", child.pid);
            activeChildByThread.set(threadKey, child);
            refreshIdleTimeout();
          } catch (err) {
            devError("[claude-adapter] spawn failed:", err);
            throw err;
          }

          const onAbort = () => {
            wasAborted = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            void child?.kill();
            resolveAllPermissionRequestsForThread(threadKey);
            push({ done: true });
          };
          abortSignal.addEventListener("abort", onAbort, { once: true });

          try {
            while (true) {
              const item = await pull();
              if ("done" in item) break;
              if ("error" in item) throw item.error;

              yield item.chunk;
            }
          } finally {
            activeChildByThread.delete(threadKey);
            abortSignal.removeEventListener("abort", onAbort);
            if (timeoutHandle) clearTimeout(timeoutHandle);
          }

          if (timedOut) {
            const details = idleTimeoutDetails ? `; ${idleTimeoutDetails}` : "";
            throw new Error(`Claude CLI idle timeout after ${RUN_IDLE_TIMEOUT_MS}ms${details}`);
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
    gitBranchByThread.clear();
    loadedThreadConfig.clear();
    seenMcpToolUseIds.clear();
    activeChildByThread.clear();
    permissionRequestById.clear();
    permissionRequestsByThread.clear();
    sessionRecords.clear();
    sessionRecordsSnapshot = [];
    devListeners.clear();
    sessionListeners.clear();
    permissionRequestListeners.clear();
    devEventsHead = 0;
    devEventsCount = 0;
  });
}

import { Command, type Child } from "@tauri-apps/plugin-shell";
import { homeDir } from "@tauri-apps/api/path";
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import { db } from "@/lib/db";
import { resolveModel, resolveEffort, getModelById } from "@/lib/models";
import { queueDevEventForArchive } from "@/lib/dev-event-batcher";
import { prefetchTitle } from "@/lib/sqlite-thread-list-adapter";

type ClaudeStreamEventBase = {
  index?: number;
  parent_tool_use_id?: string | null;
  tool_use_result?: unknown;
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

type ClaudeUserEvent = ClaudeStreamEventBase & {
  type: "user";
  message?: ClaudeStreamEventBase["message"];
};

type ClaudeResultEvent = ClaudeStreamEventBase & {
  type: "result";
  result?: string;
};

type ClaudeContentBlockStartEvent = ClaudeStreamEventBase & {
  type: "content_block_start";
  index: number;
  content_block: {
    type: string;
    id?: string;
    name?: string;
    text?: string;
    thinking?: string;
  };
};

type ClaudeContentBlockDeltaEvent = ClaudeStreamEventBase & {
  type: "content_block_delta";
  index: number;
  delta: {
    type: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
};

type ClaudeContentBlockStopEvent = ClaudeStreamEventBase & {
  type: "content_block_stop";
  index: number;
};

type ClaudeStreamEventEnvelope = ClaudeStreamEventBase & {
  type: "stream_event";
  event: {
    type: string;
    index?: number;
    content_block?: {
      type: string;
      id?: string;
      name?: string;
      text?: string;
      thinking?: string;
    };
    delta?: {
      type: string;
      text?: string;
      thinking?: string;
      partial_json?: string;
    };
    message?: ClaudeStreamEventBase["message"];
    usage?: ClaudeStreamEventBase["usage"];
  };
};

type ClaudeStreamEvent =
  | ClaudeSystemEvent
  | ClaudeAssistantEvent
  | ClaudeUserEvent
  | ClaudeResultEvent
  | ClaudeContentBlockStartEvent
  | ClaudeContentBlockDeltaEvent
  | ClaudeContentBlockStopEvent
  | ClaudeStreamEventEnvelope;

const sessionByThread = new Map<string, string>();
const GLOBAL_THREAD_KEY = "__global__";
const activeThreadRuns = new Set<string>();
const pendingThreadRunWaiters = new Map<string, Array<() => void>>();
const MAX_DEV_EVENTS = 500;
const THREAD_LOCK_TIMEOUT_MS = 60_000;
const DEV_LOGS = import.meta.env.DEV;
const ADAPTER_REV = "claude-adapter-reset-baseline-v2";
const YIELD_THROTTLE_MS = 16; // ~60fps

/** Tracks active child processes per thread for abort support. */
const activeChildByThread = new Map<string, Child>();

/** Accumulates incremental state for a single content block during streaming. */
interface ContentBlockAccumulator {
  key: string;
  scopeId: string;
  parentId?: string;
  streamIndex: number | null;
  blockType: "text" | "thinking" | "tool_use";
  text: string;
  toolCallId: string;
  toolName: string;
  argsJson: string;
  result: unknown;
  isError: boolean;
}

interface StreamProcessingState {
  orderedAccumulators: ContentBlockAccumulator[];
  accumulatorByKey: Map<string, ContentBlockAccumulator>;
  keyByScopeIndex: Map<string, string>;
  startCountByScopeIndex: Map<string, number>;
  keyByToolCallId: Map<string, string>;
  latestToolCallIdByScope: Map<string, string>;
  pendingToolResultByCallId: Map<
    string,
    { result: unknown; isError: boolean; scopeId: string }
  >;
  unhandledEventKinds: Map<string, number>;
  unresolvedToolResults: number;
}

const ROOT_SCOPE_ID = "root";

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
  streamUnhandledCounts: Record<string, number>;
  unresolvedToolResultCount: number;
}

export interface ClaudeAdapterOptions {
  threadKey?: string;
  onUserPrompt?: (prompt: string) => void;
}

export type ClaudeSessionStatus =
  | "active"
  | "stale"
  | "error";

export interface ClaudeSessionRecord {
  threadKey: string;
  sessionId: string;
  status: ClaudeSessionStatus;
  lastUpdatedAt: number;
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
  streamUnhandledCounts: {},
  unresolvedToolResultCount: 0,
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
  streamUnhandledCounts: {},
  unresolvedToolResultCount: 0,
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

  // Verify the shell wrapper scope works (matches streaming path)
  const shellCmd = Command.create("claude-stream-sh", ["-c", "echo SHELL_OK < /dev/null"]);
  shellCmd.stdout.on("data", (line: string) => {
    devLog("[claude-diag] shell wrapper stdout:", line.trim());
  });
  shellCmd.stderr.on("data", (line: string) => {
    devWarn("[claude-diag] shell wrapper stderr:", line.trim());
  });
  shellCmd.on("close", (data) => {
    devLog("[claude-diag] shell wrapper closed:", JSON.stringify(data));
  });
  shellCmd.on("error", (err: string) => {
    devError("[claude-diag] shell wrapper error:", err);
  });

  try {
    await shellCmd.spawn();
  } catch (err) {
    devError("[claude-diag] shell wrapper spawn failed:", err);
  }
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
      lastUpdatedAt: new Date(row.last_updated_at).getTime(),
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
    status: current?.status ?? "active",
    lastUpdatedAt: Date.now(),
    ...patch,
  };
  sessionRecords.set(threadKey, next);
  notifySessionListeners();

  // Write-through to SQLite (fire-and-forget)
  void db.sessions.upsert({
    thread_id: threadKey,
    session_id: sessionId,
    status: next.status,
    last_updated_at: new Date(next.lastUpdatedAt).toISOString(),
  });
}

function getSessionForThread(threadKey: string): string | null {
  return sessionByThread.get(threadKey) ?? null;
}

function setSessionForThread(threadKey: string, id: string): void {
  sessionByThread.set(threadKey, id);

  upsertSessionRecord(threadKey, id, {
    status: "active",
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
  if (event.type === "assistant" || event.type === "user") return "messages";
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
    streamUnhandledCounts: devSnapshot.streamUnhandledCounts,
    unresolvedToolResultCount: devSnapshot.unresolvedToolResultCount,
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
    streamUnhandledCounts: {},
    unresolvedToolResultCount: 0,
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
    upsertSessionRecord(record.threadKey, record.sessionId, {
      status: record.status,
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
  _threadKey: string,
  sessionId: string | null,
): {
  strategy: "resume" | "none";
  sessionId: string | null;
} {
  if (!sessionId) {
    return { strategy: "none", sessionId: null };
  }

  return { strategy: "resume", sessionId };
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

function makeAccumulator(
  state: StreamProcessingState,
  blockType: ContentBlockAccumulator["blockType"],
  options: {
    key: string;
    scopeId: string;
    parentId?: string;
    streamIndex: number | null;
  },
): ContentBlockAccumulator {
  const acc: ContentBlockAccumulator = {
    key: options.key,
    scopeId: options.scopeId,
    parentId: options.parentId,
    streamIndex: options.streamIndex,
    blockType,
    text: "",
    toolCallId: "",
    toolName: "",
    argsJson: "",
    result: undefined,
    isError: false,
  };
  state.orderedAccumulators.push(acc);
  state.accumulatorByKey.set(options.key, acc);
  return acc;
}

function makeStreamProcessingState(): StreamProcessingState {
  return {
    orderedAccumulators: [],
    accumulatorByKey: new Map(),
    keyByScopeIndex: new Map(),
    startCountByScopeIndex: new Map(),
    keyByToolCallId: new Map(),
    latestToolCallIdByScope: new Map(),
    pendingToolResultByCallId: new Map(),
    unhandledEventKinds: new Map(),
    unresolvedToolResults: 0,
  };
}

function toScopeId(parentToolUseId?: string | null): string {
  const trimmed = parentToolUseId?.trim();
  return trimmed ? trimmed : ROOT_SCOPE_ID;
}

function toParentPartId(scopeId: string): string | undefined {
  return scopeId === ROOT_SCOPE_ID ? undefined : scopeId;
}

function makeScopeIndexKey(scopeId: string, index: number): string {
  return `${scopeId}:${index}`;
}

function createIndexedAccumulator(
  state: StreamProcessingState,
  blockType: ContentBlockAccumulator["blockType"],
  options: {
    scopeId: string;
    parentId?: string;
    streamIndex: number;
    source: "stream" | "assistant" | "delta";
  },
): ContentBlockAccumulator {
  const scopeIndexKey = makeScopeIndexKey(options.scopeId, options.streamIndex);
  const nextStartCount = (state.startCountByScopeIndex.get(scopeIndexKey) ?? 0) + 1;
  state.startCountByScopeIndex.set(scopeIndexKey, nextStartCount);

  const key = `${scopeIndexKey}:${nextStartCount}:${options.source}`;
  const acc = makeAccumulator(state, blockType, {
    key,
    scopeId: options.scopeId,
    parentId: options.parentId,
    streamIndex: options.streamIndex,
  });
  state.keyByScopeIndex.set(scopeIndexKey, acc.key);
  return acc;
}

function serializeToolResultPayload(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    return input;
  }
  try {
    JSON.stringify(input);
    return input;
  } catch {
    return String(input);
  }
}

function applyToolResultToState(
  state: StreamProcessingState,
  toolCallId: string | null | undefined,
  payload: unknown,
  isError: boolean,
  scopeId: string,
): boolean {
  const normalizedToolCallId = toolCallId?.trim();
  if (!normalizedToolCallId) {
    const latestInScope = state.latestToolCallIdByScope.get(scopeId);
    if (latestInScope) {
      return applyToolResultToState(
        state,
        latestInScope,
        payload,
        isError,
        scopeId,
      );
    }
    state.unresolvedToolResults += 1;
    return false;
  }

  const key = state.keyByToolCallId.get(normalizedToolCallId);
  if (!key) {
    state.pendingToolResultByCallId.set(normalizedToolCallId, {
      result: payload,
      isError,
      scopeId,
    });
    state.unresolvedToolResults += 1;
    return false;
  }

  const acc = state.accumulatorByKey.get(key);
  if (!acc || acc.blockType !== "tool_use") {
    return false;
  }

  const changed =
    acc.result !== payload || acc.isError !== isError;
  acc.result = payload;
  acc.isError = isError;
  return changed;
}

function noteUnhandledEventKind(state: StreamProcessingState, key: string): void {
  state.unhandledEventKinds.set(key, (state.unhandledEventKinds.get(key) ?? 0) + 1);
}

/**
 * Unwrap a `stream_event` envelope into the inner event type that
 * `processStreamEvent()` already handles.
 *
 * Claude CLI's `--output-format stream-json` wraps Anthropic API streaming
 * events like `content_block_start`, `content_block_delta`, etc. inside
 * `{"type":"stream_event","event":{...}}`. This function extracts the inner
 * event and maps it to one of the existing `ClaudeStreamEvent` variants.
 *
 * Returns `null` for envelope sub-types we don't need to process
 * (e.g. `message_start`, `message_delta`, `message_stop`).
 */
function unwrapStreamEvent(
  envelope: ClaudeStreamEventEnvelope,
): ClaudeStreamEvent | null {
  const inner = envelope.event;
  if (!inner || !inner.type) return null;

  switch (inner.type) {
    case "content_block_start":
      return {
        type: "content_block_start",
        index: inner.index ?? 0,
        content_block: inner.content_block ?? { type: "text" },
        session_id: envelope.session_id,
        parent_tool_use_id: envelope.parent_tool_use_id ?? null,
      } as ClaudeContentBlockStartEvent;

    case "content_block_delta":
      return {
        type: "content_block_delta",
        index: inner.index ?? 0,
        delta: inner.delta ?? { type: "text_delta" },
        session_id: envelope.session_id,
        parent_tool_use_id: envelope.parent_tool_use_id ?? null,
      } as ClaudeContentBlockDeltaEvent;

    case "content_block_stop":
      return {
        type: "content_block_stop",
        index: inner.index ?? 0,
        session_id: envelope.session_id,
        parent_tool_use_id: envelope.parent_tool_use_id ?? null,
      } as ClaudeContentBlockStopEvent;

    // message_start, message_delta, message_stop — not needed,
    // the top-level "assistant" and "result" events carry this data.
    default:
      devLog(
        "[claude-adapter] unwrap: skipping stream_event sub-type:",
        inner.type,
      );
      return null;
  }
}

/**
 * Extracts the element type from `ChatModelRunResult["content"]` so we can
 * build a mutable array that still satisfies the readonly constraint.
 */
type ContentPart = NonNullable<ChatModelRunResult["content"]>[number];

/**
 * Convert the accumulator array into content parts that assistant-ui expects.
 */
function buildContentFromAccumulators(
  state: StreamProcessingState,
): NonNullable<ChatModelRunResult["content"]> {
  const content: ContentPart[] = [] as ContentPart[];
  for (const acc of state.orderedAccumulators) {
    switch (acc.blockType) {
      case "thinking":
        if (acc.text) {
          content.push({
            type: "reasoning",
            text: acc.text,
            parentId: acc.parentId,
          });
        }
        break;
      case "text":
        if (acc.text) {
          content.push({
            type: "text",
            text: acc.text,
            parentId: acc.parentId,
          });
        }
        break;
      case "tool_use": {
        let args: Record<string, never> = {};
        if (acc.argsJson) {
          try {
            args = JSON.parse(acc.argsJson) as Record<string, never>;
          } catch {
            // partial JSON — pass argsText for display
          }
        }
        content.push({
          type: "tool-call" as const,
          toolCallId: acc.toolCallId || crypto.randomUUID(),
          toolName: acc.toolName,
          args,
          argsText: acc.argsJson,
          result: acc.result,
          isError: acc.isError,
          parentId: acc.parentId,
        } as ContentPart);
        break;
      }
    }
  }
  return content;
}

/**
 * Process a single parsed stream event and update the accumulators array.
 *
 * Returns flags so the caller knows what happened.
 */
function processStreamEvent(
  event: ClaudeStreamEvent,
  state: StreamProcessingState,
): {
  contentChanged: boolean;
  sessionId: string | null;
  resultEvent: ClaudeStreamEvent | null;
  isError: boolean;
  resultText: string | null;
  missingConversation: boolean;
  errors: string[] | null;
  subtype: string | null;
} {
  const scopeId = toScopeId(event.parent_tool_use_id);
  const parentId = toParentPartId(scopeId);
  let contentChanged = false;
  let sessionId: string | null = event.session_id ?? null;
  let resultEvent: ClaudeStreamEvent | null = null;
  let isError = false;
  let resultText: string | null = null;
  let missingConversation = false;
  let errors: string[] | null = null;
  let subtype: string | null = null;

  switch (event.type) {
    case "system":
      // init event carries session_id — already captured above
      break;

    case "content_block_start": {
      const idx = event.index;
      const block = event.content_block;
      const blockType =
        block.type === "thinking"
          ? "thinking"
          : block.type === "tool_use"
            ? "tool_use"
            : "text";
      const acc = createIndexedAccumulator(state, blockType, {
        scopeId,
        parentId,
        streamIndex: idx,
        source: "stream",
      });
      acc.blockType = blockType;
      acc.scopeId = scopeId;
      acc.parentId = parentId;
      acc.streamIndex = idx;
      if (block.type === "tool_use") {
        acc.toolCallId = block.id ?? acc.toolCallId;
        acc.toolName = block.name ?? "";
        if (acc.toolCallId) {
          state.keyByToolCallId.set(acc.toolCallId, acc.key);
          state.latestToolCallIdByScope.set(scopeId, acc.toolCallId);
          const pending = state.pendingToolResultByCallId.get(acc.toolCallId);
          if (pending) {
            acc.result = pending.result;
            acc.isError = pending.isError;
            state.pendingToolResultByCallId.delete(acc.toolCallId);
          }
        }
      }
      if (block.text) acc.text = block.text;
      if (block.thinking) acc.text = block.thinking;
      contentChanged = true;
      break;
    }

    case "content_block_delta": {
      const idx = event.index;
      const delta = event.delta;
      const scopedIdxKey = makeScopeIndexKey(scopeId, idx);
      const accKey = state.keyByScopeIndex.get(scopedIdxKey);
      let acc = accKey ? state.accumulatorByKey.get(accKey) : undefined;
      if (!acc) {
        acc = createIndexedAccumulator(state, "text", {
          scopeId,
          parentId,
          streamIndex: idx,
          source: "delta",
        });
      }
      if (delta.text) {
        acc.text += delta.text;
        contentChanged = true;
      }
      if (delta.thinking) {
        acc.text += delta.thinking;
        contentChanged = true;
      }
      if (delta.partial_json) {
        acc.argsJson += delta.partial_json;
        contentChanged = true;
      }
      break;
    }

    case "content_block_stop":
      // Block is complete — signal change so final accumulated state is yielded
      contentChanged = true;
      break;

    case "assistant":
    case "user": {
      if (event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "tool_use") {
            const toolCallId = block.id ?? "";
            if (!toolCallId) continue;
            const toolKey =
              state.keyByToolCallId.get(toolCallId) ??
              `${scopeId}:tool:${toolCallId}`;
            let acc = state.accumulatorByKey.get(toolKey);
            if (!acc) {
              acc = makeAccumulator(state, "tool_use", {
                key: toolKey,
                scopeId,
                parentId,
                streamIndex: null,
              });
            }
            acc.toolCallId = toolCallId;
            acc.toolName = block.tool_name ?? block.name ?? acc.toolName;
            if (block.input !== undefined) {
              try {
                acc.argsJson = JSON.stringify(block.input);
              } catch {
                acc.argsJson = String(block.input);
              }
            }
            state.keyByToolCallId.set(toolCallId, acc.key);
            state.latestToolCallIdByScope.set(scopeId, toolCallId);
            const pending = state.pendingToolResultByCallId.get(toolCallId);
            if (pending) {
              acc.result = pending.result;
              acc.isError = pending.isError;
              state.pendingToolResultByCallId.delete(toolCallId);
            }
            contentChanged = true;
            continue;
          }

          if (block.type === "tool_result" && block.tool_use_id) {
            const payload = serializeToolResultPayload(
              block.content ?? block.result ?? block.error ?? null,
            );
            if (
              applyToolResultToState(
                state,
                block.tool_use_id,
                payload,
                block.is_error ?? false,
                scopeId,
              )
            ) {
              contentChanged = true;
            }
          }
        }
      }

      if (event.tool_use_result !== undefined) {
        const firstToolResult = event.message?.content.find(
          (block) => block.type === "tool_result",
        );
        const fallbackCallId = firstToolResult?.tool_use_id;
        if (
          applyToolResultToState(
            state,
            fallbackCallId,
            serializeToolResultPayload(event.tool_use_result),
            false,
            scopeId,
          )
        ) {
          contentChanged = true;
        }
      }

      // assistant events with content_block / delta (alternative format)
      if (event.content_block) {
        const idx = event.index ?? state.orderedAccumulators.length;
        const block = event.content_block;
        const blockType =
          block.type === "thinking"
            ? "thinking"
            : block.type === "tool_use"
              ? "tool_use"
              : "text";
        const acc = createIndexedAccumulator(state, blockType, {
          scopeId,
          parentId,
          streamIndex: idx,
          source: "assistant",
        });
        if (block.type === "tool_use") {
          acc.toolCallId = block.id ?? acc.toolCallId;
          acc.toolName = block.tool_name ?? block.name ?? acc.toolName;
          if (acc.toolCallId) {
            state.keyByToolCallId.set(acc.toolCallId, acc.key);
            state.latestToolCallIdByScope.set(scopeId, acc.toolCallId);
          }
        }
        if (block.text) acc.text = block.text;
        if (block.thinking) acc.text = block.thinking;
        contentChanged = true;
      }
      if (event.delta) {
        const idx = event.index ?? state.orderedAccumulators.length - 1;
        const scopedIdxKey = makeScopeIndexKey(scopeId, idx);
        const key = state.keyByScopeIndex.get(scopedIdxKey);
        const acc = key ? state.accumulatorByKey.get(key) : undefined;
        if (acc) {
          if (event.delta.text) {
            acc.text += event.delta.text;
            contentChanged = true;
          }
          if (event.delta.thinking) {
            acc.text += event.delta.thinking;
            contentChanged = true;
          }
          if (event.delta.partial_json) {
            acc.argsJson += event.delta.partial_json;
            contentChanged = true;
          }
        }
      }
      break;
    }

    case "result": {
      resultEvent = event;
      sessionId = event.session_id ?? sessionId;
      isError = event.is_error ?? false;
      resultText = event.result ?? null;
      errors = event.errors ?? null;
      subtype = event.subtype ?? null;
      if (
        event.subtype === "error_during_execution" &&
        event.errors?.some((e) =>
          e.includes("No conversation found with session ID"),
        )
      ) {
        missingConversation = true;
      }
      break;
    }

    default:
      noteUnhandledEventKind(state, `type:${String((event as { type?: string }).type)}`);
      break;
  }

  return {
    contentChanged,
    sessionId,
    resultEvent,
    isError,
    resultText,
    missingConversation,
    errors,
    subtype,
  };
}

// ---------------------------------------------------------------------------
// Stream event queue types for spawnClaudeStreaming
// ---------------------------------------------------------------------------

type StreamQueueItem =
  | { kind: "stdout"; line: string }
  | { kind: "stderr"; line: string }
  | { kind: "close"; code: number | null; signal: number | null }
  | { kind: "error"; message: string };

interface StreamSpawnConfig {
  prompt: string;
  sessionMode: "resume" | "none";
  sessionId: string | null;
  cwd?: string;
  model?: string;
  effort?: string;
}

const ENSURE_BRANCH_SCRIPT = `
repo_dir="$1"
target_branch="$2"
repo_root="$(git -C "$repo_dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
current_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ -z "$target_branch" ] || [ "$current_branch" = "$target_branch" ]; then
  exit 0
fi
git -C "$repo_root" show-ref --verify --quiet "refs/heads/$target_branch" || exit 2
git -C "$repo_root" checkout "$target_branch" >/dev/null 2>&1
`;

async function ensureBranchCheckedOut(cwd: string, branch: string): Promise<boolean> {
  const target = branch.trim();
  if (!target) return true;
  const command = Command.create("claude-stream-sh", ["-c", ENSURE_BRANCH_SCRIPT, "ensure-branch", cwd, target]);
  const result = await command.execute();
  return result.code === 0;
}

/**
 * Shell script that invokes Claude CLI with `< /dev/null` to close stdin
 * immediately (EOF). Without this, Claude CLI detects a pipe on stdin
 * and blocks waiting for input before producing any output.
 *
 * The prompt and session details are passed via environment variables
 * to avoid shell injection. `exec` replaces `sh` with `claude` so
 * there is no lingering parent shell process.
 */
const CLAUDE_SHELL_SCRIPT =
  'MODEL_FLAG=""; [ -n "$CLAUDE_MODEL" ] && MODEL_FLAG="--model $CLAUDE_MODEL"; EFFORT_FLAG=""; [ -n "$CLAUDE_EFFORT" ] && EFFORT_FLAG="--effort $CLAUDE_EFFORT"; if [ "$CLAUDE_MODE" = "resume" ]; then exec claude -p "$CLAUDE_PROMPT" $MODEL_FLAG $EFFORT_FLAG --output-format stream-json --verbose --include-partial-messages --debug-to-stderr --resume "$CLAUDE_SESSION_ID" < /dev/null; else exec claude -p "$CLAUDE_PROMPT" $MODEL_FLAG $EFFORT_FLAG --output-format stream-json --verbose --include-partial-messages --debug-to-stderr < /dev/null; fi';

/**
 * Spawn Claude CLI and yield stream events as an async iterable.
 *
 * Bridges Tauri's callback-based shell events into an async generator
 * the run() method can consume with `for await`.
 *
 * Uses a shell wrapper (`sh -c`) with `< /dev/null` to immediately close
 * stdin, which prevents Claude CLI from hanging when it detects a pipe
 * instead of a TTY.
 */
async function* spawnClaudeStreaming(
  config: StreamSpawnConfig,
  threadKey: string,
  abortSignal: AbortSignal,
): AsyncGenerator<StreamQueueItem, void, unknown> {
  const command = Command.create("claude-stream-sh", ["-c", CLAUDE_SHELL_SCRIPT], {
    cwd: config.cwd,
    env: {
      CLAUDE_MODE: config.sessionMode,
      CLAUDE_PROMPT: config.prompt,
      CLAUDE_SESSION_ID: config.sessionId ?? "",
      CLAUDE_MODEL: config.model ?? "",
      CLAUDE_EFFORT: config.effort ?? "",
    },
  });

  // Queue + resolver pattern to bridge callbacks → async iteration
  const queue: StreamQueueItem[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  function enqueue(item: StreamQueueItem) {
    queue.push(item);
    if (resolve) {
      const r = resolve;
      resolve = null;
      r();
    }
  }

  command.stdout.on("data", (line: string) => {
    devLog(
      "[claude-stream] stdout data:",
      line.length,
      "chars,",
      line.slice(0, 80),
    );
    enqueue({ kind: "stdout", line });
  });
  command.stderr.on("data", (line: string) => {
    devLog("[claude-stream] stderr data:", line.slice(0, 120));
    enqueue({ kind: "stderr", line });
  });
  command.on("close", (data) => {
    enqueue({
      kind: "close",
      code: data.code ?? null,
      signal: data.signal ?? null,
    });
  });
  command.on("error", (err: string) => {
    enqueue({ kind: "error", message: err });
  });

  const child = await command.spawn();
  activeChildByThread.set(threadKey, child);

  // Wire abort signal to kill
  const onAbort = () => {
    void child.kill();
  };
  if (abortSignal.aborted) {
    void child.kill();
  } else {
    abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (!done) {
      // Drain any queued items
      while (queue.length > 0) {
        const item = queue.shift()!;
        if (item.kind === "close" || item.kind === "error") {
          // Race guard: drain any remaining stdout/stderr before yielding close
          for (const remaining of queue) {
            if (
              remaining.kind === "stdout" ||
              remaining.kind === "stderr"
            ) {
              yield remaining;
            }
          }
          queue.length = 0;
          done = true;
          yield item;
          return;
        }
        yield item;
      }

      // Wait for next item
      if (!done) {
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
    }
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
    activeChildByThread.delete(threadKey);
  }
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

        // Resolve CWD fallback once before the retry loop
        let fallbackCwd: string | undefined;
        if (!cwdByThread.get(threadKey)) {
          try {
            fallbackCwd = await homeDir();
          } catch {
            // homeDir() can fail in some environments; leave undefined
          }
        }

        let lastAttempt = 0;

        while (lastAttempt < 3) {
          lastAttempt += 1;

          const { strategy, sessionId } = chooseSessionStrategy(
            threadKey,
            knownSessionId,
          );
          const attemptedSessionId = sessionId;
          const sessionMode = strategy;

          const configuredCwd = cwdByThread.get(threadKey) ?? fallbackCwd;
          const configuredGitBranch = gitBranchByThread.get(threadKey);

          const threadRow = await db.threads.get(threadKey);
          const effectiveModel = resolveModel(threadRow?.model ?? null);
          const effectiveEffort = resolveEffort(threadRow?.effort ?? null);
          const modelDef = getModelById(effectiveModel);

          const spawnConfig: StreamSpawnConfig = {
            prompt,
            sessionMode,
            sessionId,
            cwd: configuredCwd,
            model: effectiveModel,
            effort: modelDef?.supportsEffort ? effectiveEffort : undefined,
          };

          devLog(
            "[claude-adapter] spawning:",
            `[${ADAPTER_REV}]`,
            JSON.stringify({ sessionMode, sessionId, cwd: configuredCwd }),
          );

          if (configuredCwd && configuredGitBranch?.trim()) {
            const switched = await ensureBranchCheckedOut(configuredCwd, configuredGitBranch);
            if (!switched) {
              devWarn(
                "[claude-adapter] failed to checkout configured branch:",
                configuredGitBranch,
              );
            }
          }

          let missingConversation = false;
          let sessionInUse = false;
          let latestSessionId: string | null = null;
          let exitCode: number | null = null;
          let exitSignal: number | null = null;
          let wasAborted = abortSignal.aborted;
          let streamResultEvent: ClaudeStreamEvent | null = null;
          let streamResultIsError = false;
          let streamResultText: string | null = null;

          const streamState = makeStreamProcessingState();
          let stdoutLineBuffer = "";
          let lastYieldTime = 0;
          let pendingYield = false;

          const processNdjsonLine = (
            line: string,
          ): boolean => {
            let rawParsed: ClaudeStreamEvent;
            try {
              rawParsed = JSON.parse(line) as ClaudeStreamEvent;
            } catch {
              devWarn(
                "[claude-adapter] non-JSON stdout line:",
                line.slice(0, 120),
              );
              return false;
            }

            devLog(
              "[claude-adapter] parsed type:",
              rawParsed.type,
              rawParsed.type === "stream_event"
                ? `-> inner: ${(rawParsed as ClaudeStreamEventEnvelope).event?.type}`
                : "",
            );

            let parsed: ClaudeStreamEvent;
            if (rawParsed.type === "stream_event") {
              const innerType =
                (rawParsed as ClaudeStreamEventEnvelope).event?.type ??
                "unknown";
              const unwrapped = unwrapStreamEvent(
                rawParsed as ClaudeStreamEventEnvelope,
              );
              if (!unwrapped) {
                devLog("[claude-adapter] unwrap: skipped (null)");
                noteUnhandledEventKind(
                  streamState,
                  `stream_event:${innerType}`,
                );
                pushDevEvent(line, rawParsed, threadKey);
                return false;
              }
              devLog("[claude-adapter] unwrap: ->", unwrapped.type);
              parsed = unwrapped;
            } else {
              parsed = rawParsed;
            }

            pushDevEvent(line, parsed, threadKey);

            const result = processStreamEvent(parsed, streamState);

            devLog(
              "[claude-adapter] processStreamEvent:",
              parsed.type,
              "contentChanged:",
              result.contentChanged,
              "accumulators:",
              streamState.orderedAccumulators.length,
              "textLen:",
              streamState.orderedAccumulators.reduce(
                (sum, acc) => sum + acc.text.length,
                0,
              ),
            );

            if (result.sessionId) {
              latestSessionId = result.sessionId;
              knownSessionId = result.sessionId;
            }
            if (result.missingConversation) {
              missingConversation = true;
              const staleSessionId =
                attemptedSessionId ?? knownSessionId;
              if (staleSessionId) {
                upsertSessionRecord(threadKey, staleSessionId, {
                  status: "stale",
                });
              }
            }
            if (result.resultEvent) {
              streamResultEvent = result.resultEvent;
              streamResultIsError = result.isError;
              streamResultText = result.resultText;
            }

            if (result.contentChanged) {
              const now = Date.now();
              if (now - lastYieldTime >= YIELD_THROTTLE_MS) {
                lastYieldTime = now;
                pendingYield = false;
                return true;
              } else {
                pendingYield = true;
              }
            }
            return false;
          };

          for await (const item of spawnClaudeStreaming(
            spawnConfig,
            threadKey,
            abortSignal,
          )) {
            if (abortSignal.aborted) {
              wasAborted = true;
              break;
            }

            switch (item.kind) {
              case "stderr": {
                const trimmed = item.line.trim();
                if (!trimmed) break;
                devWarn("[claude-adapter] stderr:", trimmed);
                if (
                  trimmed.includes("No conversation found with session ID")
                ) {
                  missingConversation = true;
                  const staleSessionId = attemptedSessionId ?? knownSessionId;
                  if (staleSessionId) {
                    upsertSessionRecord(threadKey, staleSessionId, {
                      status: "stale",
                    });
                  }
                }
                if (trimmed.includes("already in use")) {
                  sessionInUse = true;
                  if (knownSessionId) {
                    upsertSessionRecord(threadKey, knownSessionId, {
                      status: "error",
                    });
                  }
                }
                break;
              }

              case "stdout": {
                devLog(
                  "[claude-adapter] raw stdout:",
                  item.line.length,
                  "chars,",
                  item.line.slice(0, 80),
                );
                stdoutLineBuffer += item.line;
                let newlineIdx = stdoutLineBuffer.indexOf("\n");
                while (newlineIdx >= 0) {
                  const rawLine = stdoutLineBuffer.slice(0, newlineIdx);
                  stdoutLineBuffer = stdoutLineBuffer.slice(newlineIdx + 1);
                  const line = rawLine.trim();
                  if (line) {
                    const shouldYield = processNdjsonLine(line);
                    if (shouldYield) {
                      const content = buildContentFromAccumulators(
                        streamState,
                      );
                      if (content.length > 0) {
                        devLog(
                          "[claude-adapter] yielding content:",
                          content.length,
                          "parts",
                        );
                        yield { content } satisfies ChatModelRunResult;
                      }
                    }
                  }
                  newlineIdx = stdoutLineBuffer.indexOf("\n");
                }
                break;
              }

              case "close": {
                const trailing = stdoutLineBuffer.trim();
                if (trailing) {
                  const shouldYield = processNdjsonLine(trailing);
                  if (shouldYield) {
                    const content = buildContentFromAccumulators(streamState);
                    if (content.length > 0) {
                      devLog(
                        "[claude-adapter] yielding content:",
                        content.length,
                        "parts",
                      );
                      yield { content } satisfies ChatModelRunResult;
                    }
                  }
                }
                stdoutLineBuffer = "";
                exitCode = item.code;
                exitSignal = item.signal;
                devLog(
                  "[claude-adapter] process closed:",
                  JSON.stringify({
                    code: item.code,
                    signal: item.signal,
                  }),
                );
                break;
              }

              case "error": {
                devError("[claude-adapter] spawn error:", item.message);
                break;
              }
            }
          }

          if (wasAborted) {
            // Flush final content before breaking out
            const content = buildContentFromAccumulators(streamState);
            if (content.length > 0) {
              yield {
                content,
                status: { type: "incomplete", reason: "cancelled" },
              } satisfies ChatModelRunResult;
            }
            break;
          }

          // Flush any pending content that wasn't yielded due to throttling
          if (pendingYield || streamState.orderedAccumulators.length > 0) {
            const content = buildContentFromAccumulators(streamState);
            if (content.length > 0) {
              yield {
                content,
                status: { type: "complete", reason: "stop" },
              } satisfies ChatModelRunResult;
            }
          }

          // Track usage from result event
          if (streamResultEvent) {
            const re = streamResultEvent as ClaudeResultEvent;
            const modelId =
              re.modelUsage && typeof re.modelUsage === "object"
                ? Object.keys(re.modelUsage)[0] ?? null
                : null;
            void db.usageSnapshots.insert({
              id: crypto.randomUUID(),
              thread_id: threadKey,
              session_id: latestSessionId,
              input_tokens: re.usage?.input_tokens ?? null,
              output_tokens: re.usage?.output_tokens ?? null,
              cache_creation_input_tokens:
                re.usage?.cache_creation_input_tokens ?? null,
              cache_read_input_tokens:
                re.usage?.cache_read_input_tokens ?? null,
              total_cost_usd: re.total_cost_usd ?? re.cost_usd ?? null,
              model_id: modelId,
              context_window: null,
              captured_at: new Date().toISOString(),
            });
          }

          // If no content was yielded from accumulators, fall back to result text
          if (
            streamState.orderedAccumulators.length === 0 &&
            streamResultText
          ) {
            if (!streamResultIsError) {
              yield {
                content: [{ type: "text", text: streamResultText }],
              } satisfies ChatModelRunResult;
            } else {
              yield {
                content: [
                  { type: "text", text: `Error: ${streamResultText}` },
                ],
              } satisfies ChatModelRunResult;
            }
          }

          devSnapshot = {
            ...devSnapshot,
            streamUnhandledCounts: Object.fromEntries(
              streamState.unhandledEventKinds,
            ),
            unresolvedToolResultCount: streamState.unresolvedToolResults,
          };
          devSnapshotVersion += 1;

          // --- Retry logic (structurally identical to before) ---

          if (
            exitCode !== null &&
            exitCode !== 0 &&
            !missingConversation &&
            !sessionInUse
          ) {
            const signalSuffix =
              exitSignal !== null ? ` (signal ${exitSignal})` : "";
            throw new Error(
              `Claude CLI exited with code ${exitCode}${signalSuffix}`,
            );
          }

          if (
            exitCode === 0 &&
            latestSessionId &&
            !missingConversation &&
            !sessionInUse
          ) {
            setSessionForThread(threadKey, latestSessionId);
          }

          if (knownSessionId && !missingConversation && !sessionInUse) {
            upsertSessionRecord(threadKey, knownSessionId, {
              status: "active",
            });
          }

          if (missingConversation && strategy === "resume") {
            const staleSessionId = attemptedSessionId ?? knownSessionId;
            clearSessionForThread(threadKey);
            if (staleSessionId) {
              upsertSessionRecord(threadKey, staleSessionId, {
                status: "stale",
              });
            }
            knownSessionId = null;
            continue;
          }

          if (sessionInUse && strategy === "resume") {
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

/**
 * Diagnostic: spawn a minimal Claude CLI session and log every event
 * with counters. Call from browser console to verify the pipeline
 * independently of assistant-ui.
 *
 * Usage: `import { runStreamDiagnostic } from '@/lib/claude-adapter'; runStreamDiagnostic()`
 * Or: assign to window in dev and call `window.runStreamDiagnostic()`
 */
export async function runStreamDiagnostic(): Promise<void> {
  const diagKey = "__stream_diag__";
  const ac = new AbortController();
  const counters: Record<string, number> = {};

  console.log("[stream-diag] Starting diagnostic — spawning Claude CLI...");

  for await (const item of spawnClaudeStreaming(
    { prompt: "say hello", sessionMode: "none", sessionId: null },
    diagKey,
    ac.signal,
  )) {
    const key = item.kind;
    counters[key] = (counters[key] ?? 0) + 1;

    if (item.kind === "stdout") {
      const lines = item.line.split("\n");
      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        try {
          const rawParsed = JSON.parse(trimmed) as ClaudeStreamEvent;
          const typeKey = rawParsed.type;
          counters[`type:${typeKey}`] = (counters[`type:${typeKey}`] ?? 0) + 1;

          if (rawParsed.type === "stream_event") {
            const envelope = rawParsed as ClaudeStreamEventEnvelope;
            const innerType = envelope.event?.type ?? "unknown";
            counters[`inner:${innerType}`] =
              (counters[`inner:${innerType}`] ?? 0) + 1;

            const unwrapped = unwrapStreamEvent(envelope);
            if (unwrapped) {
              counters[`unwrapped:${unwrapped.type}`] =
                (counters[`unwrapped:${unwrapped.type}`] ?? 0) + 1;

              if (
                unwrapped.type === "content_block_delta" &&
                unwrapped.delta?.text
              ) {
                console.log(
                  "[stream-diag] delta text:",
                  JSON.stringify(unwrapped.delta.text),
                );
              }
            } else {
              counters["unwrapped:skipped"] =
                (counters["unwrapped:skipped"] ?? 0) + 1;
            }
          }

          console.log(
            "[stream-diag]",
            typeKey,
            rawParsed.type === "stream_event"
              ? `(${(rawParsed as ClaudeStreamEventEnvelope).event?.type})`
              : "",
            trimmed.slice(0, 100),
          );
        } catch {
          console.log("[stream-diag] non-JSON:", trimmed.slice(0, 100));
        }
      }
    } else if (item.kind === "stderr") {
      console.warn("[stream-diag] stderr:", item.line.slice(0, 200));
    } else if (item.kind === "close") {
      console.log(
        "[stream-diag] process closed: code=",
        item.code,
        "signal=",
        item.signal,
      );
    } else if (item.kind === "error") {
      console.error("[stream-diag] error:", item.message);
    }
  }

  console.log("[stream-diag] Done. Counters:", counters);
}

// Expose diagnostic on window in dev for easy console access
if (DEV_LOGS && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).runStreamDiagnostic =
    runStreamDiagnostic;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // Kill any active child processes on hot reload
    for (const child of activeChildByThread.values()) {
      void child.kill();
    }
    activeChildByThread.clear();
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

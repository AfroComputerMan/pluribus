import { Command, type Child } from "@tauri-apps/plugin-shell";
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
  blockType: "text" | "thinking" | "tool_use";
  text: string;
  toolCallId: string;
  toolName: string;
  argsJson: string;
  result: string | undefined;
  isError: boolean;
}

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

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

function makeAccumulator(
  blockType: ContentBlockAccumulator["blockType"],
): ContentBlockAccumulator {
  return {
    blockType,
    text: "",
    toolCallId: "",
    toolName: "",
    argsJson: "",
    result: undefined,
    isError: false,
  };
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
        // Propagate session_id from envelope
        session_id: envelope.session_id,
      } as ClaudeContentBlockStartEvent;

    case "content_block_delta":
      return {
        type: "content_block_delta",
        index: inner.index ?? 0,
        delta: inner.delta ?? { type: "text_delta" },
        session_id: envelope.session_id,
      } as ClaudeContentBlockDeltaEvent;

    case "content_block_stop":
      return {
        type: "content_block_stop",
        index: inner.index ?? 0,
        session_id: envelope.session_id,
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
  accumulators: ContentBlockAccumulator[],
): NonNullable<ChatModelRunResult["content"]> {
  const content: ContentPart[] = [] as ContentPart[];
  for (const acc of accumulators) {
    switch (acc.blockType) {
      case "thinking":
        if (acc.text) {
          content.push({ type: "reasoning", text: acc.text });
        }
        break;
      case "text":
        if (acc.text) {
          content.push({ type: "text", text: acc.text });
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
  accumulators: ContentBlockAccumulator[],
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
      const acc = makeAccumulator(blockType);
      if (block.type === "tool_use") {
        acc.toolCallId = block.id ?? "";
        acc.toolName = block.name ?? "";
      }
      if (block.text) acc.text = block.text;
      if (block.thinking) acc.text = block.thinking;
      accumulators[idx] = acc;
      contentChanged = true;
      break;
    }

    case "content_block_delta": {
      const idx = event.index;
      const delta = event.delta;
      let acc = accumulators[idx];
      if (!acc) {
        // Safety: if we missed the start event, create a text accumulator
        acc = makeAccumulator("text");
        accumulators[idx] = acc;
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
      // Block is complete — no action needed, accumulator already has full state
      break;

    case "assistant": {
      // assistant events carry full message snapshots
      if (event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "tool_result" && block.tool_use_id) {
            // Reconcile tool results back to their tool_use accumulators
            for (const acc of accumulators) {
              if (
                acc.blockType === "tool_use" &&
                acc.toolCallId === block.tool_use_id
              ) {
                acc.result =
                  typeof block.content === "string"
                    ? block.content
                    : JSON.stringify(block.content ?? block.result ?? "");
                acc.isError = block.is_error ?? false;
                contentChanged = true;
                break;
              }
            }
          }
        }
      }

      // assistant events with content_block / delta (alternative format)
      if (event.content_block) {
        const idx = event.index ?? accumulators.length;
        const block = event.content_block;
        const blockType =
          block.type === "thinking"
            ? "thinking"
            : block.type === "tool_use"
              ? "tool_use"
              : "text";
        if (!accumulators[idx]) {
          const acc = makeAccumulator(blockType);
          if (block.type === "tool_use") {
            acc.toolCallId = block.id ?? "";
            acc.toolName = block.tool_name ?? block.name ?? "";
          }
          if (block.text) acc.text = block.text;
          if (block.thinking) acc.text = block.thinking;
          accumulators[idx] = acc;
          contentChanged = true;
        }
      }
      if (event.delta) {
        const idx = event.index ?? accumulators.length - 1;
        const acc = accumulators[idx];
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
  sessionMode: "resume" | "session-id" | "none";
  sessionId: string | null;
  cwd?: string;
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
  'if [ "$CLAUDE_MODE" = "resume" ]; then exec claude -p "$CLAUDE_PROMPT" --output-format stream-json --verbose --include-partial-messages --resume "$CLAUDE_SESSION_ID" < /dev/null; elif [ "$CLAUDE_MODE" = "session-id" ]; then exec claude -p "$CLAUDE_PROMPT" --output-format stream-json --verbose --include-partial-messages --session-id "$CLAUDE_SESSION_ID" < /dev/null; else exec claude -p "$CLAUDE_PROMPT" --output-format stream-json --verbose --include-partial-messages < /dev/null; fi';

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

          const configuredCwd = cwdByThread.get(threadKey);
          const configuredGitBranch = gitBranchByThread.get(threadKey);

          const spawnConfig: StreamSpawnConfig = {
            prompt,
            sessionMode,
            sessionId,
            cwd: configuredCwd,
          };

          devLog(
            "[claude-adapter] spawning:",
            `[${ADAPTER_REV}]`,
            JSON.stringify({ sessionMode, sessionId, cwd: configuredCwd }),
          );

          if (configuredGitBranch?.trim()) {
            devLog(
              "[claude-adapter] skipping auto git checkout:",
              configuredGitBranch,
            );
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

          // Accumulators for incremental content blocks
          const accumulators: ContentBlockAccumulator[] = [];
          let lastYieldTime = 0;
          let pendingYield = false;

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
                break;
              }

              case "stdout": {
                devLog(
                  "[claude-adapter] raw stdout:",
                  item.line.length,
                  "chars,",
                  item.line.slice(0, 80),
                );

                // Defensive: split on newlines in case Tauri batches lines
                const lines = item.line.split("\n");
                for (const rawLine of lines) {
                  const line = rawLine.trim();
                  if (!line) continue;

                  let rawParsed: ClaudeStreamEvent;
                  try {
                    rawParsed = JSON.parse(line) as ClaudeStreamEvent;
                  } catch {
                    devWarn(
                      "[claude-adapter] non-JSON stdout line:",
                      line.slice(0, 120),
                    );
                    continue;
                  }

                  devLog(
                    "[claude-adapter] parsed type:",
                    rawParsed.type,
                    rawParsed.type === "stream_event"
                      ? `-> inner: ${(rawParsed as ClaudeStreamEventEnvelope).event?.type}`
                      : "",
                  );

                  // Unwrap stream_event envelopes into the inner event types
                  let parsed: ClaudeStreamEvent;
                  if (rawParsed.type === "stream_event") {
                    const unwrapped = unwrapStreamEvent(
                      rawParsed as ClaudeStreamEventEnvelope,
                    );
                    if (!unwrapped) {
                      devLog("[claude-adapter] unwrap: skipped (null)");
                      // Still log the raw envelope to dev panel for visibility
                      pushDevEvent(line, rawParsed, threadKey);
                      continue;
                    }
                    devLog(
                      "[claude-adapter] unwrap: ->",
                      unwrapped.type,
                    );
                    parsed = unwrapped;
                  } else {
                    parsed = rawParsed;
                  }

                  // Log every event to dev panel
                  pushDevEvent(line, parsed, threadKey);

                  // Process the event and update accumulators
                  const result = processStreamEvent(parsed, accumulators);

                  devLog(
                    "[claude-adapter] processStreamEvent:",
                    parsed.type,
                    "contentChanged:",
                    result.contentChanged,
                    "accumulators:",
                    accumulators.length,
                    "textLen:",
                    accumulators.reduce((s, a) => s + a.text.length, 0),
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
                        localCache: "missing",
                        strategy,
                        lastCheckedAt: Date.now(),
                        lastError: "No conversation found with session ID",
                      });
                    }
                  }
                  if (result.resultEvent) {
                    streamResultEvent = result.resultEvent;
                    streamResultIsError = result.isError;
                    streamResultText = result.resultText;
                  }

                  // Yield throttled content updates (~60fps)
                  if (result.contentChanged) {
                    const now = Date.now();
                    if (now - lastYieldTime >= YIELD_THROTTLE_MS) {
                      const content =
                        buildContentFromAccumulators(accumulators);
                      if (content.length > 0) {
                        devLog(
                          "[claude-adapter] yielding content:",
                          content.length,
                          "parts",
                        );
                        yield { content } satisfies ChatModelRunResult;
                        lastYieldTime = now;
                        pendingYield = false;
                      }
                    } else {
                      pendingYield = true;
                    }
                  }
                }
                break;
              }

              case "close": {
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
            const content = buildContentFromAccumulators(accumulators);
            if (content.length > 0) {
              yield {
                content,
                status: { type: "incomplete", reason: "cancelled" },
              } satisfies ChatModelRunResult;
            }
            break;
          }

          // Flush any pending content that wasn't yielded due to throttling
          if (pendingYield || accumulators.length > 0) {
            const content = buildContentFromAccumulators(accumulators);
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
              model_id: null,
              context_window: null,
              captured_at: new Date().toISOString(),
            });
          }

          // If no content was yielded from accumulators, fall back to result text
          if (accumulators.length === 0 && streamResultText) {
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

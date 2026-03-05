/**
 * Dev event system -- circular buffer for real-time inspection of
 * provider stream events in the DevPanel.
 *
 * Replaces the dev event system previously embedded in claude-adapter.ts.
 * Uses the DevEvent type from providers/types.ts as the canonical event shape.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DevEventCategory =
  | "hooks"
  | "mcp"
  | "commands"
  | "skills"
  | "usage"
  | "messages"
  | "sidecar"
  | "other";

/**
 * Minimal shape of an SDKMessage forwarded from the Agent SDK sidecar.
 * Used by the DevPanel to render SDK-specific event rows.
 */
export interface SidecarSdkMessage {
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

export interface DevEventEntry {
  id: string;
  at: number;
  threadKey: string;
  raw: string;
  parsed: Record<string, unknown>;
  category: DevEventCategory;
  sdkMessage?: SidecarSdkMessage;
}

export interface DevSnapshot {
  events: DevEventEntry[];
  latestInitEvent: DevEventEntry | null;
  latestUsageEvent: DevEventEntry | null;
  latestSessionId: string | null;
  streamUnhandledCounts: Record<string, number>;
  unresolvedToolResultCount: number;
}

export interface SessionRecord {
  threadKey: string;
  sessionId: string;
  status: "active" | "stale" | "error";
  lastUpdatedAt: number;
}

export interface PermissionRequest {
  id: string;
  threadKey: string;
  prompt: string;
  createdAt: number;
  resolved: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DEV_EVENTS = 500;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const devListeners = new Set<() => void>();
let devEventSeq = 0;

let devSnapshot: Omit<DevSnapshot, "events"> = {
  latestInitEvent: null,
  latestUsageEvent: null,
  latestSessionId: null,
  streamUnhandledCounts: {},
  unresolvedToolResultCount: 0,
};

const devEventsBuffer: Array<DevEventEntry | undefined> = new Array(
  MAX_DEV_EVENTS,
);
let devEventsHead = 0;
let devEventsCount = 0;
let devEventsVersion = 0;
let devEventsSnapshotVersion = -1;
let devEventsSnapshot: DevEventEntry[] = [];
let devSnapshotVersion = 0;
let cachedDevSnapshotVersion = -1;
let cachedDevSnapshot: DevSnapshot = {
  events: [],
  latestInitEvent: null,
  latestUsageEvent: null,
  latestSessionId: null,
  streamUnhandledCounts: {},
  unresolvedToolResultCount: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notifyDevListeners(): void {
  for (const listener of devListeners) {
    listener();
  }
}

function getDevEventsSnapshot(): DevEventEntry[] {
  if (devEventsSnapshotVersion === devEventsVersion) {
    return devEventsSnapshot;
  }
  const events: DevEventEntry[] = [];
  for (let i = 0; i < devEventsCount; i++) {
    const idx = (devEventsHead + i) % MAX_DEV_EVENTS;
    const event = devEventsBuffer[idx];
    if (event) events.push(event);
  }
  devEventsSnapshot = events;
  devEventsSnapshotVersion = devEventsVersion;
  return events;
}

function pushDevEventToBuffer(event: DevEventEntry): void {
  if (devEventsCount < MAX_DEV_EVENTS) {
    devEventsBuffer[(devEventsHead + devEventsCount) % MAX_DEV_EVENTS] = event;
    devEventsCount++;
  } else {
    devEventsBuffer[devEventsHead] = event;
    devEventsHead = (devEventsHead + 1) % MAX_DEV_EVENTS;
  }
  devEventsVersion++;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the current dev snapshot (memoized by version). */
export function getDevSnapshot(): DevSnapshot {
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

/** Subscribe to dev snapshot changes. */
export function subscribeDevSnapshot(listener: () => void): () => void {
  devListeners.add(listener);
  return () => {
    devListeners.delete(listener);
  };
}

/** Clear all dev events. */
export function clearDevSnapshot(): void {
  devEventsHead = 0;
  devEventsCount = 0;
  devEventsVersion++;
  devSnapshot = {
    latestInitEvent: null,
    latestUsageEvent: null,
    latestSessionId: null,
    streamUnhandledCounts: {},
    unresolvedToolResultCount: 0,
  };
  devSnapshotVersion++;
  notifyDevListeners();
}

/**
 * Push a dev event into the shared circular buffer and notify listeners.
 * Called by providers when they emit DevEvents.
 */
export function pushDevEvent(
  threadKey: string,
  category: DevEventCategory,
  data: unknown,
  sdkMessage?: SidecarSdkMessage,
): void {
  const id = `dev-${++devEventSeq}`;
  const raw = JSON.stringify(data);
  const parsed =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : { value: data };

  const event: DevEventEntry = {
    id,
    at: Date.now(),
    threadKey,
    raw,
    parsed,
    category,
    sdkMessage,
  };

  pushDevEventToBuffer(event);

  // Update snapshot metadata
  if (
    parsed.type === "system" &&
    parsed.subtype === "init"
  ) {
    devSnapshot = {
      ...devSnapshot,
      latestInitEvent: event,
      latestSessionId:
        typeof parsed.session_id === "string" ? parsed.session_id : null,
    };
    devSnapshotVersion++;
  }
  if (parsed.type === "result") {
    devSnapshot = { ...devSnapshot, latestUsageEvent: event };
    devSnapshotVersion++;
  }

  devEventsVersion++;
  notifyDevListeners();
}

// ---------------------------------------------------------------------------
// Session records (in-memory registry for DevPanel display)
// ---------------------------------------------------------------------------

const sessionRecords = new Map<string, SessionRecord>();
const sessionListeners = new Set<() => void>();
let sessionRecordsSnapshot: SessionRecord[] = [];

export function getSessionRecords(): SessionRecord[] {
  return sessionRecordsSnapshot;
}

export function subscribeSessionRecords(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

export function upsertSessionRecord(
  threadKey: string,
  sessionId: string,
  updates: Partial<Pick<SessionRecord, "status">>,
): void {
  const existing = sessionRecords.get(threadKey);
  sessionRecords.set(threadKey, {
    threadKey,
    sessionId,
    status: updates.status ?? existing?.status ?? "active",
    lastUpdatedAt: Date.now(),
  });
  sessionRecordsSnapshot = Array.from(sessionRecords.values());
  for (const listener of sessionListeners) {
    listener();
  }
}

export async function refreshSessionRecords(): Promise<void> {
  const entries = Array.from(sessionRecords.values());
  for (const record of entries) {
    upsertSessionRecord(record.threadKey, record.sessionId, {
      status: record.status,
    });
  }
}

// ---------------------------------------------------------------------------
// Permission requests (stub -- permission approval moved to codex-approval-store)
// ---------------------------------------------------------------------------

const EMPTY_PERMISSION_REQUESTS: PermissionRequest[] = [];

export function getPermissionRequests(
  _threadKey: string | null,
): PermissionRequest[] {
  return EMPTY_PERMISSION_REQUESTS;
}

export function subscribePermissionRequests(
  _listener: () => void,
): () => void {
  return () => {};
}

export async function respondToPermissionRequest(
  _requestId: string,
  _approved: boolean,
): Promise<void> {
  return;
}

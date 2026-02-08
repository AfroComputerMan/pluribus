# SQLite Backend — Architecture Design

> Companion to [sqlite-backend-requirements.md](./sqlite-backend-requirements.md)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Plugin Integration](#2-plugin-integration)
3. [Database Schema](#3-database-schema)
4. [Module Design: `db.ts`](#4-module-design-dbts)
5. [Adapter Design: `SQLiteThreadListAdapter`](#5-adapter-design-sqlitethreadlistadapter)
6. [Adapter Design: `SQLiteThreadHistoryAdapter`](#6-adapter-design-sqlitethreadhistoryadapter)
7. [RuntimeProvider Rewiring](#7-runtimeprovider-rewiring)
8. [Claude Adapter Modifications](#8-claude-adapter-modifications)
9. [Dev Event Archive Pipeline](#9-dev-event-archive-pipeline)
10. [MCP Telemetry Pipeline](#10-mcp-telemetry-pipeline)
11. [Data Flow Diagrams](#11-data-flow-diagrams)
12. [Migration Strategy](#12-migration-strategy)
13. [File Manifest](#13-file-manifest)
14. [Implementation Order](#14-implementation-order)

---

## 1. System Overview

### Before (Current)

```
┌─────────────────────────────────────────────────────┐
│  RuntimeProvider                                    │
│  useLocalRuntime(adapter)                           │
│  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │ No thread    │  │ No message persistence      │  │
│  │ persistence  │  │ (lost on switch/restart)    │  │
│  └──────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
        ↕                       ↕
   React state            In-memory only
   (ThreadWorkspace)      (circular buffer, Maps)
        ↕
   localStorage
   (session IDs only)
```

### After (Target)

```
┌───────────────────────────────────────────────────────────────┐
│  RuntimeProvider                                              │
│  useRemoteThreadListRuntime({ runtimeHook, adapter })         │
│  ┌─────────────────────┐  ┌─────────────────────────────────┐ │
│  │ SQLiteThreadList     │  │ SQLiteThreadHistory             │ │
│  │ Adapter              │  │ Adapter (per-thread)            │ │
│  │                      │  │ injected via unstable_Provider  │ │
│  └──────────┬───────────┘  └──────────────┬──────────────────┘ │
└─────────────┼──────────────────────────────┼──────────────────┘
              │                              │
              ▼                              ▼
┌───────────────────────────────────────────────────────────────┐
│                     src/lib/db.ts                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ threads  │ │ messages │ │ sessions │ │ dev_events       │ │
│  │          │ │          │ │          │ │ mcp_snapshots    │ │
│  │          │ │          │ │          │ │ mcp_invocations  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
└──────────────────────────┬────────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────┐
│  tauri-plugin-sql  →  SQLite  ($APPDATA/pluribus/pluribus.db) │
└───────────────────────────────────────────────────────────────┘
```

---

## 2. Plugin Integration

### 2.1 Rust Side (`src-tauri/Cargo.toml`)

Add the plugin with the `sqlite` feature:

```toml
[dependencies]
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```

### 2.2 Rust Side (`src-tauri/src/lib.rs`)

Register the plugin with migrations:

```rust
use tauri_plugin_sql::{Migration, MigrationKind};

pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_schema",
            sql: include_str!("../migrations/001_initial_schema.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pluribus.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 2.3 JavaScript Side (`package.json`)

```bash
bun add @tauri-apps/plugin-sql
```

### 2.4 Tauri Capabilities (`src-tauri/capabilities/default.json`)

Add SQL permissions alongside existing shell permissions:

```json
{
  "permissions": [
    "core:default",
    "sql:default",
    "sql:allow-execute",
    // ... existing shell permissions
  ]
}
```

`sql:default` grants `load`, `select`, and `close`. We add `sql:allow-execute` for write operations (INSERT/UPDATE/DELETE).

### 2.5 Optional: Preload (`src-tauri/tauri.conf.json`)

```json
{
  "plugins": {
    "sql": {
      "preload": ["sqlite:pluribus.db"]
    }
  }
}
```

This ensures migrations run at app startup before the frontend requests any data.

---

## 3. Database Schema

### 3.1 Full DDL (`src-tauri/migrations/001_initial_schema.sql`)

```sql
-- Enable WAL mode for better concurrent read/write performance
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

------------------------------------------------------------
-- threads: Thread metadata (drives RemoteThreadListAdapter)
------------------------------------------------------------
CREATE TABLE threads (
  id          TEXT PRIMARY KEY,              -- assistant-ui thread ID (UUID)
  remote_id   TEXT UNIQUE,                   -- ID returned by initialize() — same as id for us
  title       TEXT,                          -- Thread title (nullable, set by generateTitle)
  status      TEXT NOT NULL DEFAULT 'regular' CHECK (status IN ('regular', 'archived')),
  session_id  TEXT,                          -- Claude CLI session ID (nullable)
  cwd         TEXT,                          -- Working directory for this thread
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);

CREATE INDEX idx_threads_status ON threads(status);
CREATE INDEX idx_threads_updated ON threads(updated_at DESC);

------------------------------------------------------------
-- messages: Conversation messages (drives ThreadHistoryAdapter)
------------------------------------------------------------
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,              -- ThreadMessage.id
  thread_id   TEXT NOT NULL,                 -- FK → threads.id
  parent_id   TEXT,                          -- Parent message ID (branching support)
  role        TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content     TEXT NOT NULL,                 -- JSON: ThreadMessage.content array
  status      TEXT,                          -- JSON: MessageStatus (for assistant messages)
  metadata    TEXT,                          -- JSON: ThreadMessage.metadata
  run_config  TEXT,                          -- JSON: RunConfig
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_parent ON messages(parent_id);

------------------------------------------------------------
-- sessions: Claude CLI session records
------------------------------------------------------------
CREATE TABLE sessions (
  thread_id       TEXT NOT NULL,             -- FK → threads.id (or threadKey)
  session_id      TEXT NOT NULL,             -- Claude CLI session ID
  status          TEXT NOT NULL DEFAULT 'unknown',
  local_cache     TEXT NOT NULL DEFAULT 'unknown',
  strategy        TEXT NOT NULL DEFAULT 'none',
  last_checked_at TEXT,                      -- ISO timestamp
  last_updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  last_error      TEXT,

  PRIMARY KEY (thread_id),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

------------------------------------------------------------
-- dev_events: Archived dev events from Claude CLI stream
------------------------------------------------------------
CREATE TABLE dev_events (
  id          TEXT PRIMARY KEY,              -- Same ID format as in-memory events
  thread_id   TEXT NOT NULL,                 -- Thread that generated this event
  seq         INTEGER NOT NULL,              -- Monotonic sequence number
  category    TEXT NOT NULL,                 -- hooks|mcp|commands|skills|usage|messages|other
  raw         TEXT NOT NULL,                 -- Raw JSON line from Claude CLI
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_dev_events_thread ON dev_events(thread_id);
CREATE INDEX idx_dev_events_category ON dev_events(category);
CREATE INDEX idx_dev_events_created ON dev_events(created_at DESC);

------------------------------------------------------------
-- mcp_snapshots: Per-session MCP server/tool state
------------------------------------------------------------
CREATE TABLE mcp_snapshots (
  id          TEXT PRIMARY KEY,              -- Generated UUID
  thread_id   TEXT NOT NULL,                 -- FK → threads.id
  session_id  TEXT,                          -- Claude CLI session ID at capture time
  servers     TEXT NOT NULL,                 -- JSON: Array<{ name, status }>
  tools       TEXT NOT NULL,                 -- JSON: string[] (all tool names)
  mcp_tools   TEXT NOT NULL,                 -- JSON: string[] (only mcp__* prefixed)
  builtin_tools TEXT NOT NULL,               -- JSON: string[] (non-mcp tools)
  skills      TEXT,                          -- JSON: string[] (skills available)
  slash_commands TEXT,                       -- JSON: string[] (slash commands available)
  captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_mcp_snapshots_thread ON mcp_snapshots(thread_id);

------------------------------------------------------------
-- mcp_invocations: Per-call MCP tool telemetry
------------------------------------------------------------
CREATE TABLE mcp_invocations (
  id              TEXT PRIMARY KEY,          -- Generated UUID
  thread_id       TEXT NOT NULL,             -- FK → threads.id
  session_id      TEXT,                      -- Claude CLI session at invocation time
  tool_name       TEXT NOT NULL,             -- Full tool name (e.g. "mcp__slack__read_channel")
  server_name     TEXT,                      -- Extracted MCP server name (e.g. "slack")
  input_tokens    INTEGER,                   -- Token cost of tool input
  output_tokens   INTEGER,                   -- Token cost of tool output
  cost_usd        REAL,                      -- USD cost (if available)
  duration_ms     INTEGER,                   -- Execution duration (if available)
  success         INTEGER NOT NULL DEFAULT 1, -- 1=success, 0=error
  error           TEXT,                      -- Error message if failed
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_mcp_invocations_thread ON mcp_invocations(thread_id);
CREATE INDEX idx_mcp_invocations_tool ON mcp_invocations(tool_name);

------------------------------------------------------------
-- usage_snapshots: Context window utilization tracking
------------------------------------------------------------
CREATE TABLE usage_snapshots (
  id                          TEXT PRIMARY KEY,
  thread_id                   TEXT NOT NULL,
  session_id                  TEXT,
  input_tokens                INTEGER,
  output_tokens               INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens     INTEGER,
  total_cost_usd              REAL,
  model_id                    TEXT,          -- Which model was used (if available)
  context_window              INTEGER,       -- Context window size (if available)
  captured_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_usage_snapshots_thread ON usage_snapshots(thread_id);
```

### 3.2 Design Decisions

| Decision | Rationale |
|----------|-----------|
| TEXT for timestamps | ISO 8601 strings sort lexicographically and are human-readable. SQLite has no native datetime. |
| TEXT for IDs | assistant-ui uses string UUIDs. No auto-increment needed. |
| JSON in TEXT columns | `content`, `metadata`, `servers`, `tools` etc. are stored as JSON strings. Forward-compatible — schema doesn't need to change when assistant-ui adds fields. |
| `ON DELETE CASCADE` on all FKs | Thread deletion cleans up everything. Single DELETE statement removes all related data. |
| `usage_snapshots` table (7th table) | Added to the original 6-table spec to capture per-event context window utilization. Separated from `mcp_invocations` because usage events fire independently of tool calls. |
| WAL mode | Better concurrent read/write. The DevPanel reads while the adapter writes. Set via PRAGMA in migration. |

### 3.3 Entity Relationship Diagram

```
┌──────────┐
│ threads  │
│──────────│
│ id (PK)  │───┐
│ remote_id│   │
│ title    │   │
│ status   │   │
│ session_id   │
│ cwd      │   │
│ timestamps│  │
└──────────┘   │
               │
    ┌──────────┼────────────┬──────────────┬────────────────┬──────────────┐
    │          │            │              │                │              │
    ▼          ▼            ▼              ▼                ▼              ▼
┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────┐
│ messages │ │ sessions │ │ dev_events │ │mcp_snapshots │ │mcp_invocat.│ │usage_snapshot│
│──────────│ │──────────│ │────────────│ │──────────────│ │────────────│ │──────────────│
│ id (PK)  │ │thread_id │ │ id (PK)    │ │ id (PK)      │ │ id (PK)    │ │ id (PK)      │
│ thread_id│ │(PK, FK)  │ │ thread_id  │ │ thread_id    │ │ thread_id  │ │ thread_id    │
│ parent_id│ │session_id│ │ seq        │ │ session_id   │ │ session_id │ │ session_id   │
│ role     │ │ status   │ │ category   │ │ servers (J)  │ │ tool_name  │ │ input_tokens │
│content(J)│ │local_cache│ │ raw (J)    │ │ tools (J)    │ │server_name │ │ output_tokens│
│status (J)│ │ strategy │ │ created_at │ │ mcp_tools(J) │ │ tokens     │ │ cost_usd     │
│metadata(J│ │ last_err │ └────────────┘ │ captured_at  │ │ cost_usd   │ │ captured_at  │
│run_cfg(J)│ │timestamps│                └──────────────┘ │ success    │ └──────────────┘
│created_at│ └──────────┘                                  │ error      │
└──────────┘                                               │ created_at │
                                                           └────────────┘
                                                   (J) = JSON text column
```

---

## 4. Module Design: `db.ts`

### 4.1 File: `src/lib/db.ts`

This is the standalone database access layer. All SQL lives here. Adapters and other modules import typed functions from this module — they never write raw SQL.

### 4.2 Initialization

```typescript
import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:pluribus.db";

let dbInstance: Database | null = null;
let dbPromise: Promise<Database> | null = null;

/** Get or initialize the database singleton. Thread-safe via promise dedup. */
export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL).then((db) => {
      dbInstance = db;
      return db;
    });
  }
  return dbPromise;
}
```

The `getDb()` pattern ensures:
- Only one connection is opened (singleton)
- Concurrent callers during init share the same promise (no race conditions)
- After first load, returns synchronously from cache

### 4.3 API Surface (Namespaced Functions)

```typescript
export const db = {
  threads: {
    list,           // () → Promise<ThreadRow[]>
    get,            // (id: string) → Promise<ThreadRow | null>
    create,         // (id: string) → Promise<ThreadRow>
    rename,         // (id: string, title: string) → Promise<void>
    archive,        // (id: string) → Promise<void>
    unarchive,      // (id: string) → Promise<void>
    delete,         // (id: string) → Promise<void>
    updateSessionId, // (id: string, sessionId: string) → Promise<void>
    updateCwd,      // (id: string, cwd: string) → Promise<void>
  },
  messages: {
    loadByThread,   // (threadId: string) → Promise<MessageRow[]>
    append,         // (row: MessageRow) → Promise<void>
    deleteByThread, // (threadId: string) → Promise<void>
  },
  sessions: {
    get,            // (threadId: string) → Promise<SessionRow | null>
    upsert,         // (row: SessionRow) → Promise<void>
    delete,         // (threadId: string) → Promise<void>
  },
  devEvents: {
    insertBatch,    // (events: DevEventRow[]) → Promise<void>
    queryByThread,  // (threadId: string, opts?) → Promise<DevEventRow[]>
    queryByCategory,// (category: string, opts?) → Promise<DevEventRow[]>
    count,          // () → Promise<number>
    prune,          // (keepCount: number) → Promise<number>  -- delete oldest beyond threshold
  },
  mcpSnapshots: {
    insert,         // (row: McpSnapshotRow) → Promise<void>
    getByThread,    // (threadId: string) → Promise<McpSnapshotRow[]>
    getLatest,      // (threadId: string) → Promise<McpSnapshotRow | null>
  },
  mcpInvocations: {
    insert,         // (row: McpInvocationRow) → Promise<void>
    getByThread,    // (threadId: string) → Promise<McpInvocationRow[]>
    getByTool,      // (toolName: string, opts?) → Promise<McpInvocationRow[]>
  },
  usageSnapshots: {
    insert,         // (row: UsageSnapshotRow) → Promise<void>
    getByThread,    // (threadId: string) → Promise<UsageSnapshotRow[]>
    getLatest,      // (threadId: string) → Promise<UsageSnapshotRow | null>
  },
} as const;
```

### 4.4 Row Types

```typescript
/** Row types mirror the database schema. JSON columns are stored as strings
 *  but typed functions handle serialization/deserialization at the boundary. */

export interface ThreadRow {
  id: string;
  remote_id: string;
  title: string | null;
  status: "regular" | "archived";
  session_id: string | null;
  cwd: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  parent_id: string | null;
  role: "system" | "user" | "assistant";
  content: string;     // JSON string — serialized ThreadMessage.content
  status: string | null; // JSON string — serialized MessageStatus
  metadata: string | null; // JSON string — serialized ThreadMessage.metadata
  run_config: string | null; // JSON string — serialized RunConfig
  created_at: string;
}

export interface SessionRow {
  thread_id: string;
  session_id: string;
  status: string;
  local_cache: string;
  strategy: string;
  last_checked_at: string | null;
  last_updated_at: string;
  last_error: string | null;
}

export interface DevEventRow {
  id: string;
  thread_id: string;
  seq: number;
  category: string;
  raw: string;         // JSON string — raw Claude CLI event
  created_at: string;
}

export interface McpSnapshotRow {
  id: string;
  thread_id: string;
  session_id: string | null;
  servers: string;     // JSON string
  tools: string;       // JSON string
  mcp_tools: string;   // JSON string
  builtin_tools: string; // JSON string
  skills: string | null;
  slash_commands: string | null;
  captured_at: string;
}

export interface McpInvocationRow {
  id: string;
  thread_id: string;
  session_id: string | null;
  tool_name: string;
  server_name: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  success: number;     // SQLite boolean: 1 or 0
  error: string | null;
  created_at: string;
}

export interface UsageSnapshotRow {
  id: string;
  thread_id: string;
  session_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  total_cost_usd: number | null;
  model_id: string | null;
  context_window: number | null;
  captured_at: string;
}
```

### 4.5 Example Implementation: `db.threads.list()`

```typescript
async function list(): Promise<ThreadRow[]> {
  const conn = await getDb();
  return conn.select<ThreadRow[]>(
    "SELECT * FROM threads WHERE status = $1 ORDER BY updated_at DESC",
    ["regular"],
  );
}
```

### 4.6 Example Implementation: `db.messages.append()`

```typescript
async function append(row: MessageRow): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    `INSERT INTO messages (id, thread_id, parent_id, role, content, status, metadata, run_config, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING`,
    [row.id, row.thread_id, row.parent_id, row.role,
     row.content, row.status, row.metadata, row.run_config, row.created_at],
  );
}
```

The `ON CONFLICT DO NOTHING` guard makes `append()` idempotent — safe for retries and the race condition documented in assistant-ui issue #2104.

### 4.7 UUID Generation

Use `crypto.randomUUID()` (available in all modern browsers and Tauri webview):

```typescript
function generateId(): string {
  return crypto.randomUUID();
}
```

---

## 5. Adapter Design: `SQLiteThreadListAdapter`

### 5.1 File: `src/lib/sqlite-thread-list-adapter.ts`

Implements the `RemoteThreadListAdapter` interface from assistant-ui. This is the primary integration point for thread persistence.

### 5.2 Interface Mapping

| `RemoteThreadListAdapter` method | SQLite operation | Notes |
|----------------------------------|------------------|-------|
| `list()` | `db.threads.list()` | Returns all non-archived threads as `RemoteThreadMetadata[]` |
| `initialize(threadId)` | `db.threads.create(threadId)` | Creates a thread row, returns `{ remoteId, externalId }` |
| `rename(remoteId, title)` | `db.threads.rename(id, title)` | Updates `threads.title` and `updated_at` |
| `archive(remoteId)` | `db.threads.archive(id)` | Sets `threads.status = 'archived'` |
| `unarchive(remoteId)` | `db.threads.unarchive(id)` | Sets `threads.status = 'regular'` |
| `delete(remoteId)` | `db.threads.delete(id)` | Deletes thread row; cascades to all child tables |
| `fetch(threadId)` | `db.threads.get(id)` | Returns `RemoteThreadMetadata` for a single thread |
| `generateTitle(remoteId, messages)` | Returns placeholder stream | Streams back a title derived from the first user message |
| `unstable_Provider` | Injects `SQLiteThreadHistoryAdapter` | See section 6 |

### 5.3 Structural Design

```typescript
import type { RemoteThreadListAdapter, RemoteThreadMetadata } from "@assistant-ui/react";
import { db, type ThreadRow } from "@/lib/db";

function threadRowToMetadata(row: ThreadRow): RemoteThreadMetadata {
  return {
    remoteId: row.remote_id,
    status: row.status,
    title: row.title ?? undefined,
    externalId: row.id,
  };
}

export function createSQLiteThreadListAdapter(): RemoteThreadListAdapter {
  return {
    async list() {
      const rows = await db.threads.list();
      return { threads: rows.map(threadRowToMetadata) };
    },

    async initialize(threadId: string) {
      const row = await db.threads.create(threadId);
      return { remoteId: row.remote_id, externalId: row.id };
    },

    async rename(remoteId: string, newTitle: string) {
      await db.threads.rename(remoteId, newTitle);
    },

    async archive(remoteId: string) {
      await db.threads.archive(remoteId);
    },

    async unarchive(remoteId: string) {
      await db.threads.unarchive(remoteId);
    },

    async delete(remoteId: string) {
      await db.threads.delete(remoteId);
    },

    async fetch(threadId: string) {
      const row = await db.threads.get(threadId);
      if (!row) throw new Error(`Thread not found: ${threadId}`);
      return threadRowToMetadata(row);
    },

    generateTitle(_remoteId, messages) {
      // Extract title from first user message (first 50 chars)
      // Returns an AssistantStream — minimal implementation
      return createTitleStream(messages);
    },

    unstable_Provider: SQLiteHistoryProvider,  // See section 6.3
  };
}
```

### 5.4 Title Generation

Rather than calling Claude CLI for title generation (which would spawn a subprocess), use a simple heuristic:

```typescript
function createTitleStream(messages: readonly ThreadMessage[]): AssistantStream {
  const firstUserMsg = messages.find((m) => m.role === "user");
  const text = firstUserMsg?.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join(" ") ?? "New Thread";

  const title = text.length > 50 ? text.slice(0, 47) + "..." : text;

  // Create a minimal AssistantStream that yields the title
  // (Implementation depends on assistant-ui's AssistantStream factory)
  return AssistantStream.fromText(title);
}
```

> **Note**: `AssistantStream.fromText()` may not exist — at implementation time, check assistant-ui exports for the correct factory. Fallback: return a `ReadableStream` that emits a single text chunk.

### 5.5 `remoteId` Strategy

For a local-only SQLite backend, `remoteId` and `id` are the same value. There's no external service generating IDs. In `initialize()`, we use the `threadId` passed by assistant-ui as both:

```typescript
async initialize(threadId: string) {
  const row = await db.threads.create(threadId);
  return { remoteId: threadId, externalId: threadId };
}
```

---

## 6. Adapter Design: `SQLiteThreadHistoryAdapter`

### 6.1 File: `src/lib/sqlite-thread-history-adapter.ts`

This module exports a React component (`SQLiteHistoryProvider`) that is used as the `unstable_Provider` on the thread list adapter. It injects a per-thread `ThreadHistoryAdapter` via `RuntimeAdapterProvider`.

### 6.2 Message Serialization

assistant-ui's `ThreadMessage` is a complex type with nested content parts, metadata, attachments, etc. We serialize the full message object for storage:

```typescript
import type { ThreadMessage } from "@assistant-ui/react";
import type { ExportedMessageRepositoryItem, ExportedMessageRepository } from "@assistant-ui/react";
import type { MessageRow } from "@/lib/db";

/** Serialize a ThreadMessage into a MessageRow for SQLite storage. */
function messageToRow(threadId: string, item: ExportedMessageRepositoryItem): MessageRow {
  const msg = item.message;
  return {
    id: msg.id,
    thread_id: threadId,
    parent_id: item.parentId,
    role: msg.role,
    content: JSON.stringify(msg.content),
    status: "status" in msg ? JSON.stringify(msg.status) : null,
    metadata: JSON.stringify(msg.metadata),
    run_config: item.runConfig ? JSON.stringify(item.runConfig) : null,
    created_at: msg.createdAt.toISOString(),
  };
}

/** Deserialize a MessageRow back into an ExportedMessageRepositoryItem. */
function rowToMessageItem(row: MessageRow): ExportedMessageRepositoryItem {
  return {
    parentId: row.parent_id,
    message: {
      id: row.id,
      createdAt: new Date(row.created_at),
      role: row.role,
      content: JSON.parse(row.content),
      ...(row.status ? { status: JSON.parse(row.status) } : {}),
      metadata: row.metadata ? JSON.parse(row.metadata) : { custom: {} },
      ...(row.role === "user" ? { attachments: [] } : {}),
    } as ThreadMessage,
    ...(row.run_config ? { runConfig: JSON.parse(row.run_config) } : {}),
  };
}
```

### 6.3 The `unstable_Provider` Component

This is the key integration point. It's a React component set on `RemoteThreadListAdapter.unstable_Provider`. assistant-ui renders this component wrapping each thread, giving us a place to inject the `ThreadHistoryAdapter` per-thread.

```typescript
import { useMemo } from "react";
import { RuntimeAdapterProvider, useAui } from "@assistant-ui/react";
import type { ThreadHistoryAdapter } from "@assistant-ui/react";
import { db } from "@/lib/db";

export function SQLiteHistoryProvider({ children }: { children: React.ReactNode }) {
  const aui = useAui();

  const history = useMemo<ThreadHistoryAdapter>(() => ({
    async load() {
      // Get the thread's remote ID (which is our SQLite thread ID)
      const state = aui.threadListItem.getState();
      const threadId = state.remoteId;
      if (!threadId) return { messages: [] };

      const rows = await db.messages.loadByThread(threadId);
      const messages = rows.map(rowToMessageItem);

      // Determine head: the last message in chronological order
      const headId = messages.length > 0
        ? messages[messages.length - 1].message.id
        : null;

      return { headId, messages };
    },

    async append(item) {
      // initialize() is idempotent — safe to call on every append
      // This handles the race condition from issue #2104
      const { remoteId } = await aui.threadListItem.initialize();
      const row = messageToRow(remoteId, item);
      await db.messages.append(row);
    },
  }), [aui]);

  return (
    <RuntimeAdapterProvider adapters={{ history }}>
      {children}
    </RuntimeAdapterProvider>
  );
}
```

### 6.4 Critical: The `initialize()` Race Condition

From assistant-ui issue [#2104](https://github.com/assistant-ui/assistant-ui/issues/2104): `append()` can be called before `initialize()` completes on the first message. The fix is to always call `await aui.threadListItem.initialize()` inside `append()`. The `initialize()` method is idempotent — if the thread is already initialized, it immediately returns the existing `remoteId`.

In `db.threads.create()`, we use `INSERT ... ON CONFLICT DO NOTHING` to make this safe:

```sql
INSERT INTO threads (id, remote_id, status, created_at, updated_at)
VALUES ($1, $1, 'regular', ..., ...)
ON CONFLICT (id) DO NOTHING
```

### 6.5 Message Tree (Branching)

assistant-ui uses a tree structure for messages via `parentId`. This supports edit/branch/regenerate operations. Our schema preserves this with the `parent_id` column. The `load()` method returns all messages for a thread, and assistant-ui reconstructs the tree internally using its `MessageRepository`.

The `headId` in the `load()` return value tells assistant-ui which branch to display. We return the last message chronologically, but assistant-ui may adjust this based on user navigation.

---

## 7. RuntimeProvider Rewiring

### 7.1 Current (`src/components/RuntimeProvider.tsx`)

```typescript
// BEFORE
const adapter = useMemo(() => createClaudeAdapter(), []);
const runtime = useLocalRuntime(adapter);
```

### 7.2 Target

```typescript
// AFTER
import { useLocalRuntime, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { createClaudeAdapter } from "@/lib/claude-adapter";
import { createSQLiteThreadListAdapter } from "@/lib/sqlite-thread-list-adapter";

const threadListAdapter = createSQLiteThreadListAdapter();

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useRuntimeHook,
    adapter: threadListAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>{children}</TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

/** Inner hook — creates the per-thread local runtime with the Claude adapter. */
function useRuntimeHook(): AssistantRuntime {
  const adapter = useMemo(() => createClaudeAdapter(), []);
  return useLocalRuntime(adapter);
}
```

### 7.3 Key Changes

| Aspect | Before | After |
|--------|--------|-------|
| Runtime hook | `useLocalRuntime(adapter)` directly | `useRemoteThreadListRuntime({ runtimeHook, adapter })` wrapping `useLocalRuntime` |
| Thread list | React state in ThreadWorkspace + `key={activeThread.id}` hack | Managed by assistant-ui via `RemoteThreadListAdapter` |
| Message persistence | None (lost on switch) | `ThreadHistoryAdapter` via `unstable_Provider` |
| Thread list adapter | None | `SQLiteThreadListAdapter` |

### 7.4 ThreadWorkspace Simplification

The current `ThreadWorkspace.tsx` is already simple (just renders `ThreadList` + `Thread`). After this change, it requires **no modifications** — the thread list and thread components are driven by the runtime, which now has persistence baked in.

The `key={activeThread.id}` pattern that was in earlier versions is already gone from the current code, so no cleanup is needed there.

---

## 8. Claude Adapter Modifications

### 8.1 What Changes in `claude-adapter.ts`

The claude adapter needs targeted modifications to write to SQLite instead of (or in addition to) the in-memory structures:

| Current Code | Change | Reason |
|-------------|--------|--------|
| `sessionByThread` Map | Read/write from `db.sessions.*` | Persist session IDs |
| `sessionRecords` Map | Read/write from `db.sessions.*` | Persist session metadata |
| `cwdByThread` Map | Write to `db.threads.updateCwd()` | Persist working directory |
| `localStorage` read/write/clear | Remove entirely | Replaced by SQLite |
| `pushDevEvent()` | Add call to dev event batcher | Archive to SQLite |
| Init event handling | Add `db.mcpSnapshots.insert()` | Capture MCP state |
| Usage event handling | Add `db.usageSnapshots.insert()` | Capture token usage |

### 8.2 Session Persistence Migration

Replace the localStorage-based functions:

```typescript
// BEFORE (localStorage)
function readPersistedSession(threadKey: string): string | null { ... }
function persistSession(threadKey: string, id: string): void { ... }
function clearPersistedSession(threadKey: string): void { ... }

// AFTER (SQLite)
async function readPersistedSession(threadKey: string): Promise<string | null> {
  const row = await db.sessions.get(threadKey);
  return row?.session_id ?? null;
}

async function persistSession(threadKey: string, id: string): Promise<void> {
  await db.sessions.upsert({ thread_id: threadKey, session_id: id, ... });
}

async function clearPersistedSession(threadKey: string): Promise<void> {
  await db.sessions.delete(threadKey);
}
```

### 8.3 Handling Async Migration

The current `getSessionForThread()` is synchronous. SQLite queries are async. Two approaches:

**Option A: Cache on load, write-through** (Recommended)
- Keep the in-memory `sessionByThread` Map as a read cache
- On thread open, hydrate from SQLite: `sessionByThread.set(key, await db.sessions.get(key))`
- On write, update both Map and SQLite
- This minimizes changes to the synchronous call sites in `createClaudeAdapter.run()`

**Option B: Make everything async**
- Refactor `getSessionForThread()` to be async
- Simpler mental model but requires changes to all callers

**Recommendation**: Option A — the adapter's `run()` method is already async, so we can hydrate the cache at the start of each run. The hot path (reading session ID mid-stream) stays synchronous.

```typescript
// At the start of run():
async *run(options) {
  const threadKey = ...;
  await hydrateSessionCache(threadKey); // Load from SQLite into Map
  await acquireThreadRunLock(threadKey);
  // ... rest of run() unchanged
}

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
      lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at).getTime() : null,
      lastUpdatedAt: new Date(row.last_updated_at).getTime(),
      lastError: row.last_error,
    });
  }
}
```

### 8.4 Write-Through on Session Updates

Modify `upsertSessionRecord()` to also write to SQLite:

```typescript
function upsertSessionRecord(
  threadKey: string,
  sessionId: string,
  patch: Partial<ClaudeSessionRecord>,
): void {
  // In-memory update (unchanged)
  const next = { ...current, ...patch, lastUpdatedAt: Date.now() };
  sessionRecords.set(threadKey, next);
  notifySessionListeners();

  // Write-through to SQLite (fire-and-forget)
  void db.sessions.upsert({
    thread_id: threadKey,
    session_id: sessionId,
    status: next.status,
    local_cache: next.localCache,
    strategy: next.strategy,
    last_checked_at: next.lastCheckedAt ? new Date(next.lastCheckedAt).toISOString() : null,
    last_updated_at: new Date(next.lastUpdatedAt).toISOString(),
    last_error: next.lastError,
  });
}
```

The `void` prefix makes the SQLite write fire-and-forget — it won't block the stream processing. If it fails, the in-memory state is still correct for the current session, and the next successful write will overwrite.

### 8.5 CWD Persistence

```typescript
// In handleStreamLine(), where cwd is captured:
if (event.type === "system" && event.subtype === "init" && typeof event.cwd === "string") {
  cwdByThread.set(threadKey, event.cwd);
  void db.threads.updateCwd(threadKey, event.cwd);  // NEW: persist to SQLite
}
```

---

## 9. Dev Event Archive Pipeline

### 9.1 Architecture

```
pushDevEvent()
    │
    ├──→ In-memory circular buffer (unchanged, for live DevPanel)
    │
    └──→ Batch queue ──(50 events or 200ms)──→ db.devEvents.insertBatch()
```

### 9.2 Batch Queue Implementation

```typescript
// In claude-adapter.ts (or a new src/lib/dev-event-batcher.ts)

const DEV_EVENT_BATCH_SIZE = 50;
const DEV_EVENT_FLUSH_INTERVAL_MS = 200;

let devEventBatch: DevEventRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueDevEventForArchive(event: ClaudeDevEvent): void {
  devEventBatch.push({
    id: event.id,
    thread_id: event.threadKey,
    seq: devEventSeq,  // Use the existing sequence counter
    category: event.category,
    raw: event.raw,
    created_at: new Date(event.at).toISOString(),
  });

  if (devEventBatch.length >= DEV_EVENT_BATCH_SIZE) {
    flushDevEventBatch();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushDevEventBatch, DEV_EVENT_FLUSH_INTERVAL_MS);
  }
}

function flushDevEventBatch(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (devEventBatch.length === 0) return;

  const batch = devEventBatch;
  devEventBatch = [];

  // Fire-and-forget — don't block the event stream
  void db.devEvents.insertBatch(batch).catch((err) => {
    console.error("[dev-event-archive] batch insert failed:", err);
  });
}
```

### 9.3 Integration Point

Modify `pushDevEvent()` to also queue for archive:

```typescript
function pushDevEvent(raw: string, parsed: ClaudeStreamEvent, threadKey: string): void {
  // ... existing in-memory buffer logic (unchanged) ...

  // NEW: queue for SQLite archive
  queueDevEventForArchive(event);
}
```

### 9.4 Batch INSERT SQL

```typescript
// In db.ts
async function insertBatch(events: DevEventRow[]): Promise<void> {
  if (events.length === 0) return;
  const conn = await getDb();

  // Build a multi-row INSERT for efficiency
  const placeholders = events
    .map((_, i) => {
      const base = i * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    })
    .join(", ");

  const values = events.flatMap((e) => [e.id, e.thread_id, e.seq, e.category, e.raw]);

  await conn.execute(
    `INSERT OR IGNORE INTO dev_events (id, thread_id, seq, category, raw) VALUES ${placeholders}`,
    values,
  );
}
```

### 9.5 Pruning

Optional: periodic cleanup to prevent unbounded growth:

```typescript
async function prune(keepCount: number): Promise<number> {
  const conn = await getDb();
  const result = await conn.execute(
    `DELETE FROM dev_events WHERE id NOT IN (
       SELECT id FROM dev_events ORDER BY seq DESC LIMIT $1
     )`,
    [keepCount],
  );
  return result.rowsAffected;
}
```

This could be called on app startup or on a timer. Default threshold: 50,000 events.

---

## 10. MCP Telemetry Pipeline

### 10.1 Snapshot Capture (Init Events)

When Claude CLI emits an init event, capture the MCP state:

```typescript
// In handleStreamLine(), after parsing an init event:
if (event.type === "system" && event.subtype === "init") {
  const allTools = event.tools ?? [];
  const mcpTools = allTools.filter((t) => t.startsWith("mcp__"));
  const builtinTools = allTools.filter((t) => !t.startsWith("mcp__"));

  void db.mcpSnapshots.insert({
    id: crypto.randomUUID(),
    thread_id: threadKey,
    session_id: latestSessionId,
    servers: JSON.stringify(event.mcp_servers ?? []),
    tools: JSON.stringify(allTools),
    mcp_tools: JSON.stringify(mcpTools),
    builtin_tools: JSON.stringify(builtinTools),
    skills: event.skills ? JSON.stringify(event.skills) : null,
    slash_commands: event.slash_commands ? JSON.stringify(event.slash_commands) : null,
    captured_at: new Date().toISOString(),
  });
}
```

### 10.2 Usage Snapshot Capture (Result/Usage Events)

```typescript
// In handleStreamLine(), when a usage event is detected:
if (event.usage || event.modelUsage) {
  const usage = event.usage;
  const modelUsage = event.modelUsage
    ? Object.entries(event.modelUsage)[0] // First model entry
    : undefined;

  void db.usageSnapshots.insert({
    id: crypto.randomUUID(),
    thread_id: threadKey,
    session_id: latestSessionId,
    input_tokens: usage?.input_tokens ?? modelUsage?.[1]?.inputTokens ?? null,
    output_tokens: usage?.output_tokens ?? modelUsage?.[1]?.outputTokens ?? null,
    cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
    total_cost_usd: event.total_cost_usd ?? modelUsage?.[1]?.costUSD ?? null,
    model_id: modelUsage?.[0] ?? null,
    context_window: modelUsage?.[1]?.contextWindow ?? null,
    captured_at: new Date().toISOString(),
  });
}
```

### 10.3 Tool Invocation Tracking (Future Enhancement)

Claude CLI's stream-json output currently does not emit per-tool-call events with the detail needed for full invocation tracking (tool name, duration, input/output sizes). The `mcp_invocations` table schema is designed for when this data becomes available.

For now, tool invocations can be partially inferred from:
- assistant-type events with tool_use content blocks
- The diff between sequential usage events (to estimate per-tool token cost)

This is flagged as a **future enhancement** — the table and `db.mcpInvocations.*` API should be created now for forward compatibility, but population logic deferred until Claude CLI provides richer tool telemetry.

---

## 11. Data Flow Diagrams

### 11.1 Thread Lifecycle

```
User clicks "New Thread"
    │
    ▼
ThreadListPrimitive.New (assistant-ui)
    │
    ▼
RemoteThreadListAdapter.initialize(threadId)
    │
    ▼
db.threads.create(threadId)
    │  INSERT INTO threads (id, remote_id, ...) VALUES (...)
    ▼
Returns { remoteId, externalId }
    │
    ▼
Thread appears in sidebar
```

### 11.2 Message Send Flow

```
User types message → ComposerPrimitive.Send
    │
    ├──→ ThreadHistoryAdapter.append({ message: userMsg, parentId })
    │        │
    │        ▼
    │    db.messages.append(messageToRow(threadId, item))
    │        INSERT INTO messages (...) VALUES (...)
    │
    ▼
ChatModelAdapter.run() (claude-adapter.ts)
    │
    ├──→ hydrateSessionCache(threadKey)
    │        SELECT * FROM sessions WHERE thread_id = ?
    │
    ├──→ Spawn Claude CLI subprocess
    │
    ├──→ Stream JSON events
    │        │
    │        ├──→ Init event: db.mcpSnapshots.insert(...)
    │        ├──→ Text chunks: yield to assistant-ui runtime
    │        ├──→ Usage event: db.usageSnapshots.insert(...)
    │        ├──→ All events: pushDevEvent() → buffer + batch queue
    │        └──→ Session ID: upsertSessionRecord() → Map + db.sessions.upsert()
    │
    ▼
Runtime receives assistant message
    │
    ▼
ThreadHistoryAdapter.append({ message: assistantMsg, parentId })
    │
    ▼
db.messages.append(messageToRow(threadId, item))
```

### 11.3 Thread Switch Flow

```
User clicks different thread in sidebar
    │
    ▼
assistant-ui switches active thread (internal)
    │
    ▼
ThreadHistoryAdapter.load() [for new thread]
    │
    ▼
db.messages.loadByThread(threadId)
    SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at
    │
    ▼
Returns ExportedMessageRepository { headId, messages }
    │
    ▼
assistant-ui hydrates runtime with persisted messages
    │
    ▼
Thread renders with full history
```

### 11.4 App Restart Flow

```
App starts
    │
    ▼
tauri-plugin-sql runs migrations (if preloaded)
    │
    ▼
RuntimeProvider mounts
    │
    ▼
useRemoteThreadListRuntime({ runtimeHook, adapter })
    │
    ▼
RemoteThreadListAdapter.list()
    │
    ▼
db.threads.list()
    SELECT * FROM threads WHERE status = 'regular' ORDER BY updated_at DESC
    │
    ▼
Thread sidebar populated from SQLite
    │
    ▼
User clicks a thread → load() hydrates messages (see 11.3)
```

---

## 12. Migration Strategy

### 12.1 Versioned Migrations in Rust

Migrations are defined in Rust and run automatically by `tauri-plugin-sql` on database load:

```
src-tauri/
  migrations/
    001_initial_schema.sql    ← Full schema from section 3.1
```

Future schema changes add new migration files:

```
    002_add_context_window_to_usage.sql
    003_add_tool_call_chain.sql
```

Each migration file is included via `include_str!()` in `lib.rs`:

```rust
let migrations = vec![
    Migration {
        version: 1,
        description: "create_initial_schema",
        sql: include_str!("../migrations/001_initial_schema.sql"),
        kind: MigrationKind::Up,
    },
    // Future migrations added here
];
```

### 12.2 No localStorage Migration

Per requirements: start fresh. Existing localStorage session data is ignored. The `resetClaudeSession()` function and all `STORAGE_KEY_PREFIX` references in claude-adapter.ts will be removed.

### 12.3 WAL Mode

Set via PRAGMA in the first migration. WAL mode persists across connections — once set, it stays until explicitly changed.

---

## 13. File Manifest

### New Files

| File | Purpose | Size Estimate |
|------|---------|:---:|
| `src/lib/db.ts` | Database singleton, row types, all query functions | ~400 lines |
| `src/lib/sqlite-thread-list-adapter.ts` | `RemoteThreadListAdapter` implementation | ~100 lines |
| `src/lib/sqlite-thread-history-adapter.ts` | `ThreadHistoryAdapter` factory + `SQLiteHistoryProvider` component | ~120 lines |
| `src/lib/dev-event-batcher.ts` | Hybrid batch queue for dev event archiving | ~60 lines |
| `src-tauri/migrations/001_initial_schema.sql` | Full DDL from section 3.1 | ~120 lines |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/RuntimeProvider.tsx` | Replace `useLocalRuntime` with `useRemoteThreadListRuntime`; import thread list adapter |
| `src/lib/claude-adapter.ts` | Add session cache hydration, write-through to SQLite, MCP snapshot capture, usage snapshot capture, dev event batcher integration; remove localStorage functions |
| `src-tauri/src/lib.rs` | Register `tauri-plugin-sql` with migrations |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-sql` dependency with `sqlite` feature |
| `src-tauri/capabilities/default.json` | Add `sql:default` and `sql:allow-execute` permissions |
| `src-tauri/tauri.conf.json` | Add `plugins.sql.preload` config |
| `package.json` | Add `@tauri-apps/plugin-sql` dependency |

### Unchanged Files

| File | Reason |
|------|--------|
| `src/components/ThreadWorkspace.tsx` | Already just renders `ThreadList` + `Thread`. No changes needed. |
| `src/components/assistant-ui/thread.tsx` | Chat UI primitives unchanged. |
| `src/components/assistant-ui/thread-list.tsx` | Thread list UI primitives unchanged — they consume from the runtime, which now has SQLite backing. |
| `src/components/assistant-ui/markdown-text.tsx` | Unrelated to persistence. |
| `src/lib/local-thread-list-adapter.ts` | Will become unused but can be deleted as a cleanup step. |

---

## 14. Implementation Order

### Phase 1: Foundation (no behavior change)

1. **Add dependencies** — `tauri-plugin-sql` in Cargo.toml and package.json
2. **Create migration SQL** — `001_initial_schema.sql`
3. **Register plugin** — Update `lib.rs` with plugin and migrations
4. **Update capabilities** — Add SQL permissions to `default.json`
5. **Create `db.ts`** — Database singleton + all row types + query functions
6. **Verify** — App starts, database file created, tables exist

### Phase 2: Thread + Message Persistence

7. **Create `sqlite-thread-list-adapter.ts`** — Implement all `RemoteThreadListAdapter` methods
8. **Create `sqlite-thread-history-adapter.ts`** — Implement `SQLiteHistoryProvider` with `load()`/`append()`
9. **Rewire `RuntimeProvider.tsx`** — Switch to `useRemoteThreadListRuntime`
10. **Verify** — Threads persist across restarts. Messages survive thread switching.

### Phase 3: Session + Adapter Migration

11. **Modify `claude-adapter.ts`** — Add `hydrateSessionCache()`, write-through to `db.sessions.*`
12. **Remove localStorage code** — Delete `readPersistedSession`, `persistSession`, `clearPersistedSession`, `canUseStorage`, `getStorageKey`, `STORAGE_KEY_PREFIX`
13. **Add CWD persistence** — Write-through to `db.threads.updateCwd()`
14. **Verify** — Session resume works across restarts via SQLite

### Phase 4: Dev Event Archive

15. **Create `dev-event-batcher.ts`** — Hybrid batch queue (50 events / 200ms)
16. **Integrate with `pushDevEvent()`** — Call `queueDevEventForArchive()`
17. **Verify** — Events accumulate in `dev_events` table; live DevPanel unaffected

### Phase 5: MCP Telemetry

18. **Add MCP snapshot capture** — In init event handler, call `db.mcpSnapshots.insert()`
19. **Add usage snapshot capture** — In usage event handler, call `db.usageSnapshots.insert()`
20. **Verify** — MCP and usage data persisted per session

### Phase 6: Cleanup

21. **Delete `src/lib/local-thread-list-adapter.ts`** — No longer needed
22. **Remove HMR cleanup for Maps** — Simplify `import.meta.hot.dispose()`
23. **Optional: Add dev event pruning** — Timer or startup cleanup for 50k threshold

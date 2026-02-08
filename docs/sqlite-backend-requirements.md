# SQLite Backend Requirements Specification

## Overview

Add a SQLite persistence layer to Pluribus, replacing ephemeral in-memory state and localStorage with durable, queryable storage. Integration flows through assistant-ui's adapter pattern (`RemoteThreadListAdapter` + `ThreadHistoryAdapter`) so persistence is framework-native rather than bolted on.

## Goals

1. **Stop losing data** — Sessions, dev events, MCP telemetry, and messages survive app restarts and thread switches
2. **Hybrid message storage** — SQLite stores messages for UI hydration; Claude CLI still uses `--resume` for its own continuity
3. **Full MCP telemetry** — Per-invocation tool call tracking with costs, errors, context window impact
4. **Use assistant-ui's adapter pattern** — `RemoteThreadListAdapter` + `ThreadHistoryAdapter` backed by SQLite
5. **Dual dev event system** — In-memory circular buffer for real-time DevPanel; SQLite archive for historical queries

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    assistant-ui Runtime                  │
│  ┌──────────────────┐  ┌──────────────────────────────┐ │
│  │ RemoteThreadList  │  │ ThreadHistoryAdapter         │ │
│  │ Adapter (SQLite)  │  │ (per-thread, via Provider)   │ │
│  └────────┬─────────┘  └────────────┬─────────────────┘ │
└───────────┼──────────────────────────┼──────────────────┘
            │                          │
            ▼                          ▼
┌─────────────────────────────────────────────────────────┐
│              src/lib/db.ts  (Standalone DB Module)       │
│  db.threads.*  db.messages.*  db.sessions.*             │
│  db.devEvents.*  db.mcpSessions.*  db.mcpInvocations.*  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│          tauri-plugin-sql  →  SQLite ($APPDATA)         │
└─────────────────────────────────────────────────────────┘
```

## Current State (What Gets Replaced)

| What | Current Storage | Survives Restart? | Target |
|------|----------------|:-:|--------|
| Session IDs | localStorage | Yes | SQLite `sessions` table |
| Session metadata, CWD, locks | In-memory Maps | No | SQLite `sessions` table + `threads.cwd` |
| Dev events (500 max) | Circular buffer | No | Dual: buffer (live) + SQLite (archive) |
| MCP server/tool info | Last init event | No | SQLite `mcp_snapshots` table |
| MCP tool invocations | Not tracked | N/A | SQLite `mcp_invocations` table |
| Messages | assistant-ui runtime | No (lost on switch) | SQLite `messages` table via ThreadHistoryAdapter |
| Thread list | React state | No | SQLite `threads` table via RemoteThreadListAdapter |

## Functional Requirements

### FR1: SQLite Database Setup
- Use `tauri-plugin-sql` with a local SQLite file
- Database stored in Tauri's app data directory (`$APPDATA/pluribus/pluribus.db`)
- Schema migrations managed via versioned SQL scripts
- Start fresh — no localStorage migration

### FR2: Thread Persistence
- Implement `RemoteThreadListAdapter` backed by SQLite
- Store: thread ID, title, status (regular/archived), created/updated timestamps, Claude session ID
- Support: list, create (initialize), rename, archive, unarchive, delete
- `generateTitle()` delegates to Claude CLI or returns a placeholder

### FR3: Message Persistence
- Implement `ThreadHistoryAdapter` backed by SQLite, injected per-thread via `unstable_Provider`
- `append()` writes each message (user + assistant) to SQLite as it arrives
- `load()` hydrates messages from SQLite when a thread is opened
- Store: message ID, thread ID, parent ID (for branching), role, content (JSON), run config, timestamp
- Claude CLI still uses `--resume` for its own session continuity — SQLite is for UI display

### FR4: Session Record Persistence
- Replace in-memory `sessionRecords` Map with SQLite-backed storage
- Store all `ClaudeSessionRecord` fields: thread key, session ID, status, local cache state, strategy, timestamps, errors
- Replace in-memory `cwdByThread` Map — persist working directories per thread

### FR5: Dev Event Archive
- Keep the existing in-memory circular buffer (500 items) for real-time DevPanel
- Additionally write all dev events to a SQLite `dev_events` table
- Store: event ID, thread key, timestamp, raw JSON, parsed category, sequence number
- No cap on SQLite storage (or a generous cap, e.g., 50,000 events with optional cleanup)
- Hybrid batching: flush to SQLite at 50 events or 200ms, whichever comes first

### FR6: MCP Telemetry
- **Per-session snapshots**: On each Claude CLI init event, persist the list of MCP servers (name, status) and tools (name, type: mcp/built-in) to SQLite
- **Per-invocation logging**: For each tool call event from Claude CLI, persist:
  - Tool name, MCP server name
  - Invocation timestamp, duration (if available)
  - Input/output token cost (if available from usage events)
  - Success/error status
  - Thread key and session ID
- **Context tracking**: Store context window utilization snapshots (input tokens, cache read/create, total cost) per message or per usage event

## Non-Functional Requirements

- **NFR1**: SQLite operations must not block the UI thread. Use async Tauri commands (the plugin's JS API is already async).
- **NFR2**: Dev event writes to SQLite should be batched (hybrid: 50 events or 200ms threshold).
- **NFR3**: Database schema should be forward-compatible — use nullable columns and JSON columns where schema evolution is likely.
- **NFR4**: The in-memory circular buffer must remain the primary data source for the live DevPanel. SQLite is queried only for historical/analytical views.

## User Stories

| Story | Acceptance Criteria |
|-------|-------------------|
| As a user, I restart the app and my threads are still there | Thread list loads from SQLite on startup; titles and status preserved |
| As a user, I switch threads and my messages are preserved | `ThreadHistoryAdapter.load()` hydrates messages from SQLite; no more blank threads |
| As a user, I can see what MCP tools were available in a past session | `mcp_snapshots` table stores per-session tool snapshots |
| As a user, I can see which MCP tools were called during a conversation | `mcp_invocations` table logs each tool call with metadata |
| As a user, I can see historical dev events from past sessions | `dev_events` table stores all events; future UI can query/filter |
| As a user, I delete a thread and its data is cleaned up | Cascade delete removes messages, events, MCP data, and session records |

## Proposed Schema (6 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `threads` | Thread metadata | id, title, status, session_id, cwd, created_at, updated_at |
| `messages` | Message content | id, thread_id, parent_id, role, content (JSON), run_config (JSON), created_at |
| `sessions` | Claude CLI session records | thread_id, session_id, status, local_cache, strategy, last_error, timestamps |
| `dev_events` | Archived dev events | id, thread_id, seq, category, raw (JSON), created_at |
| `mcp_snapshots` | Per-session MCP state | id, thread_id, session_id, servers (JSON), tools (JSON), captured_at |
| `mcp_invocations` | Per-call MCP telemetry | id, thread_id, session_id, tool_name, server_name, input_tokens, output_tokens, cost_usd, duration_ms, success, error, created_at |

## Code Structure

| File | Responsibility |
|------|---------------|
| `src/lib/db.ts` | Standalone DB module. Schema init, migrations, typed query functions |
| `src/lib/sqlite-thread-list-adapter.ts` | `RemoteThreadListAdapter` implementation backed by `db.threads.*` |
| `src/lib/sqlite-thread-history-adapter.ts` | `ThreadHistoryAdapter` factory, injected via `unstable_Provider` |
| `src/lib/claude-adapter.ts` | Modified to write session records and MCP telemetry via `db.*` |
| `src/components/RuntimeProvider.tsx` | Rewired to use `useRemoteThreadListRuntime` |

## Key Decisions

- assistant-ui adapters are the interface — all persistence flows through `RemoteThreadListAdapter` + `ThreadHistoryAdapter`
- Standalone `db.ts` — clean separation between SQL layer and adapter logic
- Dual dev events — in-memory buffer stays for live DevPanel; SQLite archives everything
- Hybrid batching — flush to SQLite at 50 events or 200ms, whichever comes first
- Start fresh — no localStorage migration
- Full MCP telemetry — per-session snapshots + per-invocation logging

## Future Possibilities

- Thread search (query messages by content)
- MCP analytics dashboard ("which tools do I use most?", "what's my token spend per tool?")
- Historical dev event browsing with filters
- Export/import conversation history
- Thread deduplication and cleanup tools

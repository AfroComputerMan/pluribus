# Architecture

**Analysis Date:** 2026-03-05

## Pattern Overview

**Overall:** Tauri 2 desktop app with a React 19 frontend, using the **assistant-ui** framework as the runtime backbone for chat primitives and thread management. The app delegates AI execution to external CLI processes (Claude CLI, Codex app-server) rather than calling APIs directly.

**Key Characteristics:**
- **Adapter-based model routing** -- a `ChatModelAdapter` router dispatches to Claude or Codex backends based on the thread's model selection
- **Three separate process architectures** for AI backends: (1) Claude CLI via Tauri shell plugin, (2) Claude Agent SDK via Bun sidecar, (3) Codex via Rust-managed `codex app-server` child process
- **SQLite as single persistence layer** -- threads, messages, sessions, settings, dev events, MCP data all go through `tauri-plugin-sql`
- **assistant-ui owns the runtime lifecycle** -- thread creation, message history, and rendering all flow through assistant-ui's `useRemoteThreadListRuntime` and `useLocalRuntime`

## Layers

**Tauri Native Layer (Rust):**
- Purpose: Desktop window, SQLite plugin, shell permissions, Codex process management
- Location: `src-tauri/src/`
- Contains: Tauri builder setup (`lib.rs`), Codex service (`codex/service.rs`), Codex Tauri commands (`codex/commands.rs`), Codex types (`codex/types.rs`)
- Depends on: `tauri-plugin-sql`, `tauri-plugin-shell`, `tauri-plugin-dialog`, `tokio`
- Used by: Frontend via `invoke()` (Codex) and `Command.create()` (shell plugin)

**Sidecar Layer (Bun):**
- Purpose: Runs `@anthropic-ai/claude-agent-sdk` in a long-lived Bun process
- Location: `sidecar/agent-sdk-bridge/index.ts`
- Contains: NDJSON protocol handler, SDK query wrapper, abort support
- Depends on: `@anthropic-ai/claude-agent-sdk`, Bun runtime
- Used by: `src/lib/agent-sdk-adapter.ts` via Tauri shell plugin stdin/stdout

**Adapter Layer (TypeScript):**
- Purpose: Implements `ChatModelAdapter` interface from assistant-ui for each AI backend
- Location: `src/lib/`
- Contains:
  - `router-adapter.ts` -- top-level router that selects adapter per-thread
  - `claude-adapter.ts` -- Shell-based Claude CLI adapter (legacy, ~1900 lines)
  - `agent-sdk-adapter.ts` -- Agent SDK sidecar adapter (~500 lines)
  - `codex-adapter.ts` -- Codex app-server adapter via Tauri invoke/listen (~300 lines)
- Depends on: `@assistant-ui/react`, `@tauri-apps/plugin-shell`, `@tauri-apps/api/core`, `db.ts`
- Used by: `RuntimeProvider.tsx` via assistant-ui's `useLocalRuntime()`

**Persistence Layer (TypeScript):**
- Purpose: All SQLite operations, schema types, thread/message CRUD
- Location: `src/lib/db.ts`
- Contains: Connection singleton, row types, namespaced query functions
- Depends on: `@tauri-apps/plugin-sql`
- Used by: Every adapter, thread list adapter, thread history adapter

**Thread Management Layer (TypeScript):**
- Purpose: Maps assistant-ui's thread abstractions to SQLite persistence
- Location:
  - `src/lib/sqlite-thread-list-adapter.ts` -- implements `RemoteThreadListAdapter`
  - `src/lib/sqlite-thread-history-adapter.tsx` -- implements `ThreadHistoryAdapter` as a React provider
- Depends on: `db.ts`, `@assistant-ui/react`
- Used by: `RuntimeProvider.tsx`

**UI Layer (React):**
- Purpose: Chat interface, thread sidebar, settings, dev tools
- Location: `src/components/`
- Contains:
  - `assistant-ui/thread.tsx` -- main chat UI using assistant-ui primitives
  - `assistant-ui/thread-list.tsx` -- sidebar thread list
  - `assistant-ui/claude-tool-display.tsx` -- Claude tool call rendering
  - `assistant-ui/codex-tool-display.tsx` -- Codex tool call rendering
  - `assistant-ui/markdown-text.tsx` -- markdown rendering
  - `ThreadWorkspace.tsx` -- layout shell (sidebar + chat + utility panel)
  - `settings-overlay.tsx` -- settings dialog
  - `DevPanel.tsx` -- dev-only event inspector
- Depends on: assistant-ui primitives, shadcn/ui, Radix, lucide-react
- Used by: `App.tsx`

**State Layer (TypeScript):**
- Purpose: Lightweight client-side state for cross-component reactivity
- Location: `src/lib/`
- Contains:
  - `thread-status-store.ts` -- Zustand store tracking per-thread running/idle/error status
  - `codex-approval-store.ts` -- Zustand store for pending Codex tool approval requests
- Depends on: `zustand`
- Used by: Adapters (write status), UI components (read status)

## Data Flow

**User Message (Claude via Agent SDK):**

1. User types in composer -> assistant-ui calls `ChatModelAdapter.run(options)`
2. `router-adapter.ts` reads thread model from SQLite, selects `agent-sdk-adapter`
3. `AgentSdkSidecar.ensureRunning()` spawns/reuses the Bun sidecar via `Command.create("agent-sdk-bridge", [])`
4. Adapter writes NDJSON `{ type: "query", id, prompt, sessionId, model, cwd }` to sidecar stdin
5. Sidecar calls `query()` from `@anthropic-ai/claude-agent-sdk`, iterates `SDKMessage` events
6. Sidecar writes NDJSON `{ type: "message", queryId, message }` to stdout
7. Adapter reads stdout line-by-line, yields `ChatModelRunResult` chunks to assistant-ui
8. assistant-ui renders messages via `thread.tsx` primitives
9. On completion, sidecar sends `{ type: "done", queryId, sessionId, costUsd }`
10. Adapter persists session ID to SQLite via `db.sessions.upsert()`

**User Message (Codex):**

1. User types in composer -> `router-adapter.ts` detects Codex model, selects `codex-adapter`
2. Adapter calls `invoke("codex_start_thread")` or `invoke("codex_send_turn")` via Tauri IPC
3. Rust `CodexService` writes JSON-RPC to `codex app-server` stdin
4. Rust reads JSONL events from stdout, emits Tauri events (`codex-event`)
5. Frontend `listen("codex-event")` receives `AgentEvent` payloads
6. Adapter yields `ChatModelRunResult` chunks to assistant-ui
7. For tool approvals: Rust emits `approval_needed` event -> Zustand store -> `ApprovalBanner` UI -> user approves -> `invoke("codex_approve_tool")`

**Thread Persistence:**

1. assistant-ui calls `RemoteThreadListAdapter.initialize(threadId)` on new thread
2. `sqlite-thread-list-adapter.ts` calls `db.threads.create()` with pending options (cwd, workspace, model)
3. On each message: `SQLiteHistoryProvider` calls `db.messages.append()` via `ThreadHistoryAdapter`
4. On thread switch: `SQLiteHistoryProvider.load()` reads messages from SQLite
5. Title generation: `prefetchTitle()` spawns `claude -p` (Haiku) concurrently, pushes title via callback

**State Management:**
- **Runtime state**: assistant-ui's `useRemoteThreadListRuntime` + `useLocalRuntime` own thread switching, message state, and composer state
- **Ephemeral process state**: In-memory Maps in adapters track child processes, session IDs, thread locks
- **Persistent state**: SQLite via `db.*` namespace for threads, messages, sessions, settings
- **UI state**: Zustand stores for thread status indicators and Codex approval queue

## Key Abstractions

**ChatModelAdapter (assistant-ui interface):**
- Purpose: Contract between assistant-ui runtime and AI backend
- Examples: `src/lib/router-adapter.ts`, `src/lib/agent-sdk-adapter.ts`, `src/lib/codex-adapter.ts`, `src/lib/claude-adapter.ts`
- Pattern: Async generator that yields `ChatModelRunResult` chunks

**db namespace object:**
- Purpose: Single access point for all SQLite operations
- Examples: `src/lib/db.ts` (exported as `db`)
- Pattern: Namespaced plain functions (`db.threads.get()`, `db.messages.append()`, etc.) over a singleton `Database` connection

**Thread locking:**
- Purpose: Prevent concurrent CLI invocations on the same thread
- Examples: `AgentSdkSidecar.acquireLock()` in `src/lib/agent-sdk-adapter.ts`, FIFO waiter queue in `src/lib/claude-adapter.ts`
- Pattern: Chained promises per thread key, release function returned to caller

**Sidecar NDJSON protocol:**
- Purpose: Multiplexed bidirectional communication between frontend and Bun sidecar
- Examples: `sidecar/agent-sdk-bridge/index.ts` (server), `src/lib/agent-sdk-adapter.ts` (client)
- Pattern: Newline-delimited JSON with `type` discriminator and `queryId` for correlation

**Codex JSON-RPC protocol:**
- Purpose: Communication between Rust backend and `codex app-server` process
- Examples: `src-tauri/src/codex/service.rs` (Rust side), `src/lib/codex-adapter.ts` (frontend side)
- Pattern: JSON-RPC over stdin/stdout with Tauri event bridge to frontend

## Entry Points

**Frontend (`index.html` -> `src/main.tsx`):**
- Location: `src/main.tsx`
- Triggers: Tauri webview loads `index.html`
- Responsibilities: Mount React root with `<App />`

**App component (`src/App.tsx`):**
- Location: `src/App.tsx`
- Triggers: React render
- Responsibilities: Wraps everything in `RuntimeProvider`, renders `ThreadWorkspace` and lazy-loaded `DevPanel`

**RuntimeProvider (`src/components/RuntimeProvider.tsx`):**
- Location: `src/components/RuntimeProvider.tsx`
- Triggers: App mount
- Responsibilities: Creates assistant-ui runtime with `useRemoteThreadListRuntime`, injects SQLite thread list adapter and router adapter

**Tauri backend (`src-tauri/src/main.rs` -> `src-tauri/src/lib.rs`):**
- Location: `src-tauri/src/lib.rs`
- Triggers: OS launches the Tauri binary
- Responsibilities: Registers plugins (shell, SQL, dialog), runs migrations, registers Codex Tauri commands, manages `CodexService` state

**Sidecar (`sidecar/agent-sdk-bridge/index.ts`):**
- Location: `sidecar/agent-sdk-bridge/index.ts`
- Triggers: Spawned by `agent-sdk-adapter.ts` via `Command.create("agent-sdk-bridge", [])`
- Responsibilities: Reads NDJSON from stdin, calls Claude Agent SDK, writes NDJSON to stdout

## Error Handling

**Strategy:** Per-adapter error handling with status propagation via Zustand store

**Patterns:**
- Adapters catch errors in the async generator, set thread status to `"error"` via `useThreadStatusStore`, then re-throw
- `router-adapter.ts` wraps each adapter call in try/catch for status tracking
- Sidecar distinguishes `AbortError` (user interrupt) from real errors -- aborts still send `done` events
- Rust `CodexService` uses `oneshot` channels for request/response correlation with error propagation
- SQLite operations use fire-and-forget for non-critical writes (dev events) and await for critical writes (messages, sessions)
- Missing table errors in `db.ts` trigger lazy table creation (e.g., `ensureMcpInvocationsTable()`)

## Cross-Cutting Concerns

**Logging:**
- Dev-only console logging gated by `import.meta.env.DEV`
- Adapter-specific log prefixes: `[agent-sdk-adapter]`, `[codex-adapter]`
- Dev event system: circular buffer + SQLite archival via `dev-event-batcher.ts`
- Sidecar logs to stderr to avoid polluting the stdout NDJSON protocol

**Validation:**
- Model resolution chain: thread row -> localStorage -> hardcoded default (`src/lib/models.ts`)
- CWD normalization in `db.ts` (trailing separators, platform handling)
- Workspace uniqueness enforced with `DuplicateWorkspaceCwdError`

**Authentication:**
- No app-level auth -- relies on Claude CLI's own authentication
- Codex auth status checked via `invoke("codex_get_auth_status")`
- Shell permissions controlled by Tauri capabilities (`src-tauri/capabilities/default.json`)

---

*Architecture analysis: 2026-03-05*

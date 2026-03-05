# External Integrations

**Analysis Date:** 2026-03-05

## APIs & External Services

**Claude CLI (Primary - Shell Engine):**
- The app spawns Claude CLI as a subprocess via Tauri shell plugin
- Adapter: `src/lib/claude-adapter.ts` (~1900 lines)
- Invoked through `sh -c` wrapper (command name: `claude-stream-sh`) or direct `claude` command
- Streams JSON events from Claude CLI stdout
- Session management: `--resume`, `--session-id` flags for conversation continuity
- Shell permission: `src-tauri/capabilities/default.json` grants `claude` and `claude-stream-sh`
- No API key managed by the app - Claude CLI handles its own authentication

**Claude Agent SDK (Alternative - Agent SDK Engine):**
- Communicates via Bun-compiled sidecar binary (`sidecar/agent-sdk-bridge/index.ts`)
- SDK package: `@anthropic-ai/claude-agent-sdk` (latest)
- Protocol: NDJSON over stdin/stdout between Tauri webview and sidecar process
- Message types: `query`, `interrupt`, `ping` (inbound); `message`, `done`, `error`, `pong` (outbound)
- Adapter: `src/lib/agent-sdk-adapter.ts` (~400 lines)
- Sidecar resolves Claude CLI path at startup via `Bun.which("claude")`
- External binary registered in Tauri config: `src-tauri/tauri.conf.json` -> `bundle.externalBin`

**Codex CLI (Third Engine - Rust-native):**
- Spawns `codex app-server` as a child process from Rust backend
- Service: `src-tauri/src/codex/service.rs` - JSON-RPC over stdin/stdout
- Types: `src-tauri/src/codex/types.rs` - AgentEvent enum, Usage struct
- Commands: `src-tauri/src/codex/commands.rs` - Tauri command handlers
- Protocol: JSON-RPC with `initialize` handshake, then request/response + streaming notifications
- Notifications: `turn/started`, `item/agentMessage/delta`, `item/completed`, `turn/completed`, `turn/approval/requested`, `account/updated`
- Events routed to frontend via Tauri event system (`app_handle.emit`)
- Shell permission: `src-tauri/capabilities/default.json` grants `codex` command

**Git CLI:**
- Shell permission granted for `git` command in `src-tauri/capabilities/default.json`
- Used for workspace/branch context (git branch detection for threads)

## Data Storage

**Database:**
- SQLite via `tauri-plugin-sql`
- Database file: `pluribus.db` (Tauri app data directory)
- Connection: `sqlite:pluribus.db` preloaded in `src-tauri/tauri.conf.json`
- Client: `@tauri-apps/plugin-sql` (frontend), `tauri-plugin-sql` with sqlite feature (Rust)
- Schema managed via Rust migrations in `src-tauri/migrations/` (7 migrations)
- DB layer: `src/lib/db.ts` - singleton connection, namespaced CRUD operations

**Database Tables:**
- `threads` - Chat thread metadata (id, title, status, session_id, cwd, workspace_id, model, effort)
- `messages` - Message history per thread (role, content, metadata, parent_id for branching)
- `sessions` - Claude CLI session state per thread (session_id, status)
- `dev_events` - Development event log (category, raw JSON, sequence number)
- `mcp_snapshots` - MCP server/tool configuration snapshots per thread
- `mcp_invocations` - MCP tool call records (tokens, cost, duration, success)
- `usage_snapshots` - Token usage and cost tracking per thread
- `workspaces` - Named workspace directories
- `config_overrides` - Per-workspace/thread configuration overrides
- `global_settings` - Key-value app settings (e.g., `engine: "shell" | "agent-sdk"`)

**File Storage:**
- Local filesystem only
- Claude CLI session files managed by Claude CLI itself (not by the app)
- Sidecar binary stored in `src-tauri/binaries/` (build artifact, not committed)

**Caching:**
- In-memory `Map<string, SessionRecord>` in `claude-adapter.ts` for runtime session state
- In-memory circular buffer (500 entries) for dev events
- SQLite serves as persistent cache for thread/session data

## Authentication & Identity

**Auth Provider:**
- None managed by the app
- Claude CLI handles its own authentication (API key or OAuth via Anthropic)
- Codex CLI handles its own authentication
- The app is a local desktop tool with no user accounts

**Codex Auth Events:**
- `account/updated` notification from codex app-server provides `authMode` and `username`
- Forwarded to frontend via Tauri `agent:auth` event

## Monitoring & Observability

**Error Tracking:**
- None (no external error tracking service)
- Sidecar writes errors to stderr: `process.stderr.write()`
- Codex service supervisor logs process exit to Tauri event system

**Logs:**
- Dev event system: circular buffer in adapter, persisted to `dev_events` SQLite table
- DevPanel (lazy-loaded, dev-only) for real-time stream inspection via `useSyncExternalStore`
- Sidecar logs to stderr (not captured by default in production)
- Rust backend: no structured logging framework detected

**Usage Tracking:**
- `usage_snapshots` table tracks token counts and costs per thread
- `mcp_invocations` table tracks MCP tool call metrics
- All local - no telemetry sent externally

## CI/CD & Deployment

**Hosting:**
- Desktop application - no hosting required
- Distributed as native binary via `cargo tauri build`

**CI Pipeline:**
- None detected (no `.github/` directory or CI config files)

## Environment Configuration

**Required env vars:**
- None required by the app itself
- `TAURI_DEV_HOST` (optional) - Custom dev server host for remote development

**Secrets location:**
- No secrets managed by the app
- Claude CLI and Codex manage their own credentials externally

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## Inter-Process Communication

**Tauri IPC (Webview <-> Rust):**
- Standard Tauri invoke system for commands (`greet`, `codex_*` commands)
- Tauri event system for streaming notifications (`agent:event`, `agent:auth`)
- SQL plugin provides direct SQLite access from webview JavaScript

**Sidecar Protocol (Webview <-> Bun sidecar):**
- NDJSON over stdin/stdout via `@tauri-apps/plugin-shell` Command.create
- Protocol: `src/lib/agent-sdk-adapter.ts` (frontend) <-> `sidecar/agent-sdk-bridge/index.ts` (sidecar)

**Codex Protocol (Rust <-> codex app-server):**
- JSON-RPC over stdin/stdout via `tokio::process::Command`
- Service: `src-tauri/src/codex/service.rs`
- Initialize handshake required before any requests

**Shell Adapter Protocol (Webview <-> Claude CLI):**
- Spawns Claude CLI via Tauri shell plugin
- Streams JSON events from stdout
- Adapter: `src/lib/claude-adapter.ts`

---

*Integration audit: 2026-03-05*

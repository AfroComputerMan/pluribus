# Project Index: Pluribus

Generated: 2026-02-18 · Partially refreshed: 2026-05-31

> **Note:** This index was first generated for the earlier Claude-CLI-shell
> architecture. Much of the per-file detail below predates the move to the
> provider/orchestration layer and the Pi sandbox backend. For current,
> authoritative structure see [README.md](README.md), [CLAUDE.md](CLAUDE.md),
> and [CONTEXT.md](CONTEXT.md). The sections most relevant today are flagged
> inline.

## Overview

Tauri 2 + React 19 desktop app — a chat UI over AI coding agents, built on
**assistant-ui** primitives. Backend selection is **model-driven** via a
provider registry (`src/lib/providers/`); the registered backends are
**agent-sdk** (Bun sidecar), **codex** (Rust bridge), and **pi** (Rust bridge
driving `pi --mode rpc` in a per-agent Docker sandbox against a per-agent git
clone — the strategic direction). The Rust backend is authoritative over agent
lifecycle; state persists in SQLite (`pluribus.db`).

> The "Claude CLI / shell plugin" framing in the per-file sections below is
> **stale**: `claude-adapter.ts`, `agent-sdk-adapter.ts`, `settings-overlay.tsx`,
> and `claude-tool-display.tsx` no longer exist. See the "Current key areas"
> section immediately below for what replaced them.

## Current key areas (2026-05)

- **`src/lib/providers/`** — `provider-registry.ts` (model-driven resolution),
  `types.ts` (`ProviderType = "agent-sdk" | "codex" | "pi"`),
  `pi-provider.ts`, `codex-provider.ts`, `agent-sdk-provider.ts`,
  `pi-steer.ts`, `shared.ts`.
- **`src/lib/orchestration/`** — `orchestrated-adapter.ts` (the active
  `ChatModelAdapter`), `agent-registry.ts`, `agent-process-manager.ts`,
  `concurrency-governor.ts`, `write-serializer.ts`, `agent-status-store.ts`,
  `agent-status.ts`.
- **`src-tauri/src/pi/`** — Pi RPC bridge: `service.rs` (reader/writer/
  supervisor), `io.rs` (`PiIo`/`PiHandle` transport seam), `container.rs`
  (bollard `docker exec`), `clone.rs` (per-agent git clone), `diff.rs`
  (post-run clone diff), `commands.rs` (Tauri commands), `mod.rs`, `types.rs`.
- **`src-tauri/src/codex/`** — Codex backend bridge (`service.rs`,
  `commands.rs`, `types.rs`, `mod.rs`).
- **`docker/sandbox-base/`** — `pi-base` sandbox image (Node + Pi).
- **`docs/adr/`** — `0001` backend language, `0002` sandbox as safety boundary,
  `0003` Rust-authoritative orchestration, `0004` provisioning author-loop,
  `0005` Pi RPC protocol.
- **`docs/plans/`** — includes the Pi POC slices (`2026-05-30-issue-17`…`-21`,
  `pi-poc-gap-report.md`).

## Project Structure

```
pluribus/
├── src/                          # React frontend (TypeScript)
│   ├── main.tsx                  # ReactDOM entry point
│   ├── App.tsx                   # Root component (RuntimeProvider + ThreadWorkspace + DevPanel)
│   ├── App.css                   # Global styles
│   ├── lib/                      # Core logic & adapters
│   │   │  # NOTE (2026-05): claude-adapter.ts / agent-sdk-adapter.ts are gone;
│   │   │  # backends now live under lib/providers/ + lib/orchestration/ (see above).
│   │   ├── claude-adapter.ts     # (REMOVED — historical) Core CLI integration — ChatModelAdapter, process lifecycle, stream parsing, session resume
│   │   ├── db.ts                 # (855 lines) SQLite DAL — singleton connection, row types, CRUD for threads/workspaces/messages/sessions/dev_events/mcp_snapshots/usage
│   │   ├── sqlite-thread-list-adapter.ts   # (163 lines) RemoteThreadListAdapter backed by SQLite + title generation via Claude CLI
│   │   ├── sqlite-thread-history-adapter.tsx # (108 lines) ThreadHistoryAdapter — serialize/deserialize messages to SQLite
│   │   ├── dev-event-batcher.ts  # Batched dev event writes (50/batch, 200ms flush)
│   │   ├── workspace-repo-metadata.ts # Git repo metadata extraction via shell scripts
│   │   ├── themes.ts             # Theme definitions (currently "carbon" only)
│   │   ├── visual-layouts.ts     # Layout definitions (currently "carbon" only)
│   │   ├── visual-layout-context.tsx # React context for active layout
│   │   └── utils.ts              # cn() className utility
│   └── components/
│       ├── RuntimeProvider.tsx    # Sets up useRemoteThreadListRuntime with Claude adapter + SQLite thread list
│       ├── ThreadWorkspace.tsx    # (89 lines) Main layout: collapsible sidebar + thread canvas + utility panel
│       ├── DevPanel.tsx          # (457 lines) Dev-only panel for inspecting stream events, sessions, MCP state
│       ├── ThemeSwitcher.tsx     # Theme selection UI
│       ├── VisualDesigner.tsx    # Layout designer UI
│       ├── assistant-ui/         # assistant-ui primitive compositions
│       │   ├── thread.tsx        # (891 lines) Chat thread UI (messages, composer, welcome screen)
│       │   ├── thread-list.tsx   # (1017 lines) Thread list sidebar with workspace grouping
│       │   ├── claude-tool-display.tsx # (735 lines) Tool call rendering (file ops, bash, search, etc.)
│       │   ├── markdown-text.tsx # (241 lines) Markdown renderer with syntax highlighting
│       │   └── tooltip-icon-button.tsx # Reusable icon button with tooltip
│       └── ui/                   # shadcn/ui components (button, dialog, tooltip, avatar, collapsible, skeleton, card, badge)
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── lib.rs                # Tauri builder: shell + sql + dialog plugins, 4 SQLite migrations
│   │   └── main.rs               # Binary entry point
│   ├── Cargo.toml                # tauri, tauri-plugin-{shell,sql,dialog}, serde
│   ├── tauri.conf.json           # App config: CSP, sqlite:pluribus.db preload, bundle settings
│   ├── capabilities/default.json # Shell permissions: claude + sh commands allowed
│   └── migrations/               # 001–011 (later: 005 model/effort, 006 config_overrides,
│                                 #          007 global_settings, 008 active_processes,
│                                 #          009 agent_state, 010 agents, 011 clones)
├── docs/                         # Design docs, ADRs & plans
│   ├── adr/                      # Architecture Decision Records (0001–0005)
│   ├── agents/                   # Agent workflow docs (issue-tracker, triage-labels, domain)
│   ├── design-language.md        # UI design spec
│   ├── comprehensive-audit-report.md # Multi-expert code audit
│   ├── claudecode-cli-docs.md    # Claude CLI reference
│   └── plans/                    # Design & implementation plans (incl. Pi POC slices)
├── package.json                  # bun, v0.1.0
├── tsconfig.json                 # Strict TS, @/* path alias
├── vite.config.ts                # Vite + React + Tailwind CSS v4
├── components.json               # shadcn/ui config (new-york style, slate)
└── CLAUDE.md                     # Agent instructions
```

## Data Flow

```
User Input → assistant-ui Runtime → ChatModelAdapter.run()
  → Tauri Shell (Command.create) → Claude CLI subprocess (--output-format stream-json)
  → Stream JSON events → Adapter yields content parts → assistant-ui renders
  → Messages persisted to SQLite via ThreadHistoryAdapter
```

## Entry Points

- **App**: `src/main.tsx` → `src/App.tsx`
- **Tauri**: `src-tauri/src/main.rs` → `src-tauri/src/lib.rs`
- **Dev**: `cargo tauri dev` (or `bun run tauri dev`)
- **Build**: `cargo tauri build`

## Core Modules

> **Stale section (pre-2026-05).** The module descriptions below describe the
> retired Claude-CLI-shell adapter and its helpers. They are kept for history;
> the live equivalents are the provider/orchestration modules listed under
> "Current key areas" above. The "Architectural Insights" notes about `sh -c`
> and the Claude CLI stream protocol likewise describe the old shell backend.

### claude-adapter.ts (1911 lines) — REMOVED
- Implements `ChatModelAdapter` from assistant-ui
- Manages Claude CLI subprocess lifecycle (spawn, kill, stdin)
- Parses `stream-json` output format into assistant-ui content parts
- Session resume strategy: resume → session-id → fresh
- Thread locking via FIFO waiter queue with timeout
- Exports: `createClaudeAdapter()`, `currentProcessByThread`, `pendingRequestByThread`

### db.ts (855 lines)
- SQLite DAL via `@tauri-apps/plugin-sql`
- Namespaced API: `db.threads.*`, `db.workspaces.*`, `db.messages.*`, `db.sessions.*`, `db.devEvents.*`, `db.mcpSnapshots.*`, `db.mcpInvocations.*`, `db.usageSnapshots.*`
- Row types: ThreadRow, WorkspaceRow, MessageRow, SessionRow, DevEventRow, McpSnapshotRow, McpInvocationRow, UsageSnapshotRow
- Duplicate workspace/thread-cwd detection with custom error classes

### sqlite-thread-list-adapter.ts (163 lines)
- Implements `RemoteThreadListAdapter` for assistant-ui
- Maps SQLite thread CRUD to assistant-ui's thread list protocol
- Concurrent title generation via separate Claude CLI call
- Exports: `createSQLiteThreadListAdapter()`, `prefetchTitle()`, `onTitleReady()`

### thread.tsx (891 lines) + thread-list.tsx (1017 lines)
- Full chat UI using assistant-ui primitives (ThreadPrimitive, MessagePrimitive, ComposerPrimitive)
- Thread list with workspace grouping, drag-drop reorder potential
- Inline tool call displays, thinking blocks, markdown rendering

### claude-tool-display.tsx (735 lines)
- Renders Claude CLI tool calls (Read, Write, Edit, Bash, Glob, Grep, WebSearch, etc.)
- Collapsible tool call cards with syntax-highlighted content

## Configuration

| File | Purpose |
|------|---------|
| `tauri.conf.json` | Tauri app settings, CSP, SQLite preload, window dimensions |
| `capabilities/default.json` | Shell permissions: `claude` and `sh` commands allowed |
| `package.json` | Frontend deps, scripts (dev/build/preview/tauri) |
| `Cargo.toml` | Rust deps: tauri, shell/sql/dialog plugins |
| `tsconfig.json` | Strict TS, `@/*` → `src/*` alias |
| `vite.config.ts` | Vite + React + Tailwind, port 1420 |
| `components.json` | shadcn/ui: new-york style, slate base |

## Key Dependencies

### Frontend
| Package | Version | Purpose |
|---------|---------|---------|
| `@assistant-ui/react` | ^0.12.9 | Chat runtime, primitives, thread management |
| `@assistant-ui/react-markdown` | ^0.12.3 | Markdown rendering for messages |
| `@tauri-apps/plugin-shell` | ~2 | Subprocess management (Claude CLI) |
| `@tauri-apps/plugin-sql` | ^2.3.2 | SQLite database access |
| `react` | ^19.1.0 | UI framework |
| `tailwindcss` | ^4.1.18 | Styling |
| `radix-ui` | ^1.4.3 | Accessible UI primitives |
| `zustand` | ^5.0.11 | State management (lightly used) |
| `highlight.js` | ^11.11.1 | Code syntax highlighting |

### Backend (Rust)
| Crate | Purpose |
|-------|---------|
| `tauri` | Desktop app framework |
| `tauri-plugin-shell` | Subprocess spawning |
| `tauri-plugin-sql` | SQLite with migrations |
| `tauri-plugin-dialog` | Native file/folder dialogs |

## Database Schema

6 core tables + 2 auxiliary:
- **threads** — id, remote_id, title, status, session_id, cwd, workspace_id, git_branch, dev_panel_open
- **messages** — id, thread_id, parent_id, role, content (JSON), status, metadata, run_config
- **sessions** — thread_id (PK), session_id, status
- **workspaces** — id, name, cwd
- **dev_events** — id, thread_id, seq, category, raw (JSON)
- **mcp_snapshots** — id, thread_id, session_id, servers/tools/mcp_tools/builtin_tools (JSON)
- **mcp_invocations** — id, thread_id, tool_name, server_name, tokens, cost, duration
- **usage_snapshots** — id, thread_id, tokens, cost, model_id, context_window

## Quick Start

```bash
bun install                # Install frontend dependencies
cargo tauri dev            # Start dev server + Tauri window
```

## Architectural Insights

### Why `sh -c` Instead of Direct `Command.create("claude", [...])`?

Claude CLI detects whether stdin is a **pipe or TTY**. Tauri's `Command.create` makes stdin appear as a pipe, causing Claude CLI to block waiting for piped input. The `sh -c ... < /dev/null` wrapper forces immediate stdin EOF. The `exec` in the shell script replaces `sh` with `claude` so there's no lingering parent shell process. Prompt data passes via env vars (`CLAUDE_PROMPT`) to avoid shell injection.

### Stream Protocol: Double-Envelope Format

Claude CLI's `--output-format stream-json` emits two JSON formats on stdout:
- **Top-level**: `{ "type": "system" | "assistant" | "result", ... }`
- **Enveloped**: `{ "type": "stream_event", "event": { "type": "content_block_start|delta|stop", ... } }`

The adapter unwraps `stream_event` envelopes before processing. Content blocks may include a `parent_tool_use_id` creating a scope hierarchy (root scope vs tool-execution scope).

### Why Module-Level Maps (Not React State)?

The adapter runs **outside React's render cycle** as an async generator. Module-level `Map`s survive component remounts (e.g., thread switching), provide direct access from async contexts without hook rules, and outlive component lifecycles (a CLI process may still stream when components unmount).

### Concurrency Model

| Pattern | Purpose |
|---------|---------|
| FIFO waiter queue | One CLI process per thread; subsequent calls block and resolve in order (60s timeout) |
| Queue+resolver bridge | Converts Tauri's callback-based shell events into async generator yields |
| ~60fps yield throttle | Prevents excessive DOM reconciliation during fast streaming |
| Concurrent title prefetch | Spawns Haiku CLI call in parallel with main conversation stream |
| Lazy session hydration | Loads session from SQLite once per thread on first access |

### Known Limitations

- **Only last message sent** — Claude CLI manages history via `--resume`; Pluribus's message history diverges on edit/branch/regenerate
- **Stale session detection is fragile** — relies on string-matching `"No conversation found"` in stderr
- **Cross-thread git races** — thread lock prevents same-thread races but not cross-thread races on the same cwd
- **Env var size limit** — extremely long prompts may exceed OS env var limits (~128KB Linux, ~32KB macOS)
- **No test framework** configured
- **Attachments non-functional** — UI wired but no `adapters.attachments` configured
- Single theme ("carbon") — warm dark IDE aesthetic

### Serena Memories (Deep Dives)

For detailed analysis beyond this index, read these Serena memories:
- `pluribus-design-rationale` — why each architectural choice was made
- `pluribus-gotchas-and-pitfalls` — non-obvious behaviors and edge cases
- `pluribus-concurrency-patterns` — queue+resolver bridge, throttling, abort handling
- `pluribus-assistant-ui-integration` — framework usage patterns and adapter contracts
- `pluribus-claude-adapter-core` — adapter internals by line range
- `pluribus-data-extraction-logic` — step-by-step stream processing flow
- `pluribus-session-management` — session lifecycle and retry strategy
- `pluribus-database-layer` — SQLite schema and query patterns

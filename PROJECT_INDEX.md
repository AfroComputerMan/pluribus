# Project Index: Pluribus

Generated: 2026-02-18

## Overview

Tauri 2 + React 19 desktop app providing a chat UI for Claude CLI. Uses **assistant-ui** for chat primitives, spawns Claude CLI as a subprocess via Tauri's shell plugin, and persists state in SQLite.

## Project Structure

```
pluribus/
├── src/                          # React frontend (TypeScript)
│   ├── main.tsx                  # ReactDOM entry point
│   ├── App.tsx                   # Root component (RuntimeProvider + ThreadWorkspace + DevPanel)
│   ├── App.css                   # Global styles
│   ├── lib/                      # Core logic & adapters
│   │   ├── claude-adapter.ts     # (1911 lines) Core CLI integration — ChatModelAdapter, process lifecycle, stream parsing, session resume
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
│   └── migrations/
│       ├── 001_initial_schema.sql       # threads, messages, sessions, dev_events, mcp_snapshots, usage_snapshots
│       ├── 002_thread_dev_panel_state.sql # dev_panel_open column
│       ├── 003_ensure_mcp_invocations.sql # mcp_invocations table
│       └── 004_workspaces_and_thread_branch.sql # workspaces table, thread workspace_id + git_branch
├── docs/                         # Design docs & plans
│   ├── design-language.md        # UI design spec
│   ├── comprehensive-audit-report.md # Multi-expert code audit
│   ├── sqlite-backend-{requirements,design}.md
│   ├── claudecode-cli-docs.md    # Claude CLI reference
│   ├── enhanced-cli-integration-plan.md
│   └── plans/                    # Active design plans
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

### claude-adapter.ts (1911 lines)
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

## Known Architectural Notes

- Thread list uses `useRemoteThreadListRuntime` with SQLite-backed adapter
- Claude CLI session resume uses 3-tier strategy (resume → session-id → fresh)
- Dev event archival uses batched writes (50 events / 200ms flush)
- Shell permissions allow both `claude` direct and `sh -c` invocation
- No test framework configured
- Single theme ("carbon") — warm dark IDE aesthetic

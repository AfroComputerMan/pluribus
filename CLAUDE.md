# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pluribus is a Tauri 2 + React 19 desktop application that provides a chat interface to Claude CLI. It uses **assistant-ui** for chat primitives and spawns Claude CLI as a subprocess via Tauri's shell plugin. The core integration is in `src/lib/claude-adapter.ts`, which implements assistant-ui's `ChatModelAdapter` interface.

## Build & Development Commands

```bash
# Development (starts Vite dev server on :1420 + Tauri window)
cargo tauri dev            # or: bun run tauri dev

# Build for production
cargo tauri build

# Frontend-only dev server (no Tauri window)
bun run dev

# Type-check + bundle frontend
bun run build
```

Package manager is **bun**. No test framework is configured.

## Architecture

### Data Flow

```
User Input → assistant-ui Runtime → ChatModelAdapter.run()
  → Tauri Shell (Command.create) → Claude CLI subprocess
  → Stream JSON events → Adapter yields content → assistant-ui renders
```

### Key Files

- **`src/lib/claude-adapter.ts`** (~1900 lines) — Core integration. Implements `ChatModelAdapter`, manages Claude CLI process lifecycle, session persistence, stream parsing, and dev event logging. This is the most complex file in the project.
- **`src/lib/db.ts`** — SQLite database layer. Schema management, migrations, and all DB operations for threads, messages, and session state.
- **`src/lib/sqlite-thread-list-adapter.ts`** — Thread list persistence via SQLite (implements assistant-ui's `ThreadListAdapter`).
- **`src/lib/sqlite-thread-history-adapter.tsx`** — Thread message history persistence via SQLite.
- **`src/components/RuntimeProvider.tsx`** — Sets up the runtime with the Claude adapter, thread list adapter, and thread history adapter.
- **`src/components/ThreadWorkspace.tsx`** — Main layout: sidebar thread list + chat area.
- **`src/components/assistant-ui/thread.tsx`** — Chat UI using assistant-ui primitives (`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`, etc.).
- **`src/components/assistant-ui/claude-tool-display.tsx`** — Specialized rendering for Claude CLI tool call events (file edits, shell commands, etc.).
- **`src-tauri/src/lib.rs`** — Tauri builder setup with shell and SQL plugins.
- **`src-tauri/capabilities/default.json`** — Shell permission grants (controls which commands the webview can execute).
- **`src-tauri/migrations/`** — SQLite schema migrations for the `pluribus.db` database.

### Session Management (claude-adapter.ts)

The adapter maintains per-thread Claude CLI sessions with a retry strategy:
1. **Resume** — If a cached session file exists, use `--resume`
2. **Session-ID** — If cache is missing but we have an ID, use `--session-id`
3. **Fresh** — Start a new session

Sessions are stored in an in-memory `Map<string, SessionRecord>` and persisted to SQLite. Thread locking uses a FIFO waiter queue with timeout protection to prevent concurrent CLI invocations per thread.

### Persistence Layer

The app uses **SQLite** (via `tauri-plugin-sql`) as its primary persistence backend, stored in `pluribus.db`. The database layer in `db.ts` manages:
- Thread metadata and ordering
- Message history per thread
- Session state (Claude CLI session IDs and resume files)
- Schema migrations (tracked in `src-tauri/migrations/`)

### Dev Event System

A circular buffer (500 entries max) logs all stream events from Claude CLI. The DevPanel (lazy-loaded, dev-only) subscribes via `useSyncExternalStore` for real-time inspection of session state, stream events, and Claude CLI output.

## Component Philosophy (Important)

- **UI components**: Always use shadcn/ui or Radix primitives. Never build custom UI components when these libraries provide equivalents.
- **LLM integration**: Always check what assistant-ui provides FIRST. Use its built-in adapters, hooks, primitives, and thread management before building custom solutions. When customization is needed, extend assistant-ui's components — don't bypass the framework.
- **General rule**: Search existing dependencies (assistant-ui, shadcn, Radix, lucide) for a pre-built solution before creating new components, hooks, or adapters.

## Tech Stack & Conventions

- **UI framework**: assistant-ui v0.12 primitives (not custom components) — follow its composition patterns (`ThreadPrimitive.Root > Viewport > Messages`, etc.)
- **Styling**: Tailwind CSS v4 + shadcn/ui (new-york style, slate base color). Use `cn()` from `@/lib/utils` for className merging.
- **shadcn config**: `components.json` — components go in `@/components/ui`, non-RSC mode, lucide icons
- **TypeScript**: Strict mode with `noUnusedLocals` and `noUnusedParameters` enforced
- **Path alias**: `@/*` maps to `src/*`
- **File naming**: kebab-case for files, PascalCase for components
- **Persistence**: SQLite via `tauri-plugin-sql` (`pluribus.db`) for threads, messages, and session state. In-memory Maps/Sets in claude-adapter.ts for runtime process state.
- **State**: Minimal Zustand (installed but lightly used)

## Known Issues

- **Adapter sends only last message** — `extractUserPrompt()` discards conversation history (Claude CLI manages its own via `--resume`). This means edit/branch/regenerate operations in the UI diverge from the CLI session.
- **No attachment adapter** — The UI has attachment components wired up but no `adapters.attachments` is passed to `useLocalRuntime`, so attachments are non-functional.
- **Shell security** — The adapter invokes Claude CLI via a `sh -c` wrapper (`claude-stream-sh`). Replacing this with a direct `Command.create("claude", [...args])` invocation would be more secure.

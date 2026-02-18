# Pluribus — Completed Feature History

A chronological record of major features that have been planned, implemented, and shipped. Each entry summarizes what was built, which files were created or changed, and any open items carried forward.

---

## 1. SQLite Persistence Backend

**Timeframe**: Feb 8–10, 2026
**Commits**: `1f476b8` through `b351419`

Replaced all ephemeral in-memory state and localStorage with a durable SQLite persistence layer via `tauri-plugin-sql`. The database (`pluribus.db`) stores threads, messages, session records, and schema is managed through versioned migrations.

**What was built**:
- `src/lib/db.ts` — Standalone database module with typed query functions, singleton connection, and namespaced API (`db.threads.*`, `db.messages.*`, `db.sessions.*`)
- `src/lib/sqlite-thread-list-adapter.ts` — `RemoteThreadListAdapter` backed by SQLite for thread persistence
- `src/lib/sqlite-thread-history-adapter.tsx` — `ThreadHistoryAdapter` for per-thread message persistence via `unstable_Provider`
- `src/components/RuntimeProvider.tsx` — Rewired from `useLocalRuntime` to `useRemoteThreadListRuntime`
- `src-tauri/migrations/001–006` — Schema migrations (threads, messages, sessions, dev_events, mcp tables, workspaces)

**Key decisions**:
- assistant-ui adapters are the persistence interface — all data flows through `RemoteThreadListAdapter` + `ThreadHistoryAdapter`
- Dual dev event system: in-memory circular buffer for live DevPanel, SQLite archive for history
- WAL mode for concurrent read/write performance
- `ON DELETE CASCADE` on all foreign keys for clean thread deletion
- Start fresh — no localStorage migration

---

## 2. Claude CLI Stream Parsing & Adapter

**Timeframe**: Feb 8–11, 2026
**Commits**: `036543c`, `79d9b94`, `ca666ea`

Built the core `ChatModelAdapter` that spawns Claude CLI as a subprocess via Tauri's shell plugin, parses NDJSON `stream-json` output, and yields content to assistant-ui's runtime.

**What was built**:
- `src/lib/claude-adapter.ts` (~1900 lines) — Full lifecycle management: process spawn, stream parsing, session persistence, content accumulation, tool call tracking, sub-agent state, dev event logging
- Identity-based tool call tracking (by `toolCallId`, not array index)
- Tool result reconciliation across all event paths (assistant, user, top-level `tool_use_result`)
- Line-buffered JSON parsing with partial JSON assembly for streamed tool args

**Key decisions**:
- Uses `sh -c` wrapper for stdin closure (Tauri shell plugin lacks stdin close API)
- Session retry strategy: resume → session-id → fresh
- Sub-agent content routing via `parent_tool_use_id`

---

## 3. Enhanced CLI Integration — Tool Display & Accumulator Improvements

**Timeframe**: Feb 11–17, 2026
**Commits**: `01d2c51`, `7403e7b`

Added structured tool call display with per-tool components, status progression tracking, and dead code cleanup. This was Phases 2, 4, 5, and 6 of the enhanced CLI integration plan.

**What was built**:
- `src/components/assistant-ui/claude-tool-display.tsx` — Per-tool renderers (Read, Edit, Write, Bash, Grep, Glob, WebSearch, WebFetch, Task) with rich argument parsing and result display
- Tool status progression: streaming → complete → error
- Content accumulator improvements for stable tool call lifecycle
- Wired tool components into `MessagePrimitive.Parts` via `tools.by_name`
- Dead code cleanup: removed unused components and orphaned files

**Open items carried forward**:
- **Phase 1 (direct CLI invocation)**: Blocked by Tauri shell plugin lacking a stdin close API. The `sh -c` wrapper remains as a workaround.
- **Phase 3 (sub-agent live streaming)**: Descoped to basic Task tool renderer. Full live sub-agent streaming deferred.

---

## 4. Carbon Dark Theme

**Timeframe**: Feb 18, 2026
**Commit**: `e350644`

Complete visual redesign from multi-theme, multi-layout system to a single "Carbon" dark design language — warm dark grays, amber + teal accents, flat full-bleed panels, professional IDE aesthetic.

**What was built**:
- Rewrote `src/App.css` — Single dark palette (`#111114` background, `#e8a849` amber primary, `#4ec9b0` teal accent)
- Redesigned `ThreadWorkspace.tsx` — 3-column grid layout with collapsible sidebar and scratchpad panels
- Restyled chat messages — removed role labels, user messages get amber-tinted background, assistant messages are clean text
- Restyled sidebar — flat workspace sections with collapse controls, single-line thread items, amber active border
- Added IBM Plex Sans + IBM Plex Mono fonts
- Simplified `visual-layouts.ts` and `themes.ts` to single Carbon identity
- Removed all 5 previous themes (studio, graphite, sunset, terminal, paper) and 5 layout variants

---

## 5. Per-Thread Model Selection & Effort Control

**Timeframe**: Feb 18, 2026
**Commits**: `b2ed946` → `5960cab` (8 commits)

Added ability to select Claude model and effort level per thread, with persistence to SQLite and CLI flag injection.

**What was built**:
- `src-tauri/migrations/005_thread_model_effort.sql` — Added `model` and `effort` columns to threads table
- `src/lib/models.ts` — Hardcoded model registry (Opus 4.6, Sonnet 4.6, Haiku 4.5) with resolve helpers
- Extended `db.ts` with `updateModel()` and `updateEffort()` methods
- Interactive dropdown selectors in composer bar replacing read-only model chip
- CLI flags: `--model` and `--effort` injected via env vars in shell script
- Fallback chain: thread row → localStorage → hardcoded defaults
- Effort selector auto-hides for models that don't support it (Haiku)

---

## 6. Loading Animation (Cascade)

**Timeframe**: Feb 18, 2026
**Commit**: `9f9177e`

Replaced the default assistant-ui pulsing dot with a cascade animation — three teal dots that brighten in sequence.

**What was built**:
- `src/loading-animations.css` — CSS-only animations using `box-shadow` technique for multi-dot rendering
- Five variants were prototyped (terminal cursor, cascade, bounce, orbit, beacon); cascade was chosen
- Removed the temporary animation switcher UI after selection

---

## 7. Settings Page (Data Layer)

**Timeframe**: Feb 18, 2026
**Commits**: `08bedf3`, `bdc6eaa`, `dd42105`

Built the data layer and initial UI for a settings overlay that exposes Claude Code configuration.

**What was built**:
- Settings overlay redesigned from sidebar list to tabbed card grid
- Config overrides data layer for reading and writing Claude Code settings

**Note**: This feature is still active — UI v2 redesign is in progress. See `docs/plans/2026-02-18-settings-page.md`.

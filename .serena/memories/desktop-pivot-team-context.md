# Desktop Pivot Team Context

## Project State (2026-02-08)
- **Branch**: feat-tauri_app_rework
- **Phase 1**: ~80% complete (core chat implementation present, runtime validation pending)
- **Phase 2-5**: Not started

## Key Blockers for Phase 1 Closure
1. Missing Tauri icon assets (blocks `cargo check` binary target / `bun run tauri dev`)
2. Desktop dependencies need `bun install` verification
3. Full end-to-end runtime validation pending (create session → send → stream → complete)
4. IPC layer tests (commands.test.ts) only cover normalization; need channel/stream tests
5. Rust LOC at 2019 (target was <1000) — may need scope review

## Architecture Decisions
- **CLI Wrapper**: Spawns `claude` with `--output-format stream-json`, streams NDJSON
- **Tauri Channels**: Per-session Channel<String> for IPC streaming (not global events)
- **Drizzle sqlite-proxy**: TypeScript ORM, SQL execution delegated to Rust via invoke()
- **State**: Zustand stores (chatStore, sessionStore, settingsStore)
- **DB**: SQLite with 7 tables (projects, sessions, messages, teams, tasks, usage_records, settings)
- **Process lifecycle**: Rust tracks in AppState HashMap, persists status to SQLite

## Completed Work
- Rust: commands (chat, db, project, worktree), process manager, session lifecycle
- Frontend: chat UI, session sidebar, app shell, NDJSON parser (93% coverage), IPC bridge
- Tests: ndjson-parser (42/42), commands (2/2), Rust chat commands (11/11)

## PDCA Practice
- All work must update docs/pdca/desktop-pivot/do.md with timestamped entries
- Phase completions update check.md metrics and quality gates
- Learnings go to act.md
- Every completion commits changes with descriptive messages

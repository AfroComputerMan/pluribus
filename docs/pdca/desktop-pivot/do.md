# Do: Pluribus Desktop Pivot

**Feature**: Native desktop application implementation log
**Started**: 2026-02-07
**Status**: In Progress (Phase 1 implementation complete, integration checks in progress)

---

## TDD Tracking

### Test-First Development Log

| Phase | Test File | Tests Written | Tests Passing | Coverage |
|-------|-----------|---------------|---------------|----------|
| Phase 1 | `ndjson-parser.test.ts` | 42 | 42 | 93.04% lines (target >= 90%) |
| Phase 1 | `ipc/commands.test.ts` | TBD | TBD | Target 85% |
| Phase 1 | `ipc/channels.test.ts` | TBD | TBD | Target 85% |
| Phase 1 | `stores/sessionStore.test.ts` | TBD | TBD | Target 85% |
| Phase 1 | `stores/chatStore.test.ts` | TBD | TBD | Target 85% |
| Phase 1 | `ChatPanel.test.tsx` | TBD | TBD | Target 80% |
| Phase 1 | `MessageBubble.test.tsx` | TBD | TBD | Target 80% |
| Phase 1 | `ToolCallCard.test.tsx` | TBD | TBD | Target 80% |
| Phase 2 | Worktree operations | TBD | TBD | TBD |
| Phase 2 | Cost tracking | TBD | TBD | TBD |
| Phase 3 | Team watcher | TBD | TBD | TBD |
| Phase 3 | Team dashboard | TBD | TBD | TBD |
| Phase 4 | Diff parsing | TBD | TBD | TBD |
| Phase 4 | Diff review UI | TBD | TBD | TBD |
| Phase 5 | Permission system | TBD | TBD | TBD |

### TDD Workflow Per Task

1. **Write test first** — Define expected behavior
2. **Run test** — Confirm it fails (Red)
3. **Implement minimum code** — Make test pass (Green)
4. **Refactor** — Clean up while tests stay green
5. **Document** — Log test file and coverage in table above

---

## Implementation Log (Time Series)

### 2026-02-08: Planning Phase

**[Time]** — Created PDCA structure
- Created `docs/pdca/desktop-pivot/` directory
- Created `plan.md` with comprehensive hypothesis, risks, and phases
- Created `do.md` (this file) for implementation tracking
- Created `check.md` for evaluation framework
- Created `act.md` for learnings and improvements

### 2026-02-08: Phase 1 — Project Scaffold

**[Architecture Specialist]** — Initialized Tauri 2.0 project structure
- Created `src-tauri/` directory with Rust backend structure
  - Cargo.toml with Tauri 2.0 dependencies (tauri-plugin-shell, tauri-plugin-sql, tauri-plugin-fs)
  - tauri.conf.json configured for app identifier, window settings, plugin scopes
  - capabilities/default.json with shell, sql, and fs permissions
  - src/main.rs with Tauri builder and plugin initialization
  - src/lib.rs with module declarations
  - src/state.rs with AppState, SessionHandle, and ProcessHandle types
  - src/error.rs with AppError enum and result types
  - src/commands/mod.rs (placeholder for future Tauri commands)
  - src/process/mod.rs (placeholder for process management)
  - src/worktree/mod.rs (placeholder for worktree operations)
  - build.rs for Tauri build integration
- Created new `src/` directory for React frontend (separate from existing backend)
  - main.tsx with React 19, React Router, and React Query setup
  - App.tsx with minimal HomePage component
  - index.css with TailwindCSS v4 imports
  - test/setup.ts with Vitest + jsdom configuration
  - Directory structure: types/, db/, ipc/, stores/, hooks/, lib/, components/, pages/
- Created root-level configuration files
  - package.json with Tauri dependencies and React 19
  - vite.config.ts with React plugin and Tauri-specific settings
  - index.html as Vite entry point
  - tsconfig.json configured for React and JSX
  - tsconfig.node.json for Vite config
  - postcss.config.js for TailwindCSS v4
- Result: `bun run dev` ready to test (after `bun install` and Rust dependencies)

### 2026-02-07: Phase 1 — Core Chat Implementation Sweep

**[Verification + completion pass]** — audited existing unstaged implementation and normalized status
- Confirmed implemented modules across Rust + frontend:
  - Rust commands: `chat`, `db`, `project`, `worktree`
  - Rust managers: process lifecycle/session state + git worktree manager
  - Frontend: app shell, session sidebar/dialog, chat panel/input/cards, Zustand stores, IPC wrappers
  - NDJSON parser + test suite at `src/lib/ndjson-parser.test.ts`
- Verification results:
  - `bun test src/lib/ndjson-parser.test.ts`: 42/42 pass, parser line coverage 93.04%
  - `cargo check --lib` in `src-tauri`: pass
  - `cargo check` (bin): fails at Tauri context generation due missing icon assets (`src-tauri/icons/icon.png`)
  - `bun run desktop:typecheck`: currently blocked because desktop dependencies (`vite`/`vitest` types) are not installable in this network-restricted environment
- Code quality fixes applied during verification:
  - Removed conflicting `From<AppError> for tauri::ipc::InvokeError` impl
  - Cleaned Rust warnings (unused imports/variables) in process/worktree modules
  - Split desktop scripts from backend scripts (`desktop:dev`, `desktop:build`, `desktop:typecheck`) and updated Tauri pre-build commands to use desktop-specific scripts
- Outcome: Phase 1 implementation is materially present; remaining work is integration hardening and runtime verification.

### 2026-02-07: Phase 1 — Chat Wiring + IPC Contract (TDD Slice)

**[Test-first integration pass]** — fixed frontend-to-Rust chat stream contract and connected UI
- Wrote failing test first:
  - Added `src/ipc/commands.test.ts` to validate `send_message` invoke payload mapping.
  - Initial run failed because `buildSendMessageArgs` did not exist.
- Implemented to green:
  - Added `buildSendMessageArgs` and `SendMessageInput` in `src/ipc/commands.ts`.
  - Updated `chatCommands.sendMessage` to pass full Rust command args.
  - Updated `useChatStream` to send session-scoped runtime fields (`projectPath`, `model`, `autonomyLevel`, `worktreePath`).
  - Wired `ChatPage` to render `ChatPanel` and call `useChatStream` instead of placeholder text.
  - Added `projectPath` to `SessionSummary` typing to match Rust session serialization.
- Stabilization fixes:
  - `src/test/setup.ts`: fixed global mock typing for strict TS.
  - `vite.config.ts`: switched config typing import to `vitest/config` for `test` block support.
- Verification results:
  - `bun run desktop:typecheck`: pass
  - `bun test src/ipc/commands.test.ts src/lib/ndjson-parser.test.ts`: 43/43 pass
  - `cd src-tauri && cargo check`: pass

### 2026-02-07: Phase 1 — Session Contract Normalization (TDD Slice)

**[Test-first compatibility pass]** — normalized Rust session payloads for frontend stream path stability
- Wrote failing test first:
  - Extended `src/ipc/commands.test.ts` with `normalizeSessionSummary` expectations for snake_case Rust payloads.
  - Initial run failed due missing export/implementation.
- Implemented to green:
  - Added `normalizeSessionSummary` in `src/ipc/commands.ts` to map snake_case and camelCase fields.
  - Updated `sessionCommands.create/list/get` to normalize all session responses before store usage.
  - Updated Rust `create_session` to preserve `project_path` from input (instead of empty string), so `send_message` has a valid working directory source.
- Verification results:
  - `bun test src/ipc/commands.test.ts`: 2/2 pass
  - `bun run desktop:typecheck`: pass
  - `cd src-tauri && cargo check`: pass

### 2026-02-07: Phase 1 — Session Persistence Hydration (TDD Slice)

**[Rust test-first pass]** — hydrate sessions from SQLite when in-memory cache is empty
- Wrote tests first in `src-tauri/src/commands/chat.rs`:
  - status parsing fallback behavior (`parse_session_status`)
  - single-session load from DB by id
  - bulk session load from DB
- First run failed on FK constraints (good signal): session rows require existing `projects` rows.
- Implemented to green:
  - Added DB hydration helpers: `load_session_from_db`, `load_all_sessions_from_db`.
  - Updated `get_session` to fallback to DB on cache miss and rehydrate memory map.
  - Updated `list_sessions` to hydrate from DB when memory is empty.
  - Fixed test fixtures to insert required `projects` rows before `sessions`.
- Verification results:
  - `cd src-tauri && cargo test commands::chat -- --nocapture`: 3/3 pass
  - `cd src-tauri && cargo check`: pass
  - `bun run desktop:typecheck`: pass

### 2026-02-07: Phase 1 — Session Status Hydration (TDD Slice)

**[Rust test-first pass]** — fixed `get_session_status` restart behavior
- Added failing-path coverage by introducing `get_session_status_inner` and a test for DB fallback hydration.
- Implemented command behavior:
  - `get_session_status` now delegates to `get_session_status_inner`.
  - Inner logic checks memory first, then falls back to SQLite and rehydrates cache.
- Verification results:
  - `cd src-tauri && cargo test commands::chat -- --nocapture`: 4/4 pass
  - `cd src-tauri && cargo check`: pass
  - `bun run desktop:typecheck`: pass

### 2026-02-07: Phase 1 — Session Name Fidelity (TDD Slice)

**[Rust test-first pass]** — preserved user-provided session names through command serialization
- Wrote failing assertion first in Rust command tests:
  - `load_session_from_db_returns_saved_session` now asserts `SessionHandle.name`.
  - Initial compile failed because `SessionHandle` had no `name` field.
- Implemented to green:
  - Added `name` to `SessionHandle` in `src-tauri/src/state.rs`.
  - Updated `SessionHandle::new` signature and all call sites.
  - Updated DB hydration queries (`load_session_from_db` / `load_all_sessions_from_db`) to select/map `name`.
  - Defaulted ad-hoc runtime sessions (created via `send_message`) to a generated display name.
- Verification results:
  - `cd src-tauri && cargo test commands::chat -- --nocapture`: 4/4 pass
  - `cd src-tauri && cargo test process::session -- --nocapture`: 12/12 pass
  - `cd src-tauri && cargo check`: pass
  - `bun run desktop:typecheck`: pass

### 2026-02-07: Phase 1 — Runtime Session Metadata Durability (TDD Slice)

**[Rust test-first pass]** — ensured runtime sessions and Claude session IDs persist to SQLite
- Wrote failing tests first in `src-tauri/src/commands/chat.rs`:
  - runtime session upsert is idempotent (`INSERT OR IGNORE` behavior)
  - `claude_session_id` persistence updates backing row
- Implemented to green:
  - Added `upsert_runtime_session_in_db` and wired into `send_message` for runtime-created sessions.
  - Added `persist_claude_session_id_in_db` and wired into `update_claude_session_id`.
  - Fixed ownership bug in `update_claude_session_id` (`session_id` borrow after move).
- Verification results:
  - `cd src-tauri && cargo test commands::chat -- --nocapture`: 6/6 pass
  - `cd src-tauri && cargo check`: pass
  - `bun run desktop:typecheck`: pass

### 2026-02-07: Phase 1 — Session Status DB Durability (TDD Slice)

**[Rust test-first pass]** — persisted status transitions from process lifecycle to SQLite
- Wrote failing-path test in `src-tauri/src/process/manager.rs`:
  - `persist_session_status_in_db_updates_row` validates status row update.
- Implemented to green:
  - Added `persist_session_status_in_db` helper.
  - Wired DB status sync into:
    - process exit handling (`completed` / `failed`)
    - abort flow (`killed`)
    - pause/resume flows (`paused` / `running`)
- Verification results:
  - `cd src-tauri && cargo test process::manager -- --nocapture`: 1/1 pass
  - `cd src-tauri && cargo test commands::chat -- --nocapture`: 6/6 pass
  - `cd src-tauri && cargo check`: pass
  - `bun run desktop:typecheck`: pass

### 2026-02-07: Phase 1 — Project-Scoped Session Listing (TDD Slice)

**[Rust test-first pass]** — added DB-backed project filtering for `list_sessions`
- Wrote failing test first:
  - `load_sessions_from_db_filters_by_project_id` verifies only sessions for requested project are returned.
- Implemented to green:
  - Replaced broad load helper with `load_sessions_from_db(state, project_id?)`.
  - Updated `list_sessions` command to accept optional `project_id` and filter both cache and DB paths.
  - Kept hydration semantics intact (cache repopulated after DB load).
- Verification results:
  - `cd src-tauri && cargo test commands::chat -- --nocapture`: 7/7 pass
  - `cd src-tauri && cargo check`: pass
  - `bun run desktop:typecheck`: pass

### 2026-02-07: Phase 1 — Project Path Resolution in Session Creation (TDD Slice)

**[Rust test-first pass]** — ensured `create_session` uses real repo path when `projectId` refers to a saved project
- Wrote tests first:
  - `resolve_project_path_uses_projects_table_when_id_exists`
  - `resolve_project_path_falls_back_to_project_id_when_missing`
- Implemented to green:
  - Added `resolve_project_path` helper in `chat.rs`.
  - `create_session` now resolves `project_path` via `projects.path` when available; otherwise keeps backward-compatible fallback.
- Verification results:
  - `cd src-tauri && cargo test commands::chat -- --nocapture`: 9/9 pass
  - `cd src-tauri && cargo check`: pass
  - `bun run desktop:typecheck`: pass

---

## Phase 1: Core Chat (Weeks 1-3)

**Timeline**: In progress (implementation complete, verification gates pending)
**Goal**: Single session chat with Claude CLI, NDJSON parsing, streaming display

### Task Checklist

- [x] Initialize Tauri 2.0 project (`bun create tauri-app`, React + Vite + TS)
- [x] Set up Tauri plugins (`bun add @tauri-apps/plugin-shell @tauri-apps/plugin-sql @tauri-apps/plugin-fs`)
- [x] Create SQLite schema (all 7 tables via Drizzle)
- [x] Implement Drizzle sqlite-proxy client
- [x] Build Rust ProcessManager (spawn, BufReader->Channel)
- [x] Build Rust SessionHandle (state machine, stdin, kill)
- [x] Build NDJSON parser with tests (90%+ coverage)
- [x] Build Zustand stores (session, chat, settings)
- [x] Build ChatPanel, ChatInput, MessageBubble, StreamingMessage
- [x] Build ToolCallCard + ToolResultCard
- [x] Build SessionSidebar + AppShell layout
- [x] Copy common components from Pluribus
- [x] Implement check_claude_cli for onboarding
- [x] Build ipc/commands.ts (type-safe invoke wrappers)
- [x] Wire useChatStream hook end-to-end

### Implementation Log

- Gate pending: add real app icons so `cargo check` / `bun run tauri dev` can build the binary target.
- Gate pending: run end-to-end runtime checks (session create -> send message -> stream -> completion).
- Gate pending: install desktop dependencies when network access is available (`react`, `@tauri-apps/api`, `zustand`, `vite`, `vitest`, etc.), then re-run `bun run desktop:typecheck`.

---

## Phase 2: Multi-Session + Worktrees (Weeks 4-5)

**Timeline**: Not started
**Goal**: Multiple concurrent sessions, project management, worktree isolation

### Task Checklist

- [ ] Extend ProcessManager for concurrent sessions
- [ ] Build enhanced NewSessionDialog
- [ ] Implement project management commands
- [ ] Build WorktreeManager in Rust
- [ ] Wire worktree creation into session flow
- [ ] Implement session resume (--resume)
- [ ] Implement session pause (SIGSTOP/SIGCONT)
- [ ] Build CostTrackingPanel (adapted from Pluribus)
- [ ] Build useCostTracking hook

### Implementation Log

*Will be updated during Phase 2 implementation*

---

## Phase 3: Agent Teams + Orchestration (Weeks 6-8)

**Timeline**: Not started
**Goal**: Spawn Agent Teams, visualize tasks, team dashboard

### Task Checklist

- [ ] Team creation with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env
- [ ] Build useTeamWatcher (filesystem polling)
- [ ] Sync task JSONs to SQLite
- [ ] Build TeamDashboard (AgentCard grid)
- [ ] Build TaskBoard (columns by status)
- [ ] Build TaskCard
- [ ] Build team creation wizard

### Implementation Log

*Will be updated during Phase 3 implementation*

---

## Phase 4: Diff Review (Weeks 9-10)

**Timeline**: Not started
**Goal**: Review file changes made by agents

### Task Checklist

- [ ] Build DiffReviewPanel (slide-over)
- [ ] Extract diffs from Edit/Write tool messages + git diff
- [ ] Build DiffFileCard with unified diff rendering
- [ ] Implement accept/reject per file and bulk
- [ ] "Open in Editor" integration

### Implementation Log

*Will be updated during Phase 4 implementation*

---

## Phase 5: Permission System + Polish (Weeks 11-12)

**Timeline**: Not started
**Goal**: Permission MCP server, shortcuts, settings, production

### Task Checklist

- [ ] MCP stdio permission server (Rust)
- [ ] PermissionPrompt modal
- [ ] Three-level autonomy implementation
- [ ] SettingsPage
- [ ] Keyboard shortcuts
- [ ] Dark mode
- [ ] Virtualized message list
- [ ] Cross-platform testing
- [ ] Production packaging (cargo tauri build)

### Implementation Log

*Will be updated during Phase 5 implementation*

---

## Learnings During Implementation

### Successful Patterns

*Will be documented as patterns emerge*

### Failed Approaches

*Will be documented when approaches fail*

### Technical Discoveries

*Will be documented during implementation*

### Dependency Issues

*Will be documented if dependency issues arise*

---

## Metrics Tracking

### Development Velocity

| Phase | Estimated | Actual | Notes |
|-------|-----------|--------|-------|
| Phase 1 | 3 weeks | TBD | Critical path |
| Phase 2 | 2 weeks | TBD | |
| Phase 3 | 3 weeks | TBD | |
| Phase 4 | 2 weeks | TBD | |
| Phase 5 | 2 weeks | TBD | |

### Quality Metrics

| Metric | Target | Actual | Notes |
|--------|--------|--------|-------|
| TypeScript errors | 0 | TBD | |
| Test coverage (overall) | >= 70% | TBD | |
| Test coverage (NDJSON) | >= 90% | TBD | |
| Bundle size | < 15 MB | TBD | |
| App memory (idle) | < 100 MB | TBD | |

### Performance Metrics

| Metric | Target | Actual | Notes |
|--------|--------|--------|-------|
| App startup | < 1s | TBD | |
| Streaming latency | < 100ms | TBD | |
| 4 concurrent sessions | stable | TBD | |

---

## Notes

This document will be continuously updated during implementation. Each significant milestone, error, or discovery will be timestamped and logged.

**Update Frequency**: After each task completion, error resolution, or phase transition.

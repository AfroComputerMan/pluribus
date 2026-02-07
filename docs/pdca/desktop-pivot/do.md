# Do: Pluribus Desktop Pivot

**Feature**: Native desktop application implementation log
**Started**: 2026-02-08
**Status**: Not Started (Awaiting Plan Approval)

---

## TDD Tracking

### Test-First Development Log

| Phase | Test File | Tests Written | Tests Passing | Coverage |
|-------|-----------|---------------|---------------|----------|
| Phase 1 | `ndjson-parser.test.ts` | TBD | TBD | Target 90% |
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

---

## Phase 1: Core Chat (Weeks 1-3)

**Timeline**: Not started
**Goal**: Single session chat with Claude CLI, NDJSON parsing, streaming display

### Task Checklist

- [x] Initialize Tauri 2.0 project (`bun create tauri-app`, React + Vite + TS)
- [x] Set up Tauri plugins (`bun add @tauri-apps/plugin-shell @tauri-apps/plugin-sql @tauri-apps/plugin-fs`)
- [ ] Create SQLite schema (all 7 tables via Drizzle)
- [ ] Implement Drizzle sqlite-proxy client
- [ ] Build Rust ProcessManager (spawn, BufReader->Channel)
- [ ] Build Rust SessionHandle (state machine, stdin, kill)
- [ ] Build NDJSON parser with tests (90%+ coverage)
- [ ] Build Zustand stores (session, chat, settings)
- [ ] Build ChatPanel, ChatInput, MessageBubble, StreamingMessage
- [ ] Build ToolCallCard + ToolResultCard
- [ ] Build SessionSidebar + AppShell layout
- [ ] Copy common components from Pluribus
- [ ] Implement check_claude_cli for onboarding
- [ ] Build ipc/commands.ts (type-safe invoke wrappers)
- [ ] Wire useChatStream hook end-to-end

### Implementation Log

*Will be updated during Phase 1 implementation*

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

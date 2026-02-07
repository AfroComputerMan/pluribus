# Plan: Pluribus Desktop Pivot

**Feature**: Native desktop chat application wrapping Claude Code CLI for visual AI agent orchestration
**Timeline**: 12 weeks (5 phases)
**Started**: 2026-02-08
**Status**: Planning Phase

---

## Hypothesis

### Problem Statement

Current state: Pluribus is a backend-only workflow orchestration system (Hono + Postgres + Redis) that requires API/JSON interaction. Users cannot visually manage AI coding agents, see streaming chat responses, coordinate agent teams, or review code changes in a unified interface. The workflow-centric model doesn't match how developers actually interact with AI agents — through conversation.

### Proposed Solution

Pivot Pluribus into a **Tauri 2.0 native desktop application** that:
1. **Wraps Claude Code CLI** — uses `--output-format stream-json` to parse NDJSON, leveraging the user's existing subscription (no API key)
2. **Provides chat-first UX** — streaming markdown rendering, tool call cards, permission prompts
3. **Orchestrates agent teams** — visual team builder, shared task board, agent status dashboard
4. **Isolates sessions via git worktrees** — multiple concurrent agents working on the same repo without conflicts
5. **Enables diff-first code review** — grouped file changes with accept/reject per file

### Why This Approach?

**Category Decision: Agent Orchestrator, NOT an IDE**

The competitive landscape has two product categories:
- **Full IDEs** (Cursor, Windsurf, Zed) — massive scope, deep editor integration, billions in funding
- **Agent Orchestrators** (Conductor, Codex App, Claudia) — focused on managing agents visually

Pluribus targets Agent Orchestrators because:
- Lower barrier to entry (no code editor to build)
- Users keep their preferred IDE
- Focus on coordination and review, not editing
- Existing Pluribus code handles agent management, MCP integration, cost tracking

**Technology Choices:**

| Decision | Choice | Rationale |
|---|---|---|
| Desktop framework | Tauri 2.0 | 30-40 MB idle (vs Electron's 200-300 MB), React reuse, cross-platform, proven by opcode + Claudia |
| Agent engine | CLI wrapper | Uses existing Claude Code subscription, no API key friction, same approach as Conductor |
| JS runtime / package manager | Bun | Already used throughout Pluribus, fast installs, native TS execution, single toolchain for dev + test + build |
| Database | SQLite + Drizzle ORM | Zero config, embedded, type-safe, no external services |
| IPC streaming | Tauri Channels | Per-session scoping, high throughput, no global event fan-out |
| State management | Zustand | Already used in Pluribus frontend, lightweight (3KB) |
| Session isolation | Git worktrees | Industry standard — Conductor, Cursor, Codex all use this pattern |
| Frontend reuse | ~60-70% from existing Pluribus | Button, StatusBadge, DataTable, JsonViewer, CostTrackingPanel, keyboard shortcuts, Zustand patterns |

**Architecture Rationale:**

1. **CLI Wrapper Over SDK**: The Claude Agent SDK requires an Anthropic API key with billing. By wrapping the `claude` CLI with `--output-format stream-json`, we piggyback on the user's existing subscription. Zero API key friction — same approach as Conductor and Codex App.

2. **Pure Tauri (No Separate Server)**: Single binary distribution. SQLite for persistence. All app logic stays in TypeScript (React). Rust is thin (~500-1000 LOC) for process management + IPC. No Hono, no PostgreSQL, no Redis.

3. **Tauri Channels for Streaming**: Each chat session gets its own `Channel<String>`. Rust BufReader reads claude CLI stdout line-by-line and sends to the channel. TypeScript NDJSON parser converts lines to store actions. No global event fan-out, no message routing.

4. **Drizzle sqlite-proxy Pattern**: Drizzle ORM runs in the frontend but delegates actual SQL execution to Rust via `invoke('execute_sql')` / `invoke('select_sql')`. Type-safe queries in TypeScript, SQLite execution in Rust.

---

## Expected Outcomes (Quantitative)

### User Experience

| Metric | Target | Measurement |
|---|---|---|
| App startup | < 1 second | Time from launch to interactive UI |
| Streaming latency | < 100ms | Time from CLI stdout to UI render |
| Concurrent sessions | 4-8 | Simultaneous chat sessions without degradation |
| App memory (idle) | < 100 MB | App process only, agent processes separate |
| App memory (4 sessions) | < 200 MB | With 4 active streaming sessions |

### Technical Metrics

| Metric | Target | Measurement |
|---|---|---|
| Test coverage (overall) | >= 70% | All frontend feature code |
| Test coverage (NDJSON parser) | >= 90% | Critical path — every CLI message type |
| Test coverage (IPC layer) | >= 85% | Type-safe invoke/channel wrappers |
| Rust LOC | < 1000 | Thin Rust layer, app logic in TypeScript |
| Bundle size (frontend) | < 2 MB | WebView assets |
| Binary size (total) | < 15 MB | Tauri app bundle |
| SQLite tables | 7 | projects, sessions, messages, teams, tasks, usage_records, settings |

### Reuse Metrics

| Category | Files | Strategy |
|---|---|---|
| Drop-in reuse | 6 components | Button, StatusBadge, DataTable, JsonViewer, CostTrackingPanel, useKeyboardShortcuts |
| Adapt with changes | 4 modules | API client -> IPC commands, SSE hooks -> Channels, Claude Code adapter -> Rust port, error hierarchy |
| Pattern reference | 3 patterns | Service architecture, Zustand store, event publishing |
| Cannot reuse | 7 systems | Hono API, PostgreSQL, Redis, BullMQ, DAG engine, Docker runtime, triggers |

### Implementation Timeline

| Phase | Duration | Deliverable |
|---|---|---|
| Phase 1: Core Chat | Weeks 1-3 | Single session chat, NDJSON parsing, streaming display |
| Phase 2: Multi-Session + Worktrees | Weeks 4-5 | Concurrent sessions, project management, worktree isolation |
| Phase 3: Agent Teams | Weeks 6-8 | Team builder, task board, agent status dashboard |
| Phase 4: Diff Review | Weeks 9-10 | Grouped file changes, accept/reject per file |
| Phase 5: Permission System + Polish | Weeks 11-12 | Permission MCP server, settings, shortcuts, dark mode, packaging |

---

## Risks & Mitigation

### Technical Risks

**Risk 1: Tauri 2.0 Maturity**
- **Impact**: High — could block core functionality
- **Probability**: Low — Tauri 2 is stable (GA since Aug 2024), opcode and Claudia are production apps
- **Mitigation**:
  - Start with minimal Rust (process spawn + line streaming)
  - Use `tauri-plugin-shell` for process management (maintained by Tauri team)
  - Use `tauri-plugin-sql` for SQLite (maintained by Tauri team)
  - Test cross-platform early (Linux primary, macOS secondary)
- **Fallback**: If Tauri proves problematic for a specific feature, isolate that feature to a shell command

**Risk 2: NDJSON Parser Correctness**
- **Impact**: High — incorrect parsing breaks the entire chat experience
- **Probability**: Medium — Claude CLI output format is not formally documented, could change between versions
- **Mitigation**:
  - Build comprehensive test suite from real CLI output captures
  - Test all message types: system, assistant, user, stream_event, result
  - Test all stream_event subtypes: content_block_delta (text, thinking, tool input), content_block_start/stop
  - Pin Claude CLI version in documentation
  - Add graceful handling for unknown message types (log + skip, don't crash)
- **Monitoring**: Log parse failures with full raw line for debugging

**Risk 3: Claude CLI Process Management**
- **Impact**: High — orphaned processes, zombie sessions, resource leaks
- **Probability**: Medium — process lifecycle is inherently complex
- **Mitigation**:
  - Implement proper cleanup in Rust: kill process group on session abort
  - Handle SIGTERM/SIGINT for graceful shutdown
  - Track all child processes in AppState HashMap
  - Periodic health check: verify PID is still alive
  - Auto-kill sessions exceeding budget/turn limits
- **Fallback**: Expose "kill all sessions" emergency button in UI

**Risk 4: Git Worktree Conflicts**
- **Impact**: Medium — concurrent agents could step on each other
- **Probability**: Low — worktrees are designed for this exact use case
- **Mitigation**:
  - Each session gets its own branch: `pluribus/<session-short-id>`
  - Worktree path is sibling of repo: `<repo>/../.pluribus-worktrees/<id>`
  - Validate worktree doesn't already exist before creation
  - Auto-cleanup: prune + remove orphaned dirs after 24h
- **Fallback**: Fall back to same-directory mode if worktree creation fails

**Risk 5: Permission MCP Server Complexity**
- **Impact**: Medium — permission system is a Phase 5 feature
- **Probability**: Medium — stdio MCP server in Rust requires careful protocol adherence
- **Mitigation**:
  - Defer to Phase 5 (non-critical for MVP)
  - Start with `--allowedTools` flag for basic autonomy levels
  - MCP server only needed for "ask" and "supervised" modes
  - Reference existing MCP server implementations (Conductor uses similar approach)
- **Fallback**: Use `autonomous` mode only for MVP, add permission UI in v1.1

**Risk 6: Agent Teams Experimental API Stability**
- **Impact**: Medium — filesystem-based monitoring could break
- **Probability**: High — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is a research preview
- **Mitigation**:
  - Isolate team monitoring to `useTeamWatcher` hook
  - Use filesystem polling (not inotify) for portability
  - Abstract team state sync behind interface for easy replacement
  - Document supported Claude Code version
- **Fallback**: If API changes, update filesystem paths only — UI components unaffected

### Project Risks

**Risk 7: Scope Creep**
- **Impact**: High — desktop app has unlimited feature surface
- **Probability**: High — chat + teams + diff review + permissions is already ambitious
- **Mitigation**:
  - Strict phase gating: each phase must pass verification before starting next
  - Phase 1 is the hard gate: if core chat doesn't work, everything else is irrelevant
  - "Works" means: launch app, type message, see streaming response, tool calls render
  - Out-of-scope list enforced: no code editor, no AI-powered suggestions, no marketplace

**Risk 8: Existing Codebase Migration Complexity**
- **Impact**: Medium — adapting components for Tauri IPC
- **Probability**: Low — most reuse is straightforward copy
- **Mitigation**:
  - Phase 1 creates the IPC layer first (commands.ts, channels.ts, events.ts)
  - Copy components after IPC layer is proven
  - Test each adapted component individually
- **Fallback**: Rewrite component from scratch if adaptation proves harder than expected

---

## Implementation Strategy

### Phase 1: Core Chat (Weeks 1-3)
**Goal**: Single session chat with Claude CLI, NDJSON parsing, streaming display.

**This is the critical phase.** If core chat doesn't work end-to-end, nothing else matters.

**Tasks**:

1. **Initialize Tauri 2.0 project**
   - `bun create tauri-app` with React + Vite + TypeScript template
   - Configure tauri.conf.json: window size (1200x800), title, shell scope
   - Configure `beforeDevCommand` and `beforeBuildCommand` in tauri.conf.json to use `bun run dev` / `bun run build`
   - Set up capabilities/default.json: shell:allow-spawn (claude, git), sql:default, fs permissions
   - Verify `bun run tauri dev` launches empty app

2. **Set up Tauri plugins**
   - `bun add @tauri-apps/plugin-shell @tauri-apps/plugin-sql @tauri-apps/plugin-fs`
   - Add corresponding Rust crate dependencies in Cargo.toml
   - Verify plugins load correctly in `bun run tauri dev`

3. **Create SQLite schema**
   - Define all 7 tables via Drizzle ORM: projects, sessions, messages, teams, tasks, usage_records, settings
   - Implement Drizzle sqlite-proxy client wrapping invoke('execute_sql'/'select_sql')
   - Create Rust commands: execute_sql, select_sql
   - Run initial migration, verify tables created

4. **Implement Rust ProcessManager**
   - Spawn `claude` CLI with `--print --output-format stream-json --verbose`
   - BufReader reads stdout line-by-line
   - Each line sent via Channel<String> to frontend
   - Handle process exit (code 0 = success, non-zero = failure)
   - Store child process handle in AppState

5. **Implement Rust SessionHandle**
   - State machine: Created -> Running -> Completed/Failed/Killed
   - stdin writer for sending messages (resume)
   - kill() for aborting sessions
   - Status tracking in AppState HashMap

6. **Build NDJSON parser (TypeScript)**
   - `parseCLILine(line: string): CLIMessage | null`
   - Handle all 5 message types: system, assistant, user, stream_event, result
   - Handle all stream_event subtypes
   - `cliMessageToUIAction(msg: CLIMessage): UIAction[]` mapper
   - Comprehensive test suite (target 90% coverage)

7. **Build Zustand stores**
   - sessionStore: session list, active session, sidebar state
   - chatStore: messages per session, streaming state, content blocks
   - settingsStore: app preferences (model, autonomy, theme)
   - Dispatch pattern: UIAction -> store update

8. **Build chat UI components**
   - ChatPanel: message list + input area
   - ChatInput: multi-line input, Cmd/Ctrl+Enter to send
   - MessageBubble: single message with markdown rendering (react-markdown)
   - StreamingMessage: in-progress message with cursor animation
   - ToolCallCard: collapsible tool invocation display
   - ToolResultCard: tool result with syntax highlighting

9. **Build session management**
   - SessionSidebar: session list with status dots + cost
   - SessionItem: name, status, model, cost
   - NewSessionDialog: project path, model selection, autonomy level
   - AppShell: sidebar + main chat area layout

10. **Build IPC layer (TypeScript)**
    - ipc/commands.ts: type-safe invoke() wrappers
    - ipc/events.ts: type-safe listen() wrappers
    - ipc/channels.ts: Channel<T> factory for streaming
    - Wire useChatStream hook: Channel -> NDJSON parser -> chatStore

11. **Copy common components from Pluribus**
    - Button, StatusBadge, DataTable, JsonViewer
    - Adapt imports (remove any backend-specific dependencies)

12. **CLI detection and onboarding**
    - check_claude_cli command: verify `claude` is in PATH
    - Onboarding screen if CLI not found
    - Version detection and compatibility warning

**Acceptance Criteria**:
- Launch app with `bun run tauri dev`
- Create a session pointing to a local git repo
- Type a message, see streaming response with markdown
- Tool calls render as collapsible cards with tool name and input
- Tool results render with syntax highlighting
- Session persists in SQLite across app restart
- Session sidebar shows session with status dot and cost

**Quality Gate**:
- All NDJSON parser tests pass (90%+ coverage)
- TypeScript compiles cleanly (`bunx tsc --noEmit`)
- `bun run tauri dev` launches and connects to claude CLI
- Manual E2E: type "What files are in this directory?" -> see file listing response

---

### Phase 2: Multi-Session + Worktrees (Weeks 4-5)
**Goal**: Multiple concurrent sessions, project management, worktree isolation.

**Tasks**:

1. **Extend ProcessManager for concurrent sessions**
   - HashMap<SessionId, SessionHandle> in AppState
   - Create/destroy sessions independently
   - Each session gets its own Channel

2. **Build NewSessionDialog (enhanced)**
   - Project selection (previously opened projects)
   - Model selection (sonnet, opus, haiku)
   - Autonomy level (ask, supervised, autonomous)
   - Worktree toggle (on/off)
   - Budget limit (optional)
   - Max turns (optional)

3. **Implement project management**
   - open_project: validate path is git repo, store in SQLite
   - list_projects: sorted by last used
   - Project settings: default model, default autonomy

4. **Build WorktreeManager (Rust)**
   - create_worktree: `git worktree add -b pluribus/<id> <path> [<base>]`
   - remove_worktree: `git worktree remove <path>` + `git branch -D`
   - list_worktrees: parse `git worktree list --porcelain`
   - prune: `git worktree prune` + orphaned dir cleanup

5. **Wire worktree into session flow**
   - Session creation with worktree=true creates worktree first
   - Claude CLI spawned with `cwd` set to worktree path
   - Session deletion offers worktree cleanup

6. **Implement session resume**
   - `--resume <claude_session_id>` flag
   - Resume button in session sidebar
   - Load previous messages from SQLite on resume

7. **Implement session pause**
   - Send SIGSTOP to claude process
   - Visual indicator in sidebar
   - Resume with SIGCONT

8. **Build cost tracking**
   - Adapt CostTrackingPanel from Pluribus
   - useCostTracking hook: per-session and aggregate queries
   - Cost per turn from ResultMessage

**Acceptance Criteria**:
- 3 concurrent sessions on different repos
- Each session in its own git worktree
- Pause/resume preserves conversation
- Cost tracking shows per-session and total costs
- Projects page lists opened repositories

**Quality Gate**:
- Run 3 simultaneous sessions, all stream correctly
- Pause session, resume, continue conversation
- Verify worktree branches exist: `git worktree list`
- Cost accumulates across turns

---

### Phase 3: Agent Teams + Orchestration (Weeks 6-8)
**Goal**: Spawn Agent Teams, visualize tasks, team dashboard.

**Tasks**:

1. **Team creation**
   - Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env on lead agent
   - Create team in SQLite with project reference
   - Start lead agent with team prompt

2. **Build useTeamWatcher hook**
   - Filesystem polling (2s interval) for `~/.claude/tasks/<team-id>/`
   - Parse task JSON files
   - Sync state to SQLite tasks table
   - Update teamStore

3. **Build TeamDashboard**
   - Agent grid with status cards (AgentCard)
   - Each card shows: agent name, current task, status, session link
   - Click card to open agent's chat session

4. **Build TaskBoard**
   - Column-based layout: Pending | In Progress | Completed | Failed
   - TaskCard: title, assigned agent, dependencies
   - Drag-and-drop reordering (optional)

5. **Build team creation wizard**
   - Select project
   - Name team
   - Define initial prompt/task list
   - Choose number of teammates

**Acceptance Criteria**:
- Create a team, lead agent spawns
- Teammates appear in dashboard as they start
- Task board populates as agents claim tasks
- Agent status updates in real-time
- Can click agent card to see its chat session

**Quality Gate**:
- Agent Team spawns successfully with env var
- Tasks appear within 5s of creation (polling)
- Agent cards show correct status transitions

---

### Phase 4: Diff Review (Weeks 9-10)
**Goal**: Review file changes made by agents.

**Tasks**:

1. **Build DiffReviewPanel (slide-over)**
   - Triggered from session context menu or button
   - Shows all file changes in the session's worktree
   - Grouped by file with unified diff view

2. **Extract diffs from tool messages**
   - Parse Edit/Write tool_use messages for file paths
   - Run `git diff` in worktree to get actual changes
   - Handle new files, deleted files, modified files

3. **Build DiffFileCard**
   - Unified diff rendering with syntax highlighting
   - Line numbers, additions (green), deletions (red)
   - Collapsible per-file

4. **Accept/reject per file**
   - Checkbox per file for selective acceptance
   - "Accept All" / "Reject All" bulk actions
   - Accept = `git checkout <file>` from worktree to main
   - Reject = discard changes

5. **"Open in Editor" integration**
   - `xdg-open` / `code` / `cursor` file path
   - Configurable editor command in settings

**Acceptance Criteria**:
- Session makes file edits -> DiffReviewPanel shows all changes
- Each file shows unified diff with syntax highlighting
- Can accept individual files (cherry-pick changes)
- Can reject individual files (discard changes)
- "Open in Editor" opens file in user's preferred editor

**Quality Gate**:
- Create session, ask it to modify a file
- DiffReviewPanel shows correct diff
- Accept one file, reject another, verify correct files in main branch

---

### Phase 5: Permission System + Polish (Weeks 11-12)
**Goal**: Permission MCP server, shortcuts, settings, production packaging.

**Tasks**:

1. **Build MCP stdio permission server (Rust)**
   - Implements MCP protocol over stdio
   - Receives permission requests from `--permission-prompt-tool`
   - Forwards to frontend as Tauri events
   - Waits for response, sends back to CLI

2. **Build PermissionPrompt modal**
   - Shows tool name, tool input
   - Allow / Deny buttons
   - "Always allow this tool" option
   - Timeout with auto-deny

3. **Implement three autonomy levels**
   - `ask`: no --allowedTools, MCP server active
   - `supervised`: --allowedTools for reads only, MCP for writes
   - `autonomous`: all tools allowed, no MCP server

4. **Build SettingsPage**
   - Default model selection
   - Default autonomy level
   - Theme (light/dark/system)
   - Editor command
   - Worktree auto-cleanup interval
   - Claude CLI path override

5. **Keyboard shortcuts**
   - Adapt useKeyboardShortcuts from Pluribus
   - Cmd/Ctrl+N: new session
   - Cmd/Ctrl+W: close session
   - Cmd/Ctrl+Enter: send message
   - Cmd/Ctrl+K: command palette (stretch)
   - Esc: cancel streaming / close modal

6. **Dark mode**
   - TailwindCSS dark class strategy
   - System preference detection
   - Toggle in settings

7. **Performance optimization**
   - Virtualized message list (react-window or tanstack-virtual) for long sessions
   - Debounced streaming state updates
   - Lazy load non-critical components

8. **Cross-platform testing**
   - Linux: primary target, test on Arch/Ubuntu
   - macOS: secondary, test on Apple Silicon
   - Windows: stretch, document known issues

9. **Production packaging**
   - `bun run tauri build`
   - App icon, window title, about dialog
   - Onboarding flow for first launch
   - Auto-updater configuration (stretch)

**Acceptance Criteria**:
- Autonomy levels work: ask prompts for everything, supervised prompts for writes, autonomous runs freely
- Settings persist across restart
- Keyboard shortcuts functional
- Dark mode renders correctly
- Production build: `bun run tauri build` produces distributable binary
- Binary runs on a fresh machine with claude CLI installed

**Quality Gate**:
- Test all 3 autonomy levels end-to-end
- Production binary < 15 MB
- Launch-to-interactive < 1 second
- No console errors in production build

---

## Success Criteria (Must-Have for MVP)

### Functional Requirements
- Single and multi-session chat with Claude Code CLI
- Streaming markdown rendering with tool call cards
- Session persistence across app restart
- Git worktree isolation per session
- Project management (open, list, configure)
- Cost tracking per session and aggregate
- Basic autonomy levels (at minimum: autonomous mode)

### Technical Requirements
- TypeScript strict mode
- Zustand for UI state, Drizzle ORM for persistence
- NDJSON parser with 90%+ test coverage
- Single binary distribution (Tauri build)
- SQLite, no external services
- Cross-platform (Linux minimum, macOS stretch)

### Quality Requirements
- App startup < 1 second
- Streaming latency < 100ms
- < 200 MB memory with 4 sessions
- No orphaned claude processes after session cleanup

---

## Out of Scope (Future Versions)

- Code editor / IDE features
- AI-powered code suggestions (beyond what Claude CLI provides)
- Collaborative multi-user editing
- Cloud sync / remote storage
- Plugin marketplace
- Custom MCP server creation UI
- Workflow DAG engine (the old Pluribus)
- Docker-based isolation (worktrees replace this)
- Voice input
- Mobile companion app

---

## Dependencies & Assumptions

### System Dependencies

**Development:**
- Bun — JS runtime, package manager, test runner, script executor (already used throughout Pluribus)
- Rust toolchain (cargo, rustc) for Tauri Rust core

**Runtime:**
- Claude Code CLI installed and in PATH
- Git installed (for worktrees)
- User has active Claude Code subscription

### Development Commands (Bun-Powered)

All frontend tooling runs through Bun. Tauri's CLI hooks into Bun for the frontend dev server and build.

```bash
# Development
bun install                       # Install all frontend dependencies
bun run tauri dev                 # Start Tauri dev mode (Rust + Vite + WebView)
bun run dev                       # Start Vite frontend only (for UI work without Rust)

# Testing
bun run test                      # Run Vitest suite
bun run test -- --run             # Single run (no watch)
bun run test -- --coverage        # With coverage report

# Quality
bunx tsc --noEmit                 # TypeScript check
bun run lint                      # ESLint

# Production
bun run tauri build               # Build distributable binary (Rust + frontend)
bun run build                     # Build frontend assets only
```

**Why Bun everywhere?** Bun is already the standard across Pluribus (see CLAUDE.md). Using it for the desktop app too means:
- One package manager and lockfile format
- Consistent `bun run` / `bun test` commands
- Fast dependency installs (~3x faster than npm)
- Native TypeScript execution for scripts and tooling
- No Node.js required as a separate dependency

### Assumptions

1. Claude CLI `--output-format stream-json` format is stable across patch versions
2. Claude CLI `--verbose` enables stream events (content_block_delta)
3. Agent Teams experimental feature is available in current Claude CLI
4. Git worktrees work reliably on Linux, macOS, Windows
5. Tauri 2.0 plugins (shell, sql, fs) are production-ready
6. SQLite handles concurrent reads from multiple sessions without locking issues
7. Existing Pluribus frontend components work with React 19 in Tauri WebView

---

## Project Structure

See `docs/architecture-desktop.md` Section 2 for the complete directory structure.

Key directories:
- `src-tauri/src/` — Rust core (process manager, worktree manager, IPC commands)
- `src/` — React frontend (replaces current `frontend/src/` for the desktop app)
- `src/db/` — Drizzle schema + sqlite-proxy client
- `src/ipc/` — Type-safe Tauri IPC wrappers (replaces `src/api/`)
- `src/stores/` — Zustand stores (session, chat, team, settings)
- `src/components/chat/` — Chat interface components
- `src/components/session/` — Session management components
- `src/components/team/` — Agent Teams components
- `src/components/diff/` — Diff review components

---

## Next Steps

After plan approval:
1. **Phase 1 Start**: Initialize Tauri 2.0 project with React + Vite template
2. **Foundation**: Set up SQLite schema, Rust ProcessManager, NDJSON parser
3. **Critical Path**: End-to-end: type message -> see streaming response -> tool calls render
4. **Quality Gate**: Manual E2E test before proceeding to Phase 2
5. **Continuous Documentation**: Update `do.md` with implementation log

**Ready to proceed?** Waiting for user confirmation to start Phase 1.

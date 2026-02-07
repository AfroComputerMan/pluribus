# Brainstorming: Pluribus Desktop Pivot

> **Date:** 2026-02-08
> **Status:** Requirements Discovery Complete → Architecture Designed

## Vision

Pivot Pluribus from a backend workflow orchestration system into a **native desktop chat application** that provides a visual interface for orchestrating AI coding agents. The app wraps the Claude Code CLI to leverage the user's existing subscription, presenting agent interactions as chat sessions with full orchestration capabilities — team building, task boards, worktree-based isolation, and diff review.

**Category:** Agent Orchestrator (like Conductor/Codex App, NOT an IDE like Cursor)

---

## Research: Claude Code Agent SDK & CLI

### Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

The SDK provides `query()` — the same agent loop powering Claude Code CLI — as a programmatic TypeScript API.

| SDK Feature | What It Enables |
|---|---|
| `query()` streaming | Real-time typed messages from the agent |
| `resume` (session ID) | Persistent conversations |
| `agents` option | Define subagent teams programmatically |
| `canUseTool` callback | Custom permission UI |
| Hooks (`PreToolUse`, `SubagentStart`, etc.) | Real-time monitoring |
| `outputFormat` (JSON schema) | Structured outputs for rich UI |
| `mcpServers` option | Configure tools per conversation |
| V2 `send()`/`stream()` API | Maps perfectly to chat send/receive |
| `SDKResultMessage` | Cost tracking (`total_cost_usd`) |

### Agent Teams (CLI Feature, Research Preview)

Agent Teams enables multiple Claude Code instances working as a coordinated team:

| Component | Role |
|---|---|
| Team Lead | Main session that coordinates |
| Teammates | Separate instances, each with own context |
| Task List | Shared at `~/.claude/tasks/{team-name}/` |
| Mailbox | Messaging at `~/.claude/teams/{team}/inboxes/{agent}.json` |

Enabled via: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` environment variable.

### CLI Output Format (`--output-format stream-json`)

NDJSON (newline-delimited JSON) with these message types:

1. **SystemMessage** (init): `session_id`, `model`, `tools`, `mcp_servers`
2. **AssistantMessage**: `content[]` with `text`, `tool_use`, `thinking` blocks + `usage`
3. **UserMessage**: `tool_result` blocks (tool execution results)
4. **StreamEvent** (with `--verbose`): Token-by-token `content_block_delta` events
5. **ResultMessage** (final): `total_cost_usd`, `duration_ms`, `num_turns`, `modelUsage`

Key CLI flags: `--print`, `--output-format stream-json`, `--verbose`, `--resume <id>`, `--allowedTools`, `--max-turns`, `--max-budget-usd`, `--permission-prompt-tool`

### Decision: CLI Wrapper Over SDK for MVP

The SDK requires an Anthropic API key with billing. By wrapping the `claude` CLI with `--output-format stream-json`, we piggyback on the user's existing Claude Code subscription (same approach as Conductor and Codex App). Zero API key friction.

---

## Research: Competitive Landscape

### Two Product Categories

| Category | Examples | Description |
|---|---|---|
| **Full IDEs** | Cursor, Windsurf, Zed, Aide | Code editor + AI integrated |
| **Agent Orchestrators** | Conductor, Codex App, Claudia, Crystal | Manage agents visually, review diffs |

Pluribus Desktop falls into **Agent Orchestrators**.

### Conductor (by Melty Labs)
- macOS native app, uses Claude Code SDK
- Dashboard showing all agent threads simultaneously
- **Diff-first review** (like reviewing a PR)
- Automatic **git worktree** isolation per agent thread
- Works with Claude Code and OpenAI Codex API keys
- Free, one-time download

### Codex App (by OpenAI)
- macOS native app (Apple Silicon), Rust core
- **App Server** with JSON-RPC-over-stdio protocol (decouples agent from UI)
- **Items event model**: `item/started` → `item/*/delta` → `item/completed`
- **Skills system** for reusable agent capabilities
- Thread-per-project with worktree isolation
- Agents run up to 30 minutes independently

### Cursor 2.0
- Electron (VS Code fork), $29.3B valuation
- **Agent Layout**: Left (agent sidebar) + Center (AI reasoning) + Right (code diffs)
- **Grouped diff review** (all changes in one tab, like PR review)
- **Background Agents** persist across sessions
- Up to 8 parallel agents via worktrees/sandboxes

### Zed
- 100% Rust, custom GPU framework (GPUI), 120 FPS
- **Multibuffer review** (all agent edits in single reviewable view)
- **Agent following** (viewport tracks agent's work in real-time)
- `@` mentions for files/symbols/threads

### Claudia (Tauri 2 + React)
- Desktop GUI for Claude Code with session versioning
- **Session checkpoints** with visual timeline navigation
- Session forking with diff viewer
- Built with Tauri 2 + React 18 + TypeScript + Rust

### Common UX Patterns

1. **Diff-first review** — all changes in one panel (Cursor, Zed, Conductor)
2. **Session/Agent sidebar** — list with status indicators
3. **Git worktree isolation** — standard for parallel agents
4. **Tool call cards** — collapsible action display
5. **Streaming markdown** rendering
6. **Three-level autonomy** — ask / assisted / autonomous
7. **Cost tracking** — per-session token and dollar amounts

---

## Research: Desktop Framework Comparison

| Criteria | Tauri 2.0 | Electron | Swift Native |
|---|---|---|---|
| Bundle size | 3-10 MB | 50-150 MB | 5-15 MB |
| Memory (idle) | 30-40 MB | 200-300 MB | 10-20 MB |
| React/TS reuse | Full | Full | None |
| Cross-platform | Yes | Yes | macOS only |
| Process spawning | Good (plugin) | Excellent | Excellent |
| Precedent apps | opcode, Claudia | Cursor, Crystal | — |

### Decision: Tauri 2.0

1. **Proven**: opcode and Claudia are production Tauri 2 apps wrapping Claude Code
2. **Resource efficiency**: 30-40 MB vs 200-300 MB matters when running 4-8 concurrent agent sessions
3. **React reuse**: Existing Pluribus frontend (React 19, Vite, TailwindCSS v4, React Query) maps directly
4. **Cross-platform**: Linux, macOS, Windows from single codebase
5. **Rust is thin**: ~500-1000 LOC for process management + IPC, all app logic stays in TypeScript

---

## Research: Existing Pluribus Codebase Reuse

**Reusability Score: ~60-70%** — substantial infrastructure is salvageable.

### Tier 1: Drop-in Reuse
- Credential vault (AES-256-GCM encryption)
- MCP integration (tool discovery, execution, all transports)
- Error hierarchy (AppError, ValidationError, NotFoundError, etc.)
- Cost tracking logic and pricing tables
- Frontend: Button, StatusBadge, DataTable, JsonViewer, CostTrackingPanel
- React Query config, Zustand store patterns, keyboard shortcuts hook

### Tier 2: Adapt with Minor Changes
- Agent model (remove isolation levels, keep skills/tools/model config)
- Claude Code adapter (port spawn + NDJSON parse logic to Rust)
- API client pattern (replace `fetch()` → Tauri `invoke()`)
- SSE hooks (replace `EventSource` → Tauri `Channel<T>`)

### Tier 3: Salvage Patterns Only
- Service architecture (types → schemas → service → repository)
- Event publishing system (repurpose for chat messages)
- Queue workers (convert to message handlers)

### Tier 4: Cannot Reuse
- Hono API server, PostgreSQL, Redis, BullMQ
- DAG workflow engine, WorkflowCanvas, NodePalette
- Docker runtime, trigger/scheduler system

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Agent engine | CLI wrapper (not SDK) | Uses existing Claude Code subscription, no API key friction |
| Orchestration level | Full (team builder + task board + chat) | Maximum value for agent coordination |
| Session isolation | Git worktrees | Standard pattern (Conductor, Cursor, Codex all use this) |
| Backend | Pure Tauri (no separate server) | Single binary, SQLite, simplest deployment |
| Desktop framework | Tauri 2.0 | Lightweight, React-compatible, proven for this exact use case |
| Database | SQLite via Drizzle ORM | Zero config, embedded, type-safe queries |
| IPC streaming | Tauri Channels | Per-session scoping, high throughput, no global event fan-out |

---

## Requirements Summary

### Functional
- **FR-1**: Chat interface with streaming markdown, tool call cards, diff display
- **FR-2**: Worktree-based session isolation with resume/pause
- **FR-3**: Agent Teams orchestration (team builder, task board, agent status)
- **FR-4**: Diff-first code review (accept/reject per file)
- **FR-5**: Project/repository management
- **FR-6**: Permission control (three autonomy levels)
- **FR-7**: Cost and usage tracking per session

### Non-Functional
- App startup < 1s, streaming latency < 100ms
- Support 4-8 concurrent sessions
- Memory < 200 MB (app only, agents are separate)
- Linux primary, macOS secondary, Windows stretch
- SQLite, no external services, single binary

### User Stories
- US-1: Chat with Claude Code agent via visual interface
- US-2: Run multiple agents on same repo in parallel worktrees
- US-3: Create Agent Team and see all teammates' progress
- US-4: Review all code changes in grouped diff view
- US-5: Merge agent's worktree back to main branch
- US-6: Approve/deny tool requests with autonomy levels
- US-7: Track costs per session and overall
- US-8: Works with existing Claude Code subscription (no API key)

---

## Next Steps

See `docs/architecture-desktop.md` for the full architecture design and implementation plan.

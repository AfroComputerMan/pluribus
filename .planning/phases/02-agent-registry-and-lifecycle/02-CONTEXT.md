# Phase 2: Agent Registry and Lifecycle - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Central registry for spawning, tracking, and managing multiple agents with persistence and concurrency controls. Users can spawn multiple agents simultaneously, each with its own working directory and status. This phase delivers the AgentRegistry, concurrency governor, push-based status tracking, per-thread working directory scoping, and the extended SQLite schema for multi-agent state. Streaming, intervention controls, and multi-agent UI are separate phases.

Requirements: ORCH-01, ORCH-02, ORCH-03, ORCH-08, PERS-01, PERS-02, PERS-03

</domain>

<decisions>
## Implementation Decisions

### Concurrency limit behavior
- Fixed limit of 5 concurrent agents (hardcoded, not user-configurable)
- When hitting the limit, agent enters a 'queued' state with a toast: "5 agents running -- this one will start when a slot opens"
- Queued agents can be cancelled before they start
- When a slot opens and a queued agent starts, show a toast notification: "Agent [name] started (was queued)"

### Agent recovery on restart
- On app restart, previously-running agents are marked as 'error' with a 'process lost' indicator (Phase 1 already kills orphan processes on startup)
- Crashed/errored agents can be restarted from the UI -- a 'Restart' action spawns a fresh process in the same working directory, resuming the session if possible
- Completed agents auto-archive after 7 days (removed from active list, still in DB)

### Working directory selection
- Native Tauri file picker dialog for directory selection (tauri-plugin-dialog)
- Always require explicit directory selection -- no default working directory
- Multiple agents can share the same working directory with no restrictions or warnings
- Agent display name auto-generated from the directory name (e.g., 'pluribus', 'my-api') -- can be renamed later

### Status lifecycle
- Five statuses: running, error, waiting-approval, completed, queued (dropped 'idle' -- simpler model)
- Completion triggered by agent self-reporting (provider detects task completion signal)
- Completed agents can be reactivated -- sending a new message restarts the process and resumes the session, status returns to 'running'
- Error state shows status badge only -- user clicks into the thread to see error details in conversation history

### Testing approach
- Test-driven development for this phase -- write tests before implementation
- Focus on registry operations (spawn, kill, query), concurrency governor, and status transitions

### Claude's Discretion
- Internal AgentRegistry data structures and API design
- Zustand store shape for agent status tracking
- SQLite schema design for multi-agent state (tables, columns, migrations)
- WAL mode enablement and write serialization implementation
- Queue ordering strategy (FIFO assumed, but implementation details flexible)
- Auto-archive implementation (cron-like check vs on-app-startup cleanup)
- How session resume works during restart (provider-specific behavior)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `thread-status-store.ts`: Zustand store for per-thread status -- extend with new statuses (queued, waiting-approval, completed) and richer state
- `db.ts`: SQLite persistence layer with migration system -- add new migration for agent registry table(s)
- `codex-approval-store.ts`: Existing approval flow store -- integration point for waiting-approval status
- `models.ts`: Model registry with `isCodexModel()` -- used by OrchestratedAdapter for routing

### Established Patterns
- `ChatModelAdapter` async generator pattern from assistant-ui -- registry must coordinate with this
- OrchestratedAdapter routes by model to Agent SDK or Codex provider -- registry sits above this
- Static ProviderRegistry -- providers registered at startup in code
- Process PIDs tracked via `onProcessStarted` callback, persisted to SQLite
- Tauri `dialog.open()` for native file picker (tauri-plugin-dialog already in use for exit confirmation)
- SQLite via `tauri-plugin-sql` for all persistence, namespaced `db.*` pattern

### Integration Points
- `RuntimeProvider.tsx`: Wire registry into the runtime setup
- `OrchestratedAdapter`: Needs registry awareness for spawn/status coordination
- `AgentProcessManager` (from Phase 1): Registry delegates process lifecycle to this
- `db.ts`: New migration for agent state table (provider type, working directory, status, timestamps)
- `src-tauri/migrations/`: New SQL migration file(s)

</code_context>

<specifics>
## Specific Ideas

- Agent naming from directory name keeps things low-friction -- user just picks a folder and goes
- Toast notifications for queue events (both "queued" and "started from queue") give enough feedback without interrupting flow
- Error recovery via restart button in the thread, not a separate management UI
- 7-day auto-archive for completed agents keeps the active list clean without losing history

</specifics>

<deferred>
## Deferred Ideas

- Configurable concurrency limit in settings -- can add later if users need it
- "Warn on shared working directory" -- decided against, but could add as a setting
- Agent templates/presets for common configurations -- future version
- Per-agent dev event scoping (separate buffers per agent) -- noted in Phase 1 deferred, still deferred
- Auto-resume on restart (vs current mark-as-crashed approach) -- could add when providers support it better

</deferred>

---

*Phase: 02-agent-registry-and-lifecycle*
*Context gathered: 2026-03-06*

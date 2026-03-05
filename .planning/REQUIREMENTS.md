# Requirements: Pluribus

**Defined:** 2026-03-05
**Core Value:** Run multiple AI agents simultaneously across repos and have full control over every one of them

## v1.0 Requirements

Requirements for milestone v1.0: Multi-Thread Agent Orchestration.

### Provider Abstraction

- [x] **PROV-01**: Unified AgentProvider interface with standardized lifecycle (start, stop, cleanup, status)
- [x] **PROV-02**: Agent SDK provider implementation (replaces Claude CLI adapter entirely)
- [x] **PROV-03**: Codex server provider implementation (refactored from existing Codex adapter)
- [x] **PROV-04**: Process group management with cleanup on app exit and crash recovery
- [x] **PROV-05**: Orphan process detection and cleanup on app startup
- [x] **PROV-06**: Remove Claude CLI adapter and sh -c shell wrapper from codebase
- [x] **PROV-07**: Per-agent config isolation (separate config directories/environments)

### Agent Orchestration

- [ ] **ORCH-01**: AgentRegistry as central hub for all agent lifecycle operations (spawn/kill/query)
- [ ] **ORCH-02**: Concurrency governor with configurable max concurrent agents (default 5)
- [ ] **ORCH-03**: Push-based agent status tracking via Zustand (running/idle/error/waiting-approval/completed)
- [ ] **ORCH-04**: Multiplexed real-time output streaming from N concurrent agents
- [ ] **ORCH-05**: IPC streaming backpressure with batched event delivery (50ms windows)
- [ ] **ORCH-06**: Per-agent tool call approve/reject with diff preview
- [ ] **ORCH-07**: Per-agent pause/resume controls
- [ ] **ORCH-08**: Per-thread working directory scoping

### Multi-Agent UI

- [ ] **MAUI-01**: Agent overview showing all agents with real-time status indicators
- [ ] **MAUI-02**: Drill-down from overview to full agent thread view (assistant-ui runtime per pane)
- [ ] **MAUI-03**: Resizable split-pane layout for viewing 2-4 agents simultaneously
- [ ] **MAUI-04**: Desktop notifications on agent completion, error, and approval-needed
- [ ] **MAUI-05**: Agent status indicators (running/idle/error/waiting-approval/completed) with visual differentiation

### Persistence

- [ ] **PERS-01**: Extended SQLite schema for multi-agent state (provider type, working directory, agent status per thread)
- [ ] **PERS-02**: WAL mode enabled for concurrent write safety
- [ ] **PERS-03**: Write serialization through single-writer pattern for high-contention paths

## Future Requirements (v1.1+)

### Dashboard & Workspaces

- **DASH-01**: Dashboard overview showing all workspaces, active agents, and recent activity
- **DASH-02**: Workspace management — create, configure, and group repos into workspaces
- **DASH-03**: Workspace-level MCP server configuration with per-thread overrides (inherit + customize)

### Fire-and-Forget

- **FF-01**: Fire-and-forget mode — launch agents, get notified on completion or errors
- **FF-02**: Fire-and-forget inbox with results review

### Power User

- **PWR-01**: Cost/token tracking aggregated across agents and providers
- **PWR-02**: Keyboard-driven command palette (Cmd+K)
- **PWR-03**: Agent templates for reusable configurations

## Out of Scope

| Feature | Reason |
|---------|--------|
| Claude CLI adapter | Dropped in favor of Agent SDK — CLI has concurrent session corruption, global config races, and shell security issues |
| Visual workflow/DAG builder | Let Claude Code handle sub-task DAGs internally |
| Built-in code editor | Pluribus is a command center, not an IDE |
| Cloud sync / team collaboration | Local-only for v1 |
| Agent-to-agent communication | Use sequential handoff; real-time cross-agent messaging adds complexity without clear value |
| Checkpoint/rollback via git worktrees | High complexity, defer to v2+ |
| Mobile app | Desktop-first (Tauri) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROV-01 | Phase 1 | Complete |
| PROV-02 | Phase 1 | Complete |
| PROV-03 | Phase 1 | Complete |
| PROV-04 | Phase 1 | Complete |
| PROV-05 | Phase 1 | Complete |
| PROV-06 | Phase 1 | Complete |
| PROV-07 | Phase 1 | Complete |
| ORCH-01 | Phase 2 | Pending |
| ORCH-02 | Phase 2 | Pending |
| ORCH-03 | Phase 2 | Pending |
| ORCH-04 | Phase 3 | Pending |
| ORCH-05 | Phase 3 | Pending |
| ORCH-06 | Phase 3 | Pending |
| ORCH-07 | Phase 3 | Pending |
| ORCH-08 | Phase 2 | Pending |
| MAUI-01 | Phase 4 | Pending |
| MAUI-02 | Phase 4 | Pending |
| MAUI-03 | Phase 4 | Pending |
| MAUI-04 | Phase 4 | Pending |
| MAUI-05 | Phase 4 | Pending |
| PERS-01 | Phase 2 | Pending |
| PERS-02 | Phase 2 | Pending |
| PERS-03 | Phase 2 | Pending |

**Coverage:**
- v1.0 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0

---
*Requirements defined: 2026-03-05*
*Last updated: 2026-03-05 after roadmap creation*

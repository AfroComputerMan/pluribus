# Project Research Summary

**Project:** Pluribus -- AI Agent Mission Control
**Domain:** Multi-agent AI orchestration desktop application
**Researched:** 2026-03-05
**Confidence:** MEDIUM-HIGH

## Executive Summary

Pluribus is pivoting from a single-chat Claude CLI wrapper into a multi-agent orchestration desktop app -- a "mission control" for running multiple AI coding agents (Claude, Codex, and future providers) across multiple repositories simultaneously. The existing codebase already proves the three core adapter patterns (Claude CLI via shell, Claude Agent SDK via Bun sidecar, Codex via Rust-managed process) and has solid persistence via SQLite. The pivot requires four new architectural layers: a unified provider abstraction, a central agent registry for lifecycle management, a workspace model for repo grouping, and a dashboard-first UI. The good news is that the existing stack (Tauri 2, React 19, assistant-ui, SQLite, Zustand) carries forward with minimal additions -- only `react-resizable-panels` is a genuinely new dependency.

The recommended approach is to refactor the existing three adapters into a formal `AgentProvider` interface first, then build the `AgentRegistry` as the central hub for all agent lifecycle operations, then layer workspace management and MCP configuration on top, and finally build the multi-agent dashboard UI. This bottom-up ordering is dictated by hard dependency chains: the dashboard needs the registry, the registry needs providers, and workspace features need the registry for spawn integration. Attempting to build the dashboard before the orchestration layer is a common failure mode in multi-agent projects.

The dominant risks are (1) Claude CLI concurrent session corruption -- the CLI was designed for single-instance use and corrupts shared config files when multiple instances run simultaneously, (2) orphaned child processes consuming gigabytes of RAM after app crashes, and (3) assistant-ui's assumption of a single active thread conflicting with the multi-pane agent views. All three must be addressed in Phase 1, not deferred. The Agent SDK path avoids the CLI corruption issue entirely, making it the preferred engine for multi-agent use. The CLI path should be treated as a fallback with enforced concurrency limits.

## Key Findings

### Recommended Stack

The existing stack is retained unchanged. New additions are minimal because the codebase already has the right foundations. The key architectural decision is managing processes from two channels: Rust-side Tokio processes for providers needing fine-grained control (Codex, future CLI-based providers), and the existing Bun sidecar with NDJSON multiplexing for the Agent SDK. No third-party orchestration framework is needed -- `tokio::process::Command` and the existing sidecar pattern are sufficient.

**Core technologies (new or expanded):**
- **Custom Rust ProcessManager (Tokio):** Generalize the existing CodexService pattern into a central process supervisor with cleanup, health checks, and orphan prevention
- **`react-resizable-panels`:** Split-pane layouts for the dashboard; already wrapped by shadcn/ui's Resizable component
- **Zustand v5 (expanded):** New stores for workspace state, agent registry, and dashboard view state; entity-map pattern (`Record<ThreadId, AgentState>`) for tracking N agents
- **Agent SDK V1 `query()` API:** Preferred engine for multi-agent; V2 is still unstable (watch for mid-2026 stabilization)

**Explicitly rejected:** LangChain/LangGraph (wrong abstraction level), Redux (unnecessary boilerplate), Jotai (poor fit for entity maps), `react-grid-layout` (overkill), xterm.js (evaluate later only if structured rendering is insufficient).

### Expected Features

**Must have (table stakes -- P1):**
- Real-time output streaming per agent (multiplexed across N streams)
- Tool call approval with diff preview and keyboard shortcuts
- Agent lifecycle controls (start, stop, pause, resume)
- Agent status indicators (running/idle/error/waiting-approval/completed)
- Workspace model with repo grouping and per-workspace defaults
- Dashboard overview (grid of agents grouped by workspace)
- Multi-agent simultaneous streaming (2-4 agents in split/tabbed views)
- Working directory scoping per agent
- Desktop notifications on completion/error/approval-needed

**Should have (differentiators -- P2):**
- Fire-and-forget inbox with results review
- MCP configuration UI with workspace inheritance
- Cost/token tracking aggregated across agents and providers
- Keyboard-driven command palette
- Agent templates for reusable configurations

**Defer (v2+):**
- Checkpoint/rollback via git worktrees (high complexity, not core value)
- Cross-provider comparison (needs battle-tested abstraction first)
- Config import from claude_desktop_config.json / .cursor/mcp.json

**Anti-features (explicitly avoid):**
- Visual workflow/DAG builder (let Claude Code handle sub-task DAGs)
- Built-in code editor (Pluribus is a command center, not an IDE)
- Cloud sync / team collaboration (local-only for v1)
- Agent-to-agent real-time communication (use sequential handoff instead)

### Architecture Approach

The architecture is a four-layer stack: UI (Dashboard / Workspace / Agent Thread views), Orchestration (AgentRegistry, WorkspaceManager, McpConfigResolver), Process (AgentProcessManager with per-agent isolation), and Adapter (provider-specific protocol translation). State flows push-based through Zustand stores -- no polling. SQLite is the persistence backbone, Zustand handles UI reactivity, and in-memory Maps hold unserialized process handles.

**Major components:**
1. **AgentRegistry** -- Central hub owning all agent lifecycle state; all spawn/kill/pause/resume operations route through it
2. **AgentProvider interface** -- Common abstraction over Claude Agent SDK, Codex, and future providers; capabilities-based extension for provider-specific features
3. **WorkspaceManager** -- CRUD for workspaces with repo paths, default configs, and MCP server inheritance
4. **McpConfigResolver** -- Three-tier config resolution (global -> workspace -> thread) at agent spawn time
5. **Dashboard/WorkspaceView/AgentThreadView** -- Three-level UI navigation hierarchy replacing the current flat thread list

**Critical architectural decision:** Start with multiplexed sidecar (one Bun process, query-level routing via `queryId`) rather than per-agent sidecars. Lower resource cost, and per-query `cwd` is already supported. Shift to per-agent mode only if isolation issues emerge.

### Critical Pitfalls

1. **Claude CLI concurrent session corruption** -- Multiple CLI instances corrupt `.claude.json` and race on OAuth token refresh. Mitigate by preferring Agent SDK for multi-agent use, enforcing max-concurrent limits on the CLI path, and isolating config directories per agent via `CLAUDE_CONFIG_DIR`.

2. **Orphaned child processes** -- App crashes leave Claude/Codex processes running (270-370MB each). Mitigate with process groups (`command_group` crate), a Rust-side PID registry with cleanup on exit events, and a startup sweep that kills orphans from previous sessions.

3. **assistant-ui single-thread assumption** -- The framework assumes one active thread at a time; multi-pane views cause hook conflicts. Mitigate by instantiating one runtime per visible agent pane, using assistant-ui only for interactive drill-down views, and building the dashboard with custom components reading directly from Zustand/SQLite.

4. **Unbounded agent spawning** -- No governor means users can exhaust system resources. Mitigate with a hard cap on concurrent running agents (default 5), IPC streaming backpressure, and resource usage display in the dashboard.

5. **Shell security escalation** -- The `sh -c` wrapper with `"args": true` grants unrestricted shell access from the webview; multi-agent multiplies blast radius. Mitigate by replacing with direct `Command.create("claude", [...args])` and removing the `sh` entry from Tauri capabilities before multi-agent ships.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Provider Abstraction and Foundation Hardening
**Rationale:** Everything depends on a clean provider interface. The existing 1900-line claude-adapter.ts must be decomposed. Security and process cleanup must be addressed before multi-agent amplifies the blast radius.
**Delivers:** Unified `AgentProvider` interface, refactored adapters, direct CLI invocation (no `sh -c`), process cleanup on exit, orphan detection on startup.
**Addresses:** Multi-provider support (table stakes), shell security hardening.
**Avoids:** Claude CLI concurrent corruption (concurrency guard in CLI provider), orphaned processes (cleanup in provider interface), shell security escalation (direct invocation).

### Phase 2: Agent Registry and Multi-Agent Orchestration
**Rationale:** With providers abstracted, the central registry can manage N agents. This is the core new capability that defines the product pivot.
**Delivers:** AgentRegistry (hub-and-spoke lifecycle management), concurrency governor (max 5 default), push-based status via Zustand, multi-agent streaming with IPC batching.
**Addresses:** Agent lifecycle controls, agent status indicators, multi-agent streaming, concurrent agent management.
**Avoids:** Unbounded resource exhaustion (governor), state desynchronization (push-based Zustand), UI jank from multiple streams (IPC batching at 50ms windows).

### Phase 3: Workspace Model and Persistence
**Rationale:** Workspaces are the organizational unit that makes the dashboard meaningful. Without them, the dashboard is just a flat thread list. Requires the registry (Phase 2) for spawn integration.
**Delivers:** Workspace CRUD, repo path associations, workspace-scoped defaults, working directory scoping per agent, extended SQLite schema.
**Addresses:** Workspace model, working directory scoping, thread/agent persistence.

### Phase 4: Dashboard and Multi-Agent UI
**Rationale:** The dashboard is the product's primary differentiator but depends on everything below it (providers, registry, workspaces). Building it last ensures it has real data to display.
**Delivers:** Dashboard overview (agent grid by workspace), WorkspaceView (agent management within a workspace), resizable split-pane agent views, fire-and-forget status tracking, desktop notifications.
**Addresses:** Dashboard overview, fire-and-forget mode, desktop notifications, notification batching.
**Uses:** `react-resizable-panels` for split-pane layouts, Zustand stores for reactive status display.

### Phase 5: MCP Configuration and Inheritance
**Rationale:** MCP management is high-value but high-complexity. Requires workspaces (Phase 3) for the inheritance model. Separate phase because MCP server lifecycle management (reference counting, health checks, shared vs. per-thread instances) is a distinct concern.
**Delivers:** MCP config UI, three-tier inheritance (global -> workspace -> thread), Rust-side MCP server lifecycle management, health checks and auto-restart.
**Avoids:** MCP server lifecycle mismanagement (reference counting, idle timeouts).

### Phase 6: Polish and Power User Features
**Rationale:** These features enhance the core experience but are not required for the product to be useful.
**Delivers:** Command palette (Cmd+K), cost/token tracking, agent templates, keyboard-driven navigation.

### Phase Ordering Rationale

- Phases 1-2 are strictly sequential: the registry cannot exist without the provider interface.
- Phase 3 (workspaces) depends on Phase 2 (registry) for spawn integration but could partially overlap with late Phase 2 work.
- Phase 4 (dashboard UI) depends on Phase 3 (workspaces for grouping) but the basic agent grid could start during Phase 3 with flat thread lists.
- Phase 5 (MCP) is deliberately separated from Phase 3 because MCP server lifecycle is a complex problem domain that should not block the workspace + dashboard delivery.
- The architecture research and pitfalls research strongly agree on this ordering: foundation first, orchestration second, UI on top.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** Needs investigation into `CLAUDE_CONFIG_DIR` support (does Claude CLI honor it?), and the exact process group cleanup mechanism for each platform (Linux/macOS/Windows).
- **Phase 5:** MCP server lifecycle management is sparsely documented for multi-client scenarios. The reference counting and shared-instance patterns need prototyping before committing to a design.

Phases with standard patterns (skip research-phase):
- **Phase 2:** Hub-and-spoke registry is a well-documented pattern. Zustand entity maps are straightforward.
- **Phase 3:** Workspace CRUD and SQLite schema extension are standard application development.
- **Phase 4:** Dashboard UI with `react-resizable-panels` and Zustand subscriptions follows established React patterns.
- **Phase 6:** Command palette and cost tracking are well-trodden features.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Minimal new dependencies; existing stack proven in codebase. Agent SDK V1 is stable. Only uncertainty is xterm.js (deferred). |
| Features | HIGH | Thorough competitor analysis (Cursor 2.0, Claude Code, Cline, Windsurf, Augment). Feature priorities grounded in market positioning. |
| Architecture | MEDIUM-HIGH | Layered architecture is sound and maps to existing codebase patterns. The multiplexed-vs-per-agent sidecar decision may need revisiting under load. |
| Pitfalls | HIGH | Grounded in documented GitHub issues (Claude CLI corruption, Tauri process kill bugs) and existing codebase analysis. Concrete, actionable mitigations. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Claude CLI config isolation:** It is unclear whether `CLAUDE_CONFIG_DIR` is a supported environment variable. If not, the CLI path may require a file-locking wrapper or be limited to a single concurrent instance. Validate during Phase 1 implementation.
- **Agent SDK 12s cold-start:** Each SDK `query()` call incurs ~12s overhead. For interactive multi-agent use this is noticeable. No known workaround. Monitor the SDK issue tracker for fixes.
- **assistant-ui multi-runtime memory:** Instantiating one `useLocalRuntime` per visible agent pane may cause memory leaks if runtimes are not properly disposed. Needs profiling during Phase 4 implementation.
- **Multiplexed sidecar under load:** The single-sidecar model has not been tested with 5+ concurrent queries. If query-level multiplexing breaks down, the fallback is per-agent sidecars at higher resource cost. Validate during Phase 2.
- **Windows process cleanup:** Tauri's `child.kill()` is unreliable on Windows (issue #4949). The `command_group` crate may not fully solve this. Windows support may require platform-specific cleanup code.

## Sources

### Primary (HIGH confidence)
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- V1 API, session management
- [Claude Agent SDK V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) -- V2 session API, migration path
- [MCP Lifecycle Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle) -- Server lifecycle protocol
- [Tauri 2 Process Model](https://v2.tauri.app/concept/process-model/) -- Process management architecture
- [assistant-ui Runtime Architecture](https://www.assistant-ui.com/docs/architecture) -- Thread and runtime design

### Secondary (MEDIUM confidence)
- [Claude CLI concurrent session corruption -- GitHub #28829](https://github.com/anthropics/claude-code/issues/28829) -- Documented corruption with concurrent instances
- [Claude CLI OAuth race condition -- GitHub #27933](https://github.com/anthropics/claude-code/issues/27933) -- Token refresh contention
- [Tauri child process kill issue -- GitHub #4949](https://github.com/tauri-apps/tauri/issues/4949) -- Windows process cleanup
- [Claude Agent SDK 12s overhead -- GitHub #34](https://github.com/anthropics/claude-agent-sdk-typescript/issues/34) -- Cold-start performance
- [Cursor 2.0 Changelog](https://cursor.com/changelog/2-0) -- Competitor feature analysis
- [Augment Intent](https://www.augmentcode.com/blog/intent-a-workspace-for-agent-orchestration) -- Competitor architecture
- [Multi-agent workflow failure patterns -- GitHub Blog](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/) -- Orchestration anti-patterns

### Tertiary (LOW confidence)
- [Azure AI Agent Orchestration Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) -- Hub-and-spoke vs mesh (cloud-oriented, adapted for desktop)
- xterm.js evaluation -- Deferred; may not be needed

---
*Research completed: 2026-03-05*
*Ready for roadmap: yes*

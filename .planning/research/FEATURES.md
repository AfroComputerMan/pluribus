# Feature Research

**Domain:** AI Agent Orchestration Desktop App (Mission Control)
**Researched:** 2026-03-05 (updated)
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in any multi-agent coding tool. Missing these and the product feels broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Real-time output streaming per agent | Every coding agent tool (Claude Code, Cursor, Cline, Aider) streams output live. Users will not wait for batch results. | MEDIUM | Pluribus already has streaming for single threads via assistant-ui. Needs multiplexing across N simultaneous streams without UI jank. Use virtualized rendering for inactive agents -- only the focused agent gets full DOM rendering, background agents get lightweight status updates. |
| Tool call approval / human-in-the-loop | Cline's core UX: every file edit shows a diff, every command requires approval. Claude Code defaults to asking permission. This is the safety contract users expect. | MEDIUM | Already partially built (tool display components exist). Needs: approve/reject buttons with keyboard shortcuts, diff previews for file edits, batch approve for trusted operations. Best practice from HITL research: define clear approval criteria -- only require confirmation for actions with meaningful consequences. Implement timeouts for unattended approvals (auto-reject or escalate after configurable period). |
| Agent lifecycle management (start/stop/pause) | Cursor 2.0 and Windsurf both let you spin up, pause, and terminate agents. Basic process control is assumed. | MEDIUM | Maps to process lifecycle in Tauri shell/sidecar. Pause = interrupt stdin stream + persist state checkpoint. Stop = SIGTERM + cleanup. Resume = restore from checkpoint without replaying prior work. AG-UI protocol defines 5 event categories: Lifecycle, Text Messages, Tool Calls, State Management, Special events -- follow this mental model. |
| Agent status indicators | Every dashboard tool shows running/idle/error/completed states. Users managing multiple agents need status at a glance. | LOW | Color-coded badges or icons. Map to process states: spawning, running, waiting-for-approval, paused, completed, errored. UX standard from orchestration tools: use verb phrases like "Searching files," "Editing code," "Waiting for approval" not just status dots. |
| Thread/agent history and persistence | Existing Pluribus has SQLite persistence for threads. Users expect to close the app and resume where they left off. | LOW | Already built. Extend schema for workspace association and multi-agent metadata (provider, working directory, MCP config). |
| Working directory scoping per agent | Claude Code, Aider, Cline all operate within a specific directory context. Each agent needs its own cwd. | LOW | Pass cwd to Tauri Command.create(). Store in thread metadata. |
| Multi-provider support | The market has fragmented: Claude Code, Codex, Cursor agents, Windsurf Cascade. Users pick tools per task. Pluribus already supports 3 backends. | HIGH | Existing adapter pattern (Claude CLI, Agent SDK, Codex) is the foundation. Needs a unified provider abstraction with consistent lifecycle hooks (start, stream, interrupt, resume, getStatus). |
| Markdown and code rendering in output | Every coding agent renders markdown, syntax-highlighted code, and diffs. | LOW | Already built via assistant-ui and existing components. |
| Notification on agent completion/error | When running fire-and-forget agents, users need to know when something finishes or breaks. Cursor background agents notify on PR creation; Claude Code tasks notify on completion. | LOW | Desktop notifications via Tauri notification plugin. In-app toast/badge system. Notification should include agent name, workspace, and a one-line result summary. |
| Concurrent agent output display | Users running 2-5 agents need to see output from multiple agents simultaneously without constant switching. AgentBase, Cursor Mission Control, and Antigravity all support this. | HIGH | Three display modes needed: (1) **Grid/card overview** -- all agents visible with truncated last output; (2) **Split pane** -- 2-3 agents side-by-side with scrollable output; (3) **Focused single** -- one agent full screen with sidebar list. Users toggle between these. Default to grid overview, drill into focused view on click. |

### Differentiators (Competitive Advantage)

Features that set Pluribus apart. These are where the product competes.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Dashboard-first multi-agent overview | Cursor 2.0 has Mission Control sidebar; AgentBase has a visual canvas; Augment Intent has a coordinator view. But no standalone desktop app gives you a dedicated dashboard across multiple repos and providers simultaneously. This is the core value proposition. | HIGH | Grid layout showing all active agents with live status, last output preview, and workspace grouping. Progressive disclosure: card shows status + last line of output, expand for recent history, click for full thread view. Think macOS Mission Control but for AI agents. |
| Unified approval command center | AgentBase has a "Command Center" for handling pending approvals from multiple agents in one place. No other tool centralizes approval across providers. When running 5+ agents, checking each one for pending approvals is the pain point. | MEDIUM | Aggregate all pending approval requests across all agents into one view. Show: agent name, tool call type, diff preview, approve/reject buttons. Keyboard-navigable (j/k to move between requests, y/n to approve/reject). Badge count on dashboard shows total pending approvals. This is the killer feature for multi-agent workflows. |
| Workspace model (repo grouping) | No existing tool lets you group repos into logical workspaces (monorepo, microservices cluster) and manage agents across them. Cursor works per-project; Claude Code works per-directory. | MEDIUM | Data model: Workspace -> repos (paths) -> agent threads. Workspace-level defaults (MCP config, provider preferences) inherited by threads. |
| Fire-and-forget with async results | Claude Code has background/headless mode but no GUI. Cursor has background agents but tied to their cloud VMs. Pluribus can offer local fire-and-forget with a results inbox. | MEDIUM | Launch agent with a prompt, minimize/ignore it. Agent runs to completion or hits an approval gate. Results appear in dashboard with diff summary. Key UX: "inbox" pattern for completed agents needing review. |
| MCP configuration with inheritance | Claude Code uses CLAUDE.md for project config. Codex uses config.toml. No tool provides a visual MCP configuration UI with workspace-level defaults and per-thread overrides. | HIGH | Three-tier config: global defaults -> workspace defaults -> thread overrides. Visual editor for MCP server definitions (command, args, env). Show effective config with override indicators. |
| Cross-provider agent comparison | Run the same task with Claude Code and Codex side-by-side to compare results. No existing tool supports this because they are all single-provider. | MEDIUM | Same prompt, different provider, diff the outputs. Useful for evaluating which agent handles a task better. Builds on multi-provider support. |
| Cost and token tracking across agents | Claude Code dashboards (Sniffly, claude-code-otel) track costs per session. No tool aggregates costs across multiple agents and providers in one view. | MEDIUM | Parse token usage from agent output streams (Claude CLI reports tokens). Aggregate by workspace, provider, time period. Show cost-per-task estimates. |
| Checkpoint and rollback per agent | Cline has checkpoints. Git worktrees provide isolation. Pluribus can offer visual checkpoint management: snapshot agent state, roll back changes, branch from any checkpoint. | HIGH | Integrate with git: auto-commit before agent runs, tag checkpoints, provide one-click rollback. For worktree isolation: create worktree per agent, merge results back. Heavy git integration. |
| Keyboard-driven power user UX | Cursor and VS Code users expect keyboard shortcuts for everything. A mission control app lives or dies by navigation speed. | MEDIUM | Global hotkeys: switch between agents (Cmd+1-9), approve/reject (y/n), pause (space), new agent (Cmd+N). Command palette (Cmd+K) for all actions. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Visual workflow/DAG builder for agent orchestration | Looks impressive in demos (Augment Intent has coordinator/implementor/verifier). Enterprise orchestration tools use visual DAGs. | Massive complexity for a desktop app. Users want to run agents, not design workflow graphs. Claude Code Tasks already supports DAGs at the CLI level -- Pluribus should consume these, not rebuild them. | Simple "run N agents" with dependency-aware sequencing. Let Claude Code handle internal task DAGs. Pluribus orchestrates at the session level, not the sub-task level. |
| Built-in code editor / IDE features | "If I'm looking at agent output, let me edit code too." Scope creep toward becoming another IDE. | Cursor, VS Code, Windsurf already exist. Competing on editor features is a losing battle. Pluribus is a command center, not an editor. | Deep-link to user's IDE from agent output. "Open in VS Code" buttons. Show diffs read-only but edit in the real editor. |
| Cloud sync / team collaboration | "Share workspaces with my team." Enterprise feature request. | Adds server infrastructure, auth, conflict resolution. Violates local-only constraint. Single-user tool for v1. | Export/import workspace configs as JSON files for manual sharing. |
| Plugin marketplace for MCP servers | "Let me browse and install MCP servers." | Building a marketplace is a product in itself. MCP server discovery is a community problem, not Pluribus's problem. | Manual MCP config with good defaults. Link to community MCP server lists. Import from existing claude_desktop_config.json. |
| Auto-approve everything mode | "I trust the agent, just let it run." Aider and Claude Code both support auto-approve modes. | Dangerous for a multi-agent tool where N agents could all be making destructive changes simultaneously. Risk multiplies with parallelism. | Per-operation-type approval rules (e.g., auto-approve file reads, require approval for shell commands). Tiered trust levels rather than binary on/off. |
| Real-time collaboration between agents | "Agent A should talk to Agent B." Multi-agent communication patterns. | Extremely complex coordination problem. Agent SDKs don't support inter-agent messaging. Would require building a message bus, conflict resolution, shared state. | Sequential handoff: Agent A completes, its output becomes context for Agent B. Manual orchestration by the user, not automatic agent-to-agent communication. |
| Custom AI model hosting | "Let me use my own fine-tuned model." | Pluribus orchestrates CLI tools, not models. Model hosting is infrastructure, not UX. | Support whatever models the underlying CLI tools support (Claude Code, Codex, Aider all handle model selection internally). |
| Real-time everything (all agents streaming at full DOM simultaneously) | "Show me all 10 agents streaming live at once." Looks cool in demos. | DOM rendering of 10 concurrent rich markdown streams will destroy performance. Each stream has code blocks, diffs, tool call displays. React will buckle under the re-render load. | Focused rendering: only 1-2 agents get full live DOM rendering. Others show status + last line preview. Full output available on focus. AgentBase uses this pattern -- visual canvas with zoom-in/zoom-out. |

## Feature Dependencies

```
[Provider Abstraction]
    |-- requires --> [Agent Lifecycle Management]
    |-- requires --> [Streaming Output]
    |-- enables  --> [Cross-Provider Comparison]
    |-- enables  --> [Cost Tracking]
    |-- enables  --> [Dashboard Overview]

[Concurrent Agent Display]
    |-- requires --> [Multi-Agent Streaming]
    |-- requires --> [Agent Status Indicators]
    |-- enables  --> [Dashboard Overview]
    |-- enables  --> [Drill-Down Navigation]

[Dashboard Overview]
    |-- requires --> [Agent Status Indicators]
    |-- requires --> [Concurrent Agent Display]
    |-- enhances --> [Fire-and-Forget Mode]
    |-- enables  --> [Approval Command Center]

[Approval Command Center]
    |-- requires --> [Tool Call Approval UX]
    |-- requires --> [Dashboard Overview] (aggregation point)
    |-- requires --> [Agent Status Indicators] (waiting-for-approval state)

[Tool Call Approval UX]
    |-- requires --> [Streaming Output]
    |-- enhances --> [Agent Lifecycle Management] (pause while waiting)

[Drill-Down Navigation]
    |-- requires --> [Concurrent Agent Display]
    |-- requires --> [Thread/Agent History]
    |-- enhances --> [Tool Call Approval UX] (full context for decisions)

[Workspace Model]
    |-- requires --> [Working Directory Scoping]
    |-- requires --> [Thread/Agent Persistence]
    |-- enables  --> [MCP Config Inheritance]
    |-- enables  --> [Dashboard Grouping]

[Fire-and-Forget Mode]
    |-- requires --> [Notification System]
    |-- requires --> [Agent Lifecycle Management]
    |-- requires --> [Dashboard Overview] (results inbox)

[MCP Config Inheritance]
    |-- requires --> [Workspace Model]
    |-- requires --> [MCP Config UI]

[Checkpoint/Rollback]
    |-- requires --> [Working Directory Scoping]
    |-- requires --> [Git Integration]
    |-- conflicts --> early phases (too complex for MVP)

[Cost Tracking]
    |-- requires --> [Streaming Output] (parse token counts)
    |-- requires --> [Provider Abstraction] (normalize across providers)
```

### Dependency Notes

- **Provider Abstraction is the foundation:** Everything else depends on a unified way to start, stream, pause, resume, and stop agents regardless of backend. This must come first.
- **Concurrent Agent Display before Dashboard:** The dashboard is a layout of concurrent agent cards. You need the card/pane rendering before you can arrange them in a dashboard grid.
- **Approval Command Center requires Dashboard:** The command center aggregates approvals from the dashboard view. Without the dashboard, approvals are per-thread only (which is what current Pluribus already does).
- **Drill-Down is the bridge:** Users go from dashboard overview -> drill-down into single thread. This navigation pattern connects the overview features to the existing single-thread chat experience.
- **Workspace Model is parallel to core orchestration:** Workspaces can be built alongside or after the core agent orchestration loop. They add organization but are not required for the core "run multiple agents" experience.
- **Checkpoint/Rollback conflicts with early phases:** Git worktree management and checkpoint UI is high complexity. Ship the core orchestration loop first.

## Detailed Feature Specifications

### Concurrent Agent Output Display (Table Stakes, HIGH Complexity)

Three-tier display model based on patterns from AgentBase, Cursor Mission Control, and Antigravity:

**Tier 1 -- Overview Grid (dashboard default)**
- Cards arranged in a responsive grid (2-4 columns depending on window width)
- Each card shows: agent name, provider badge, workspace/repo, status indicator, last 2-3 lines of output (plain text, no markdown rendering)
- Cards are color-bordered by status (green=running, yellow=waiting-approval, red=error, gray=completed)
- Pending approval count badge on cards that need intervention
- Click card to drill down to Tier 3

**Tier 2 -- Split Pane (comparison/monitoring)**
- 2-3 agents side by side with scrollable output
- Each pane renders markdown but with reduced fidelity (no code block copy buttons, simplified tool call display)
- Panes are resizable
- Good for monitoring 2-3 related agents (e.g., same task, different repos)

**Tier 3 -- Focused Single (drill-down)**
- Full-screen agent view, identical to current single-thread chat experience
- Sidebar shows list of other agents with status dots for quick switching
- Full markdown rendering, tool call display, approval controls
- Back button or Escape returns to Tier 1

**Performance strategy:** Only Tier 3 (focused) gets full assistant-ui rendering. Tier 1 cards use plain text excerpts from a ring buffer. Tier 2 uses a lightweight markdown renderer. This prevents N simultaneous assistant-ui runtimes from killing performance.

### Intervention Controls (Table Stakes, MEDIUM Complexity)

Based on HITL best practices and AG-UI protocol patterns:

**Per-Agent Controls (always visible in Tier 2/3):**
- **Approve** (y or Enter) -- accept the pending tool call, agent continues
- **Reject** (n) -- reject with optional feedback text, agent receives rejection and adapts
- **Edit** (e) -- modify the tool call arguments before approval (e.g., edit a shell command)
- **Pause** (Space) -- suspend agent execution, persist state checkpoint, agent can be resumed later
- **Resume** (Space again or r) -- restore from checkpoint, continue execution
- **Stop** (Ctrl+C or q) -- terminate agent process, mark as stopped, preserve output history
- **Escalate** -- promote a pending approval to the Approval Command Center for later review

**Approval Queue per Agent:**
When an agent hits multiple approval gates (e.g., read file then write file), queue them. Show count of pending approvals. Allow batch approve for same-type operations (e.g., "approve all file reads").

**Approval Command Center (Differentiator):**
Aggregated view across all agents. Columns: Agent Name | Tool Call Type | Target (file/command) | Preview | Actions. Sortable by time, agent, type. Keyboard navigable. This is what makes multi-agent workflows manageable at scale -- you do not need to visit each agent individually to approve actions.

### Agent Status Tracking (Table Stakes, LOW Complexity)

Status state machine:

```
[Not Started] -> [Spawning] -> [Running] -> [Completed]
                                   |
                                   +-> [Waiting for Approval] -> [Running] (on approve)
                                   |                          -> [Running] (on reject, agent adapts)
                                   |
                                   +-> [Paused] -> [Running] (on resume)
                                   |            -> [Stopped] (on stop while paused)
                                   |
                                   +-> [Errored]
                                   |
                                   +-> [Stopped]
```

Each status maps to:
- **Visual indicator**: Color + icon + verb phrase (e.g., "Editing src/main.ts", "Waiting: approve shell command?")
- **Dashboard behavior**: Running agents sort to top, waiting-for-approval agents flash/pulse, completed agents sort to bottom
- **Notification trigger**: Transition to Completed, Errored, or Waiting-for-Approval triggers notification if agent is not focused

### Drill-Down Navigation (Table Stakes, MEDIUM Complexity)

Three navigation patterns observed in competing tools:

**Pattern chosen: Progressive drill-down (AgentBase-style)**
1. Dashboard grid shows all agents as cards (Tier 1)
2. Click card -> animate transition to focused view (Tier 3)
3. Focused view has sidebar with other agent statuses for quick switching
4. Breadcrumb: Dashboard > Workspace > Agent Name
5. Escape or back button returns to dashboard

**Why not tabs (Cursor-style):** Tabs work for 3-5 agents but break at 10+. Cards scale better visually and allow grouping by workspace.

**Why not canvas (AgentBase-style free-form):** Canvas is complex to implement (drag, zoom, pan) and the spatial metaphor does not add value for code agents where the primary interaction is sequential text output. Grid is simpler and sufficient.

## MVP Definition

### Launch With (v1.0)

Minimum viable product -- enough to validate that dashboard-first multi-agent orchestration is useful.

- [ ] **Unified provider abstraction** -- Refactor existing 3 adapters (Claude CLI, Agent SDK, Codex) into a common interface with consistent lifecycle hooks (start, stream, interrupt, resume, getStatus)
- [ ] **Agent status tracking** -- State machine with visual indicators, verb-phrase status messages
- [ ] **Concurrent agent display (Tier 1 + Tier 3)** -- Grid overview cards with status and last output line, click to drill into full thread view
- [ ] **Multi-agent streaming** -- Run 2-4 agents simultaneously with independent output streams
- [ ] **Agent lifecycle controls** -- Start, pause, resume, stop per agent with keyboard shortcuts
- [ ] **Tool call approval UX** -- Approve/reject with diff preview, keyboard shortcuts (y/n), per-thread approval queue
- [ ] **Working directory scoping** -- Each agent runs in its configured repo directory
- [ ] **Desktop notifications** -- Alert on agent completion, error, or approval-needed via Tauri notification plugin
- [ ] **Drill-down navigation** -- Dashboard grid -> focused single agent view -> back to dashboard

### Add After Validation (v1.x)

Features to add once core orchestration is working and useful.

- [ ] **Approval command center** -- Aggregated cross-agent approval queue. Trigger: users report losing track of which agents need attention
- [ ] **Workspace model** -- Create/edit workspaces, associate repo paths, group agents. Trigger: users working across 3+ repos need organization
- [ ] **Split pane view (Tier 2)** -- Side-by-side agent comparison. Trigger: users want to monitor 2-3 related agents simultaneously
- [ ] **Fire-and-forget inbox** -- Results view for completed background agents with diff summaries
- [ ] **Cost/token tracking** -- Parse usage from agent output, aggregate by workspace and provider
- [ ] **Keyboard-driven command palette** -- Cmd+K for all actions, agent switching, quick commands
- [ ] **Agent templates** -- Save and reuse common agent configurations (provider + system prompt + cwd)

### Future Consideration (v2+)

- [ ] **MCP configuration UI with inheritance** -- Visual editor with workspace defaults and per-thread overrides. Defer because MCP config complexity is orthogonal to the core orchestration value.
- [ ] **Checkpoint/rollback** -- Git-integrated snapshots with visual rollback UI. Defer because git worktree management is complex and the core value proposition does not depend on it.
- [ ] **Cross-provider comparison** -- Side-by-side same-task execution. Defer because it requires the abstraction layer to be battle-tested first.
- [ ] **Import from existing configs** -- Pull MCP config from claude_desktop_config.json, .cursor/mcp.json, codex config.toml. Nice-to-have onboarding convenience.
- [ ] **Agent activity timeline** -- Chronological view of all agent actions across a workspace. Useful for audit but not core.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Dependencies on Existing |
|---------|------------|---------------------|----------|--------------------------|
| Unified provider abstraction | HIGH | HIGH | P1 | Refactors existing 3 adapters |
| Agent status tracking | HIGH | LOW | P1 | Extends existing thread metadata |
| Concurrent agent display (grid + focused) | HIGH | HIGH | P1 | Extends existing thread list + single chat view |
| Multi-agent streaming | HIGH | MEDIUM | P1 | Extends existing single-stream adapter |
| Agent lifecycle controls | HIGH | MEDIUM | P1 | Extends existing process management in adapters |
| Tool call approval UX | HIGH | MEDIUM | P1 | Extends existing tool call display components |
| Working directory scoping | HIGH | LOW | P1 | Extends existing thread metadata in SQLite |
| Desktop notifications | MEDIUM | LOW | P1 | New (Tauri notification plugin) |
| Drill-down navigation | HIGH | MEDIUM | P1 | Transforms existing sidebar + chat layout |
| Approval command center | HIGH | MEDIUM | P2 | Builds on P1 approval UX + dashboard |
| Workspace model | HIGH | MEDIUM | P2 | Extends existing SQLite schema |
| Split pane view | MEDIUM | MEDIUM | P2 | Builds on P1 concurrent display |
| Fire-and-forget inbox | HIGH | MEDIUM | P2 | Builds on P1 lifecycle + notifications |
| Cost/token tracking | MEDIUM | MEDIUM | P2 | Parses existing stream output |
| Command palette | MEDIUM | MEDIUM | P2 | New, standalone component |
| Agent templates | MEDIUM | LOW | P2 | New, SQLite storage |
| MCP configuration UI | MEDIUM | HIGH | P3 | New, complex UI |
| Checkpoint/rollback | MEDIUM | HIGH | P3 | New, heavy git integration |
| Cross-provider comparison | LOW | MEDIUM | P3 | Builds on P1 provider abstraction |
| Config import | LOW | LOW | P3 | New, file parsing |
| Activity timeline | LOW | MEDIUM | P3 | New, event aggregation |

**Priority key:**
- P1: Must have for launch -- defines the product
- P2: Should have, add when core is stable
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Cursor 2.0 | Claude Code CLI | AgentBase | Cline | Windsurf | Augment Intent | Pluribus (Our Approach) |
|---------|-------------|-----------------|-----------|-------|----------|----------------|------------------------|
| Multi-agent parallel | Yes (8 agents, git worktrees) | Yes (subagents, background tasks) | Yes (visual canvas) | No (single agent) | Yes (Wave 13, parallel) | Yes (coordinator + implementors) | Yes -- unlimited local agents, no cloud VMs |
| Dashboard / overview | Mission Control sidebar | None (CLI only) | Visual canvas with zoom | None (VS Code panel) | None | Workspace view | Dedicated dashboard-first app |
| Centralized approval queue | No (per-agent inline) | No (per-terminal prompts) | Yes (Command Center) | No (per-panel) | No | No | Yes -- cross-agent approval command center |
| Agent isolation | Git worktrees + SVFS | Git worktrees | Toggle edit isolation | None | Git worktrees | Worktrees | Working directory scoping, worktrees in v2 |
| Tool approval UX | Inline in editor | Terminal prompts | Pending requests queue | Diff preview + explicit | Inline in editor | Spec-based verification | Dedicated approval queue with diff preview |
| Fire-and-forget | Background agents (cloud VMs) | Headless mode, Tasks | No | No | No | Background agents | Local fire-and-forget with results inbox |
| Progress tracking | Limited | None | Todo list + summaries | None | None | Spec tracking | Status state machine + verb phrases |
| MCP support | Yes (config file) | Yes (CLAUDE.md) | Unknown | Yes (config file) | Yes | Yes | Visual config UI with inheritance |
| Cost tracking | Usage dashboard (cloud) | Third-party tools | No | Token display | Usage limits | Unknown | Built-in aggregated cost view |
| Provider flexibility | Cursor models only | Claude only | Claude, Cursor, Codex | Any LLM provider | Windsurf models only | Multiple | Any CLI agent (extensible) |
| Platform | IDE (VS Code fork) | Terminal | Desktop app | VS Code extension | IDE (VS Code fork) | Desktop app | Desktop app (Tauri) |

**Key competitive positioning:** Pluribus is the only tool combining (1) standalone desktop app (not IDE-locked), (2) multi-provider support, (3) dashboard-first UX, (4) centralized approval command center, and (5) local-only execution. AgentBase is the closest competitor in concept (visual multi-agent control center, local-first) but lacks provider abstraction and approval aggregation. Cursor 2.0 is powerful but cloud-dependent for background agents and locked to their models.

## Sources

- [Cursor 2.0 Features](https://cursor.com/changelog/2-0) -- Mission Control, background agents, SVFS
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) -- Experimental multi-agent coordination
- [AgentBase](https://github.com/AgentOrchestrator/AgentBase) -- Multi-agent orchestrator for Claude Code, Cursor, Codex
- [Cline GitHub](https://github.com/cline/cline) -- Approval UX, checkpoint system
- [Windsurf Cascade](https://windsurf.com/cascade) -- Flow awareness, multi-mode operation
- [Augment Code Intent](https://www.augmentcode.com/blog/intent-a-workspace-for-agent-orchestration) -- Spec-driven development
- [AG-UI Protocol](https://www.codecademy.com/article/ag-ui-agent-user-interaction-protocol) -- 16 event types across 5 categories for agent-UI interaction
- [Smashing Magazine: Designing for Agentic AI](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) -- UX patterns for control, consent, accountability
- [7 UX Patterns for Human Oversight](https://www.bprigent.com/article/7-ux-patterns-for-human-oversight-in-ambient-ai-agents) -- Oversight patterns for AI agents
- [HITL Best Practices (Permit.io)](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo) -- Approval criteria, timeouts, audit trails
- [LangGraph Human-in-the-Loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) -- interrupt() pattern for pause/resume
- [CrewAI Dashboard](https://crewai.com/) -- Centralized dashboard for agent crews
- [Antigravity IDE](https://www.codecademy.com/article/agentic-ide-comparison-cursor-vs-windsurf-vs-antigravity) -- Parallel agents with artifact communication
- [AI Coding Agent Dashboard (Marc Nuri)](https://blog.marcnuri.com/ai-coding-agent-dashboard) -- Session cards, device organization, status at a glance
- [Claude Code Subagents](https://zachwills.net/how-to-use-claude-code-subagents-to-parallelize-development/) -- Parallelization patterns
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-03-26/server/tools) -- Tool protocol standard

---
*Feature research for: AI Agent Orchestration Desktop App (Mission Control)*
*Researched: 2026-03-05 (updated with multi-agent orchestration UI patterns)*

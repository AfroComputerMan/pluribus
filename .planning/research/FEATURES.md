# Feature Research

**Domain:** AI Agent Orchestration Desktop App (Mission Control)
**Researched:** 2026-03-05
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in any multi-agent coding tool. Missing these and the product feels broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Real-time output streaming per agent | Every coding agent tool (Claude Code, Cursor, Cline, Aider) streams output live. Users will not wait for batch results. | MEDIUM | Pluribus already has streaming for single threads via assistant-ui. Needs multiplexing across N simultaneous streams without UI jank. Use virtualized rendering for inactive agents. |
| Tool call approval / human-in-the-loop | Cline's core UX: every file edit shows a diff, every command requires approval. Claude Code defaults to asking permission. This is the safety contract users expect. | MEDIUM | Already partially built (tool display components exist). Needs: approve/reject buttons with keyboard shortcuts, diff previews for file edits, batch approve for trusted operations. |
| Agent lifecycle management (start/stop/pause) | Cursor 2.0 and Windsurf both let you spin up, pause, and terminate agents. Basic process control is assumed. | MEDIUM | Maps to process lifecycle in Tauri shell/sidecar. Pause = interrupt stdin stream. Stop = SIGTERM + cleanup. Need graceful shutdown that preserves session state for resume. |
| Agent status indicators | Every dashboard tool shows running/idle/error/completed states. Users managing multiple agents need status at a glance. | LOW | Color-coded badges or icons. Map to process states: spawning, running, waiting-for-approval, paused, completed, errored. |
| Thread/agent history and persistence | Existing Pluribus has SQLite persistence for threads. Users expect to close the app and resume where they left off. | LOW | Already built. Extend schema for workspace association and multi-agent metadata (provider, working directory, MCP config). |
| Working directory scoping per agent | Claude Code, Aider, Cline all operate within a specific directory context. Each agent needs its own cwd. | LOW | Pass cwd to Tauri Command.create(). Store in thread metadata. |
| Multi-provider support | The market has fragmented: Claude Code, Codex, Cursor agents, Windsurf Cascade. Users pick tools per task. Pluribus already supports 3 backends. | HIGH | Existing adapter pattern (Claude CLI, Agent SDK, Codex) is the foundation. Needs a unified provider abstraction with consistent lifecycle hooks (start, stream, interrupt, resume). |
| Markdown and code rendering in output | Every coding agent renders markdown, syntax-highlighted code, and diffs. | LOW | Already built via assistant-ui and existing components. |
| Notification on agent completion/error | When running fire-and-forget agents, users need to know when something finishes or breaks. Cursor background agents notify on PR creation; Claude Code tasks notify on completion. | LOW | Desktop notifications via Tauri notification plugin. In-app toast/badge system (sonner toasts already exist per git history). |

### Differentiators (Competitive Advantage)

Features that set Pluribus apart. These are where the product competes.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Dashboard-first multi-agent overview | Cursor 2.0 has Mission Control sidebar; Augment Intent has a coordinator view. But no standalone desktop app gives you a dedicated dashboard across multiple repos and providers simultaneously. This is the core value proposition. | HIGH | Grid layout showing all active agents with live status, last output preview, and workspace grouping. Think macOS Mission Control but for AI agents. Click to drill into full thread view. |
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

## Feature Dependencies

```
[Workspace Model]
    |-- requires --> [Working Directory Scoping]
    |-- requires --> [Thread/Agent Persistence]
    |-- enables  --> [MCP Config Inheritance]
    |-- enables  --> [Dashboard Overview]

[Multi-Provider Abstraction]
    |-- requires --> [Agent Lifecycle Management]
    |-- requires --> [Streaming Output]
    |-- enables  --> [Cross-Provider Comparison]
    |-- enables  --> [Cost Tracking]

[Dashboard Overview]
    |-- requires --> [Agent Status Indicators]
    |-- requires --> [Workspace Model]
    |-- enhances --> [Fire-and-Forget Mode]

[Tool Call Approval UX]
    |-- requires --> [Streaming Output]
    |-- enhances --> [Agent Lifecycle Management] (pause while waiting)

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
    |-- requires --> [Multi-Provider Abstraction] (normalize across providers)
```

### Dependency Notes

- **Dashboard requires Workspace Model:** The dashboard organizes agents by workspace. Without workspaces, it is just a flat list (which is what current Pluribus already has).
- **Fire-and-Forget requires Notifications:** Without alerts, fire-and-forget is just "fire-and-forget-about-it." The notification system is what makes async agents usable.
- **MCP Config Inheritance requires Workspace Model:** The three-tier config (global -> workspace -> thread) only makes sense once workspaces exist.
- **Checkpoint/Rollback conflicts with early phases:** Git worktree management and checkpoint UI is high complexity. Ship the core orchestration loop first, add checkpoints after validation.
- **Cross-Provider Comparison requires Multi-Provider Abstraction:** Cannot compare providers without a unified interface that normalizes their outputs.

## MVP Definition

### Launch With (v1)

Minimum viable product -- enough to validate that dashboard-first multi-agent orchestration is useful.

- [ ] **Unified provider abstraction** -- Refactor existing 3 adapters (Claude CLI, Agent SDK, Codex) into a common interface with consistent lifecycle hooks
- [ ] **Workspace model** -- Create/edit workspaces, associate repo paths, store in SQLite
- [ ] **Dashboard overview** -- Grid of active agents grouped by workspace, status indicators, click-to-drill-down
- [ ] **Multi-agent streaming** -- Run 2-4 agents simultaneously with live output in split/tabbed views
- [ ] **Agent lifecycle controls** -- Start, pause, resume, stop per agent with keyboard shortcuts
- [ ] **Tool call approval UX** -- Approve/reject with diff preview, keyboard shortcuts (y/n), per-thread approval queue
- [ ] **Desktop notifications** -- Alert on agent completion, error, or approval-needed via Tauri notification plugin
- [ ] **Working directory scoping** -- Each agent runs in its configured repo directory

### Add After Validation (v1.x)

Features to add once core orchestration is working and useful.

- [ ] **Fire-and-forget inbox** -- Results view for completed background agents with diff summaries
- [ ] **MCP configuration UI** -- Visual editor for MCP server configs with workspace inheritance
- [ ] **Cost/token tracking** -- Parse usage from agent output, aggregate by workspace and provider
- [ ] **Keyboard-driven command palette** -- Cmd+K for all actions, agent switching, quick commands
- [ ] **Agent templates** -- Save and reuse common agent configurations (provider + MCP + system prompt)

### Future Consideration (v2+)

- [ ] **Checkpoint/rollback** -- Git-integrated snapshots with visual rollback UI. Defer because git worktree management is complex and the core value proposition does not depend on it.
- [ ] **Cross-provider comparison** -- Side-by-side same-task execution. Defer because it requires the abstraction layer to be battle-tested first.
- [ ] **Import from existing configs** -- Pull MCP config from claude_desktop_config.json, .cursor/mcp.json, codex config.toml. Nice-to-have onboarding convenience.
- [ ] **Agent activity timeline** -- Chronological view of all agent actions across a workspace (like a git log but for agent operations). Useful for audit but not core.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Dashboard overview | HIGH | HIGH | P1 |
| Workspace model | HIGH | MEDIUM | P1 |
| Unified provider abstraction | HIGH | HIGH | P1 |
| Multi-agent streaming | HIGH | MEDIUM | P1 |
| Agent lifecycle controls | HIGH | MEDIUM | P1 |
| Tool call approval UX | HIGH | MEDIUM | P1 |
| Agent status indicators | HIGH | LOW | P1 |
| Desktop notifications | MEDIUM | LOW | P1 |
| Working directory scoping | HIGH | LOW | P1 |
| Fire-and-forget inbox | HIGH | MEDIUM | P2 |
| MCP configuration UI | MEDIUM | HIGH | P2 |
| Cost/token tracking | MEDIUM | MEDIUM | P2 |
| Command palette | MEDIUM | MEDIUM | P2 |
| Agent templates | MEDIUM | LOW | P2 |
| Checkpoint/rollback | MEDIUM | HIGH | P3 |
| Cross-provider comparison | LOW | MEDIUM | P3 |
| Config import | LOW | LOW | P3 |
| Activity timeline | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch -- defines the product
- P2: Should have, add when core is stable
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Cursor 2.0 | Claude Code CLI | Cline | Windsurf | Augment Intent | Pluribus (Our Approach) |
|---------|-------------|-----------------|-------|----------|----------------|------------------------|
| Multi-agent parallel | Yes (8 agents, git worktrees) | Yes (subagents, background tasks) | No (single agent) | Yes (Wave 13, parallel Cascade) | Yes (coordinator + implementors) | Yes -- unlimited local agents, no cloud VMs required |
| Dashboard / overview | Mission Control sidebar | None (CLI only, third-party dashboards) | None (VS Code panel) | None | Workspace view | Dedicated dashboard-first app, not a sidebar |
| Agent isolation | Git worktrees + SVFS | Git worktrees | None | Git worktrees | Worktrees | Working directory scoping, git worktree support in v2 |
| Tool approval UX | Inline in editor | Terminal prompts | Diff preview + explicit approval | Inline in editor | Spec-based verification | Dedicated approval queue with diff preview per agent |
| Fire-and-forget | Background agents (cloud VMs) | Headless mode, Tasks | No | No | Background agents | Local fire-and-forget with results inbox |
| MCP support | Yes (config file) | Yes (CLAUDE.md, project config) | Yes (config file) | Yes | Yes | Visual config UI with inheritance model |
| Cost tracking | Usage dashboard (cloud) | Third-party tools (Sniffly, otel) | Token display | Usage limits | Unknown | Built-in aggregated cost view |
| Provider flexibility | Cursor models only | Claude only | Any LLM provider | Windsurf models only | Multiple (Claude Code, Codex) | Any CLI agent (Claude, Codex, extensible) |
| Platform | IDE (VS Code fork) | Terminal | VS Code extension | IDE (VS Code fork) | Desktop app | Desktop app (Tauri) |

**Key competitive positioning:** Pluribus is the only tool that combines (1) standalone desktop app (not IDE-locked), (2) multi-provider support, (3) dashboard-first UX, and (4) local-only execution. Cursor 2.0 is the closest competitor but requires their cloud infrastructure for background agents and locks you into their models. Augment Intent is similar in concept but is tied to their Context Engine. Pluribus is provider-agnostic and fully local.

## Sources

- [Cursor 2.0 Features](https://cursor.com/changelog/2-0) -- Mission Control, background agents, SVFS
- [Cursor Agent Product Page](https://cursor.com/product) -- Background agents, multi-agent parallelism
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents) -- Subagent architecture, parallel execution
- [Claude Code Tasks (VentureBeat)](https://venturebeat.com/orchestration/claude-codes-tasks-update-lets-agents-work-longer-and-coordinate-across) -- DAG-based task coordination
- [Cline GitHub](https://github.com/cline/cline) -- Approval UX, checkpoint system
- [Cline CLI 2.0 (DevOps.com)](https://devops.com/cline-cli-2-0-turns-your-terminal-into-an-ai-agent-control-plane/) -- Auto-approve toggle, inline markdown
- [Windsurf Cascade](https://windsurf.com/cascade) -- Flow awareness, multi-mode operation
- [Augment Code Intent](https://www.augmentcode.com/blog/intent-a-workspace-for-agent-orchestration) -- Spec-driven development, coordinator/implementor pattern
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-03-26/server/tools) -- Tool protocol standard
- [Git Worktrees for AI Agents (Medium)](https://medium.com/@mabd.dev/git-worktrees-the-secret-weapon-for-running-multiple-ai-coding-agents-in-parallel-e9046451eb96) -- Isolation patterns
- [Claude Code Missing Dashboard (Medium)](https://ridjex.medium.com/claude-codes-missing-dashboard-so-i-built-one-999f41b97741) -- Gap in Claude Code ecosystem
- [VS Code Multi-Agent Development](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development) -- IDE-level multi-agent support

---
*Feature research for: AI Agent Orchestration Desktop App (Mission Control)*
*Researched: 2026-03-05*

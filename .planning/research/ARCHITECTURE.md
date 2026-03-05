# Architecture Research

**Domain:** Multi-agent AI orchestration desktop app
**Researched:** 2026-03-05
**Confidence:** MEDIUM-HIGH

## Standard Architecture

### System Overview

```
                          Pluribus — Multi-Agent Mission Control
 ___________________________________________________________________________
|                                                                           |
|  UI Layer (React 19 + assistant-ui)                                       |
|  ┌─────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐  |
|  │  Dashboard   │  │  Workspace View  │  │  Agent Thread View           │  |
|  │  (overview)  │  │  (agent grid)    │  │  (single agent, full chat)   │  |
|  └──────┬───────┘  └────────┬─────────┘  └──────────────┬───────────────┘  |
|         │                   │                           │                 |
|─────────┴───────────────────┴───────────────────────────┴─────────────────|
|                                                                           |
|  Orchestration Layer (TypeScript)                                         |
|  ┌───────────────────┐  ┌───────────────────┐  ┌──────────────────────┐   |
|  │  WorkspaceManager │  │  AgentRegistry     │  │  MCP Config Resolver │   |
|  │  (CRUD, config)   │  │  (lifecycle, pool) │  │  (inherit + override)│   |
|  └────────┬──────────┘  └────────┬───────────┘  └──────────┬───────────┘   |
|           │                      │                         │              |
|─────────────────────────────────────────────────────────────────────────── |
|                                                                           |
|  Process Layer (per-agent isolation)                                      |
|  ┌────────────────────────────────────────────────────────────────────┐    |
|  │  AgentProcessManager                                              │    |
|  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │    |
|  │  │ Agent 1  │  │ Agent 2  │  │ Agent 3  │  │ Agent N  │          │    |
|  │  │ (Claude) │  │ (Claude) │  │ (Codex)  │  │ (Claude) │          │    |
|  │  │ cwd: /a  │  │ cwd: /b  │  │ cwd: /c  │  │ cwd: /a  │          │    |
|  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │    |
|  └────────────────────────────────────────────────────────────────────┘    |
|                                                                           |
|  Adapter Layer (provider abstraction)                                     |
|  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                     |
|  │ AgentSDK     │  │ Codex        │  │ Future       │                     |
|  │ Provider     │  │ Provider     │  │ Provider     │                     |
|  └──────────────┘  └──────────────┘  └──────────────┘                     |
|                                                                           |
|  Persistence Layer (SQLite)                                               |
|  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                  |
|  │Workspaces│  │ Threads  │  │ Messages │  │ Sessions │                  |
|  └──────────┘  └──────────┘  └──────────┘  └──────────┘                  |
|___________________________________________________________________________|
                                    │
                     ┌──────────────┴──────────────┐
                     │  Tauri Core (Rust)           │
                     │  Shell plugin, SQL plugin,   │
                     │  process supervision         │
                     └─────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| **Dashboard** | Overview of all workspaces, active agents, recent activity. Entry point for navigation. | WorkspaceManager (read), AgentRegistry (read status) |
| **WorkspaceView** | Shows all agent threads within a workspace as a grid/list. Spawn new agents, see live status. | AgentRegistry (spawn/status), WorkspaceManager (config) |
| **AgentThreadView** | Full chat interface for a single agent. Approve/reject tools, pause/resume. Reuses existing assistant-ui thread primitives. | AgentRegistry (stream), assistant-ui runtime |
| **WorkspaceManager** | CRUD for workspaces. Stores workspace-level config (default model, MCP servers, working directory). | Persistence layer, MCP Config Resolver |
| **AgentRegistry** | Tracks all active agent processes. Spawns, kills, pauses, resumes agents. Central source of truth for agent lifecycle state. | AgentProcessManager, Providers, ThreadStatusStore |
| **MCP Config Resolver** | Resolves effective MCP config for a thread: workspace defaults merged with per-thread overrides. | WorkspaceManager (defaults), Persistence (overrides) |
| **AgentProcessManager** | Low-level process lifecycle. Owns child process handles, stdin/stdout pipes, restart logic. One process per agent thread. | Tauri shell plugin / Rust process management |
| **Providers** (AgentSDK, Codex) | Protocol-specific adapters. Translate between Pluribus internal events and provider wire format. | AgentProcessManager (process I/O), assistant-ui (ChatModelRunResult) |
| **Persistence** | SQLite CRUD for all entities. Schema migrations. | All layers read/write |

## Recommended Project Structure

The existing structure is close. Key changes are introducing the orchestration and process management layers.

```
src/
├── components/
│   ├── dashboard/              # Dashboard overview page
│   │   ├── dashboard-page.tsx
│   │   ├── workspace-card.tsx
│   │   └── agent-summary.tsx
│   ├── workspace/              # Workspace detail view
│   │   ├── workspace-view.tsx
│   │   ├── agent-grid.tsx
│   │   └── workspace-settings.tsx
│   ├── agent/                  # Single agent thread (chat)
│   │   └── agent-thread-view.tsx
│   ├── assistant-ui/           # Keep: chat primitives, tool displays
│   │   ├── thread.tsx
│   │   ├── claude-tool-display.tsx
│   │   └── codex-tool-display.tsx
│   ├── ui/                     # Keep: shadcn components
│   └── settings-overlay.tsx    # Keep: global settings
├── lib/
│   ├── orchestration/          # NEW: multi-agent management
│   │   ├── agent-registry.ts       # Agent lifecycle tracking
│   │   ├── workspace-manager.ts     # Workspace CRUD + config
│   │   ├── mcp-config-resolver.ts   # MCP inheritance logic
│   │   └── agent-process-manager.ts # Process pool management
│   ├── providers/              # Refactored from flat adapters
│   │   ├── types.ts                 # Shared provider interface
│   │   ├── agent-sdk-provider.ts    # Claude Agent SDK
│   │   ├── codex-provider.ts        # Codex
│   │   └── provider-factory.ts      # Provider instantiation
│   ├── stores/                 # Zustand stores
│   │   ├── thread-status-store.ts
│   │   ├── workspace-store.ts
│   │   └── codex-approval-store.ts
│   ├── db.ts                   # Keep: SQLite operations
│   ├── router-adapter.ts       # Evolves: delegates to AgentRegistry
│   └── models.ts               # Keep: model definitions
├── sidecar/
│   └── agent-sdk-bridge/       # Keep: Bun sidecar for Agent SDK
src-tauri/
├── src/
│   ├── lib.rs                  # Tauri setup
│   ├── process/                # NEW: Rust-side process supervision
│   │   ├── mod.rs
│   │   ├── supervisor.rs       # Health checks, restart, cleanup
│   │   └── pool.rs             # Process pool management
│   └── codex/                  # Keep: Codex-specific Rust code
└── migrations/                 # SQLite schema evolution
```

### Structure Rationale

- **`orchestration/`**: Separates multi-agent concerns (lifecycle, workspace config, MCP resolution) from provider-specific protocol code. This is the new layer that does not exist today.
- **`providers/`**: Refactors the flat `claude-adapter.ts`, `agent-sdk-adapter.ts`, `codex-adapter.ts` into a structured provider pattern with a shared interface. Each provider handles only protocol translation.
- **`stores/`**: Groups Zustand stores. The thread-status-store becomes more critical when tracking 5-20 concurrent agents.
- **`dashboard/` + `workspace/` + `agent/`**: Three-level UI hierarchy matching the navigation model: Dashboard -> Workspace -> Agent Thread.

## Architectural Patterns

### Pattern 1: Hub-and-Spoke Agent Registry

**What:** A central AgentRegistry owns all agent lifecycle state. All agent operations (spawn, kill, pause, resume, query status) go through this single component. No component directly manages processes.

**When to use:** Always. This is the core orchestration pattern. Without it, process management leaks into UI components and providers, creating an untestable mess.

**Trade-offs:** Single point of coordination (good for consistency, bad if it becomes a god object). Keep it focused on lifecycle -- delegate protocol concerns to providers and config concerns to WorkspaceManager.

**Example:**
```typescript
interface AgentHandle {
  id: string;              // Thread ID
  workspaceId: string;
  provider: AgentProvider;
  status: AgentStatus;
  cwd: string;
  model: string;
  mcpConfig: ResolvedMcpConfig;
  spawnedAt: number;
}

type AgentStatus =
  | "starting"
  | "idle"
  | "running"
  | "waiting-approval"
  | "paused"
  | "error"
  | "stopped";

interface AgentRegistry {
  spawn(opts: SpawnOptions): Promise<AgentHandle>;
  kill(agentId: string): Promise<void>;
  pause(agentId: string): Promise<void>;
  resume(agentId: string): Promise<void>;
  getStatus(agentId: string): AgentStatus;
  getByWorkspace(workspaceId: string): AgentHandle[];
  getAll(): AgentHandle[];
  onStatusChange(cb: (agentId: string, status: AgentStatus) => void): () => void;
}
```

### Pattern 2: Provider Abstraction (Agent Backend Interface)

**What:** Each AI backend (Claude Agent SDK, Codex, future providers) implements a common interface. The registry does not know protocol details -- it delegates to the provider.

**When to use:** Always. The existing codebase already has three adapters. Formalizing the interface prevents drift.

**Trade-offs:** Some providers have unique capabilities (Codex approval flow, Claude subagents) that don't fit a generic interface. Handle via optional capability flags, not by bloating the base interface.

**Example:**
```typescript
interface AgentProvider {
  readonly id: string;         // "agent-sdk" | "codex" | ...
  readonly capabilities: ProviderCapabilities;

  // Spawn a new process for this agent thread
  spawnProcess(opts: ProcessOptions): Promise<ProcessHandle>;

  // Send a user message and stream results
  run(handle: ProcessHandle, prompt: string, signal: AbortSignal):
    AsyncGenerator<ChatModelRunResult, void>;

  // Interrupt the current turn
  interrupt(handle: ProcessHandle): Promise<void>;

  // Graceful shutdown
  shutdown(handle: ProcessHandle): Promise<void>;
}

interface ProviderCapabilities {
  supportsApproval: boolean;    // Codex-style tool approval
  supportsSubAgents: boolean;   // Claude sub-agents
  supportsPause: boolean;       // Can pause mid-execution
  supportsMcp: boolean;         // MCP server integration
}
```

### Pattern 3: MCP Config Inheritance

**What:** MCP server configuration follows an inheritance chain: global defaults -> workspace-level -> per-thread overrides. Each level can add servers, remove inherited ones, or override settings.

**When to use:** When a user creates a new agent thread in a workspace. The effective config is resolved at spawn time and can be modified while the agent is idle.

**Trade-offs:** More flexible than flat config, but adds complexity. Keep the resolution logic in one place (MCP Config Resolver) to avoid inconsistencies.

**Example:**
```typescript
interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface McpConfigLevel {
  servers: McpServerConfig[];
  remove?: string[];  // Names of inherited servers to exclude
}

function resolveMcpConfig(
  globalConfig: McpConfigLevel,
  workspaceConfig: McpConfigLevel | null,
  threadConfig: McpConfigLevel | null,
): McpServerConfig[] {
  let servers = [...globalConfig.servers];

  if (workspaceConfig) {
    const removeSet = new Set(workspaceConfig.remove ?? []);
    servers = servers.filter(s => !removeSet.has(s.name));
    servers.push(...workspaceConfig.servers);
  }

  if (threadConfig) {
    const removeSet = new Set(threadConfig.remove ?? []);
    servers = servers.filter(s => !removeSet.has(s.name));
    servers.push(...threadConfig.servers);
  }

  return servers;
}
```

### Pattern 4: Process-Per-Agent Isolation

**What:** Each agent thread gets its own OS process. No shared CLI sessions between threads. Each process has its own working directory, environment, and MCP server connections.

**When to use:** Always. This is a project constraint (from PROJECT.md: "Each agent thread needs its own process lifecycle"). It prevents one agent's crash from affecting others and allows per-agent cwd/env.

**Trade-offs:** Higher resource usage than multiplexing. On a typical dev machine, 5-10 concurrent Claude CLI processes are fine. At 20+, memory pressure becomes real. The current Agent SDK sidecar is a single multiplexed process -- this works for Claude but the model shifts to one sidecar per agent thread for true isolation.

**Critical decision: Sidecar multiplexing vs. per-agent processes.**

The existing `AgentSdkSidecar` class multiplexes all queries through one Bun process. For multi-agent orchestration, there are two paths:

1. **Keep multiplexed sidecar** (queries identified by `queryId`): Lower resource cost, but a sidecar crash kills all agents. The sidecar already handles per-query routing.

2. **One sidecar per agent**: Full isolation. Each agent has its own Bun process with its own `cwd`. A crash affects only one agent. Higher resource usage.

**Recommendation: Start with multiplexed sidecar (option 1), add per-agent mode later if isolation issues arise.** The existing multiplexing works well. Per-query `cwd` is already supported in the protocol. The main gap is MCP config -- if MCP servers need per-agent configuration, the sidecar protocol needs to pass MCP config at query time or the sidecar needs to manage per-session MCP connections.

## Data Flow

### Agent Spawn Flow

```
User clicks "New Agent" in WorkspaceView
    |
    v
WorkspaceView -> AgentRegistry.spawn({
    workspaceId,
    model,
    cwd,
    prompt (optional initial task)
})
    |
    v
AgentRegistry:
    1. Resolve MCP config via McpConfigResolver
    2. Select provider based on model (AgentSDK vs Codex)
    3. Call provider.spawnProcess({ cwd, mcpConfig })
    4. Create AgentHandle, add to registry
    5. Persist thread to SQLite
    6. Update ThreadStatusStore -> "starting"
    7. If initial prompt: call provider.run()
    |
    v
Provider.spawnProcess():
    - AgentSDK: sidecar.ensureRunning() (or spawn new sidecar)
    - Codex: invoke("codex_start_thread", { model })
    |
    v
AgentHandle returned to UI
    -> Dashboard and WorkspaceView update via Zustand subscription
```

### Multi-Agent Status Flow

```
                 AgentRegistry
                      |
        ┌─────────────┼─────────────┐
        |             |             |
   Agent 1        Agent 2       Agent 3
   (running)      (idle)        (error)
        |             |             |
        v             v             v
   ThreadStatusStore (Zustand)
        |
        ├── Dashboard (reads all statuses)
        ├── WorkspaceView (reads workspace-filtered statuses)
        └── AgentThreadView (reads single agent status)
```

### Message Flow (Per-Agent)

```
User types in AgentThreadView composer
    |
    v
assistant-ui runtime -> ChatModelAdapter.run(options)
    |
    v
RouterAdapter -> AgentRegistry.getHandle(threadId)
    |
    v
Provider.run(handle, prompt, abortSignal)
    |
    v
Provider yields ChatModelRunResult chunks
    |
    v
assistant-ui renders in AgentThreadView
    |
    v
On completion: persist messages to SQLite, update status to "idle"
```

### Key Data Flows

1. **Dashboard refresh:** Dashboard subscribes to `ThreadStatusStore` (Zustand). Any agent status change triggers re-render. No polling needed. Status changes propagate: Provider -> AgentRegistry -> ThreadStatusStore -> UI.

2. **Workspace navigation:** User clicks workspace card on Dashboard -> React Router navigates to `/workspace/:id` -> WorkspaceView fetches workspace config from SQLite, agent list from AgentRegistry -> renders agent grid.

3. **Fire-and-forget:** User spawns agent with initial prompt, navigates away. Agent runs in background. On completion/error, AgentRegistry updates ThreadStatusStore with `unread: true`. Dashboard shows unread badge. User clicks to see results.

4. **Tool approval (Codex):** Provider emits `approval_needed` -> AgentRegistry updates status to `"waiting-approval"` -> ThreadStatusStore notifies all subscribed views -> If user is on a different agent, notification badge appears -> User navigates to agent, approves/rejects via `invoke("codex_approve_tool")`.

## State Management

```
┌─────────────────────────────────────────────────────────────┐
│                    State Architecture                        │
│                                                             │
│  ┌─────────────────────┐   ┌──────────────────────────┐     │
│  │  Zustand Stores     │   │  In-Memory (Orchestration)│     │
│  │  (reactive UI)      │   │  (process state)          │     │
│  │                     │   │                           │     │
│  │  - ThreadStatusStore│   │  - AgentRegistry handles  │     │
│  │  - WorkspaceStore   │   │  - Process child refs     │     │
│  │  - ApprovalStore    │   │  - Sidecar connections    │     │
│  └─────────┬───────────┘   └──────────┬────────────────┘     │
│            │                          │                      │
│            │     ┌────────────────────┘                      │
│            │     │                                           │
│            v     v                                           │
│  ┌──────────────────────┐                                    │
│  │  SQLite (persistent) │                                    │
│  │                      │                                    │
│  │  - workspaces table  │                                    │
│  │  - threads table     │                                    │
│  │  - messages table    │                                    │
│  │  - sessions table    │                                    │
│  │  - mcp_configs table │ (new)                              │
│  │  - global_settings   │                                    │
│  └──────────────────────┘                                    │
└─────────────────────────────────────────────────────────────┘

Principle: Zustand for UI reactivity.
           In-memory for process handles (can't serialize a Child).
           SQLite for persistence across restarts.
           On restart: SQLite rehydrates workspace/thread state.
                       Processes are NOT restarted (agents start fresh).
```

## Scaling Considerations

This is a local desktop app. "Scaling" means concurrent agent count, not user count.

| Concurrent Agents | Architecture Adjustments |
|-------------------|--------------------------|
| 1-5 | Current architecture works. Multiplexed sidecar. Single Codex app-server. No special handling needed. |
| 5-15 | Watch memory. Each Claude CLI process uses 50-150MB. Total: 0.5-2GB for agent processes alone. Surface memory usage in Dashboard. Consider process pooling (idle agents release process, respawn on next message). |
| 15-30 | Process pooling mandatory. Max concurrent running agents should be configurable. Queue excess work. Consider replacing per-agent Codex processes with a single multiplexed server. |
| 30+ | Impractical for local desktop. If needed, offload to cloud-hosted agents (out of scope for v1). |

### Scaling Priorities

1. **First bottleneck: Memory.** Each agent process (Claude CLI, Codex) consumes significant RAM. Mitigation: process pooling with configurable max concurrent agents. Idle agents can release their process and resume later via session IDs.

2. **Second bottleneck: UI responsiveness.** 15+ agents streaming simultaneously can overwhelm React rendering. Mitigation: throttle status updates to 1-2Hz for non-focused agents. Only render full streaming for the actively viewed agent.

## Anti-Patterns

### Anti-Pattern 1: God Adapter

**What people do:** Put workspace management, process lifecycle, MCP config, status tracking, and protocol translation all in one adapter file (the current `claude-adapter.ts` at 1900 lines is heading this direction).

**Why it's wrong:** Impossible to test, impossible to extend, impossible for another developer to understand. Adapter changes risk breaking unrelated functionality.

**Do this instead:** Separate concerns into orchestration (AgentRegistry), config (WorkspaceManager, McpConfigResolver), and protocol (Provider). Each file under 400 lines.

### Anti-Pattern 2: Shared Process Sessions

**What people do:** Share a single CLI session across multiple agent threads to save resources.

**Why it's wrong:** One agent's context pollutes another's. Crashes affect all agents. Working directory conflicts. The Claude Agent SDK explicitly warns against this.

**Do this instead:** One session per agent thread. Use session IDs for resumption. Accept the resource cost.

### Anti-Pattern 3: Polling for Status

**What people do:** Poll each agent for status on a timer to update the dashboard.

**Why it's wrong:** Wastes resources, introduces latency, and the dashboard feels sluggish.

**Do this instead:** Push-based status via Zustand. Providers emit status changes -> AgentRegistry updates store -> UI reacts immediately. The existing `ThreadStatusStore` pattern is correct; extend it, don't replace it.

### Anti-Pattern 4: UI-Driven Process Management

**What people do:** Let React components directly spawn/kill processes via `Command.create()` or `invoke()`.

**Why it's wrong:** Process lifecycle becomes tied to component mount/unmount. Navigating away kills the agent. Multiple components can spawn duplicate processes.

**Do this instead:** AgentRegistry owns all processes. UI components request actions via the registry. Processes survive navigation.

### Anti-Pattern 5: Flat MCP Config

**What people do:** Store MCP server config globally with no workspace or thread scoping.

**Why it's wrong:** Different projects need different MCP servers. A monorepo workspace needs different tools than a microservices workspace. Users end up manually reconfiguring MCP for every new agent.

**Do this instead:** Three-level inheritance (global -> workspace -> thread). Resolve at spawn time. Store overrides in SQLite alongside workspace/thread records.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Claude CLI / Agent SDK | Bun sidecar, NDJSON over stdin/stdout | Existing pattern. Session IDs enable resume. Sidecar handles SDK dependency isolation. |
| Codex CLI | Rust-managed child process, JSON-RPC over stdin/stdout | Existing pattern via `CodexService`. Thread-scoped. |
| MCP Servers | Spawned per workspace or per agent, stdio transport | MCP servers are child processes themselves. Need lifecycle management alongside agent processes. Claude CLI can manage its own MCP connections if passed config. |
| Git (workspace metadata) | Tauri shell plugin, `git` CLI | Existing `workspace-repo-metadata.ts`. Used for branch display, repo detection. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| UI -> Orchestration | Function calls (TypeScript) | Direct imports. AgentRegistry is a singleton or Zustand store. |
| Orchestration -> Providers | Provider interface (TypeScript) | Providers implement `AgentProvider`. Registry selects provider by model. |
| Providers -> Tauri/Rust | `invoke()` for Codex, `Command.create()` for shell | Existing IPC patterns. No change needed. |
| Orchestration -> Persistence | `db.*` namespace functions | Existing pattern. Add new tables for MCP config. |
| Rust -> Frontend events | Tauri `emit()` -> frontend `listen()` | Used for Codex events. Could extend for process health monitoring. |
| Dashboard -> WorkspaceView -> AgentThread | React Router navigation | New navigation hierarchy replacing current flat thread list. |

## Build Order (Dependencies)

The architecture has clear dependency layers that dictate build order:

### Phase 1: Provider Abstraction
Refactor existing adapters into the `AgentProvider` interface. No new functionality -- just restructuring. This unblocks everything else.
- Depends on: nothing (existing code refactor)
- Unblocks: AgentRegistry, process management

### Phase 2: AgentRegistry + Process Management
Build the central registry that tracks agent handles and delegates to providers. Integrate with ThreadStatusStore.
- Depends on: Provider abstraction (Phase 1)
- Unblocks: Multi-agent UI, workspace management

### Phase 3: Workspace Management + MCP Config
Extend existing workspace schema. Build McpConfigResolver with inheritance. Wire workspace config into agent spawn flow.
- Depends on: AgentRegistry (Phase 2) for spawn integration
- Unblocks: Dashboard, workspace views

### Phase 4: Multi-Agent UI
Dashboard, WorkspaceView, agent grid. Navigation hierarchy. Fire-and-forget with notification badges.
- Depends on: AgentRegistry (Phase 2), WorkspaceManager (Phase 3)
- Unblocks: nothing (top of stack)

### Phase 5: Process Supervision (Rust-side)
Health checks, graceful shutdown on app exit, restart policies. Move process management partially to Rust for reliability.
- Depends on: AgentRegistry (Phase 2), working multi-agent flow
- Can be deferred: MVP works without Rust-side supervision

## Sources

- [Tauri 2 Process Model](https://v2.tauri.app/concept/process-model/)
- [Tauri Sidecar Lifecycle Management Discussion](https://github.com/tauri-apps/plugins-workspace/issues/3062)
- [Claude Agent SDK Session Management](https://docs.claude.com/en/docs/agent-sdk/sessions)
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) -- architecture patterns for orchestrating multiple Claude sessions
- [MCP Client Concepts](https://modelcontextprotocol.io/docs/learn/client-concepts)
- [assistant-ui Runtime Architecture](https://www.assistant-ui.com/docs/architecture)
- [assistant-ui AssistantRuntime API](https://www.assistant-ui.com/docs/api-reference/runtimes/assistant-runtime)
- [Azure AI Agent Orchestration Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) -- hub-and-spoke vs mesh analysis

---
*Architecture research for: multi-agent AI orchestration desktop app*
*Researched: 2026-03-05*

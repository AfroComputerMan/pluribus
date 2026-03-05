# Architecture Research: Multi-Thread Agent Orchestration Integration

**Domain:** Multi-agent AI orchestration desktop app
**Researched:** 2026-03-05
**Confidence:** MEDIUM-HIGH
**Focus:** How multi-thread orchestration integrates with the existing Pluribus codebase

## Executive Summary

The existing Pluribus architecture has strong foundations for multi-agent orchestration but requires structural changes at four integration points: (1) assistant-ui runtime model, (2) process lifecycle management, (3) adapter unification, and (4) concurrent stream routing. The key architectural insight is that assistant-ui's `useRemoteThreadListRuntime` already supports concurrent threads with independent adapter runs -- the framework does NOT require multiple `AssistantRuntimeProvider` instances. The bottleneck is in process management and adapter unification, not in the UI runtime layer.

---

## Question 1: Multiple assistant-ui Runtimes / Concurrent Active Adapters

### Current State

The app uses a single `AssistantRuntimeProvider` wrapping the entire app, backed by `useRemoteThreadListRuntime`. This creates one `AssistantRuntime` that manages a thread list and switches between threads. The `runtimeHook` (`useLocalRuntime(createRouterAdapter())`) creates a per-thread local runtime that calls `ChatModelAdapter.run()` when the user sends a message.

```
RuntimeProvider
  └── useRemoteThreadListRuntime({ runtimeHook, adapter: threadListAdapter })
        ├── Thread list from SQLite (list/archive/delete)
        └── runtimeHook = useLocalRuntime(createRouterAdapter())
              └── RouterAdapter selects AgentSDK or Codex based on model
```

### Key Finding: Single Provider, Multiple Concurrent Runs

**assistant-ui v0.12 already supports concurrent adapter runs across different threads within a single `AssistantRuntimeProvider`.** When the user switches threads, assistant-ui creates a new `LocalRuntime` instance via the `runtimeHook`. The previous thread's adapter run continues in the background -- it is not cancelled on thread switch. The `ChatModelAdapter.run()` generator keeps yielding until completion or explicit abort.

Evidence from the codebase:
- `ThreadStatusStore` already tracks `unread` state for background threads that complete while the user views a different thread
- `RouterAdapter` receives `unstable_threadId` in options, allowing thread-scoped routing
- Both `AgentSdkSidecar.acquireLock()` and `acquireThreadRunLock()` serialize runs per-thread but allow concurrent runs across different threads

**You do NOT need multiple `AssistantRuntimeProvider` instances.** The current single-provider architecture supports the multi-agent use case.

### What Changes

The change is in how threads are presented, not in how runtimes are structured:

1. **Dashboard/grid views** need to display multiple threads simultaneously. Each panel renders a `Thread` component connected to a specific thread in the same runtime.

2. **Thread switching** becomes thread focusing. Background threads keep running. The `ThreadStatusStore` already handles this -- extend it with richer status information.

3. **Side-by-side panels** require assistant-ui's `useAui().threadListItem.switchTo(remoteId)` API to programmatically switch the active thread. For multiple visible panels, each panel needs its own runtime context.

### Multi-Panel Architecture

For showing multiple agent threads simultaneously in a grid/workspace view, there are two approaches:

**Option A: Single Runtime, Active Thread Switching (Recommended for v1)**

One `AssistantRuntimeProvider` at the top. The grid shows status cards for all threads. Only one thread renders the full chat UI at a time (the focused thread). Other threads show status badges from `ThreadStatusStore`.

```
AssistantRuntimeProvider (single)
  ├── WorkspaceGrid
  │     ├── AgentCard (thread-1, status only)
  │     ├── AgentCard (thread-2, status only)
  │     └── AgentCard (thread-3, status only, focused)
  └── ThreadDetailPanel (thread-3, full chat via assistant-ui Thread)
```

Pros: Simple, works with existing assistant-ui API, no framework hacks.
Cons: Only one full chat view at a time.

**Option B: Multiple Runtime Providers for Split View (v1.1+)**

For truly concurrent visible panels, wrap each panel in its own `AssistantRuntimeProvider` with its own `useRemoteThreadListRuntime`. Each runtime manages a single thread. The thread list adapter filters to show only the assigned thread.

```
App
  ├── AssistantRuntimeProvider (panel-1, thread-1)
  │     └── Thread (full chat)
  ├── AssistantRuntimeProvider (panel-2, thread-2)
  │     └── Thread (full chat)
  └── Shared state via Zustand (ThreadStatusStore, AgentRegistry)
```

This works because `useRemoteThreadListRuntime` creates independent runtime instances. Each gets its own `runtimeHook` call, its own `LocalRuntime`, and its own `ChatModelAdapter`. The adapters share the underlying `AgentSdkSidecar` singleton and `AgentRegistry` -- the isolation is at the UI layer, not the process layer.

**Recommendation:** Start with Option A. The dashboard-first UX (from PROJECT.md) naturally maps to a status-overview + drill-down pattern. Split-view adds complexity without clear v1 value.

### Integration Points (assistant-ui Runtime)

| What | Current | Change | Impact |
|------|---------|--------|--------|
| `RuntimeProvider.tsx` | Single `AssistantRuntimeProvider` | Keep single provider for v1 | None |
| `runtimeHook` | `useLocalRuntime(createRouterAdapter())` | Keep, but router adapter delegates to AgentRegistry | Modify `router-adapter.ts` |
| `threadListAdapter` | `createSQLiteThreadListAdapter()` | Keep, add workspace filtering | Modify `sqlite-thread-list-adapter.ts` |
| `ThreadWorkspace.tsx` | Thread list sidebar + single Thread panel | Replace with Dashboard/Workspace/Agent views | New components, keep Thread primitive |
| `ThreadStatusStore` | Simple status tracking | Becomes central orchestration state hub | Extend significantly |

---

## Question 2: Process Lifecycle Management for N Concurrent CLI Processes

### Current Process Architecture

Three distinct process management patterns exist today:

| Adapter | Process Model | Lifecycle | Concurrency |
|---------|--------------|-----------|-------------|
| Claude CLI (claude-adapter) | One `sh -c` child per run | Spawned per `run()`, killed on abort/completion | Per-thread serialized via `acquireThreadRunLock()` |
| Agent SDK (agent-sdk-adapter) | Singleton Bun sidecar, multiplexed queries | Lazily spawned, kept alive indefinitely | Per-thread serialized via `sidecar.acquireLock()`, cross-thread concurrent |
| Codex (codex-adapter) | Singleton Rust-managed `codex app-server` | Lazily spawned via `codex_start_thread` | Per-thread via Codex thread IDs |

### Process Pool Design for N Agents

The three models need unification into a process pool that supports N concurrent agents.

**Recommended Architecture: AgentProcessManager**

```typescript
/**
 * Manages OS-level processes for all active agents.
 * Each agent thread owns exactly one process slot.
 * Processes survive thread navigation (UI focus changes).
 * Processes are killed only on explicit user action or app exit.
 */
interface AgentProcessManager {
  /** Acquire a process for a thread. May reuse an idle process or spawn new. */
  acquire(threadId: string, provider: string, opts: ProcessOpts): Promise<ProcessHandle>;

  /** Release a thread's process (on explicit stop or thread deletion). */
  release(threadId: string): Promise<void>;

  /** Release all processes (app exit). */
  releaseAll(): Promise<void>;

  /** Get process handle for a thread (null if no active process). */
  get(threadId: string): ProcessHandle | null;

  /** Current count of active processes. */
  activeCount(): number;

  /** Subscribe to process lifecycle events. */
  onEvent(cb: (event: ProcessEvent) => void): () => void;
}

type ProcessEvent =
  | { type: "spawned"; threadId: string }
  | { type: "exited"; threadId: string; code: number | null }
  | { type: "crashed"; threadId: string; error: string }
  | { type: "released"; threadId: string };

interface ProcessHandle {
  threadId: string;
  provider: string;
  child: Child | null;       // Tauri shell Child (Claude CLI)
  sidecarRef: string | null; // Sidecar query routing key (Agent SDK)
  codexThreadId: string | null; // Codex thread ID
  status: "starting" | "ready" | "busy" | "exiting";
  spawnedAt: number;
  cwd: string;
}
```

### Per-Provider Process Strategy

**Agent SDK (Claude):** Keep the multiplexed sidecar. The `AgentSdkSidecar` class already routes queries by `queryId`. For N concurrent agents, each gets a unique `queryId`. The sidecar handles concurrency internally. No process-per-agent needed.

Change: Extract the sidecar singleton from `agent-sdk-adapter.ts` into `AgentProcessManager` so it's shared infrastructure, not adapter-private state.

```
Before: agent-sdk-adapter.ts owns `const sidecar = new AgentSdkSidecar()`
After:  AgentProcessManager owns sidecar, passes reference to provider
```

**Codex:** Keep the singleton `codex app-server` managed by Rust. Each agent gets a Codex thread ID. The `CodexService` already handles multiplexing via thread-scoped subscriptions.

Change: Move thread ID management from `codex-adapter.ts` into `AgentProcessManager`.

**Claude CLI (shell):** Each run spawns a new `sh -c claude ...` process. For multi-agent, this means N concurrent child processes. The existing `activeChildByThread` Map tracks one child per thread.

Change: `AgentProcessManager` replaces `activeChildByThread`. The per-thread lock (`acquireThreadRunLock`) moves into the process manager.

### Resource Limits

```typescript
interface ProcessPoolConfig {
  /** Max concurrent running agents (actively streaming). Default: 10 */
  maxConcurrentRuns: number;

  /** Max total spawned processes (including idle). Default: 20 */
  maxTotalProcesses: number;

  /** Auto-release idle processes after this many ms. Default: 300000 (5min) */
  idleTimeoutMs: number;
}
```

When `maxConcurrentRuns` is reached, new runs queue in the AgentRegistry and start when a slot opens. The UI shows "queued" status. This prevents the machine from being overwhelmed by 20+ concurrent Claude CLI processes.

### Process Lifecycle State Machine

```
    spawn()          run()           complete/abort
  ──────────> READY ──────> BUSY ──────────> READY
                |                              |
                |        idleTimeout           |
                └──────────────> RELEASED <────┘
                                    |     release()
                crash               |
  READY/BUSY ─────────> CRASHED ────┘
```

### What Moves Where

| Current Location | Concern | New Location |
|-----------------|---------|--------------|
| `claude-adapter.ts` `activeChildByThread` | Child process tracking | `AgentProcessManager` |
| `claude-adapter.ts` `acquireThreadRunLock` | Per-thread run serialization | `AgentProcessManager.acquire()` |
| `claude-adapter.ts` `sessionByThread` | Session ID mapping | `AgentProcessManager` (part of ProcessHandle) |
| `agent-sdk-adapter.ts` `const sidecar` | Sidecar singleton | `AgentProcessManager` (shared infrastructure) |
| `codex-adapter.ts` `getOrCreateCodexThread` | Codex thread creation | `AgentProcessManager` |
| `thread-status-store.ts` | Status tracking | Stays, but `AgentProcessManager` drives status changes |

---

## Question 3: Unified Provider Abstraction

### Current Adapter Interfaces

All three adapters implement `ChatModelAdapter` from assistant-ui:

```typescript
interface ChatModelAdapter {
  run(options: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void>;
}
```

But they each manage their own:
- Process lifecycle (spawn, kill, restart)
- Session management (session IDs, resume logic)
- Thread config loading (model, cwd, effort from SQLite)
- Status reporting (to ThreadStatusStore)
- Dev event logging

### Recommended Unified Interface

Split the adapter into two layers:

**Layer 1: AgentProvider (protocol-specific, stateless)**

Handles only the wire protocol translation between Pluribus events and the specific backend format. Does NOT manage processes, sessions, or status.

```typescript
interface AgentProvider {
  readonly id: "agent-sdk" | "codex" | "shell";
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  /**
   * Execute a single run against a process handle.
   * Yields ChatModelRunResult chunks.
   * Does NOT manage process lifecycle -- caller provides the handle.
   */
  run(ctx: RunContext): AsyncGenerator<ChatModelRunResult, void>;

  /**
   * Interrupt the current run on a process handle.
   */
  interrupt(handle: ProcessHandle): Promise<void>;
}

interface RunContext {
  handle: ProcessHandle;
  prompt: string;
  sessionId: string | null;
  model: string;
  cwd: string;
  abortSignal: AbortSignal;
  threadId: string;
  onDevEvent: (event: DevEvent) => void;
}

interface ProviderCapabilities {
  supportsResume: boolean;       // Session resume via session ID
  supportsApproval: boolean;     // Tool approval flow (Codex)
  supportsSubAgents: boolean;    // Sub-agent tracking (Claude)
  supportsMcp: boolean;          // MCP server config passthrough
}
```

**Layer 2: OrchestratedAdapter (single implementation, wraps any provider)**

This replaces `RouterAdapter`. It handles all the cross-cutting concerns that currently live in each adapter:

```typescript
function createOrchestratedAdapter(
  registry: AgentRegistry,
  processManager: AgentProcessManager,
): ChatModelAdapter {
  return {
    async *run(options) {
      const threadId = options.unstable_threadId ?? "__global__";

      // 1. Load thread config from SQLite (model, cwd, effort)
      const config = await loadThreadConfig(threadId);

      // 2. Select provider based on model
      const provider = registry.getProvider(config.model);

      // 3. Acquire process handle (may queue if pool full)
      const handle = await processManager.acquire(threadId, provider.id, {
        cwd: config.cwd,
        model: config.model,
      });

      // 4. Update status
      registry.setStatus(threadId, "running");

      // 5. Resolve session ID
      const sessionId = await loadSessionId(threadId);

      try {
        // 6. Delegate to provider for protocol-specific streaming
        yield* provider.run({
          handle,
          prompt: extractUserPrompt(options.messages),
          sessionId,
          model: config.model,
          cwd: config.cwd,
          abortSignal: options.abortSignal,
          threadId,
          onDevEvent: (e) => pushDevEvent(e),
        });

        registry.setStatus(threadId, "idle");
      } catch (err) {
        registry.setStatus(threadId, "error");
        throw err;
      }
    },
  };
}
```

### Migration Path from Current Adapters

**Step 1: Extract shared utilities** (no behavior change)

Pull out shared functions that all three adapters duplicate:
- `extractUserPrompt()` -- already exported from claude-adapter, used by agent-sdk-adapter
- Thread config loading (model, cwd, effort resolution from SQLite)
- Session ID management (load/save from sessions table)
- Dev event logging

Create `src/lib/providers/shared.ts` for these.

**Step 2: Create AgentProvider implementations** (wrapping existing code)

Each provider wraps the existing adapter's `run()` logic but strips out:
- Process spawning (moved to AgentProcessManager)
- Thread config loading (moved to OrchestratedAdapter)
- Status reporting (moved to OrchestratedAdapter)
- Session persistence (moved to OrchestratedAdapter)

What remains in each provider:
- `agent-sdk-provider.ts`: Sidecar NDJSON protocol, SDK message parsing, content accumulation (~200 lines, down from 535)
- `codex-provider.ts`: Tauri event listening, Codex item mapping, approval flow (~180 lines, down from 414)
- `shell-provider.ts`: CLI argument construction, stream-json parsing, content block accumulation (~600 lines, down from 1900 in claude-adapter)

**Step 3: Create OrchestratedAdapter** (replaces RouterAdapter)

The new `router-adapter.ts` becomes `orchestrated-adapter.ts`. It contains the cross-cutting logic extracted from all three adapters.

**Step 4: Wire into RuntimeProvider** (minimal change)

```typescript
// Before
function useRuntimeHook() {
  return useLocalRuntime(useMemo(() => createRouterAdapter(), []));
}

// After
function useRuntimeHook() {
  return useLocalRuntime(useMemo(
    () => createOrchestratedAdapter(agentRegistry, processManager),
    []
  ));
}
```

### File-Level Change Map

| File | Action | Lines Before | Lines After (est.) |
|------|--------|-------------|-------------------|
| `src/lib/claude-adapter.ts` | Split into provider + shared | 1900 | Deleted (logic distributed) |
| `src/lib/agent-sdk-adapter.ts` | Split into provider | 535 | Deleted |
| `src/lib/codex-adapter.ts` | Split into provider | 414 | Deleted |
| `src/lib/router-adapter.ts` | Replaced | 48 | Deleted |
| `src/lib/providers/types.ts` | New | -- | ~80 |
| `src/lib/providers/shared.ts` | New | -- | ~150 |
| `src/lib/providers/agent-sdk-provider.ts` | New | -- | ~200 |
| `src/lib/providers/codex-provider.ts` | New | -- | ~180 |
| `src/lib/providers/shell-provider.ts` | New | -- | ~600 |
| `src/lib/providers/provider-registry.ts` | New | -- | ~60 |
| `src/lib/orchestration/orchestrated-adapter.ts` | New | -- | ~120 |
| `src/lib/orchestration/agent-process-manager.ts` | New | -- | ~200 |
| `src/lib/orchestration/agent-registry.ts` | New | -- | ~150 |

---

## Question 4: Concurrent Agent Streams to Separate UI Panels

### Data Flow: Multiple Agents Streaming Simultaneously

The critical constraint: assistant-ui's `ChatModelAdapter.run()` is an `AsyncGenerator`. Each thread's run is an independent generator that yields `ChatModelRunResult` updates. assistant-ui handles rendering these updates into the thread's message list. Multiple generators can run concurrently because they're independent async generators on different threads.

```
Thread A (Claude, running):
  OrchestratedAdapter.run() → AgentSdkProvider.run() → yields ChatModelRunResult
    → assistant-ui renders in Thread A's message list

Thread B (Codex, running):
  OrchestratedAdapter.run() → CodexProvider.run() → yields ChatModelRunResult
    → assistant-ui renders in Thread B's message list (if visible)

Thread C (Claude, idle):
  No active generator. Last ChatModelRunResult persisted in SQLite.
```

### Stream Isolation

Each adapter run already operates in an isolated context:
- **Agent SDK:** Queries identified by `queryId`. The sidecar's `handlers` Map routes responses to the correct generator. Multiple concurrent queries are supported.
- **Codex:** Events filtered by `thread_id` in the Tauri event listener. Multiple threads can have active turns.
- **Claude CLI:** Each run spawns its own process. `activeChildByThread` prevents duplicate processes per thread.

No additional stream isolation work is needed. The existing architecture naturally supports concurrent streams.

### UI Update Flow

```
Provider yields ChatModelRunResult
    │
    ├── assistant-ui runtime (automatic)
    │   └── Renders in the Thread component if this thread is focused
    │
    ├── ThreadStatusStore (via OrchestratedAdapter)
    │   └── Updates status: "running" | "idle" | "error" | "waiting-approval"
    │       └── Dashboard/WorkspaceGrid re-renders status badges
    │
    └── DevEventStore (via onDevEvent callback)
        └── DevPanel shows raw events for the focused thread
```

### Throttling for Non-Focused Agents

When 5+ agents stream simultaneously but only one is visible in the full chat view, unnecessary React renders waste CPU. The throttling strategy:

1. **Focused thread:** Full-speed rendering. Every `ChatModelRunResult` yield triggers a React update. This is the current behavior.

2. **Background threads:** `ThreadStatusStore` updates at most 2Hz. The `OrchestratedAdapter` wraps provider yields with a throttle:

```typescript
// In OrchestratedAdapter, for non-focused threads:
const isFocused = threadStatusStore.currentThreadId === threadId;
const throttleMs = isFocused ? 0 : 500;

let lastYieldTime = 0;
let pendingResult: ChatModelRunResult | null = null;

for await (const chunk of provider.run(ctx)) {
  if (isFocused || Date.now() - lastYieldTime > throttleMs) {
    yield chunk;
    lastYieldTime = Date.now();
    pendingResult = null;
  } else {
    pendingResult = chunk; // Buffer, yield on next tick
  }
}

// Always yield the final result
if (pendingResult) yield pendingResult;
```

3. **Status-only updates:** For the workspace grid view showing many agents, only status changes propagate. No content streaming to non-visible threads.

### Concurrent Stream Architecture Diagram

```
                        ┌─────────────────────────────┐
                        │     AssistantRuntimeProvider  │
                        │     (single, app-level)       │
                        └─────────────┬───────────────┘
                                      │
                   ┌──────────────────┼──────────────────┐
                   │                  │                   │
            Thread A (focused)  Thread B (bg)      Thread C (bg)
                   │                  │                   │
          ┌────────┴────────┐  ┌──────┴──────┐    ┌──────┴──────┐
          │OrchestratedAdapt│  │Orchestrated │    │Orchestrated │
          │  (full speed)   │  │ (throttled) │    │ (throttled) │
          └────────┬────────┘  └──────┬──────┘    └──────┬──────┘
                   │                  │                   │
          ┌────────┴────────┐  ┌──────┴──────┐    ┌──────┴──────┐
          │AgentSdkProvider │  │CodexProvider │    │AgentSdkProv │
          └────────┬────────┘  └──────┬──────┘    └──────┬──────┘
                   │                  │                   │
          ┌────────┴────────────────┐ │           ┌──────┴──────┐
          │  AgentSdkSidecar        │ │           │  (same      │
          │  (shared, multiplexed)  │ │           │   sidecar)  │
          │  queryId: "abc"         │ │           │  queryId:   │
          │  queryId: "xyz" ◄───────┼─┼───────────┤  "xyz"     │
          └─────────────────────────┘ │           └─────────────┘
                                      │
                               ┌──────┴──────┐
                               │CodexService │
                               │ (Rust, one  │
                               │  process)   │
                               └─────────────┘
```

---

## Component Boundary Summary

### New Components

| Component | Responsibility | Depends On |
|-----------|---------------|------------|
| `AgentProcessManager` | Process pool: spawn, track, release, resource limits | Tauri shell plugin, sidecar |
| `AgentRegistry` | Agent lifecycle: spawn, kill, status, workspace queries | `AgentProcessManager`, providers, `ThreadStatusStore` |
| `OrchestratedAdapter` | Unified `ChatModelAdapter`: config loading, provider routing, status | `AgentRegistry`, `AgentProcessManager`, providers |
| `ProviderRegistry` | Maps model IDs to provider instances | Provider implementations |
| Workspace/Dashboard UI | Multi-agent overview, navigation | `AgentRegistry`, `ThreadStatusStore` |

### Modified Components

| Component | Change |
|-----------|--------|
| `RuntimeProvider.tsx` | Swap `createRouterAdapter()` for `createOrchestratedAdapter()` |
| `ThreadStatusStore` | Add agent count, workspace filtering, queue status |
| `sqlite-thread-list-adapter.ts` | Add workspace-scoped thread filtering |
| `db.ts` | No schema changes needed (workspace/thread tables already exist) |
| `ThreadWorkspace.tsx` | Replace with dashboard/workspace navigation |

### Deleted Components

| Component | Replaced By |
|-----------|-------------|
| `claude-adapter.ts` | `shell-provider.ts` + `shared.ts` + `orchestrated-adapter.ts` |
| `agent-sdk-adapter.ts` | `agent-sdk-provider.ts` + `agent-process-manager.ts` |
| `codex-adapter.ts` | `codex-provider.ts` |
| `router-adapter.ts` | `orchestrated-adapter.ts` |

---

## Suggested Build Order

Build order is dictated by dependency chains. Each phase produces a working app.

### Phase 1: Provider Abstraction (refactor only, no new features)

**Goal:** Split existing adapters into Provider interface + OrchestratedAdapter without changing behavior.

1. Create `src/lib/providers/types.ts` -- AgentProvider interface
2. Create `src/lib/providers/shared.ts` -- extracted shared utilities
3. Create `src/lib/providers/agent-sdk-provider.ts` -- wrap existing sidecar logic
4. Create `src/lib/providers/codex-provider.ts` -- wrap existing Codex logic
5. Create `src/lib/providers/shell-provider.ts` -- wrap existing CLI logic (biggest file)
6. Create `src/lib/orchestration/orchestrated-adapter.ts` -- replaces router-adapter
7. Update `RuntimeProvider.tsx` to use new adapter
8. Delete old adapter files

**Depends on:** Nothing. Pure refactor.
**Validates:** Provider interface works. App behavior unchanged.
**Risk:** `claude-adapter.ts` at 1900 lines is the hardest to decompose. The stream processing state machine is deeply coupled to session management.

### Phase 2: AgentProcessManager + AgentRegistry

**Goal:** Centralized process and agent lifecycle management.

1. Create `src/lib/orchestration/agent-process-manager.ts`
2. Move sidecar singleton, child tracking, session management into process manager
3. Create `src/lib/orchestration/agent-registry.ts`
4. Wire registry into OrchestratedAdapter
5. Extend `ThreadStatusStore` with agent count, workspace filtering

**Depends on:** Phase 1 (providers exist as separate modules).
**Validates:** Multiple agents can run concurrently with centralized tracking.

### Phase 3: Multi-Agent UI

**Goal:** Dashboard and workspace views that show multiple agents.

1. Create workspace grid view with agent status cards
2. Wire status cards to `ThreadStatusStore`
3. Create drill-down navigation (card click -> full Thread view)
4. Add "New Agent" spawn flow through `AgentRegistry`
5. Add background completion notifications

**Depends on:** Phase 2 (AgentRegistry provides status data).
**Validates:** Full multi-agent orchestration UX.

### Phase 4: Resource Management + Polish

**Goal:** Process pool limits, idle timeout, graceful shutdown.

1. Implement `maxConcurrentRuns` queuing in AgentProcessManager
2. Implement idle timeout (release processes for idle agents)
3. Implement app-exit cleanup (`releaseAll()`)
4. Add resource usage display in Dashboard
5. Background thread yield throttling

**Depends on:** Phase 3 (multi-agent UX exists to exercise resource limits).
**Can be deferred:** MVP works without resource limits if agent count stays under 10.

---

## Anti-Patterns to Avoid

### Multiple AssistantRuntimeProviders for Concurrency

**Do not** create separate `AssistantRuntimeProvider` instances to achieve concurrent agent runs. The single runtime already supports this. Multiple providers create state synchronization nightmares between independent thread lists.

**Exception:** Split-view panels (v1.1+) may need per-panel providers, but this is a UI concern, not a concurrency concern.

### Process Management in Adapters

**Do not** let provider implementations manage their own process lifecycle. The current architecture has three separate process management strategies (one per adapter). This makes resource limiting impossible because no single component knows how many processes exist.

### Direct Store Access from Providers

**Do not** have providers write directly to `ThreadStatusStore` or `db.sessions`. Route all state changes through `AgentRegistry` / `OrchestratedAdapter`. This keeps the data flow unidirectional: Provider -> OrchestratedAdapter -> Registry -> Store -> UI.

---

## Sources

- [assistant-ui AssistantRuntime API](https://www.assistant-ui.com/docs/api-reference/runtimes/assistant-runtime) -- runtime architecture and thread management
- [assistant-ui LocalRuntime](https://www.assistant-ui.com/docs/runtimes/custom/local) -- ChatModelAdapter contract
- assistant-ui v0.12 source (`node_modules/@assistant-ui/react/src/legacy-runtime/`) -- verified `useRemoteThreadListRuntime` supports concurrent thread runs, `allowNesting` option for nested providers
- Existing codebase analysis: `RuntimeProvider.tsx`, `router-adapter.ts`, `claude-adapter.ts`, `agent-sdk-adapter.ts`, `codex-adapter.ts`, `thread-status-store.ts`, `db.ts`
- [Tauri 2 Process Model](https://v2.tauri.app/concept/process-model/) -- process lifecycle in Tauri apps

---
*Architecture research for: multi-thread agent orchestration integration*
*Researched: 2026-03-05*

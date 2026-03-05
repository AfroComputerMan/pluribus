# Pitfalls Research

**Domain:** Multi-thread agent orchestration added to existing single-thread Tauri 2 desktop app
**Researched:** 2026-03-05
**Confidence:** HIGH (grounded in direct codebase analysis, documented Claude CLI bugs, Tauri issues)

## Critical Pitfalls

### Pitfall 1: SQLite Write Contention from Concurrent Agent Streams

**What goes wrong:**
Multiple agents running simultaneously all write to `pluribus.db` via `tauri-plugin-sql`. The current `db.ts` has no WAL mode, no busy timeout, and no write batching for most operations. Each agent stream triggers individual `conn.execute()` calls for session upserts, message appends, usage snapshots, mcp invocations, and dev events. With 5 concurrent agents, this is dozens of write transactions per second racing on SQLite's exclusive write lock. Result: `SQLITE_BUSY` errors that silently drop agent state, or multi-second write latency that makes status updates appear frozen.

**Why it happens:**
The `getDb()` singleton (line 15 of `db.ts`) opens the connection with no PRAGMA configuration. SQLite defaults to `DELETE` journal mode which locks the entire database for every write. The only batched write is `devEventsInsertBatch()` (line 540); everything else -- `sessionsUpsert()`, `messagesAppend()`, `usageSnapshotsInsert()`, `mcpInvocationsInsert()` -- is a single statement fired synchronously from streaming callbacks. This was fine for one agent but breaks at N > 2.

**How to avoid:**
1. Add `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` to `getDb()` immediately after `Database.load()`. This is a two-line fix that allows concurrent reads during writes and retries instead of throwing.
2. Implement a write queue: high-frequency writes (dev events, usage snapshots) go into a memory buffer that flushes every 250ms in a single transaction.
3. For session state updates, debounce writes -- the `sessionsUpsert` call during streaming does not need to persist on every status change, only on meaningful transitions.
4. Use `BEGIN IMMEDIATE` transactions for multi-step operations to fail fast rather than deadlocking.

**Warning signs:**
- `SQLITE_BUSY` errors or `database is locked` messages in console
- Agent state in DB lagging behind actual process state by seconds
- Dev events or usage data appearing missing after concurrent runs
- SQLite journal files (`pluribus.db-wal`, `pluribus.db-shm`) growing very large

**Phase to address:**
Phase 1 (Foundation). WAL mode and busy timeout are prerequisite PRAGMAs that must exist before any concurrent agent work. Write batching is Phase 2 optimization.

---

### Pitfall 2: Orphaned Processes and Resource Exhaustion

**What goes wrong:**
Three independent failure modes compound in multi-agent:

**(a) Zombie processes on crash/force-quit:** The app tracks processes in in-memory Maps (`activeChildByThread` at line 167 of `claude-adapter.ts`, `this.child` in `AgentSdkSidecar`). On crash, these Maps are lost. Each orphaned Claude CLI process consumes 270-370MB RAM and API credits indefinitely. With 5+ agents, that is 1.5GB+ of leaked memory.

**(b) Process tree incompleteness:** The `sh -c` wrapper spawns `sh` which `exec`s to `claude`. If `exec` fails, `sh` persists as a zombie. The Bun sidecar (`agent-sdk-bridge`) spawns its own child processes via `@anthropic-ai/claude-agent-sdk` -- killing the sidecar does NOT kill SDK-managed agent processes because they are in a separate process tree.

**(c) Resource exhaustion:** Each agent spawns at least one process (CLI mode) or shares one sidecar process (SDK mode). Title generation (`prefetchTitle` in `sqlite-thread-list-adapter.ts`, line 46) spawns an ADDITIONAL `claude` process per new thread. With 10 agents, that is potentially 20 Claude CLI processes at peak.

**Why it happens:**
Process lifecycle management was designed for one-at-a-time execution. The `activeChildByThread` Map stores only the LATEST child per thread key. The HMR cleanup (line 1972) iterates and kills all tracked children, but this only runs during hot reload, not on app exit. No PIDs are persisted to SQLite for crash recovery. No process groups are used.

**How to avoid:**
1. Persist active agent PIDs to SQLite when spawning, clear on clean exit. On app startup, check for stale PIDs and kill them.
2. Use process groups (Tauri shell plugin supports this on Unix) so `killpg()` terminates the entire process tree.
3. Implement a hard concurrent agent limit (default 5-8) enforced by a semaphore in the orchestrator. Queue excess launch requests.
4. Replace the `sh -c` wrapper with direct `Command.create("claude", [...args])` to eliminate the shell process layer.
5. Eliminate the separate `prefetchTitle` CLI spawn -- extract titles from the agent's first response instead.
6. For the sidecar, implement structured shutdown: send a `shutdown` message, wait 3 seconds, then kill. Track sidecar-spawned child PIDs.
7. Wire Tauri's `RunEvent::ExitRequested` in `lib.rs` to kill all registered agent processes.

**Warning signs:**
- `claude` or `codex` processes visible in task manager after closing Pluribus
- RAM usage not returning to baseline after stopping all agents
- Startup sweep finding orphaned PIDs from previous sessions
- System fan running after closing the app

**Phase to address:**
Phase 1 (Provider Abstraction). Process lifecycle is a core provider responsibility. The provider interface must require `cleanup()` and `killAll()` methods.

---

### Pitfall 3: assistant-ui Runtime Aborts Background Agents on Thread Switch

**What goes wrong:**
The `useLocalRuntime` hook creates a single-thread runtime. When the user navigates between agent threads, assistant-ui fires the `abortSignal` on the previous thread's `run()` call. The current adapters all respect this signal by killing the child process:
- `claude-adapter.ts` line 1382-1389: `abortSignal.addEventListener("abort", () => { void child.kill(); })`
- `agent-sdk-adapter.ts` line 203-209: `abortSignal.addEventListener("abort", () => { void this.send({ type: "interrupt", queryId: id }); })`

This means switching from Agent A's view to Agent B's view KILLS Agent A's process. This is correct for single-chat but fatal for multi-agent orchestration where agents must continue running in the background.

**Why it happens:**
assistant-ui's `useLocalRuntime` was designed for "one conversation at a time." The `abortSignal` does not distinguish between "user cancelled this agent" and "user navigated away." The existing codebase uses `unstable_` APIs (`unstable_useRemoteThreadListRuntime`, `unstable_threadId`, `unstable_Provider`) suggesting it is already pushing assistant-ui beyond its designed use case.

**How to avoid:**
1. Build an `AgentOrchestrator` layer that owns process lifecycle INDEPENDENTLY of assistant-ui's runtime. The orchestrator spawns, monitors, and kills processes. assistant-ui only renders whatever the orchestrator has for the currently viewed thread.
2. The adapter's `run()` method should NOT directly spawn processes. Instead, it should connect to the orchestrator's existing stream for that thread. If the user aborts via the signal, the adapter disconnects from the stream but the orchestrator keeps the process alive.
3. Add a separate "user explicitly stopped this agent" action (a stop button) that tells the orchestrator to kill the process. This is distinct from the abort signal.
4. For split-pane views (viewing multiple agents simultaneously), instantiate separate `useLocalRuntime` per pane with isolated React context boundaries.
5. Fire-and-forget agents do not need assistant-ui at all -- render them with custom status components that read directly from the orchestrator's state.

**Warning signs:**
- Background agent processes dying when the user switches thread views
- Agent shows "running" in sidebar but `ps` shows no corresponding process
- Returning to a thread shows stale content that does not match actual agent progress
- `abortSignal.aborted` is `true` in adapter runs that should still be alive

**Phase to address:**
Phase 1 (Architecture). This is THE most fundamental design decision. The orchestrator must be designed and implemented before any multi-agent UI features. Getting this wrong requires a rewrite.

---

### Pitfall 4: UI Render Thrashing from N Concurrent Streams

**What goes wrong:**
Each agent adapter yields `ChatModelRunResult` at high frequency. The `claude-adapter.ts` uses `YIELD_THROTTLE_MS = 16` (line 164, ~60fps). Each yield sends the FULL `pendingContent` array (the adapter accumulates and snapshots the entire content array on every delta). With 5 concurrent agents:
- 300+ React state updates per second across all agents
- Each update triggers re-renders of: the focused thread view, sidebar status indicators, dashboard agent cards, and any overview components
- The `[...pendingContent]` spread on every yield (line 1631 and many others) creates new array references that defeat React's referential equality checks

**Why it happens:**
The adapters were optimized for single-agent responsiveness. The `YIELD_THROTTLE_MS = 16` targets 60fps for smooth streaming. Global state stores (the dev event system uses `useSyncExternalStore` with a `devListeners` Set at line 296) notify ALL subscribers on ANY agent's update. The sidebar's thread list re-renders whenever any thread's status changes. There is no per-agent state isolation.

**How to avoid:**
1. Differentiate between "focused agent" (16ms yields, full fidelity) and "background agents" (200-500ms yields, batched). The orchestrator should manage this distinction.
2. Use per-agent external stores with `useSyncExternalStore`. Components subscribe only to the specific agent they display. The sidebar subscribes to a derived "agent statuses" store, not individual content streams.
3. For the dashboard/overview, poll agent states on a 500ms-1s interval rather than subscribing to every content delta.
4. Use structural sharing for the content array -- only create a new reference when content actually changes, not on every yield.
5. The dev event system's circular buffer (500 events max, line 160) must be per-agent-scoped for rendering but can share backing storage. The current global `devListeners` Set (line 296) fires all listeners on any event -- switch to per-thread listener Sets.

**Warning signs:**
- React DevTools Profiler showing 200+ renders/second in sidebar or dashboard components
- Tauri window frame drops during multi-agent streaming (check Chromium DevTools Performance panel)
- Memory climbing steadily during concurrent runs (GC unable to keep up with object allocation from array spreads)
- Input lag in the composer when multiple agents are streaming

**Phase to address:**
Phase 2-3 (Multi-Agent UI). The architecture decisions (per-agent stores, focused vs background throttling) must be in the design from Phase 1, but the implementation and tuning happen when building the multi-agent UI.

---

### Pitfall 5: Claude CLI Concurrent Session Corruption

**What goes wrong:**
Running multiple Claude CLI processes simultaneously causes `.claude.json` corruption via non-atomic read-modify-write cycles. Documented in GitHub issues #28829 and #29003 -- corruption happens ~16 times per hour with just two concurrent instances. Concurrently, OAuth token refresh races (`~/.claude/.credentials.json`) where the loser gets a 404 and silently loses authentication (issue #27933). Context bleeding between sessions has also been reported (issue #2272).

**Why it happens:**
Claude CLI was designed as a single-user, single-instance tool. All sessions share a single global config file written on every tool call. There is no file locking. Pluribus's core value proposition directly conflicts with this design assumption.

**How to avoid:**
1. Strongly prefer the Agent SDK adapter for multi-agent use cases -- the SDK does not share a global config file and is inherently safe for concurrent use.
2. If CLI mode is necessary, serialize CLI process spawning through a global mutex (not per-thread, but per-system) to prevent concurrent `.claude.json` writes.
3. Explore `CLAUDE_CONFIG_DIR` environment variable to isolate CLI instances (if supported).
4. Implement an OAuth token management layer that handles refresh centrally.
5. Set a hard limit on concurrent CLI-mode agents (recommend max 2) while allowing more for SDK-mode agents.

**Warning signs:**
- JSON parse errors in Claude CLI stderr output
- Agents randomly failing authentication mid-session
- Agents seeing context from other sessions
- Sporadic 404 errors during normal operation

**Phase to address:**
Phase 1 (Provider Abstraction). The CLI provider must include a concurrency guard. Default new agents to SDK mode. CLI mode should display a warning about concurrent limitations.

---

### Pitfall 6: Lock Contention and Deadlock Across Unified Adapter

**What goes wrong:**
The codebase has TWO independent locking mechanisms:
1. `claude-adapter.ts` (line 651-696): `activeThreadRuns` Set + `pendingThreadRunWaiters` Map with FIFO queue and 60-second timeout
2. `agent-sdk-adapter.ts` (line 62-74): `threadLocks` Map with promise chaining

When unifying these into a single provider abstraction, the lock semantics must be reconciled. If an agent switches engines mid-session, or if the orchestrator uses one lock system while the adapter uses another, agents can deadlock (both locks held, each waiting for the other) or run concurrently on the same thread (neither lock held because the wrong one was checked).

**Why it happens:**
Each adapter was built independently with its own concurrency model. The `THREAD_LOCK_TIMEOUT_MS = 60_000` is a safety valve, but 60 seconds is a long silent hang before the user sees an error. The sidecar's promise-chain lock has no timeout at all -- a crashed query that never resolves its promise chain permanently blocks that thread's lock.

**How to avoid:**
1. Move all locking into the orchestrator layer. Adapters do not manage concurrency -- the orchestrator decides when a thread can run.
2. Use a single lock mechanism. The sidecar's promise-chaining pattern is cleaner but must add a timeout.
3. Reduce lock timeout to 10-15 seconds for multi-agent (the user should know quickly if something is wrong).
4. Add lock state to the agent status display: "waiting for lock" is a valid state the user should see, not a silent hang.
5. Implement deadlock detection: if thread A holds lock X and waits for lock Y, while thread B holds lock Y and waits for lock X, surface the deadlock immediately.

**Warning signs:**
- "Timed out waiting for thread lock" errors in console
- Agent stuck in "starting" state for extended periods
- Two processes running on the same thread simultaneously (visible via PID check)
- Session state corruption from concurrent writes to the same session

**Phase to address:**
Phase 1 (Provider Abstraction). Centralize locking when unifying the three adapters. The orchestrator owns all concurrency control.

---

### Pitfall 7: State Desynchronization Between Process Reality and UI Display

**What goes wrong:**
The UI shows an agent as "running" but the process has exited. Or the reverse: the process is actively writing files but the UI shows "idle." The user takes actions based on stale state -- tries to abort a dead agent (silent failure), or launches a new task on a thread that is still executing (state corruption). With N agents, the probability of at least one being desynchronized grows rapidly.

**Why it happens:**
Agent state currently lives in multiple unsynchronized layers:
- **Process layer**: the actual OS process (alive or dead)
- **Adapter layer**: in-memory Maps (`activeChildByThread`, `sessionByThread`, `activeThreadRuns` -- lines 156-159 of `claude-adapter.ts`)
- **Database layer**: `sessions` table with `status` field
- **UI layer**: React state derived from the above

The `close` event on Tauri's `Command` is the bridge between process and adapter layers, but if the handler throws, the component unmounts, or the event is missed during a thread switch, the adapter layer gets stuck. There is no periodic reconciliation.

**How to avoid:**
1. Use a finite state machine for agent lifecycle: `idle -> starting -> running -> stopping -> stopped | error | completed`. Log and validate every transition. Reject invalid transitions (e.g., `stopped -> running` without `starting`).
2. Persist agent state to SQLite on every transition. The database is the single source of truth, not in-memory Maps.
3. Implement a heartbeat/reconciliation loop (every 5-10 seconds) that checks whether tracked PIDs are still alive. Update state immediately on mismatch.
4. When the user interacts with an agent (abort, send message), validate process state first. If process is dead but state says "running," trigger immediate reconciliation and surface the error.
5. Add a "last seen alive" timestamp per agent. Display staleness in the UI: "Running (last activity 45s ago)" becomes a visual warning.

**Warning signs:**
- Agents stuck in "running" state with no output for extended periods
- "Kill" button does nothing (process already dead, no error shown)
- Console errors about writing to closed stdin/processes
- Agent completion events arriving long after the process exited

**Phase to address:**
Phase 2 (Agent Lifecycle). The state machine must be part of the orchestrator core, implemented before any UI is built on top.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keeping 3 separate adapter files with independent state | No refactoring needed, ship faster | Every cross-cutting concern (locking, cleanup, state tracking, error handling) must be implemented 3 times; bugs fixed in one are missed in others | Never -- unify before multi-agent |
| In-memory Maps for process tracking | Simple, fast lookups | State lost on crash, no recovery, no cross-window visibility, grows linearly with agents | Never for multi-agent -- persist PIDs to SQLite |
| `void` prefix on DB writes (fire-and-forget) | Non-blocking hot path | Silent data loss; agent state transitions silently fail without error propagation | Only for truly optional data (dev events); never for session or status state |
| `sh -c` shell wrapper for CLI invocation | Works around stdin pipe detection | Extra process per agent, shell injection surface, platform-specific behavior | Never -- replace with direct invocation before multi-agent |
| Spawning separate CLI process for title generation | Responsive UX, simple implementation | With N agents, that is 2N processes at startup (agent + title generator) | Never at multi-agent scale -- extract title from agent's first response |
| Single global dev event buffer (500 entries) | Simple implementation | With N agents writing to one buffer, agent A's events push out agent B's events; dev panel becomes unusable | Only if per-agent filtering is added |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| assistant-ui `abortSignal` in adapters | Treating abort as "user wants to stop the agent" -- killing the process on abort | Abort fires on BOTH thread switch AND user cancel. The orchestrator must distinguish these. Adapter disconnects from stream on abort; only orchestrator can kill the process |
| assistant-ui `useLocalRuntime` | Assuming it manages concurrent thread execution | Runtime manages one active thread at a time. Use a separate orchestrator for background agent execution |
| assistant-ui `unstable_` APIs | Using them without version pinning | These APIs change without semver guarantees. Pin assistant-ui version and audit on every update |
| Tauri `Command.create` / `Command.sidecar` | Assuming `close` event always fires | The `close` event can be missed during component unmount or if the event loop is blocked. Always have a PID-based fallback check |
| `tauri-plugin-sql` SQLite | Assuming the plugin handles concurrency automatically | The plugin passes through to rusqlite with no concurrency configuration. YOU must set WAL mode and busy timeout |
| Claude CLI `--resume` | Assuming resume always succeeds | Session can be "in use" by another process, file can be missing, or session can be expired. Implement the full retry chain: resume -> session-id -> fresh |
| Bun sidecar query cleanup | Assuming sidecar `close` event cleans up all in-flight queries | The current `close` handler (line 110-115 of `agent-sdk-adapter.ts`) sends error to all handlers but does not verify the SDK-level agent processes are stopped |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| 60fps yield rate for all agents (`YIELD_THROTTLE_MS = 16`) | UI freezes, dropped frames, GC pressure from array spreads | 16ms for focused agent, 200-500ms for background agents | 3+ agents streaming simultaneously |
| Full `[...pendingContent]` array copy on every yield | New array reference defeats React memoization, triggers cascading re-renders | Structural sharing; only create new reference when content changes | 3+ agents with substantial content |
| Global `devListeners` Set notifies all subscribers on any agent event | Dev panel subscription causes re-renders of unrelated components | Per-agent listener Sets, or remove dev event subscription from production builds | 5+ agents with dev panel enabled |
| Individual SQLite writes per stream event | `SQLITE_BUSY` errors, write queue grows, latency spikes | Batch writes in 250ms windows, use WAL mode | 3+ concurrent writing agents |
| React context for global agent state | Entire component tree re-renders on any agent status change | Zustand with selectors, or `useSyncExternalStore` with per-agent subscriptions | 5+ agent status indicators visible |
| Unbounded IPC streaming from multiple agents | Tauri IPC channel saturation, event queue grows | Batch streaming events per agent (50ms window) before sending through IPC | 5+ agents streaming through shell plugin |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `sh` with `"args": true` in Tauri capabilities | XSS in any agent output escalates to full shell access across ALL workspaces | Remove `sh` entry; use direct `Command.create("claude", [...args])` |
| No workspace sandboxing for agents | Agent A can read/write files in Agent B's workspace directory | Validate `cwd` per-agent against workspace root; reject paths outside workspace |
| Rendering unsanitized agent output as HTML | Script injection via crafted file contents or LLM output | Sanitize all agent output with DOMPurify; render tool results as text/code, never raw HTML |
| Unbounded process spawning | User or bug launches unlimited agents, exhausting system resources and API credits | Hard limit on concurrent agents enforced at orchestrator level |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No visual distinction between abort reasons | User cannot tell if agent stopped because they switched tabs vs explicitly cancelled | Show "paused" (user navigated away, still running in background) vs "stopped" (user cancelled) vs "error" (process died) |
| Showing full streaming output for all background agents | Information overload, cannot focus | Summary status cards for background agents (one-liner + status badge); full stream only in drill-down |
| No indication of agent resource consumption | User unaware why system is slow; keeps spawning agents | Per-agent CPU/memory indicator in dashboard; system health warning when approaching limits |
| Silent failure when agent process dies | User thinks agent is still working, waits indefinitely | Immediate error toast + status badge change to red "error" state with "Restart" button |
| Losing scroll position and UI state on thread switch | User loses context every time they check another agent | Preserve per-agent scroll position and composer state; virtualized tabs that do not unmount |
| Notification spam from concurrent completions | 5 agents completing simultaneously = 5 notifications | Batch: "3 agents completed in workspace X" as single notification |

## "Looks Done But Isn't" Checklist

- [ ] **Process cleanup on app close:** Often missing -- verify that force-quitting the app leaves zero orphaned CLI processes (check with `ps aux | grep claude` after force-quit)
- [ ] **Process cleanup on thread delete:** Often missing kill-before-delete -- verify the orchestrator kills the agent process BEFORE `threadsDelete()` removes the DB row
- [ ] **Abort signal disambiguation:** Often missing -- verify that background agents continue running after the user switches to a different thread view
- [ ] **WAL mode on every connection:** Must be set in `getDb()`, not a one-time migration -- verify `PRAGMA journal_mode` returns `wal` at runtime
- [ ] **Sidecar crash recovery:** Often missing child process cleanup when sidecar dies -- verify all in-flight queries get error callbacks AND SDK-managed processes are terminated
- [ ] **PID reconciliation on startup:** Often missing -- verify app startup checks SQLite for stale agent PIDs and kills orphans
- [ ] **Per-agent dev event scoping:** Often missing -- verify dev panel shows events for the focused agent only, not interleaved from all agents
- [ ] **Concurrent agent limit enforcement:** Often missing the actual enforcement -- verify launching agent N+1 when limit is N shows a queue message, not a crash or silent failure
- [ ] **Lock timeout surface:** Often missing user feedback -- verify that lock contention is shown to the user as "Waiting for thread lock..." rather than a silent 60-second hang

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| SQLite write contention | LOW | Add `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` to `getDb()`. Two lines of code |
| Orphaned processes | MEDIUM | Add PID tracking table to SQLite, startup cleanup routine, process group management, `RunEvent::ExitRequested` handler in Rust |
| assistant-ui abort kills background agents | HIGH | Requires architectural change: build orchestrator that owns process lifecycle independently of UI runtime. Adapter connects to orchestrator stream, does not spawn processes directly |
| UI render thrashing | MEDIUM | Retrofit per-agent throttling (focused vs background), migrate to external stores with fine-grained subscriptions |
| Claude CLI corruption | MEDIUM | Default to SDK mode for multi-agent. Add global mutex for CLI spawning. Explore `CLAUDE_CONFIG_DIR` isolation |
| Lock contention / deadlock | MEDIUM | Centralize all locking in orchestrator, remove per-adapter lock implementations, add timeout + user feedback |
| State desynchronization | MEDIUM | Implement state machine with persistence, add heartbeat reconciliation, validate process state before user interactions |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| SQLite write contention | Phase 1 (Foundation) | `PRAGMA journal_mode` returns `wal`; zero `SQLITE_BUSY` errors under 5 concurrent agents |
| Orphaned processes | Phase 1 (Provider Abstraction) | Force-kill app during 5-agent run; restart; verify zero orphan processes |
| assistant-ui abort signal conflict | Phase 1 (Orchestrator Architecture) | Switch between 3 running agent threads; verify all 3 processes stay alive |
| UI render thrashing | Phase 3 (Multi-Agent UI) | 5 concurrent streaming agents; verify < 5% dropped frames in Chromium DevTools |
| Claude CLI corruption | Phase 1 (Provider Abstraction) | 3 concurrent CLI agents running 30 minutes; verify zero `.claude.json` corruption |
| Lock contention | Phase 1 (Provider Abstraction) | Rapid thread switching during concurrent agent runs; zero timeout errors |
| State desynchronization | Phase 2 (Agent Lifecycle) | Externally `kill -9` a claude process; verify UI updates within 10 seconds |

## Sources

- Direct codebase analysis: `claude-adapter.ts` (1900+ lines), `agent-sdk-adapter.ts`, `db.ts`, `RuntimeProvider.tsx`, `sqlite-thread-list-adapter.ts`
- [Claude CLI concurrent session corruption - GitHub #28829](https://github.com/anthropics/claude-code/issues/28829)
- [Claude CLI .claude.json corruption - GitHub #29003](https://github.com/anthropics/claude-code/issues/29003)
- [OAuth token refresh race condition - GitHub #27933](https://github.com/anthropics/claude-code/issues/27933)
- [Context bleeding between sessions - GitHub #2272](https://github.com/anthropics/claude-code/issues/2272)
- [Tauri: spawned children cannot be killed on Windows - GitHub #4949](https://github.com/tauri-apps/tauri/issues/4949)
- [Tauri: shell plugin multi-process termination - GitHub #11686](https://github.com/tauri-apps/tauri/issues/11686)
- SQLite WAL mode: https://www.sqlite.org/wal.html
- SQLite busy_timeout: https://www.sqlite.org/pragma.html#pragma_busy_timeout
- assistant-ui architecture: inferred from `useLocalRuntime`, `useRemoteThreadListRuntime`, and `unstable_` API usage in codebase

---
*Pitfalls research for: Multi-thread agent orchestration in Tauri 2 + React 19 + assistant-ui desktop app*
*Researched: 2026-03-05*

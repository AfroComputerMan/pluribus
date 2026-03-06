# Phase 2: Agent Registry and Lifecycle - Research

**Researched:** 2026-03-06
**Domain:** Agent lifecycle management, Zustand state management, SQLite concurrency (WAL), test infrastructure
**Confidence:** HIGH

## Summary

Phase 2 builds the AgentRegistry -- the central hub coordinating agent spawning, status tracking, concurrency limiting, and persistence. The existing codebase already has the key building blocks from Phase 1: `AgentProcessManager` for PID tracking and orphan cleanup, `ProviderRegistry` for model-to-provider routing, `OrchestratedAdapter` as the single `ChatModelAdapter`, and a `thread-status-store.ts` Zustand store that tracks per-thread status. The registry sits above these, adding concurrency governance (hard cap of 5, with queuing), richer status states, working directory selection via native dialog, and persistence of agent state across restarts.

The critical technical challenges are: (1) extending the Zustand store to support the new 5-status model (running/error/waiting-approval/completed/queued) while remaining compatible with the existing `OrchestratedAdapter` status management, (2) implementing WAL mode and write serialization for concurrent SQLite access from multiple agents, and (3) setting up a test framework from scratch (no tests exist today) per the user's TDD requirement. Vitest is the standard choice for Vite-based projects and integrates seamlessly with the existing toolchain.

**Primary recommendation:** Build `AgentRegistry` as a singleton class (like `AgentProcessManager`) that wraps the process manager, adds concurrency governance via a FIFO queue, and exposes a Zustand store for reactive UI updates. Extend the existing `threads` table with `agent_status` and `provider_type` columns rather than creating a separate agents table, since threads and agents are 1:1.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Fixed limit of 5 concurrent agents (hardcoded, not user-configurable)
- When hitting the limit, agent enters a 'queued' state with a toast: "5 agents running -- this one will start when a slot opens"
- Queued agents can be cancelled before they start
- When a slot opens and a queued agent starts, show a toast notification: "Agent [name] started (was queued)"
- On app restart, previously-running agents are marked as 'error' with a 'process lost' indicator (Phase 1 already kills orphan processes on startup)
- Crashed/errored agents can be restarted from the UI -- a 'Restart' action spawns a fresh process in the same working directory, resuming the session if possible
- Completed agents auto-archive after 7 days (removed from active list, still in DB)
- Native Tauri file picker dialog for directory selection (tauri-plugin-dialog)
- Always require explicit directory selection -- no default working directory
- Multiple agents can share the same working directory with no restrictions or warnings
- Agent display name auto-generated from the directory name (e.g., 'pluribus', 'my-api') -- can be renamed later
- Five statuses: running, error, waiting-approval, completed, queued (dropped 'idle' -- simpler model)
- Completion triggered by agent self-reporting (provider detects task completion signal)
- Completed agents can be reactivated -- sending a new message restarts the process and resumes the session, status returns to 'running'
- Error state shows status badge only -- user clicks into the thread to see error details in conversation history
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

### Deferred Ideas (OUT OF SCOPE)
- Configurable concurrency limit in settings -- can add later if users need it
- "Warn on shared working directory" -- decided against, but could add as a setting
- Agent templates/presets for common configurations -- future version
- Per-agent dev event scoping (separate buffers per agent) -- noted in Phase 1 deferred, still deferred
- Auto-resume on restart (vs current mark-as-crashed approach) -- could add when providers support it better
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ORCH-01 | AgentRegistry as central hub for all agent lifecycle operations (spawn/kill/query) | AgentRegistry class design, integration with existing AgentProcessManager and ProviderRegistry |
| ORCH-02 | Concurrency governor with configurable max concurrent agents (default 5) | ConcurrencyGovernor with FIFO queue, hardcoded limit of 5, toast notifications |
| ORCH-03 | Push-based agent status tracking via Zustand (running/idle/error/waiting-approval/completed) | Extended Zustand store replacing thread-status-store.ts with 5-status model (no idle) |
| ORCH-08 | Per-thread working directory scoping | Native Tauri dialog.open() for directory picker, threads.cwd column already exists |
| PERS-01 | Extended SQLite schema for multi-agent state | New migration adding agent_status, provider_type columns to threads table |
| PERS-02 | WAL mode enabled for concurrent write safety | WAL already enabled in migration 001; verify it persists and add PRAGMA in getDb() |
| PERS-03 | Write serialization through single-writer pattern for high-contention paths | JS-side write queue wrapping getDb() for serialized writes |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | ^5.0.11 | Agent status store | Already in use; push-based reactivity for UI |
| @tauri-apps/plugin-sql | ^2.3.2 | SQLite persistence | Already in use; WAL mode support built in |
| @tauri-apps/plugin-dialog | ^2.6.0 | Native directory picker | Already installed; provides `open()` with `directory: true` |
| sonner | ^2.0.7 | Toast notifications | Already in use; queue/dequeue toasts |

### Testing (NEW -- must be set up)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^3.x | Test runner | Standard for Vite projects; shares vite config, fast, TypeScript native |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest | Bun test | Bun test runner works but lacks Vite integration for path aliases and import.meta.env |
| Separate agents table | Extend threads table | Agents are 1:1 with threads; separate table adds unnecessary JOINs |

**Installation:**
```bash
bun add -d vitest
```

## Architecture Patterns

### Recommended Project Structure
```
src/lib/
  orchestration/
    agent-registry.ts         # AgentRegistry class (ORCH-01)
    concurrency-governor.ts   # FIFO queue + slot management (ORCH-02)
    agent-process-manager.ts  # Existing -- unchanged
    orchestrated-adapter.ts   # Modified -- delegates to registry
  thread-status-store.ts      # Extended with 5-status model (ORCH-03)
  db.ts                       # Extended with agent state ops + write serializer (PERS-01/02/03)
src-tauri/migrations/
  009_agent_state.sql          # New columns on threads table
tests/
  agent-registry.test.ts      # Registry spawn/kill/query tests
  concurrency-governor.test.ts # Governor queue/limit tests
  status-transitions.test.ts   # Status state machine tests
```

### Pattern 1: AgentRegistry as Singleton Coordinator
**What:** A class that owns the concurrency governor and delegates to the process manager and provider registry. It is the single entry point for spawning and managing agents.
**When to use:** All agent lifecycle operations (spawn, kill, restart, query).
**Example:**
```typescript
// AgentRegistry coordinates between existing components
export class AgentRegistry {
  private readonly governor: ConcurrencyGovernor;
  private readonly processManager: AgentProcessManager;
  private readonly providerRegistry: ProviderRegistry;

  async spawn(threadId: string, cwd: string, model: string): Promise<void> {
    // 1. Check concurrency limit via governor
    // 2. If at limit, queue and return (toast shown)
    // 3. If slot available, delegate to processManager + provider
    // 4. Update Zustand store status -> 'running'
  }

  async kill(threadId: string): Promise<void> {
    // 1. Kill process via processManager
    // 2. Update status -> 'error' or remove
    // 3. Check queue, promote next if waiting
  }

  async restart(threadId: string): Promise<void> {
    // 1. Load cwd + model from DB
    // 2. Kill existing process if any
    // 3. Spawn fresh, resume session if possible
  }

  getStatus(threadId: string): AgentStatus { ... }
  listActive(): AgentInfo[] { ... }
}
```

### Pattern 2: Concurrency Governor with FIFO Queue
**What:** Manages a fixed pool of N slots with a queue for overflow. When a slot opens, the next queued agent auto-promotes.
**When to use:** Every spawn request goes through the governor.
**Example:**
```typescript
export class ConcurrencyGovernor {
  private readonly maxConcurrent = 5;
  private active = new Set<string>();
  private queue: Array<{ threadId: string; resolve: () => void }> = [];

  async acquire(threadId: string): Promise<'acquired' | 'queued'> {
    if (this.active.size < this.maxConcurrent) {
      this.active.add(threadId);
      return 'acquired';
    }
    // Queue the request
    return new Promise<'acquired' | 'queued'>((resolve) => {
      this.queue.push({ threadId, resolve: () => {
        this.active.add(threadId);
        resolve('acquired');
      }});
      // Immediately return 'queued' status
      // The promise resolves later when a slot opens
    });
  }

  release(threadId: string): void {
    this.active.delete(threadId);
    const next = this.queue.shift();
    if (next) {
      next.resolve(); // Promotes queued agent
    }
  }

  cancelQueued(threadId: string): boolean {
    const idx = this.queue.findIndex(q => q.threadId === threadId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }
}
```

### Pattern 3: Extended Status Store (replaces thread-status-store.ts)
**What:** Drop 'idle' status, add 'queued' and 'completed'. Persist agent_status to SQLite.
**When to use:** All status updates go through this store, which syncs to SQLite.
**Example:**
```typescript
export type AgentStatus = 'running' | 'error' | 'waiting-approval' | 'completed' | 'queued';

export interface AgentStatusRecord {
  status: AgentStatus;
  unread: boolean;
  title?: string;
  cwd?: string;
  providerType?: string;
  finishedAt?: number;
  errorHint?: string; // 'process lost' for restart recovery
}
```

### Pattern 4: Write Serializer for SQLite
**What:** A JS-side mutex that serializes all DB writes through a single queue. Reads can happen concurrently (WAL mode allows this).
**When to use:** Wraps all `conn.execute()` calls that modify data.
**Example:**
```typescript
class WriteSerializer {
  private queue: Promise<unknown> = Promise.resolve();

  async serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn); // chain regardless of previous result
    this.queue = result.then(() => {}, () => {}); // swallow for chaining
    return result;
  }
}

// Usage in db.ts:
const writer = new WriteSerializer();
async function threadsUpdateStatus(id: string, status: string) {
  return writer.serialize(async () => {
    const conn = await getDb();
    await conn.execute("UPDATE threads SET agent_status = $1 WHERE id = $2", [status, id]);
  });
}
```

### Anti-Patterns to Avoid
- **Creating a separate `agents` table**: Agents are 1:1 with threads. Adding agent state to the threads table avoids JOINs and keeps the data model simple. The `threads` table already has `cwd`, `session_id`, and `model`.
- **Polling for status changes**: Use Zustand's subscription model, not polling. The store already uses `useSyncExternalStore` under the hood.
- **Async governor acquire that blocks the UI**: The `acquire()` should return immediately with 'queued' status and resolve later. The caller shows the queue toast and moves on.
- **Storing status only in Zustand**: Agent status must be persisted to SQLite for restart recovery. Write to both Zustand (immediate UI) and SQLite (persistence).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Directory picker dialog | Custom file input or text field | `@tauri-apps/plugin-dialog` `open({ directory: true })` | Native OS dialog, handles permissions, consistent UX |
| Toast notifications | Custom notification system | `sonner` (already installed) | Handles stacking, dismissal, rich content |
| Reactive state | Custom event emitter | Zustand store | Already in use; built-in React integration |
| Test runner | Custom test harness | Vitest | Vite-native, fast, handles TS/path aliases |
| SQLite concurrency | Custom locking protocol | WAL mode + JS write serializer | WAL is battle-tested; JS serializer sufficient for single-process Tauri app |

**Key insight:** This phase is primarily about coordination logic (registry, governor, status FSM), not new UI components or external integrations. The building blocks exist; the work is wiring them together with proper state management.

## Common Pitfalls

### Pitfall 1: WAL Mode Not Persisting
**What goes wrong:** WAL mode is set in migration 001 via `PRAGMA journal_mode=WAL` but PRAGMAs in migrations may not persist across connection reopens depending on the plugin behavior.
**Why it happens:** `tauri-plugin-sql` runs migrations on first connect; subsequent connections may default to DELETE journal mode.
**How to avoid:** Execute `PRAGMA journal_mode=WAL` in the `getDb()` function after `Database.load()`, not just in migrations. Verify with `PRAGMA journal_mode` query.
**Warning signs:** "database is locked" errors during concurrent agent writes.

### Pitfall 2: Status Transition Race Conditions
**What goes wrong:** Two concurrent events (e.g., process crash and user kill) try to update the same agent's status simultaneously, causing inconsistent state.
**Why it happens:** Zustand updates are synchronous but DB writes are async; interleaving can produce stale reads.
**How to avoid:** All status transitions go through a single method on AgentRegistry that validates the transition is legal (e.g., can't go from 'completed' to 'error' without going through 'running' first). Use the write serializer for DB updates.
**Warning signs:** Agent showing 'running' in UI but 'error' in DB after restart.

### Pitfall 3: Queue Promotion After Kill
**What goes wrong:** When an agent is killed or completes, the governor must check the queue and promote the next agent. If this is forgotten, queued agents wait forever.
**Why it happens:** Multiple code paths can end an agent (kill, complete, error, cancel) and each must call `governor.release()`.
**How to avoid:** Use a `finally` block pattern -- every agent run, regardless of outcome, releases its governor slot.
**Warning signs:** Agents stuck in 'queued' status even when fewer than 5 are running.

### Pitfall 4: Breaking Existing Status Store Consumers
**What goes wrong:** Changing `ThreadStatus` from `"idle" | "running" | "waiting-approval" | "error"` to the new 5-status model breaks the existing `OrchestratedAdapter` which calls `setStatus(threadId, "idle")` on success.
**Why it happens:** The orchestrated adapter uses 'idle' to mean "completed this run". The new model drops 'idle'.
**How to avoid:** Update `OrchestratedAdapter` to use 'completed' instead of 'idle'. Ensure all references to the old `ThreadStatus` type are updated. Search for all `setStatus` calls.
**Warning signs:** TypeScript errors on missing 'idle' variant.

### Pitfall 5: Restart vs Reactivation Confusion
**What goes wrong:** "Restart" (error recovery) and "reactivation" (send new message to completed agent) have different behaviors but similar code paths.
**Why it happens:** Both spawn a fresh process, but restart should show an error-recovery toast while reactivation should not.
**How to avoid:** The registry should have distinct methods: `restart(threadId)` for error recovery and let the normal `OrchestratedAdapter.run()` handle reactivation (status goes completed -> running when a new message is sent).
**Warning signs:** Confusing toast messages or missing session resume on reactivation.

### Pitfall 6: Auto-Archive Timing
**What goes wrong:** Completed agents should auto-archive after 7 days, but there's no cron in a desktop app.
**Why it happens:** Desktop apps don't run background schedulers.
**How to avoid:** Run archive check on app startup AND periodically (e.g., every hour via `setInterval`). Query: `UPDATE threads SET status = 'archived' WHERE agent_status = 'completed' AND updated_at < datetime('now', '-7 days')`.
**Warning signs:** Old completed agents accumulating in the active list forever.

## Code Examples

### Directory Selection with Tauri Dialog
```typescript
// Source: @tauri-apps/plugin-dialog docs
import { open } from "@tauri-apps/plugin-dialog";

async function selectWorkingDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select working directory for agent",
  });
  // open() returns string | string[] | null
  if (typeof selected === "string") return selected;
  return null;
}
```

### Agent Name from Directory Path
```typescript
function agentNameFromCwd(cwd: string): string {
  // Extract last path segment: /home/user/projects/my-api -> my-api
  const segments = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
  return segments[segments.length - 1] || cwd;
}
```

### WAL Mode Verification
```typescript
async function ensureWalMode(): Promise<void> {
  const conn = await getDb();
  const rows = await conn.select<[{ journal_mode: string }]>(
    "PRAGMA journal_mode=WAL",
    [],
  );
  const mode = rows[0]?.journal_mode;
  if (mode !== "wal") {
    console.warn(`Expected WAL mode, got: ${mode}`);
  }
}
```

### Vitest Configuration for This Project
```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node", // Pure logic tests, no DOM needed for registry/governor
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

### Status Transition Validation
```typescript
const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  queued:             ['running', 'error'],     // error = cancelled from queue
  running:            ['completed', 'error', 'waiting-approval'],
  'waiting-approval': ['running', 'error'],     // approval granted -> running, denied -> error
  completed:          ['running'],              // reactivation
  error:              ['running', 'queued'],    // restart or re-queue
};

function isValidTransition(from: AgentStatus, to: AgentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single agent per app | Multi-agent registry | This phase | Core architectural change |
| 4-status model (idle/running/waiting-approval/error) | 5-status model (queued/running/waiting-approval/completed/error) | This phase | Replaces thread-status-store.ts |
| In-memory status only | Dual Zustand + SQLite status | This phase | Enables restart recovery |
| No write serialization | Write serializer for DB | This phase | Prevents corruption with N concurrent agents |

**Deprecated/outdated:**
- `ThreadStatus` type with 'idle': Replaced by `AgentStatus` without 'idle' (use 'completed' instead)
- Thread-only status store: Extended with agent-specific fields (cwd, providerType, errorHint)

## Open Questions

1. **Sidecar sharing vs per-agent sidecar**
   - What we know: Currently one `AgentSdkSidecar` instance is shared. Multiple concurrent agents send queries through the same sidecar process via multiplexed queryIds.
   - What's unclear: Whether the sidecar can handle 5 concurrent `query` messages reliably, given the Agent SDK's 12s cold-start per query.
   - Recommendation: Keep shared sidecar for now (it already multiplexes by queryId). If concurrency issues arise, this becomes a Phase 3 concern during streaming work.

2. **Codex provider concurrency**
   - What we know: Codex uses Tauri invoke to communicate with a Rust backend. Multiple concurrent turns may conflict.
   - What's unclear: Whether `codex_start_thread` / `codex_send_turn` support concurrent invocations safely.
   - Recommendation: The concurrency governor limits total agents to 5, which provides natural throttling. Test with 2-3 Codex agents in validation.

3. **Test mocking strategy for Tauri APIs**
   - What we know: Vitest runs in Node, but the code imports `@tauri-apps/plugin-sql`, `@tauri-apps/plugin-dialog`, etc.
   - What's unclear: Best pattern for mocking Tauri APIs in unit tests.
   - Recommendation: Design registry and governor as pure logic classes that accept dependencies via constructor injection. Test the logic without Tauri. Integration tests can mock Tauri APIs via `vi.mock()`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | `vitest.config.ts` (Wave 0 -- must create) |
| Quick run command | `bunx vitest run --reporter=verbose` |
| Full suite command | `bunx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORCH-01 | Registry spawn/kill/query operations | unit | `bunx vitest run tests/agent-registry.test.ts -t "spawn"` | No -- Wave 0 |
| ORCH-01 | Registry restart with session resume | unit | `bunx vitest run tests/agent-registry.test.ts -t "restart"` | No -- Wave 0 |
| ORCH-02 | Concurrency governor limits to 5 | unit | `bunx vitest run tests/concurrency-governor.test.ts -t "limit"` | No -- Wave 0 |
| ORCH-02 | Queue promotion on slot release | unit | `bunx vitest run tests/concurrency-governor.test.ts -t "promote"` | No -- Wave 0 |
| ORCH-02 | Cancel queued agent | unit | `bunx vitest run tests/concurrency-governor.test.ts -t "cancel"` | No -- Wave 0 |
| ORCH-03 | Status transitions valid/invalid | unit | `bunx vitest run tests/status-transitions.test.ts` | No -- Wave 0 |
| ORCH-03 | Zustand store reactivity | unit | `bunx vitest run tests/agent-status-store.test.ts` | No -- Wave 0 |
| ORCH-08 | Working directory stored per thread | unit | `bunx vitest run tests/agent-registry.test.ts -t "cwd"` | No -- Wave 0 |
| PERS-01 | Agent state persists across restart | integration | `bunx vitest run tests/agent-persistence.test.ts` | No -- Wave 0 |
| PERS-02 | WAL mode enabled | integration | `bunx vitest run tests/db-wal.test.ts` | No -- Wave 0 |
| PERS-03 | Write serialization prevents corruption | unit | `bunx vitest run tests/write-serializer.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `bunx vitest run --reporter=verbose`
- **Per wave merge:** `bunx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- Vitest configuration with path aliases
- [ ] `tests/concurrency-governor.test.ts` -- Governor unit tests (TDD: write first)
- [ ] `tests/status-transitions.test.ts` -- Status FSM tests (TDD: write first)
- [ ] `tests/write-serializer.test.ts` -- Write queue tests (TDD: write first)
- [ ] `tests/agent-registry.test.ts` -- Registry integration tests (TDD: write first)
- [ ] Framework install: `bun add -d vitest`

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `src/lib/db.ts`, `src/lib/thread-status-store.ts`, `src/lib/orchestration/agent-process-manager.ts`, `src/lib/orchestration/orchestrated-adapter.ts`, `src/lib/providers/agent-sdk-provider.ts`, `src/lib/providers/codex-provider.ts`, `src/lib/providers/types.ts`, `src/lib/providers/provider-registry.ts`
- Codebase inspection: `src/components/RuntimeProvider.tsx` -- singleton wiring pattern
- Codebase inspection: `src-tauri/migrations/001_initial_schema.sql` -- WAL mode already in migration 001
- Codebase inspection: `src-tauri/migrations/008_active_processes.sql` -- PID tracking schema
- `package.json` -- confirmed zustand ^5.0.11, @tauri-apps/plugin-dialog ^2.6.0

### Secondary (MEDIUM confidence)
- Vitest compatibility with Vite 7 and Bun -- Vitest 3.x is the current major; standard pairing with Vite projects
- Tauri plugin-dialog `open()` API for directory selection -- documented in Tauri v2 docs

### Tertiary (LOW confidence)
- Agent SDK sidecar concurrency limits under 5 simultaneous queries -- untested, flagged as open question

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed except Vitest
- Architecture: HIGH -- building on established Phase 1 patterns with clear extension points
- Pitfalls: HIGH -- identified from direct codebase analysis of existing status management and DB patterns
- Testing: MEDIUM -- Vitest is standard but mocking Tauri APIs in unit tests needs validation during Wave 0

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable domain, 30-day window)

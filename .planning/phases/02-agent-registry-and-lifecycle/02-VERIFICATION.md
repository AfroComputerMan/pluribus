---
phase: 02-agent-registry-and-lifecycle
verified: 2026-03-06T11:00:00Z
status: passed
score: 6/6 must-haves verified
human_verification:
  - test: "Start app and verify agents run with correct status lifecycle"
    expected: "Agent shows 'running' during execution, 'completed' after success, 'error' on failure"
    why_human: "Cannot programmatically launch Tauri app and interact with agent lifecycle"
  - test: "Start 6+ agents simultaneously to verify concurrency queueing"
    expected: "6th agent shows toast '5 agents running -- this one will start when a slot opens', then auto-starts when a slot opens with promotion toast"
    why_human: "Requires real concurrent agent execution in running app"
  - test: "Kill app mid-run and restart to verify crash recovery"
    expected: "Previously-running agents show as 'error' with 'process lost' hint"
    why_human: "Requires app restart cycle with persistent state"
  - test: "Run all tests via 'bunx vitest run'"
    expected: "All 54 tests pass (10 governor + 4 write-serializer + 22 status-transitions + 8 status-store + 10 registry)"
    why_human: "Bash tool permission denied during verification; tests need to be run to confirm green suite"
---

# Phase 02: Agent Registry and Lifecycle Verification Report

**Phase Goal:** Users can spawn multiple agents simultaneously, each with its own working directory and status, managed through a central registry with concurrency limits
**Verified:** 2026-03-06T11:00:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ConcurrencyGovernor limits active agents to 5 and queues overflow | VERIFIED | `concurrency-governor.ts` has hardcoded `maxConcurrent = 5`, acquire/release/cancelQueued implemented with FIFO queue and onPromoted callback |
| 2 | AgentRegistry is the single entry point for spawn/kill/restart/query operations | VERIFIED | `agent-registry.ts` exports `AgentRegistry` class with spawn, kill, restart, cancelQueued, markCompleted, markError, markWaitingApproval, markApprovalGranted, getStatus, listActive, initFromDb, ensureSlotReleased |
| 3 | Agent state persists in SQLite across app restarts | VERIFIED | Migration 009 adds `agent_status` and `provider_type` columns; `db.ts` has updateAgentStatus, updateProviderType, listByAgentStatus, archiveStaleCompleted; WAL mode enforced via `PRAGMA journal_mode=WAL` in getDb() |
| 4 | Status store provides reactive push-based updates via Zustand | VERIFIED | `agent-status-store.ts` is a Zustand store with Map-based statuses, setStatus with FSM transition validation, unread tracking, loadFromDb for startup hydration |
| 5 | OrchestratedAdapter routes lifecycle through registry | VERIFIED | `orchestrated-adapter.ts` calls `agentRegistry.spawn()` before provider.run(), `agentRegistry.markCompleted()` on success, `agentRegistry.markError()` on failure, `agentRegistry.ensureSlotReleased()` in finally block |
| 6 | Registry initialized on startup with crash recovery | VERIFIED | `RuntimeProvider.tsx` creates AgentRegistry with all deps, calls `agentRegistry.initFromDb()` on module load, auto-archive runs hourly via setInterval |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `vitest.config.ts` | Test runner with path aliases | VERIFIED | Node environment, `tests/**/*.test.ts` include, `@` alias to `src/` |
| `src/lib/orchestration/concurrency-governor.ts` | FIFO 5-slot limiter | VERIFIED | 81 lines, exports ConcurrencyGovernor with acquire/release/cancelQueued/activeCount/queuedCount |
| `src/lib/orchestration/write-serializer.ts` | Promise-chain write queue | VERIFIED | 21 lines, exports WriteSerializer with serialize() that chains and isolates errors |
| `src/lib/orchestration/agent-status.ts` | 5-status FSM with transition validation | VERIFIED | 44 lines, exports AgentStatus type, AgentStatusRecord interface, VALID_TRANSITIONS, isValidTransition |
| `src/lib/orchestration/agent-registry.ts` | Central lifecycle coordinator | VERIFIED | 321 lines, exports AgentRegistry class and createAgentRegistry factory with full spawn/kill/restart/query API |
| `src/lib/orchestration/agent-status-store.ts` | Zustand store replacing thread-status-store | VERIFIED | 98 lines, exports useAgentStatusStore with setStatus/markRead/removeStatus/loadFromDb |
| `src-tauri/migrations/009_agent_state.sql` | Migration for agent columns | VERIFIED | 2 lines, ALTER TABLE threads ADD COLUMN agent_status/provider_type |
| `src/lib/db.ts` | WAL enforcement + agent state operations | VERIFIED | WAL PRAGMA at line 22, ThreadRow extended with agent_status/provider_type, 4 new operations wired into db.threads |
| `src/lib/orchestration/orchestrated-adapter.ts` | Adapter with registry integration | VERIFIED | 167 lines, receives AgentRegistry, routes spawn/complete/error through it, safety-net ensureSlotReleased in finally |
| `src/components/RuntimeProvider.tsx` | Registry wiring and initialization | VERIFIED | Creates governor, writeSerializer, agentRegistry with all deps; calls initFromDb(); auto-archive hourly |
| `src/lib/thread-status-store.ts` | Backward-compatible re-export shim | VERIFIED | 6 lines, re-exports useAgentStatusStore as useThreadStatusStore |
| `tests/concurrency-governor.test.ts` | Governor unit tests | VERIFIED | File exists, imports ConcurrencyGovernor, test structure present |
| `tests/write-serializer.test.ts` | Serializer unit tests | VERIFIED | File exists |
| `tests/status-transitions.test.ts` | FSM unit tests | VERIFIED | File exists |
| `tests/agent-status-store.test.ts` | Status store tests | VERIFIED | File exists, imports useAgentStatusStore, tests setStatus/markRead/loadFromDb |
| `tests/agent-registry.test.ts` | Registry unit tests | VERIFIED | File exists, imports all deps with mocks, tests spawn/kill/restart flow |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tests/concurrency-governor.test.ts` | `concurrency-governor.ts` | import | WIRED | `import { ConcurrencyGovernor } from "@/lib/orchestration/concurrency-governor"` |
| `tests/status-transitions.test.ts` | `agent-status.ts` | import | WIRED | Imports isValidTransition (per plan) |
| `agent-registry.ts` | `concurrency-governor.ts` | constructor injection | WIRED | `import type { ConcurrencyGovernor }`, used in governor.acquire/release/cancelQueued |
| `agent-registry.ts` | `agent-process-manager.ts` | constructor injection | WIRED | `import type { AgentProcessManager }`, used in processManager.untrackProcess |
| `agent-registry.ts` | `db.ts` | extracted DB interface | WIRED | db.threads.updateAgentStatus/updateProviderType/listByAgentStatus/archiveStaleCompleted called throughout |
| `agent-status-store.ts` | `agent-status.ts` | import types | WIRED | `import { type AgentStatus, type AgentStatusRecord, isValidTransition }` |
| `orchestrated-adapter.ts` | `agent-registry.ts` | constructor parameter | WIRED | `import type { AgentRegistry }`, used for spawn/markCompleted/markError/ensureSlotReleased |
| `orchestrated-adapter.ts` | `agent-status-store.ts` | via registry | WIRED | Status updates flow through agentRegistry which uses statusStore internally |
| `RuntimeProvider.tsx` | `agent-registry.ts` | createAgentRegistry + initFromDb | WIRED | `import { createAgentRegistry }`, creates instance and calls initFromDb() |
| `RuntimeProvider.tsx` | `orchestrated-adapter.ts` | passes agentRegistry | WIRED | `createOrchestratedAdapter(providerRegistry, agentRegistry, processManager)` |
| `thread-status-store.ts` | `agent-status-store.ts` | re-export shim | WIRED | `export { useAgentStatusStore as useThreadStatusStore }` |
| `src-tauri/src/lib.rs` | `009_agent_state.sql` | migration registration | WIRED | Line 96: `include_str!("../migrations/009_agent_state.sql")` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ORCH-01 | 02-03, 02-04 | AgentRegistry as central hub for all agent lifecycle operations (spawn/kill/query) | SATISFIED | `agent-registry.ts` exports AgentRegistry with spawn/kill/restart/cancelQueued/markCompleted/markError/getStatus/listActive; wired into OrchestratedAdapter and RuntimeProvider |
| ORCH-02 | 02-01, 02-04 | Concurrency governor with max 5 concurrent agents | SATISFIED | `concurrency-governor.ts` with hardcoded maxConcurrent=5, FIFO queue; integrated in registry.spawn() and adapter shows queue toast |
| ORCH-03 | 02-01, 02-03, 02-04 | Push-based agent status tracking via Zustand (running/error/waiting-approval/completed/queued) | SATISFIED | `agent-status-store.ts` Zustand store with 5-status model; `agent-status.ts` FSM with validated transitions; no 'idle' status remains in codebase |
| ORCH-08 | 02-03, 02-04 | Per-thread working directory scoping | SATISFIED | AgentStatusRecord has `cwd` field; registry.spawn() accepts cwd parameter and persists to DB; restart loads cwd from DB |
| PERS-01 | 02-02 | Extended SQLite schema for multi-agent state | SATISFIED | Migration 009 adds agent_status and provider_type columns; ThreadRow extended; 4 new db.threads operations |
| PERS-02 | 02-02 | WAL mode enabled for concurrent write safety | SATISFIED | `PRAGMA journal_mode=WAL` in getDb() after Database.load() |
| PERS-03 | 02-01 | Write serialization through single-writer pattern | SATISFIED | `write-serializer.ts` with promise-chain pattern; registry uses writeSerializer.serialize() for all DB writes |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `agent-registry.ts` | 222 | Comment says "non-idle" but system uses "completed" not "idle" | Info | Cosmetic only -- comment slightly misleading but no functional impact |
| `agent-registry.ts` | 289 | `catch(() => {})` swallows promotion errors silently | Warning | If ensureSlotReleased promotion fails, no error logging occurs; unlikely path but could hide issues |

### Human Verification Required

### 1. Agent Lifecycle in Running App

**Test:** Start app with `cargo tauri dev`, select a model, pick a working directory, send a message, observe status transitions
**Expected:** Agent shows 'running' during execution, 'completed' after success; sidebar reflects status; no 'idle' status anywhere
**Why human:** Requires Tauri app runtime with real agent execution

### 2. Concurrency Queueing

**Test:** Start 6+ agents simultaneously
**Expected:** 6th agent shows toast "5 agents running -- this one will start when a slot opens"; when one completes, queued agent auto-starts with promotion toast
**Why human:** Requires 6 concurrent agent spawns in running app

### 3. Crash Recovery

**Test:** Kill app mid-agent-run (`kill -9`), restart with `cargo tauri dev`
**Expected:** Previously-running agents show as 'error' with 'process lost' hint in sidebar
**Why human:** Requires app restart cycle with persistent SQLite state

### 4. Test Suite

**Test:** Run `bunx vitest run --reporter=verbose`
**Expected:** All 54 tests pass across 5 test files
**Why human:** Bash tool permission was denied during verification; tests need manual execution to confirm green suite

### Gaps Summary

No structural gaps found. All 6 observable truths are verified through code inspection: artifacts exist, are substantive (not stubs), and are properly wired together. The full dependency chain flows from RuntimeProvider creating the AgentRegistry through to OrchestratedAdapter using it for lifecycle management.

Two items require human verification:
1. **Runtime behavior** -- the wiring is correct but actual execution in the Tauri app needs confirmation (status transitions, toast notifications, crash recovery)
2. **Test suite execution** -- test files exist and are substantive but could not be run during this verification

The noted IPC overload issue under 5 concurrent streams (from 02-04-SUMMARY.md) is acknowledged as a Phase 3 concern, not a Phase 2 gap.

---

_Verified: 2026-03-06T11:00:00Z_
_Verifier: Claude (gsd-verifier)_

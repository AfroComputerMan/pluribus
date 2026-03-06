---
phase: 02-agent-registry-and-lifecycle
plan: 04
subsystem: orchestration
tags: [tauri, zustand, agent-lifecycle, registry, toast, concurrency]

# Dependency graph
requires:
  - phase: 02-03
    provides: AgentRegistry, AgentStatusStore, ConcurrencyGovernor integration
provides:
  - OrchestratedAdapter wired to AgentRegistry for spawn/complete/error lifecycle
  - RuntimeProvider creates and initializes AgentRegistry on startup with crash recovery
  - Backward-compatible thread-status-store re-export shim
  - Toast notifications for queue/dequeue events
  - Auto-archive of stale completed agents (hourly, 7-day threshold)
affects: [phase-03-streaming, phase-04-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [registry-driven-lifecycle, status-store-migration-shim, crash-recovery-on-startup]

key-files:
  created: []
  modified:
    - src/lib/orchestration/orchestrated-adapter.ts
    - src/components/RuntimeProvider.tsx
    - src/lib/thread-status-store.ts
    - src/components/ThreadStatusToasts.tsx
    - src/components/assistant-ui/thread-list.tsx
    - src/lib/orchestration/agent-registry.ts
    - src-tauri/src/lib.rs

key-decisions:
  - "OrchestratedAdapter receives AgentRegistry as constructor parameter for lifecycle coordination"
  - "thread-status-store.ts becomes a re-export shim for backward compatibility during incremental migration"
  - "Crash recovery runs at startup via agentRegistry.initFromDb() marking running agents as error"

patterns-established:
  - "Registry-driven lifecycle: adapter delegates spawn/complete/error to AgentRegistry instead of direct status store calls"
  - "Migration shim pattern: deprecated store re-exports from new store to avoid big-bang rename"

requirements-completed: [ORCH-01, ORCH-02, ORCH-03, ORCH-08]

# Metrics
duration: ~25min
completed: 2026-03-06
---

# Phase 2 Plan 4: Registry Integration Summary

**OrchestratedAdapter wired to AgentRegistry for multi-agent lifecycle with crash recovery, queue toasts, and status store migration**

## Performance

- **Duration:** ~25 min (including human verification checkpoint)
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 7

## Accomplishments
- OrchestratedAdapter routes all lifecycle events through AgentRegistry (spawn/complete/error) instead of direct status store manipulation
- RuntimeProvider creates AgentRegistry with all dependencies (governor, process manager, provider registry, status store, write serializer) and initializes on startup with crash recovery
- Toast notifications wired for queue events ("5 agents running -- this one will start when a slot opens") and promotion events
- thread-status-store.ts converted to backward-compatible re-export shim pointing to agent-status-store
- Auto-archive of 7-day-old completed agents runs hourly

## Task Commits

Each task was committed atomically:

1. **Task 1: Update OrchestratedAdapter and migrate status store consumers** - `546c426` (feat)
2. **Task 2: RuntimeProvider wiring and startup initialization** - `db5e756` (feat)
3. **Task 3: Verify full agent registry integration in running app** - human-verify checkpoint, approved with noted issues

**Fix commit:** `629e16b` - Migration 009 registration in Tauri builder (fix)

## Files Created/Modified
- `src/lib/orchestration/orchestrated-adapter.ts` - Added AgentRegistry parameter, routes spawn/complete/error through registry
- `src/components/RuntimeProvider.tsx` - Creates AgentRegistry with deps, initializes on startup, auto-archive setup
- `src/lib/thread-status-store.ts` - Converted to re-export shim from agent-status-store
- `src/components/ThreadStatusToasts.tsx` - Updated import to use new store
- `src/components/assistant-ui/thread-list.tsx` - Updated import to use new store
- `src/lib/orchestration/agent-registry.ts` - Added DB interface for initFromDb crash recovery
- `src-tauri/src/lib.rs` - Registered migration 009 in Tauri builder

## Decisions Made
- OrchestratedAdapter receives AgentRegistry as constructor parameter rather than accessing it globally
- thread-status-store.ts kept as re-export shim for backward compatibility (avoids big-bang rename across codebase)
- Crash recovery implemented via initFromDb() at startup, marking previously-running agents as 'error' with 'process lost'

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Migration 009 not registered in Tauri builder**
- **Found during:** Task 2 verification (app failed to start)
- **Issue:** Migration 009 (agent_status column) was created in Plan 02-02 but not added to the Tauri builder's migration list in lib.rs
- **Fix:** Added migration 009 to the builder registration in src-tauri/src/lib.rs
- **Files modified:** src-tauri/src/lib.rs
- **Verification:** App starts successfully with `cargo tauri dev`
- **Committed in:** `629e16b`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for app startup. No scope creep.

## Noted Issues from Verification

These issues were observed during human verification and are deferred to later phases:

1. **IPC custom protocol overload** -- When 5 agents stream simultaneously, "TypeError: Load failed" occurs causing app blackout requiring reload. This is a streaming/concurrency concern for Phase 3 (IPC batching).
2. **Error UX incomplete** -- Error indicator shows in sidebar but no error message displayed in thread, and no retry/continue button. Error UX improvement needed in Phase 4.

## Issues Encountered
- Migration 009 missing from Tauri builder (auto-fixed, see deviations above)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 2 is now complete: all 4 plans delivered
- Agent registry with concurrency control, persistence, and crash recovery is operational
- Ready for Phase 3: Real-Time Streaming and Intervention
- Known concern: IPC overload under 5 concurrent streams needs addressing in Phase 3's batching work (ORCH-04)
- Known concern: Error UX needs improvement in Phase 4 UI work

## Self-Check: PASSED

- FOUND: commit 546c426 (Task 1)
- FOUND: commit db5e756 (Task 2)
- FOUND: commit 629e16b (migration fix)
- FOUND: .planning/phases/02-agent-registry-and-lifecycle/02-04-SUMMARY.md

---
*Phase: 02-agent-registry-and-lifecycle*
*Completed: 2026-03-06*

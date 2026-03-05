---
phase: 01-provider-abstraction
plan: 01
subsystem: api
tags: [typescript, interfaces, sqlite, process-management, provider-pattern]

# Dependency graph
requires: []
provides:
  - AgentProvider, ProviderCapabilities, RunContext interfaces
  - ProviderRegistry with O(1) model-to-provider lookups
  - AgentProcessManager with SQLite PID tracking and orphan cleanup
  - active_processes SQLite migration (v8)
  - extractUserPrompt and dev-only log helper
affects: [01-02-PLAN, 01-03-PLAN, 01-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [provider-interface-pattern, registry-pattern, process-lifecycle-management]

key-files:
  created:
    - src/lib/providers/types.ts
    - src/lib/providers/shared.ts
    - src/lib/providers/provider-registry.ts
    - src/lib/orchestration/agent-process-manager.ts
    - src-tauri/migrations/008_active_processes.sql
  modified:
    - src/lib/db.ts
    - src-tauri/src/lib.rs

key-decisions:
  - "Used sh -c wrapper (claude-stream-sh) for orphan PID kill since direct kill command not in shell permissions"
  - "In-memory Child Map alongside SQLite PID records for dual kill strategy (handle vs OS-level)"

patterns-established:
  - "Provider interface pattern: AgentProvider with id, displayName, capabilities, supportedModels, run(), interrupt()"
  - "Registry pattern: ProviderRegistry.register() + getProviderForModel() for O(1) model lookups"
  - "Process tracking: SQLite for crash recovery + in-memory Map for current-session Child handles"
  - "db namespace pattern: db.processes.track/untrack/getAll/clearAll following existing db.threads/sessions pattern"

requirements-completed: [PROV-01, PROV-04, PROV-05]

# Metrics
duration: 3min
completed: 2026-03-05
---

# Phase 1 Plan 01: Provider Type System and Process Manager Summary

**AgentProvider/ProviderCapabilities/RunContext interfaces with ProviderRegistry and AgentProcessManager backed by SQLite PID tracking**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-05T15:50:18Z
- **Completed:** 2026-03-05T15:53:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Defined AgentProvider, ProviderCapabilities, RunContext, DevEvent, and ActiveProcess interfaces as the contract all providers must implement
- Created ProviderRegistry with O(1) model-to-provider lookups via internal Map
- Built AgentProcessManager with dual kill strategy: in-memory Child handles for current session, OS-level kill via shell for crash-recovery orphans
- Added active_processes SQLite migration (v8) and db.processes namespace
- Rewrote extractUserPrompt fresh in shared.ts (not extracted from claude-adapter.ts per user decision)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create provider type system and shared utilities** - `be660f6` (feat)
2. **Task 2: Create process manager with PID tracking and orphan cleanup** - `d8cc14a` (feat)

## Files Created/Modified
- `src/lib/providers/types.ts` - AgentProvider, ProviderCapabilities, RunContext, DevEvent, ActiveProcess interfaces
- `src/lib/providers/shared.ts` - extractUserPrompt (fresh rewrite) and dev-only log helper
- `src/lib/providers/provider-registry.ts` - ProviderRegistry class with model-to-provider mapping
- `src/lib/orchestration/agent-process-manager.ts` - AgentProcessManager with PID tracking and orphan cleanup
- `src-tauri/migrations/008_active_processes.sql` - active_processes table with provider index
- `src/lib/db.ts` - Added db.processes namespace (track, untrack, getAll, clearAll)
- `src-tauri/src/lib.rs` - Added migration v8 entry

## Decisions Made
- Used claude-stream-sh (sh -c wrapper) for OS-level PID kills since the `kill` command is not in the Tauri shell spawn permissions, but `sh` is already allowed
- Implemented dual kill strategy: Child.kill() for current-session processes (reliable), OS kill for crash-recovery orphans (best-effort)
- Made cleanupOrphans silent (no user notification) per user decision in plan context

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All provider interfaces defined and ready for Plans 02 (Agent SDK provider) and 03 (Codex provider) to implement
- ProviderRegistry ready to accept provider registrations
- AgentProcessManager ready to track spawned agent processes
- active_processes table will be created on next app startup via Tauri migration

---
*Phase: 01-provider-abstraction*
*Completed: 2026-03-05*

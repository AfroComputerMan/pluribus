---
phase: 01-provider-abstraction
plan: 04
subsystem: api
tags: [typescript, tauri, assistant-ui, provider-pattern, process-management, shell-security]

# Dependency graph
requires:
  - phase: 01-02
    provides: Agent SDK provider with sidecar management
  - phase: 01-03
    provides: Codex provider with Rust PID exposure
provides:
  - OrchestratedAdapter routing models to correct provider
  - Legacy adapter removal (claude-adapter, agent-sdk-adapter, codex-adapter, router-adapter)
  - Shell security surface closed (no sh or claude entries in capabilities)
  - Exit confirmation dialog when agents are running
  - Orphan process cleanup on app startup
  - Provider badges on model selector
affects: [02-agent-registry]

# Tech tracking
tech-stack:
  added: [tauri-plugin-dialog]
  patterns: [orchestrated-adapter-pattern, exit-guard-pattern, dev-event-system]

key-files:
  created:
    - src/lib/orchestration/orchestrated-adapter.ts
    - src/lib/dev-events.ts
    - src/components/ExitGuard.tsx
  modified:
    - src/components/RuntimeProvider.tsx
    - src/components/DevPanel.tsx
    - src/components/assistant-ui/thread.tsx
    - src-tauri/capabilities/default.json
    - src-tauri/src/lib.rs
    - src/lib/providers/agent-sdk-provider.ts
    - src/lib/providers/codex-provider.ts
    - src/lib/providers/types.ts
    - src/lib/orchestration/agent-process-manager.ts

key-decisions:
  - "OrchestratedAdapter is the single ChatModelAdapter; routes by model to Agent SDK or Codex provider"
  - "Native Tauri dialog for exit confirmation (window.confirm unreliable on Linux)"
  - "Process PIDs tracked via onProcessStarted callback during provider run"

patterns-established:
  - "Orchestrated adapter pattern: single ChatModelAdapter wrapping provider registry for model-based routing"
  - "Exit guard pattern: ExitGuard component using beforeunload + native dialog for running agent confirmation"
  - "Dev event system: standalone module (dev-events.ts) with circular buffer and useSyncExternalStore subscription"

requirements-completed: [PROV-06]

# Metrics
duration: ~45min
completed: 2026-03-06
---

# Phase 1 Plan 04: Orchestrated Adapter Wiring and Legacy Removal Summary

**OrchestratedAdapter replacing four legacy adapters with model-based provider routing, shell security surface closed, exit guard with native Tauri dialog**

## Performance

- **Duration:** ~45 min (across multiple sessions including post-checkpoint fixes)
- **Started:** 2026-03-06T00:04:13Z
- **Completed:** 2026-03-06T01:00:00Z
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 18

## Accomplishments
- Created OrchestratedAdapter as the single ChatModelAdapter routing to Agent SDK or Codex based on model selection
- Deleted all four legacy adapters: claude-adapter.ts (1900 lines), agent-sdk-adapter.ts, codex-adapter.ts, router-adapter.ts
- Closed the shell security surface by removing sh and claude entries from capabilities/default.json
- Added exit confirmation dialog using native Tauri dialog when agents are running
- Orphan process cleanup runs silently on app startup
- Model selector shows provider badges (e.g., "Opus 4.6 (Agent SDK)")
- Extracted dev event system into standalone module (dev-events.ts) to replace claude-adapter.ts dependency

## Task Commits

Each task was committed atomically:

1. **Task 1: Create orchestrated adapter, wire RuntimeProvider, and initialize on startup** - `ca55450` (feat)
2. **Task 2: Remove legacy adapters, update imports, clean capabilities, add exit dialog** - `e2080b5` (feat)
3. **Task 3: Verify complete provider abstraction end-to-end** - Human verification checkpoint (APPROVED)

Post-checkpoint fixes:
- `bd747d9` - fix: sidecar startup before queries, missing Tauri permissions, codex completion status
- `9bd11d4` - fix: track process PIDs during run via onProcessStarted callback
- `efdb9e1` - fix: use native Tauri dialog for exit confirmation on Linux

## Files Created/Modified
- `src/lib/orchestration/orchestrated-adapter.ts` - Single ChatModelAdapter wrapping provider registry
- `src/lib/dev-events.ts` - Standalone dev event system extracted from claude-adapter.ts
- `src/components/ExitGuard.tsx` - Exit confirmation using native Tauri dialog
- `src/components/RuntimeProvider.tsx` - Updated to use createOrchestratedAdapter with registry and process manager
- `src/components/DevPanel.tsx` - Updated imports to use dev-events.ts
- `src/components/assistant-ui/thread.tsx` - Updated imports for type changes
- `src-tauri/capabilities/default.json` - Removed sh and claude entries; added dialog and window permissions
- `src-tauri/src/lib.rs` - Updated for dialog plugin
- `src/lib/providers/agent-sdk-provider.ts` - onProcessStarted callback for PID tracking
- `src/lib/providers/codex-provider.ts` - Always yield completion status; onProcessStarted callback
- `src/lib/providers/types.ts` - Updated types for new patterns
- `src/lib/orchestration/agent-process-manager.ts` - PID tracking integration

## Decisions Made
- Used native Tauri dialog (`tauri_plugin_dialog`) instead of `window.confirm` for exit confirmation -- `window.confirm` is unreliable on Linux with Tauri
- Process PIDs tracked during run via `onProcessStarted` callback pattern rather than post-hoc PID lookup
- Dev event system extracted to standalone `dev-events.ts` module (not inlined into providers) for clean separation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Agent SDK sidecar must start before sending queries**
- **Found during:** Post-checkpoint verification
- **Issue:** Sidecar was not started before queries were sent, causing failures
- **Fix:** Ensured sidecar spawns before query dispatch
- **Files modified:** src/lib/providers/agent-sdk-provider.ts, src/components/RuntimeProvider.tsx
- **Committed in:** `bd747d9`

**2. [Rule 3 - Blocking] Missing Tauri permissions for dialog and window close**
- **Found during:** Post-checkpoint verification
- **Issue:** dialog:allow-confirm, core:window:allow-close, core:window:allow-destroy permissions missing from capabilities
- **Fix:** Added required permissions to default.json
- **Files modified:** src-tauri/capabilities/default.json
- **Committed in:** `bd747d9`

**3. [Rule 1 - Bug] Codex provider not yielding completion status**
- **Found during:** Post-checkpoint verification
- **Issue:** Codex provider did not always yield a completion status event
- **Fix:** Ensured codex provider always yields completion status
- **Files modified:** src/lib/providers/codex-provider.ts
- **Committed in:** `bd747d9`

**4. [Rule 2 - Missing Critical] Process PIDs not tracked during run**
- **Found during:** Post-checkpoint verification
- **Issue:** Exit guard could not detect running agents because PIDs were not being tracked
- **Fix:** Added onProcessStarted callback to track PIDs during provider run
- **Files modified:** src/lib/orchestration/orchestrated-adapter.ts, src/lib/providers/agent-sdk-provider.ts, src/lib/providers/codex-provider.ts
- **Committed in:** `9bd11d4`

**5. [Rule 1 - Bug] window.confirm unreliable on Linux with Tauri**
- **Found during:** Post-checkpoint verification
- **Issue:** ExitGuard used window.confirm which does not work reliably on Linux Tauri apps
- **Fix:** Replaced with native Tauri dialog via tauri-plugin-dialog
- **Files modified:** src/components/ExitGuard.tsx, src-tauri/capabilities/default.json
- **Committed in:** `efdb9e1`

---

**Total deviations:** 5 auto-fixed (2 blocking, 2 bugs, 1 missing critical)
**Impact on plan:** All fixes necessary for correct operation on target platform. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Provider abstraction complete -- Agent SDK and Codex both registered and routable
- OrchestratedAdapter serves as the foundation for Phase 2's multi-agent registry
- Process manager with PID tracking ready to support concurrent agent lifecycle management
- All legacy code removed, clean codebase for building on

## Self-Check: PASSED

All 5 commits verified. All created files exist. All 4 legacy files confirmed deleted.

---
*Phase: 01-provider-abstraction*
*Completed: 2026-03-06*

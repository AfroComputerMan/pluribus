---
phase: quick
plan: 2
subsystem: ui
tags: [lucide, thread-list, model-display, assistant-ui]

requires:
  - phase: 01-provider-abstraction
    provides: model registry with isCodexModel/getModelById
provides:
  - inline agent icon (BotIcon/BrainCircuitIcon) on thread list items
  - model persistence pipeline from orchestrated adapter to thread row
affects: [thread-list, orchestrated-adapter]

tech-stack:
  added: []
  patterns: [ThreadModelIcon component pattern matching ThreadStatusIcon]

key-files:
  created: []
  modified:
    - src/components/assistant-ui/thread-list.tsx
    - src/lib/orchestration/orchestrated-adapter.ts

key-decisions:
  - "Source modelId from ThreadRow.model (populated) with fallback to usage_snapshots (empty)"
  - "Persist resolved model on every run() call to backfill old threads"

requirements-completed: [QUICK-2]

duration: 2min
completed: 2026-03-06
---

# Quick Task 2: Add Agent Indicator and Icon on Thread List Summary

**Inline BotIcon/BrainCircuitIcon on thread list items with model persistence pipeline from orchestrated adapter**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-06T10:52:57Z
- **Completed:** 2026-03-06T10:54:27Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Thread list items display inline agent icons (BotIcon for Claude, BrainCircuitIcon for Codex) before the title
- Fixed model data source from usage_snapshots (never populated) to ThreadRow.model (actually populated)
- Enhanced tooltip to show human-readable model label (e.g., "Opus 4.6") and provider type
- Orchestrated adapter persists resolved model to thread row on each message send, backfilling old threads

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix model data source and add inline agent icon** - `09a0c55` (feat)
2. **Task 2: Persist resolved model to thread row** - `68f84c7` (feat)

## Files Created/Modified
- `src/components/assistant-ui/thread-list.tsx` - Added ThreadModelIcon component, fixed modelId source, enhanced tooltip with label and provider
- `src/lib/orchestration/orchestrated-adapter.ts` - Added model persistence after resolveModel() call

## Decisions Made
- Source modelId from ThreadRow.model as primary source since usage_snapshots is never populated (usageSnapshots.insert is never called)
- Only write model to DB when value differs (no-op optimization)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Thread list agent icons are functional for both Claude and Codex models
- Model persistence pipeline ensures all threads get model data on next use

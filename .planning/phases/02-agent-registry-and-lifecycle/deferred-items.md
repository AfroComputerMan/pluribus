# Deferred Items — Phase 02

Items discovered during Phase 02 execution that are out of scope but need attention in later phases.

## From Plan 02-04 Verification

1. **IPC custom protocol overload** (Phase 3)
   - When 5 agents stream simultaneously, "TypeError: Load failed" occurs causing app blackout requiring reload
   - Related to ORCH-04 (50ms batching requirement)
   - Needs IPC batching/backpressure in Phase 3

2. **Error UX incomplete** (Phase 4)
   - Error indicator shows in sidebar but no error message displayed in thread
   - No retry/continue button for errored agents
   - Needs error display and recovery UI in Phase 4

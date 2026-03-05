---
phase: 01-provider-abstraction
plan: 02
subsystem: api
tags: [typescript, agent-sdk, sidecar, ndjson, provider-pattern, health-check]

# Dependency graph
requires:
  - phase: 01-provider-abstraction (plan 01)
    provides: AgentProvider interface, ProviderCapabilities, RunContext, shared utilities
provides:
  - Agent SDK provider implementing AgentProvider interface
  - AgentSdkSidecar class with NDJSON protocol, health checks, and graceful shutdown
  - Sidecar shutdown protocol and configDir support for per-agent config isolation
affects: [01-03-PLAN, 01-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [sidecar-accessor-pattern, ndjson-multiplexed-queries, health-check-ping-pong]

key-files:
  created:
    - src/lib/providers/agent-sdk-provider.ts
  modified:
    - sidecar/agent-sdk-bridge/index.ts

key-decisions:
  - "Provider receives sidecar via accessor function (getSidecar) rather than owning it -- process manager controls lifecycle"
  - "CLAUDE_CONFIG_DIR set as process-wide env var before query() call -- concurrent multi-config queries would need separate sidecar processes"
  - "Health check: 30s ping interval with 5s pong timeout; failed check kills sidecar and allows restart on next query"

patterns-established:
  - "Sidecar accessor pattern: createAgentSdkProvider(getSidecar) decouples protocol from lifecycle"
  - "Message routing: onMessage(queryId, handler) returns unsubscribe function for clean per-query cleanup"
  - "Shutdown protocol: send shutdown message, poll 100ms intervals up to 3s, kill if unresponsive"

requirements-completed: [PROV-02, PROV-07]

# Metrics
duration: 4min
completed: 2026-03-05
---

# Phase 1 Plan 02: Agent SDK Provider Summary

**Agent SDK provider with AgentSdkSidecar class, NDJSON protocol translation, health checks, graceful shutdown, and CLAUDE_CONFIG_DIR config isolation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-05T15:55:10Z
- **Completed:** 2026-03-05T15:59:10Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Upgraded sidecar with shutdown protocol (abort all queries, 3s deadline, exit) and configDir support on query messages for PROV-07
- Created fresh AgentSdkSidecar class with NDJSON stdin/stdout, message routing by queryId, 30s health checks, and graceful shutdown
- Built createAgentSdkProvider factory that receives sidecar accessor and implements full AgentProvider interface with content accumulation (text, reasoning, tool-call, sub-agent activity)

## Task Commits

Each task was committed atomically:

1. **Task 1: Upgrade sidecar with shutdown protocol and ping/pong** - `c5cb4a4` (feat)
2. **Task 2: Create Agent SDK provider implementation** - `fb6c29f` (feat)

## Files Created/Modified
- `sidecar/agent-sdk-bridge/index.ts` - Added shutdown handler, configDir env var passthrough, updated protocol docs
- `src/lib/providers/agent-sdk-provider.ts` - AgentSdkSidecar class and createAgentSdkProvider factory implementing AgentProvider

## Decisions Made
- Provider receives sidecar via accessor function rather than owning it -- keeps process lifecycle in AgentProcessManager
- CLAUDE_CONFIG_DIR is set as a process-wide env var before SDK query() call; documented limitation that concurrent queries with different configDirs would conflict (single sidecar per agent instance makes this safe in practice)
- Health check uses 30s ping interval with 5s pong timeout; failed check kills sidecar and nulls the child reference so next query triggers restart

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Agent SDK provider ready to be registered with ProviderRegistry from Plan 01
- AgentSdkSidecar exported for process manager integration
- Codex provider (Plan 03) can follow the same accessor pattern established here
- Orchestrated adapter (Plan 04) can wire provider + process manager + sidecar together

---
*Phase: 01-provider-abstraction*
*Completed: 2026-03-05*

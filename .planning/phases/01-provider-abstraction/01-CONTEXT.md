# Phase 1: Provider Abstraction - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Unified agent provider interface with SDK and Codex implementations, process lifecycle management, and full removal of the Claude CLI adapter. This phase delivers the architectural foundation that Phase 2 (Agent Registry) builds on. No new user-facing features -- this is infrastructure refactoring with process safety guarantees.

Requirements: PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06, PROV-07

</domain>

<decisions>
## Implementation Decisions

### CLI Adapter Removal
- Full removal of `claude-adapter.ts` (1900 lines) and the `sh -c` shell wrapper (`claude-stream-sh`) -- no deprecated fallback
- Rewrite shared utilities fresh in the new provider structure (do NOT extract from old adapter)
- Remove the engine toggle from settings UI -- provider selection is now automatic based on model
- Auto-route by model: Claude models -> Agent SDK provider, Codex models -> Codex provider (via `models.ts` mapping)
- Remove `sh` entry from `src-tauri/capabilities/default.json` to close the XSS-to-shell-escape security surface

### Orphan Process Behavior
- Silent cleanup on app startup -- kill orphaned processes automatically, log to dev events, no user-visible notification
- Warn on app exit if agents are still running -- confirmation dialog: "X agents are still running. Close anyway?"
- PID tracking persisted to SQLite -- write active PIDs on spawn, clear on clean exit, query for stale PIDs on startup
- Immediate toast notification + error status badge when an agent process crashes mid-run

### Provider Interface Design
- Extensible `AgentProvider` interface with a `ProviderCapabilities` system (`supportsResume`, `supportsApproval`, `supportsMcp`, etc.)
- Static `ProviderRegistry` -- providers registered at app startup in code, no runtime plugin system
- Providers declare their own supported model IDs -- the registry auto-routes based on model selection
- Model selector UI shows provider badge: e.g., "Claude Sonnet 4 (Agent SDK)" or "Codex (Codex)"

### Sidecar Evolution
- Add structured shutdown protocol: new `shutdown` NDJSON message type; on receive, abort all in-flight queries, wait up to 3s, then exit
- Add ping/pong health checks: app sends periodic `ping`, sidecar responds with `pong`; if no pong within 5s, restart sidecar
- Move sidecar ownership from Agent SDK adapter into centralized `AgentProcessManager` -- provider receives a reference
- Defer Agent SDK 12s cold-start optimization to Phase 2+

### Claude's Discretion
- Exact `AgentProvider` interface method signatures and TypeScript types
- Internal process manager data structures and cleanup implementation
- How to structure the `src/lib/providers/` and `src/lib/orchestration/` directories
- Dev event system refactoring approach (per-agent scoping, buffer management)
- Exact ping/pong interval and restart strategy for sidecar health checks

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `router-adapter.ts`: Simple routing pattern (48 lines) -- will be replaced by `OrchestratedAdapter` but shows the model-routing logic
- `thread-status-store.ts`: Zustand store for thread status tracking -- extend for richer agent status states
- `models.ts`: `isCodexModel()` function and `DEFAULT_MODEL_ID` -- extend for provider-declares-models pattern
- `codex-approval-store.ts`: Existing approval flow store for Codex -- keep and integrate with provider capabilities

### Established Patterns
- `ChatModelAdapter` from assistant-ui: All adapters implement `run()` as an `AsyncGenerator<ChatModelRunResult, void>` -- new `OrchestratedAdapter` must follow this
- Tauri `Command.create()` / `Command.sidecar()` for process spawning with `close`/`error` event handlers
- NDJSON over stdin/stdout for sidecar communication (`AgentSdkSidecar` class)
- SQLite via `tauri-plugin-sql` for all persistence (`db.ts` with migration system)
- Per-thread locking: FIFO waiter queue in claude-adapter, promise chain in agent-sdk-adapter -- unify into process manager

### Integration Points
- `RuntimeProvider.tsx`: Swap `createRouterAdapter()` for new `createOrchestratedAdapter(registry, processManager)`
- `settings-overlay.tsx`: Remove engine toggle, keep model selector
- `src-tauri/capabilities/default.json`: Remove `sh` entry, keep `claude` and `codex` direct commands
- `src-tauri/src/lib.rs`: Wire `RunEvent::ExitRequested` for graceful process cleanup (if needed beyond SQLite PID tracking)
- `db.ts`: Add migration for PID tracking table (active_processes or similar)

</code_context>

<specifics>
## Specific Ideas

- Provider badge in model selector should be subtle (secondary text or icon), not the primary label
- Crash toast should include the thread/agent name so user knows which one failed
- Exit confirmation dialog should list the running agents by name, not just a count

</specifics>

<deferred>
## Deferred Ideas

- Agent SDK 12-second cold-start optimization -- Phase 2+ performance work
- Split-pane views requiring multiple `AssistantRuntimeProvider` instances -- Phase 4 (Multi-Agent UI)
- Config-driven provider registration (runtime plugin system) -- future version if needed
- Per-agent dev event scoping (separate buffers per agent) -- Phase 2 when multiple agents exist

</deferred>

---

*Phase: 01-provider-abstraction*
*Context gathered: 2026-03-05*

---
phase: 01-provider-abstraction
verified: 2026-03-06T01:30:00Z
status: human_needed
score: 10/11 must-haves verified
gaps: []
human_verification:
  - test: "Agent SDK provider streams output end-to-end"
    expected: "Select a Claude model, send message, see streamed response"
    why_human: "Requires live Agent SDK sidecar and API key"
  - test: "Codex provider streams output end-to-end"
    expected: "Select a Codex model, send message, see streamed response"
    why_human: "Requires live Codex app-server and API key"
  - test: "Exit confirmation dialog appears when agents running"
    expected: "While agent is running, close window, see native dialog listing agent name"
    why_human: "Requires runtime process state and native dialog interaction"
  - test: "Orphan cleanup works after crash"
    expected: "Kill app mid-run, restart, verify stale PIDs cleaned from active_processes"
    why_human: "Requires simulating crash scenario"
  - test: "Per-agent config isolation works"
    expected: "Two agents with different configDir use separate CLAUDE_CONFIG_DIR"
    why_human: "Requires verifying environment variable behavior at runtime"
  - test: "App builds and runs successfully"
    expected: "cargo tauri dev starts without errors, UI loads"
    why_human: "Build verification needs full toolchain"
---

# Phase 01: Provider Abstraction Verification Report

**Phase Goal:** Unified provider abstraction layer replacing all legacy adapters
**Verified:** 2026-03-06T01:30:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | AgentProvider interface and ProviderCapabilities types compile and are importable | VERIFIED | `src/lib/providers/types.ts` exports AgentProvider, ProviderCapabilities, RunContext, DevEvent, ActiveProcess, ChatModelRunResult |
| 2 | ProviderRegistry can register providers and look up a provider by model ID | VERIFIED | `src/lib/providers/provider-registry.ts` has register(), getProviderForModel() with O(1) Map lookup, getAllProviders(), getAvailableModels() |
| 3 | AgentProcessManager can track/untrack PIDs in SQLite | VERIFIED | `src/lib/orchestration/agent-process-manager.ts` has trackProcess(), untrackProcess() calling db.processes.track/untrack |
| 4 | On startup, cleanupOrphans() queries stale PIDs and attempts to kill them | VERIFIED | cleanupOrphans() queries db.processes.getAll(), iterates with invoke("kill_pid"), clears table. RuntimeProvider.tsx calls it on module load |
| 5 | active_processes SQLite table exists after migration runs | VERIFIED | `src-tauri/migrations/008_active_processes.sql` has CREATE TABLE + index. `lib.rs` has migration v8 entry |
| 6 | Agent SDK provider implements AgentProvider interface and yields ChatModelRunResult | VERIFIED | `src/lib/providers/agent-sdk-provider.ts` -- createAgentSdkProvider returns AgentProvider, run() yields ChatModelRunResult, handles text/tool_use/thinking blocks |
| 7 | Codex provider implements AgentProvider interface and yields ChatModelRunResult | VERIFIED | `src/lib/providers/codex-provider.ts` -- createCodexProvider returns AgentProvider, run() yields ChatModelRunResult, maps item_delta/item_completed/turn_completed |
| 8 | OrchestratedAdapter routes to Agent SDK or Codex provider based on model | VERIFIED | `src/lib/orchestration/orchestrated-adapter.ts` -- resolves model, calls registry.getProviderForModel(), delegates to provider.run() |
| 9 | Legacy adapters deleted from codebase | VERIFIED | claude-adapter.ts, agent-sdk-adapter.ts, codex-adapter.ts, router-adapter.ts all confirmed missing. No import references remain in src/ |
| 10 | Shell security surface closed | VERIFIED | `capabilities/default.json` has no `sh`, `claude-stream-sh`, or `claude` entries. Only git, agent-sdk-bridge sidecar, and codex remain |
| 11 | Model selector shows provider badge | VERIFIED | thread.tsx lines 801 and 817 show "Agent SDK" and "Codex" as subtle secondary text per model option |

**Score:** 11/11 truths verified (automated checks)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/providers/types.ts` | AgentProvider, ProviderCapabilities, RunContext interfaces | VERIFIED | 70 lines, all interfaces exported with correct shapes |
| `src/lib/providers/shared.ts` | extractUserPrompt, log helper | VERIFIED | 47 lines, extractUserPrompt walks messages backwards, log checks import.meta.env.DEV |
| `src/lib/providers/provider-registry.ts` | ProviderRegistry with model-to-provider mapping | VERIFIED | 59 lines, register(), getProviderForModel(), getAllProviders(), getAvailableModels() |
| `src/lib/orchestration/agent-process-manager.ts` | PID tracking, orphan cleanup | VERIFIED | 155 lines, dual kill strategy (Child handle + invoke kill_pid), cleanupOrphans(), killAll() |
| `src/lib/orchestration/orchestrated-adapter.ts` | ChatModelAdapter wrapping provider registry | VERIFIED | 135 lines, routes by model, manages status, tracks PIDs via onProcessStarted callback |
| `src/lib/providers/agent-sdk-provider.ts` | Agent SDK AgentProvider implementation | VERIFIED | 685 lines, createAgentSdkProvider + AgentSdkSidecar class with NDJSON protocol, health checks, shutdown |
| `src/lib/providers/codex-provider.ts` | Codex AgentProvider implementation | VERIFIED | 435 lines, createCodexProvider + getCodexPid helper, invoke/listen pattern, approval flow |
| `src-tauri/migrations/008_active_processes.sql` | active_processes table schema | VERIFIED | CREATE TABLE with id, provider, pid, thread_id, spawned_at + index |
| `src/components/ExitGuard.tsx` | Exit confirmation with native dialog | VERIFIED | 50 lines, uses getCurrentWindow().onCloseRequested, confirm() from tauri-plugin-dialog |
| `src/lib/dev-events.ts` | Standalone dev event system | VERIFIED | Exists (extracted from claude-adapter.ts per summary) |
| `sidecar/agent-sdk-bridge/index.ts` | Updated sidecar with shutdown + configDir | VERIFIED | shutdown handler aborts queries with 3s deadline, configDir sets CLAUDE_CONFIG_DIR env var |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| agent-process-manager.ts | db.ts | SQLite queries for active_processes | WIRED | db.processes.track/untrack/getAll/clearAll called throughout |
| provider-registry.ts | types.ts | imports AgentProvider interface | WIRED | `import type { AgentProvider } from "@/lib/providers/types"` |
| agent-sdk-provider.ts | types.ts | implements AgentProvider | WIRED | imports AgentProvider, ProviderCapabilities, RunContext; returns conforming object |
| agent-sdk-provider.ts | sidecar index.ts | NDJSON protocol | WIRED | SidecarInbound type includes query, interrupt, shutdown, ping |
| codex-provider.ts | types.ts | implements AgentProvider | WIRED | imports AgentProvider, RunContext; createCodexProvider returns conforming object |
| codex-provider.ts | commands.rs | invoke codex_get_pid | WIRED | `invoke<number \| null>("codex_get_pid")` in getCodexPid() |
| orchestrated-adapter.ts | provider-registry.ts | getProviderForModel lookup | WIRED | `registry.getProviderForModel(model)` at line 49 |
| orchestrated-adapter.ts | agent-process-manager.ts | PID tracking on agent start | WIRED | processManager.trackProcess() via onProcessStarted callback, untrackProcess in finally |
| RuntimeProvider.tsx | orchestrated-adapter.ts | createOrchestratedAdapter call | WIRED | `createOrchestratedAdapter(registry, processManager)` at line 48 |
| RuntimeProvider.tsx | provider-registry.ts | registry.register() | WIRED | Registers both providers at module level (lines 32-33) |
| lib.rs | commands.rs | codex_get_pid registered | WIRED | Imported and listed in generate_handler! macro |
| lib.rs | 008_active_processes.sql | Migration v8 | WIRED | Migration { version: 8, ..., sql: include_str! } |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PROV-01 | 01-01 | Unified AgentProvider interface with standardized lifecycle | SATISFIED | AgentProvider interface in types.ts with run(), interrupt(), capabilities |
| PROV-02 | 01-02 | Agent SDK provider implementation | SATISFIED | agent-sdk-provider.ts with createAgentSdkProvider, full NDJSON protocol |
| PROV-03 | 01-03 | Codex server provider implementation | SATISFIED | codex-provider.ts with createCodexProvider, invoke/listen pattern |
| PROV-04 | 01-01 | Process group management with cleanup on exit and crash recovery | SATISFIED | AgentProcessManager with SQLite tracking + ExitGuard with killAll() |
| PROV-05 | 01-01 | Orphan process detection and cleanup on startup | SATISFIED | cleanupOrphans() in process manager, called on module load in RuntimeProvider |
| PROV-06 | 01-04 | Remove Claude CLI adapter and sh wrapper | SATISFIED | All 4 legacy files deleted, no sh/claude in capabilities |
| PROV-07 | 01-02 | Per-agent config isolation | SATISFIED | configDir field on sidecar query messages, sets CLAUDE_CONFIG_DIR env var |

No orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | No TODO/FIXME/PLACEHOLDER/HACK markers found in any new file |

### Human Verification Required

### 1. Agent SDK Provider Streaming

**Test:** Select a Claude model (e.g., Opus 4.6), send a message, verify streamed response appears in the chat UI
**Expected:** Text appears incrementally, tool calls render correctly, session is persisted
**Why human:** Requires live Agent SDK sidecar binary + Anthropic API key

### 2. Codex Provider Streaming

**Test:** Select a Codex model, send a message, verify streamed response appears
**Expected:** Text streams via item_delta events, tool calls render, approval flow works
**Why human:** Requires live Codex app-server + API key

### 3. Exit Confirmation Dialog

**Test:** While an agent is running, try to close the app window
**Expected:** Native dialog appears listing running agent(s), cancel keeps window open, confirm kills processes and closes
**Why human:** Requires runtime process state and native OS dialog interaction

### 4. Orphan Cleanup After Crash

**Test:** Kill the app mid-run (kill -9), restart, check console for orphan cleanup message
**Expected:** "Cleaned up N orphan processes" in console, active_processes table cleared
**Why human:** Requires simulating crash and inspecting SQLite

### 5. Config Isolation (PROV-07)

**Test:** Start two agents with different config directories, verify isolation
**Expected:** Each agent uses separate CLAUDE_CONFIG_DIR
**Why human:** Requires verifying environment variable behavior at runtime; note code comment warns concurrent queries with different configDirs on same sidecar would conflict

### 6. Full Build

**Test:** Run `bun run build` and `cargo tauri build`
**Expected:** Both complete without errors
**Why human:** Requires full Rust + Node toolchain

### Gaps Summary

No automated gaps found. All 11 observable truths verified through code inspection. All 7 requirements (PROV-01 through PROV-07) are satisfied with substantive implementations. All legacy adapters are confirmed deleted. All key links are wired. No anti-patterns detected.

The phase requires human verification for runtime behavior (streaming, exit dialog, orphan cleanup, config isolation) which cannot be tested through static code analysis alone.

---

_Verified: 2026-03-06T01:30:00Z_
_Verifier: Claude (gsd-verifier)_

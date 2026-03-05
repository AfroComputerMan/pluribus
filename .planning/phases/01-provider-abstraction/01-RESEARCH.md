# Phase 1: Provider Abstraction - Research

**Researched:** 2026-03-05
**Domain:** Agent provider interface design, process lifecycle management, Tauri shell plugin, assistant-ui adapter pattern
**Confidence:** HIGH

## Summary

Phase 1 replaces three separate adapter implementations (Claude CLI, Agent SDK, Codex) with a unified `AgentProvider` interface backed by a centralized `AgentProcessManager`. The Claude CLI adapter (1900 lines) and `sh -c` shell wrapper are fully removed. The existing Agent SDK sidecar and Codex app-server patterns are refactored into clean provider implementations that conform to a shared interface. Process lifecycle (PID tracking, orphan cleanup, crash detection) is centralized in the process manager with SQLite persistence.

The codebase already has strong foundations: `router-adapter.ts` demonstrates the model-based routing pattern (48 lines), `AgentSdkSidecar` class shows the multiplexed NDJSON protocol, and the Codex Rust backend (`CodexService`) handles JSON-RPC process management. The refactoring extracts cross-cutting concerns (config loading, session management, status tracking) into an `OrchestratedAdapter` that wraps any provider, following the pattern already sketched in `.planning/research/ARCHITECTURE.md`.

**Primary recommendation:** Build bottom-up: types and shared utilities first, then provider implementations, then process manager with PID tracking, then the orchestrated adapter that replaces `router-adapter.ts`, and finally cleanup of old code.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Full removal of `claude-adapter.ts` (1900 lines) and the `sh -c` shell wrapper (`claude-stream-sh`) -- no deprecated fallback
- Rewrite shared utilities fresh in the new provider structure (do NOT extract from old adapter)
- Remove the engine toggle from settings UI -- provider selection is now automatic based on model
- Auto-route by model: Claude models -> Agent SDK provider, Codex models -> Codex provider (via `models.ts` mapping)
- Remove `sh` entry from `src-tauri/capabilities/default.json` to close the XSS-to-shell-escape security surface
- Silent cleanup on app startup -- kill orphaned processes automatically, log to dev events, no user-visible notification
- Warn on app exit if agents are still running -- confirmation dialog: "X agents are still running. Close anyway?"
- PID tracking persisted to SQLite -- write active PIDs on spawn, clear on clean exit, query for stale PIDs on startup
- Immediate toast notification + error status badge when an agent process crashes mid-run
- Extensible `AgentProvider` interface with a `ProviderCapabilities` system (`supportsResume`, `supportsApproval`, `supportsMcp`, etc.)
- Static `ProviderRegistry` -- providers registered at app startup in code, no runtime plugin system
- Providers declare their own supported model IDs -- the registry auto-routes based on model selection
- Model selector UI shows provider badge: e.g., "Claude Sonnet 4 (Agent SDK)" or "Codex (Codex)"
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

### Deferred Ideas (OUT OF SCOPE)
- Agent SDK 12-second cold-start optimization -- Phase 2+ performance work
- Split-pane views requiring multiple `AssistantRuntimeProvider` instances -- Phase 4 (Multi-Agent UI)
- Config-driven provider registration (runtime plugin system) -- future version if needed
- Per-agent dev event scoping (separate buffers per agent) -- Phase 2 when multiple agents exist
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROV-01 | Unified AgentProvider interface with standardized lifecycle (start, stop, cleanup, status) | AgentProvider interface design with ProviderCapabilities; OrchestratedAdapter wraps providers with lifecycle management |
| PROV-02 | Agent SDK provider implementation (replaces Claude CLI adapter entirely) | Refactor AgentSdkSidecar into process-manager-owned infrastructure; provider handles only NDJSON protocol and content accumulation |
| PROV-03 | Codex server provider implementation (refactored from existing Codex adapter) | Codex adapter already works via Rust backend; refactor to conform to AgentProvider interface, keep Tauri invoke/listen pattern |
| PROV-04 | Process group management with cleanup on app exit and crash recovery | AgentProcessManager with PID tracking in SQLite, Tauri `RunEvent::ExitRequested` for exit dialog, `beforeunload` for frontend |
| PROV-05 | Orphan process detection and cleanup on app startup | Query `active_processes` table on startup, attempt kill via OS PID, log results to dev events |
| PROV-06 | Remove Claude CLI adapter and sh -c shell wrapper from codebase | Delete claude-adapter.ts, remove `claude-stream-sh` from capabilities/default.json, update all imports |
| PROV-07 | Per-agent config isolation (separate config directories/environments) | CLAUDE_CONFIG_DIR env var for Agent SDK sidecar, Codex uses thread-scoped config via app-server API |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @assistant-ui/react | ^0.12.9 | Chat UI runtime, ChatModelAdapter interface | Already installed; OrchestratedAdapter must implement `ChatModelAdapter` |
| @tauri-apps/plugin-shell | ~2 | Process spawning via `Command.create()` and `Command.sidecar()` | Already installed; all process management flows through this |
| @tauri-apps/plugin-sql | ^2.3.2 | SQLite persistence for PID tracking table | Already installed; migration system in place |
| zustand | ^5.0.11 | ThreadStatusStore for agent status tracking | Already installed; extend existing store |
| sonner | ^2.0.7 | Toast notifications for crash events | Already installed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tauri-apps/api (core) | ^2 | `invoke()` for Codex Rust backend, `listen()` for events | Codex provider communication |
| @tauri-apps/api (path) | ^2 | `homeDir()` fallback for cwd resolution | Default working directory |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQLite PID tracking | In-memory Map only | Loses PID state on crash -- cannot detect orphans on restart |
| Tauri `RunEvent::ExitRequested` for exit dialog | `beforeunload` in frontend | Frontend event fires too late; Rust-side gives process control before window closes |
| Zustand for status | Tauri event emitter only | Zustand gives React reactivity for free; events alone require manual subscription |

**Installation:** No new packages needed. All dependencies are already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/lib/
  providers/
    types.ts              # AgentProvider, ProviderCapabilities, RunContext interfaces
    provider-registry.ts  # Static registry mapping model IDs to providers
    agent-sdk-provider.ts # Agent SDK implementation
    codex-provider.ts     # Codex implementation
    shared.ts             # extractUserPrompt, content part helpers (rewritten fresh)
  orchestration/
    orchestrated-adapter.ts    # ChatModelAdapter wrapping any provider
    agent-process-manager.ts   # PID tracking, spawn/kill, orphan cleanup
```

### Pattern 1: AgentProvider Interface
**What:** Each provider implements a narrow interface focused on protocol translation only. Cross-cutting concerns (config loading, session management, status) live in the OrchestratedAdapter.
**When to use:** Always -- this is the core abstraction.

```typescript
interface AgentProvider {
  readonly id: string;                    // "agent-sdk" | "codex"
  readonly displayName: string;           // "Agent SDK" | "Codex"
  readonly capabilities: ProviderCapabilities;
  readonly supportedModels: string[];     // Model IDs this provider handles

  /**
   * Execute a single agent run. Yields ChatModelRunResult chunks.
   * Does NOT manage processes, sessions, or status -- caller handles those.
   */
  run(ctx: RunContext): AsyncGenerator<ChatModelRunResult, void>;

  /** Interrupt the current run for a given query/thread. */
  interrupt(threadId: string): Promise<void>;
}

interface ProviderCapabilities {
  supportsResume: boolean;       // Session resume via session ID
  supportsApproval: boolean;     // Tool approval flow (Codex)
  supportsSubAgents: boolean;    // Sub-agent/Task tracking (Agent SDK)
  supportsMcp: boolean;          // MCP server config passthrough
  supportsEffort: boolean;       // Reasoning effort parameter
}

interface RunContext {
  prompt: string;
  sessionId: string | null;
  model: string;
  cwd: string;
  effort: string | null;
  abortSignal: AbortSignal;
  threadId: string;
  onDevEvent?: (event: DevEvent) => void;
}
```

### Pattern 2: OrchestratedAdapter (replaces RouterAdapter)
**What:** Single `ChatModelAdapter` implementation that loads thread config, selects provider, manages status, and delegates to the provider for protocol-specific streaming.
**When to use:** This is the only adapter wired into `RuntimeProvider.tsx`.

```typescript
function createOrchestratedAdapter(
  registry: ProviderRegistry,
  processManager: AgentProcessManager,
): ChatModelAdapter {
  return {
    async *run(options) {
      const threadId = (options as any).unstable_threadId?.trim() ?? "__global__";

      // 1. Load thread config from SQLite
      const threadRow = await db.threads.get(threadId);
      const model = resolveModel(threadRow?.model ?? null);
      const effort = resolveEffort(threadRow?.effort ?? null);
      const cwd = threadRow?.cwd ?? await homeDir();

      // 2. Select provider based on model
      const provider = registry.getProviderForModel(model);

      // 3. Extract prompt
      const prompt = extractUserPrompt(options.messages);
      if (!prompt.trim()) return;

      // 4. Resolve session
      const sessionRow = await db.sessions.get(threadId);
      const sessionId = sessionRow?.session_id ?? null;

      // 5. Track status
      const { setStatus } = useThreadStatusStore.getState();
      const title = threadRow?.title ?? undefined;
      setStatus(threadId, "running", title);

      try {
        yield* provider.run({
          prompt, sessionId, model, cwd, effort,
          abortSignal: options.abortSignal,
          threadId,
        });
        setStatus(threadId, "idle", title);
      } catch (err) {
        setStatus(threadId, "error", title);
        throw err;
      }
    },
  };
}
```

### Pattern 3: AgentProcessManager with PID Tracking
**What:** Centralized process lifecycle. Tracks PIDs in SQLite for orphan detection. Owns the sidecar singleton.
**When to use:** All process spawn/kill operations go through this.

```typescript
// SQLite table: active_processes
// | id TEXT PK | provider TEXT | pid INTEGER | thread_id TEXT | spawned_at TEXT |

interface AgentProcessManager {
  /** Register a spawned process PID. */
  trackProcess(threadId: string, provider: string, pid: number): Promise<void>;

  /** Remove a process from tracking (clean exit). */
  untrackProcess(threadId: string): Promise<void>;

  /** On startup: query for stale PIDs, attempt kill, clean up table. */
  cleanupOrphans(): Promise<number>;  // returns count of orphans killed

  /** On app exit: kill all tracked processes, clear table. */
  killAll(): Promise<void>;

  /** Get the sidecar instance (owned by process manager). */
  getSidecar(): AgentSdkSidecar;

  /** Check if any agents are running (for exit confirmation). */
  hasActiveProcesses(): Promise<boolean>;

  /** Get list of active agent descriptions (for exit dialog). */
  getActiveAgentDescriptions(): Promise<Array<{ threadId: string; title?: string }>>;
}
```

### Pattern 4: Sidecar Shutdown Protocol
**What:** Structured shutdown NDJSON message for the Agent SDK sidecar. On `shutdown`, the sidecar aborts all in-flight queries, waits up to 3s, then exits.
**When to use:** On app exit, before process kill.

```typescript
// New sidecar inbound message type
type SidecarInbound =
  | { type: "query"; ... }
  | { type: "interrupt"; queryId: string }
  | { type: "ping" }
  | { type: "shutdown" };  // NEW

// In sidecar index.ts:
if (msg.type === "shutdown") {
  // Abort all active queries
  for (const [id, ac] of activeAborts) {
    ac.abort();
  }
  // Wait for in-flight work to settle (max 3s)
  const deadline = Date.now() + 3000;
  while (activeAborts.size > 0 && Date.now() < deadline) {
    await Bun.sleep(100);
  }
  process.exit(0);
}
```

### Anti-Patterns to Avoid
- **Extracting from claude-adapter.ts:** User decision says rewrite fresh. Do NOT copy-paste and refactor from the 1900-line adapter. Write new implementations from scratch using the existing patterns as reference only.
- **Process management in providers:** Providers must NOT spawn or kill processes. That is the process manager's job. Providers receive references (e.g., sidecar handle) and operate on them.
- **Direct store access from providers:** Providers should NOT import `useThreadStatusStore`. Status updates flow through the OrchestratedAdapter only. This keeps data flow unidirectional.
- **Global singleton providers:** Do not use module-level `const sidecar = new AgentSdkSidecar()`. The process manager owns the sidecar and passes it to the provider.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process spawning | Custom child_process wrapper | Tauri `Command.create()` / `Command.sidecar()` | Handles platform differences, permission scoping, stdin/stdout piping |
| SQLite access | Raw SQL strings everywhere | Existing `db.ts` pattern with namespaced functions | Type-safe, consistent error handling, migration support |
| Toast notifications | Custom notification system | `sonner` toast library (already installed) | Crash toast, exit warning -- sonner handles stacking, dismissal |
| Exit confirmation dialog | Custom modal | `@tauri-apps/plugin-dialog` (already installed) or Tauri `RunEvent::ExitRequested` with Rust-side dialog | Native dialog blocks exit, web dialogs don't |
| Status reactivity | Custom event emitter + manual subscription | Zustand store (`useThreadStatusStore`) | React integration for free, devtools support |
| NDJSON line protocol | Custom parser | Existing `lineBuffer` + `JSON.parse` pattern from `AgentSdkSidecar` | Already handles partial lines, non-JSON output |

**Key insight:** Nearly every infrastructure component needed already exists in the codebase. The work is restructuring and unifying, not building new capabilities.

## Common Pitfalls

### Pitfall 1: Import Dependency on claude-adapter.ts
**What goes wrong:** `agent-sdk-adapter.ts` imports `extractUserPrompt`, `pushClaudeDevEvent`, `ClaudeDevEventCategory`, and `SidecarSdkMessage` from `claude-adapter.ts`. `DevPanel.tsx` and `thread.tsx` also import from it. Deleting claude-adapter.ts breaks multiple files.
**Why it happens:** Shared utilities were defined in the adapter file rather than a shared module.
**How to avoid:** Before deleting claude-adapter.ts, ensure all re-exported types and functions have new homes in `providers/shared.ts` or `providers/types.ts`. Update all import paths simultaneously.
**Warning signs:** TypeScript compilation errors referencing `@/lib/claude-adapter`.

### Pitfall 2: Sidecar PID vs Query Tracking
**What goes wrong:** The sidecar is a single long-lived process with multiplexed queries. Tracking "sidecar PID" in the process table is correct for orphan cleanup, but does NOT tell you which agents are active. Active agent tracking must also check the `handlers` Map or equivalent.
**Why it happens:** Confusing process-level lifecycle with query-level lifecycle.
**How to avoid:** Track the sidecar PID for orphan cleanup. Track active queries separately (in-memory Map keyed by threadId). The "has active agents" check combines both: sidecar PID alive AND queries Map non-empty.
**Warning signs:** Exit dialog says "0 agents running" when sidecar queries are in-flight.

### Pitfall 3: Codex Process Ownership Split (Rust vs TypeScript)
**What goes wrong:** The Codex app-server process is spawned and managed by Rust (`CodexService::start()`), not by the TypeScript frontend. PID tracking in the TypeScript `AgentProcessManager` cannot directly track a Rust-owned process.
**Why it happens:** The Codex adapter uses Tauri `invoke()` instead of `Command.create()`.
**How to avoid:** Add a Tauri command `codex_get_pid()` that returns the Codex process PID from the Rust side. Or register the PID via a Tauri event when `CodexService::start()` spawns. The process manager stores this PID for orphan detection.
**Warning signs:** Orphan cleanup misses the Codex process; `codex app-server` lingers after crash.

### Pitfall 4: Race Between Exit Dialog and Process Kill
**What goes wrong:** User confirms exit, but async process cleanup takes time. If the app window closes before processes are killed, orphans remain.
**Why it happens:** The exit confirmation and process cleanup are separate async operations.
**How to avoid:** Use Tauri's Rust-side `RunEvent::ExitRequested` handler with `event.prevent_close()`. Run cleanup in Rust before allowing the window to close. Only call `app_handle.exit(0)` after all processes are killed.
**Warning signs:** Orphaned processes after quitting the app, especially under load.

### Pitfall 5: CLAUDE_CONFIG_DIR Support Uncertainty
**What goes wrong:** PROV-07 requires per-agent config isolation. The `CLAUDE_CONFIG_DIR` environment variable may or may not be supported by the Agent SDK.
**Why it happens:** This was flagged as unverified in STATE.md blockers.
**How to avoid:** Test empirically: set `CLAUDE_CONFIG_DIR` when spawning the sidecar and verify the SDK reads from that path. If unsupported, fall back to process-level isolation (separate sidecar per config dir) or defer to Phase 2.
**Warning signs:** Multiple agents sharing the same Claude config, causing session corruption.

### Pitfall 6: Removing `sh` Permission Before Removing All `sh` Usage
**What goes wrong:** Removing the `claude-stream-sh` entry from `capabilities/default.json` while `claude-adapter.ts` still exists causes runtime permission errors.
**Why it happens:** Capability removal and code removal happen in different tasks.
**How to avoid:** Remove code first, then remove capabilities. Or do both atomically in the same commit.
**Warning signs:** "Permission denied" errors when spawning shell commands.

## Code Examples

### Existing ChatModelAdapter Pattern (from router-adapter.ts)
```typescript
// Source: src/lib/router-adapter.ts
export function createRouterAdapter(): ChatModelAdapter {
  const sdkAdapter = createAgentSdkAdapter();
  let codexInstance: ChatModelAdapter | null = null;

  return {
    async *run(options): AsyncGenerator<ChatModelRunResult, void> {
      const threadKey =
        (options as { unstable_threadId?: string }).unstable_threadId?.trim() ??
        "__global__";
      const row = await db.threads.get(threadKey);
      const modelId = row?.model ?? DEFAULT_MODEL_ID;
      const adapter = isCodexModel(modelId)
        ? (codexInstance ??= createCodexAdapter())
        : sdkAdapter;
      // ... delegate to adapter
    },
  };
}
```

### Existing Sidecar NDJSON Protocol (from agent-sdk-adapter.ts)
```typescript
// Source: src/lib/agent-sdk-adapter.ts
type SidecarInbound =
  | { type: "query"; id: string; prompt: string; sessionId?: string; model?: string; cwd?: string }
  | { type: "interrupt"; queryId: string }
  | { type: "ping" };

type SidecarOutbound =
  | { type: "pong" }
  | { type: "message"; queryId: string; message: SidecarSdkMessage }
  | { type: "done"; queryId: string; sessionId: string; costUsd: number }
  | { type: "error"; queryId: string; error: string };
```

### Existing Codex Tauri Invoke Pattern (from codex-adapter.ts)
```typescript
// Source: src/lib/codex-adapter.ts
const codexThreadId = await invoke<string>("codex_start_thread", {
  model: model ?? null,
  reasoningEffort: effortArg ?? null,
});
// Listen for events filtered by thread_id
const unlistenPromise = listen<AgentEvent>("agent:event", ({ payload }) => {
  if (payload.thread_id !== codexThreadId) return;
  push(payload);
});
```

### SQLite Migration Pattern (from lib.rs)
```rust
// Source: src-tauri/src/lib.rs
Migration {
    version: 8,  // Next migration number
    description: "active_processes_tracking",
    sql: include_str!("../migrations/008_active_processes.sql"),
    kind: MigrationKind::Up,
},
```

### PID Tracking Migration SQL
```sql
-- 008_active_processes.sql
CREATE TABLE IF NOT EXISTS active_processes (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,          -- "agent-sdk" | "codex"
  pid         INTEGER NOT NULL,
  thread_id   TEXT,                   -- nullable for shared processes (sidecar)
  spawned_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_active_processes_provider ON active_processes(provider);
```

### Tauri RunEvent::ExitRequested Pattern (for exit dialog)
```rust
// In lib.rs, replace .run() with .build() + .run_callback()
let app = tauri::Builder::default()
    // ... plugins and setup ...
    .build(tauri::generate_context!())
    .expect("error building tauri application");

app.run(|app_handle, event| {
    if let tauri::RunEvent::ExitRequested { api, .. } = event {
        // Prevent default close behavior
        api.prevent_exit();

        let handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            // Check for active processes and optionally show dialog
            // Kill all tracked processes
            // Then exit
            handle.exit(0);
        });
    }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Claude CLI via `sh -c` wrapper | Agent SDK via compiled Bun sidecar | Already migrated (agent-sdk-adapter exists) | Shell adapter is legacy; remove entirely |
| Engine toggle in settings (shell vs SDK) | Auto-route by model via models.ts | This phase | No user-facing engine choice |
| Per-adapter process management | Centralized AgentProcessManager | This phase | Enables multi-agent in Phase 2 |
| No PID tracking | SQLite-persisted PID table | This phase | Crash recovery and orphan cleanup |

**Deprecated/outdated:**
- `claude-adapter.ts`: 1900 lines of Claude CLI stream parsing. Replaced by Agent SDK provider.
- `claude-stream-sh` shell permission: XSS-to-shell-escape vector. Remove entirely.
- `router-adapter.ts`: Simple if/else routing. Replaced by OrchestratedAdapter with registry.

## Open Questions

1. **CLAUDE_CONFIG_DIR Support in Agent SDK**
   - What we know: The Agent SDK sidecar uses `@anthropic-ai/claude-agent-sdk` `query()` function with `pathToClaudeCodeExecutable`. The SDK likely passes environment to the Claude subprocess.
   - What's unclear: Whether `CLAUDE_CONFIG_DIR` is respected by the SDK, or if it's a Claude CLI-only feature.
   - Recommendation: Test empirically during implementation. If unsupported, PROV-07 for Agent SDK can use separate sidecar instances per config dir, or defer to Phase 2.

2. **Codex PID Access from TypeScript**
   - What we know: `CodexService::start()` spawns `codex app-server` in Rust. The `Child` struct has a `.id()` method for PID.
   - What's unclear: Whether the PID is exposed to the frontend today.
   - Recommendation: Add a `codex_get_pid` Tauri command that returns the PID from the Rust `CodexService`. Or emit a `codex:started` event with the PID.

3. **Exit Confirmation Dialog Implementation**
   - What we know: Tauri supports `RunEvent::ExitRequested` in Rust with `api.prevent_exit()`. Also has `tauri-plugin-dialog` for native dialogs.
   - What's unclear: Whether to use a native dialog from Rust or a web dialog from the frontend.
   - Recommendation: Use Rust-side `RunEvent::ExitRequested` + `tauri-plugin-dialog` `MessageDialogBuilder`. This blocks the exit before the window closes, preventing orphans.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None configured (per CLAUDE.md: "No test framework is configured") |
| Config file | none -- see Wave 0 |
| Quick run command | `bun run build` (type-check + bundle) |
| Full suite command | `bun run build` (no tests exist) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROV-01 | AgentProvider interface + ProviderCapabilities types compile | type-check | `tsc --noEmit` | N/A (type definitions) |
| PROV-02 | Agent SDK provider yields ChatModelRunResult from sidecar messages | manual-only | Manual: start agent, verify streaming output | N/A |
| PROV-03 | Codex provider yields ChatModelRunResult from Tauri events | manual-only | Manual: start Codex agent, verify streaming | N/A |
| PROV-04 | Active PIDs written to SQLite on spawn, cleared on exit | manual-only | Manual: spawn agent, check DB, kill app, check for orphan | N/A |
| PROV-05 | Stale PIDs from active_processes killed on startup | manual-only | Manual: kill app mid-run, restart, verify cleanup | N/A |
| PROV-06 | claude-adapter.ts and sh entry removed, app still builds | build | `bun run build` | N/A |
| PROV-07 | Per-agent config isolation via env vars or separate dirs | manual-only | Manual: start two agents, verify isolated configs | N/A |

### Sampling Rate
- **Per task commit:** `tsc --noEmit` (type check, < 10s)
- **Per wave merge:** `bun run build` (full type-check + bundle)
- **Phase gate:** `bun run build` succeeds AND manual smoke test of both providers

### Wave 0 Gaps
- No test framework is configured. All validation is via type-checking (`tsc --noEmit`) and manual smoke testing.
- Given no test framework exists and the CONTEXT.md does not request one, validation relies on TypeScript strict mode (which is enabled) and manual testing.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `claude-adapter.ts`, `agent-sdk-adapter.ts`, `codex-adapter.ts`, `router-adapter.ts`, `models.ts`, `db.ts`, `thread-status-store.ts`, `codex-approval-store.ts`
- Codebase analysis: `sidecar/agent-sdk-bridge/index.ts`, `src-tauri/src/lib.rs`, `src-tauri/src/codex/service.rs`
- Codebase analysis: `src-tauri/capabilities/default.json`, `RuntimeProvider.tsx`
- `.planning/research/ARCHITECTURE.md` -- prior architecture research (2026-03-05)

### Secondary (MEDIUM confidence)
- Tauri 2 documentation: `RunEvent::ExitRequested` pattern for exit handling
- Tauri plugin-shell documentation: `Command.create()`, `Command.sidecar()` APIs

### Tertiary (LOW confidence)
- `CLAUDE_CONFIG_DIR` support in Agent SDK -- unverified, flagged in STATE.md blockers

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already installed and in use, no new dependencies
- Architecture: HIGH - patterns validated against existing codebase, ARCHITECTURE.md research aligns with CONTEXT.md decisions
- Pitfalls: HIGH - identified through direct codebase analysis of import chains and process lifecycle patterns
- PROV-07 (config isolation): LOW - CLAUDE_CONFIG_DIR support unverified

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable -- internal refactoring, no external API dependencies)

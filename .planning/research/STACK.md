# Technology Stack

**Project:** Pluribus Multi-Agent Orchestration
**Researched:** 2026-03-05
**Confidence:** HIGH
**Focus:** Stack additions for multi-thread agent orchestration (concurrent runtimes, process management, state, plugins)

## Existing Stack (Retained)

Not re-researched. Proven in the current codebase:

| Technology | Version | Purpose |
|------------|---------|---------|
| Tauri 2 | 2.x | Desktop shell, shell plugin, SQLite plugin |
| React | ^19.1.0 | UI framework |
| assistant-ui | ^0.12.9 | Chat primitives, thread management |
| SQLite (tauri-plugin-sql) | ^2.3.2 | Persistence for threads, messages, sessions |
| Zustand | ^5.0.11 | Client-side state management |
| Bun | latest | Sidecar runtime, package manager |
| TypeScript | ~5.8.3 | Application logic |
| Tailwind CSS v4 | ^4.1.18 | Styling |
| shadcn/ui + Radix | ^1.4.3 | UI components |

## Key Question 1: Can assistant-ui Support Multiple Concurrent Runtime Instances?

**Answer: YES.** `useRemoteThreadListRuntime` already creates a fresh `LocalRuntime` per active thread via the `runtimeHook` function. Each thread gets its own runtime instance with its own adapter.

**How it works (already implemented in `RuntimeProvider.tsx`):**
- `useRemoteThreadListRuntime` manages a pool of thread runtimes
- `runtimeHook` (currently `useRuntimeHook`) returns a fresh `useLocalRuntime(createRouterAdapter())` per thread
- The `unstable_Provider` pattern injects per-thread adapters (e.g., history persistence)
- Thread switching rehydrates from the cached runtime, not from scratch

**What this means for multi-agent orchestration:**
- Multiple threads can have active `adapter.run()` async generators running simultaneously -- assistant-ui does NOT cancel background threads when switching views
- The existing `createRouterAdapter()` already resolves per-thread model/provider dynamically
- No new assistant-ui configuration needed for concurrent execution

**Limitation:** assistant-ui renders one thread at a time in its `Thread` component. For a split-pane dashboard showing multiple agent outputs simultaneously, you need to either:
1. **Nest multiple `AssistantRuntimeProvider` instances** -- one per visible pane, each with its own runtime. This is the cleaner approach but means each pane is a fully independent runtime.
2. **Use assistant-ui's thread-switching with a custom multi-pane layout** -- single runtime, rapidly switch context as updates arrive. Simpler but creates visual flickering.

**Recommendation:** Option 1 (multiple providers) for the drill-down multi-pane view. The main dashboard overview does NOT need assistant-ui at all -- it should be a custom Zustand-driven status grid.

**Confidence:** HIGH -- verified via assistant-ui docs on [Custom Thread List](https://www.assistant-ui.com/docs/runtimes/custom/custom-thread-list) and [LocalRuntime](https://www.assistant-ui.com/docs/runtimes/custom/local).

## Key Question 2: What's Needed for Concurrent Process Management in Tauri?

**Answer: Nothing new.** Two proven patterns already in the codebase handle this:

### Pattern A: Rust-Managed Processes (Tokio)

The `CodexService` in `src-tauri/src/codex/service.rs` already manages a child process with stdin/stdout streaming and per-thread broadcast channels via Tokio. Generalize into a `ProcessManager`:

| Component | Status | What to Do |
|-----------|--------|------------|
| `tokio::process::Command` | Already in Cargo.toml | Use for spawning agent CLI processes |
| `tokio::sync::broadcast` | Already in Cargo.toml | Per-thread event channels for streaming output to frontend |
| `tokio::sync::mpsc` | Already in Cargo.toml | Command channels (interrupt, approve, stdin) |
| `HashMap<ThreadId, ChildProcess>` behind `Arc<Mutex<>>` | Pattern proven in CodexService | Track N concurrent agent processes |

**Process lifecycle per thread:**
```
spawn(thread_id, provider, cwd, args) -> Child
  -> stdout reader task (tokio::spawn) -> broadcast channel -> Tauri event emit
  -> stderr reader task (tokio::spawn) -> broadcast channel
  -> stdin writer (mpsc receiver) <- frontend commands
kill(thread_id) -> sigterm -> sigkill after timeout
```

**No new Rust crates needed.** `tokio` (with full features), `serde`, `serde_json`, and `tauri-plugin-shell` are already dependencies.

### Pattern B: Sidecar Multiplexing (Bun NDJSON Bridge)

The `AgentSdkSidecar` class already supports concurrent queries via `queryId` correlation. Multiple threads can issue `{ type: "query", id: "<uuid>", ... }` messages simultaneously, and responses are routed back by `queryId`.

**What to add for working directory scoping:** The sidecar query protocol already accepts a `cwd` field. Pass the thread's working directory from the UI when dispatching queries.

**Confidence:** HIGH -- both patterns are running in production code today.

### Tauri Shell Plugin Limits

The `@tauri-apps/plugin-shell` has no documented limit on concurrent `Command.create().spawn()` calls. Each spawned process returns a `Child` handle with `kill()`, `write()` on stdin, and event listeners for stdout/stderr/close. The only constraint is OS-level process limits (typically 1000+ on modern systems).

Permissions in `default.json` already grant `shell:allow-spawn`, `shell:allow-stdin-write`, and `shell:allow-kill` for all needed commands.

## Key Question 3: State Management for Multiple Concurrent Agent States?

**Answer: Expand Zustand stores.** No new library needed.

### Current State

`thread-status-store.ts` already tracks `Map<string, ThreadStatusRecord>` with status, unread flag, title, and finishedAt. This is 80% of what multi-agent orchestration needs.

### What to Add

| Store | Purpose | Key State |
|-------|---------|-----------|
| `agent-registry-store.ts` | **NEW** -- Rich per-agent state beyond status | `Map<ThreadId, AgentState>` where `AgentState` includes: provider, model, cwd, pid, startedAt, tokenUsage, costUsd, lastActivity, error details |
| `workspace-store.ts` | **NEW** -- Active workspace, workspace list | `activeWorkspaceId`, `workspaces: Map<id, Workspace>` |
| `dashboard-store.ts` | **NEW** -- Dashboard UI state | `viewMode: "grid" | "list"`, `selectedThreadIds: Set`, `filterBy: status | provider | workspace` |
| `thread-status-store.ts` | **EXPAND** -- Add new status values | Add `"paused"` and `"completed"` to `ThreadStatus` union. Add `provider` field to `ThreadStatusRecord`. |

### Zustand v5 Pattern for Entity Maps

```typescript
// Selective subscription: only re-render when THIS thread's state changes
const agentState = useAgentRegistryStore(
  (s) => s.agents.get(threadId),
  // Zustand v5 uses Object.is by default, but for map entries use shallow:
  shallow
);
```

This prevents updating one agent's cost counter from re-rendering all other agent panels. Zustand v5's default `Object.is` equality check means map lookups with `.get()` return stable references when unchanged.

**What NOT to use:**
- **Redux / RTK**: Unnecessary complexity for a single-user desktop app. Zustand provides the same selective subscription benefits with 90% less boilerplate.
- **Jotai**: Atom-based model doesn't suit the entity-map pattern. You'd need one atom per agent per field, creating atom proliferation.
- **XState**: State machines are good for individual agent lifecycle modeling but add overhead as the primary state layer. Consider using XState internally within a Zustand store action if agent lifecycle transitions get complex, but not as a replacement.

**Confidence:** HIGH -- Zustand is already in the stack; these are straightforward store additions.

## Key Question 4: Any New Tauri Plugins Needed?

### Recommended: `tauri-plugin-notification`

| Plugin | Version | Purpose | Why |
|--------|---------|---------|-----|
| `@tauri-apps/plugin-notification` | ^2.3.3 | Native OS notifications for agent completion/errors | Fire-and-forget agents need to alert the user when they finish or error. Toast notifications (sonner) only work when the app is focused. Native notifications work when the app is minimized or the user is in another application. |

**Installation:**
```bash
# JavaScript
bun add @tauri-apps/plugin-notification

# Rust (Cargo.toml)
tauri-plugin-notification = "2"
```

**Capabilities addition:**
```json
"notification:default"
```

**Confidence:** HIGH -- official Tauri plugin, mature, well-documented.

### Evaluate Later: `tauri-plugin-fs` (Watch Feature)

| Plugin | Version | Purpose | Why Defer |
|--------|---------|---------|-----------|
| `@tauri-apps/plugin-fs` | ^2.x | Watch working directories for file changes | Could display file change indicators per-agent thread. But the agent CLI output already reports file edits. Only add if users need real-time file tree views. |

### NOT Needed

| Plugin | Why Not |
|--------|---------|
| `tauri-plugin-store` | SQLite already handles all persistence. The key-value store plugin is redundant. |
| `tauri-plugin-clipboard` | No clipboard integration needed for orchestration features. |
| `tauri-plugin-http` | All communication is local IPC (invoke, stdin/stdout, Tauri events). No HTTP needed. |
| `tauri-plugin-window-state` | Nice-to-have for remembering window position/size but unrelated to orchestration. Add later if desired. |
| `tauri-plugin-autostart` | Desktop app, user launches manually. |
| `tauri-plugin-log` | Existing console + dev event system is sufficient. |

## New Stack Additions Summary

### Core (Add Now)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@tauri-apps/plugin-notification` | ^2.3.3 | Native OS notifications for agent completion/errors | Fire-and-forget agents need background alerts |
| Custom Rust `ProcessManager` (Tokio) | n/a | Centralized management of N concurrent agent child processes | Generalization of existing CodexService pattern. No new crate needed. |

### Dashboard & Layout UI

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `react-resizable-panels` | ^4.7.0 | Resizable split-pane layouts for dashboard | shadcn/ui's `Resizable` wraps this. De facto standard. Maintained by bvaughn (React core contributor). |

### Agent SDK

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@anthropic-ai/claude-agent-sdk` | ^0.2.63 | Claude agent sessions (already installed) | Continue using V1 `query()` API. V2 session API (`unstable_v2_createSession`) is still unstable. Migrate to V2 when it stabilizes. |

### Evaluate Later

| Technology | Version | Purpose | When |
|------------|---------|---------|------|
| `@xterm/xterm` | ^6.0.0 | Rich terminal rendering with ANSI support | Only if structured SDKMessage rendering proves insufficient for raw CLI output |
| `@tauri-apps/plugin-fs` (watch) | ^2.x | File system monitoring per working directory | Only if real-time file tree views are requested |

## Dependencies NOT Needed

| Library | Why Not |
|---------|---------|
| LangChain / LangGraph | Pluribus orchestrates CLI-based agents, not API-based LLM chains. The adapter pattern handles provider abstraction. |
| Socket.IO / WebSocket libs | All communication is local IPC (Tauri invoke, stdin/stdout, Tauri events). No network transport needed. |
| Docker / container libs | Agents run as native CLI processes; containerization adds latency and complexity for a desktop app. |
| Database ORMs (Prisma, Drizzle) | SQLite access through `tauri-plugin-sql` with raw SQL. Schema is simple enough that an ORM adds overhead without benefit. |
| React Query / TanStack Query | No server state to cache. All data is local SQLite reads via Tauri IPC. |
| `tauri-sidecar-manager` crate | 1 commit, no releases, not production-ready. Roll your own ProcessManager. |

## Installation

```bash
# New frontend dependencies
bun add @tauri-apps/plugin-notification react-resizable-panels

# No other new frontend dependencies needed.
# Zustand, assistant-ui, Tauri plugins are already installed.

# Rust-side: add to src-tauri/Cargo.toml
# tauri-plugin-notification = "2"

# Register in src-tauri/src/lib.rs:
# .plugin(tauri_plugin_notification::init())

# Add to capabilities/default.json:
# "notification:default"
```

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@tauri-apps/plugin-notification` ^2.3.3 | Tauri 2.x | Official plugin, same version line |
| `react-resizable-panels` ^4.7.0 | React ^19.1.0 | Supports React 18+ |
| `@assistant-ui/react` ^0.12.9 | React ^19.1.0 | Already verified working |
| `zustand` ^5.0.11 | React ^19.1.0 | v5 designed for React 18+ concurrent features |

## Sources

- [assistant-ui Custom Thread List](https://www.assistant-ui.com/docs/runtimes/custom/custom-thread-list) -- Thread runtime instantiation, concurrent threads, Provider pattern
- [assistant-ui LocalRuntime](https://www.assistant-ui.com/docs/runtimes/custom/local) -- Multi-thread support via RemoteThreadListRuntime
- [assistant-ui AssistantRuntime](https://www.assistant-ui.com/docs/api-reference/runtimes/assistant-runtime) -- Root runtime architecture
- [assistant-ui Context API](https://www.assistant-ui.com/docs/guides/context-api) -- State scope boundaries
- [Tauri Shell Plugin](https://v2.tauri.app/plugin/shell/) -- Child process spawning, concurrent process support
- [Tauri Notification Plugin](https://v2.tauri.app/plugin/notification/) -- Native OS notifications
- [Tauri File System Plugin](https://v2.tauri.app/plugin/file-system/) -- File watching with `watch` feature
- [Tauri Events System](https://v2.tauri.app/develop/calling-frontend/) -- Rust-to-frontend event emission
- [Claude Agent SDK npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) -- v0.2.63, V1/V2 API
- [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) -- v4.7.0
- [shadcn/ui Resizable](https://ui.shadcn.com/docs/components/radix/resizable) -- Wraps react-resizable-panels
- [Zustand GitHub](https://github.com/pmndrs/zustand) -- v5, selective subscriptions
- [Zustand Architecture Patterns at Scale](https://brainhub.eu/library/zustand-architecture-patterns-at-scale) -- Entity map patterns

---

*Stack research for: Pluribus Multi-Agent Orchestration*
*Researched: 2026-03-05*

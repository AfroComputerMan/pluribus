# Technology Stack

**Project:** Pluribus Multi-Agent Orchestration
**Researched:** 2026-03-05
**Scope:** Additive stack for multi-agent orchestration on top of existing Tauri 2 + React 19 + assistant-ui 0.12 stack

## Existing Stack (Retained)

Not re-researched. These are proven in the current codebase and carry forward unchanged:

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

## New Stack Additions

### Process Orchestration Layer

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Custom Rust `ProcessManager` (Tokio) | n/a | Centralized management of all agent child processes | The existing CodexService in `src-tauri/src/codex/service.rs` already proves this pattern -- Rust + Tokio managing child processes with stdin/stdout streaming and per-thread broadcast channels. Generalize this into a `ProcessManager` that handles N concurrent agent processes. No third-party crate needed; `tokio::process::Command` + `mpsc`/`broadcast` channels are sufficient. The `tauri-sidecar-manager` crate exists but has 1 commit and no releases -- not production-ready. |
| `@tauri-apps/plugin-shell` | ~2 | Frontend-spawned processes (Agent SDK sidecar) | Already in use. The existing sidecar pattern (single long-lived Bun process, multiplexed NDJSON) scales to multiple concurrent queries without spawning new processes. |

**Confidence:** HIGH -- Both patterns are already implemented and proven in the codebase. The Rust ProcessManager is a generalization of CodexService, and the Bun sidecar already supports concurrent multiplexed queries.

**Architecture decision:** Two process management strategies coexist:
1. **Rust-managed processes** (via Tokio) for providers that need fine-grained control (Codex, future CLI-based providers). Processes tracked in a `HashMap<ThreadId, ChildProcess>` behind `Arc<Mutex<>>`.
2. **Sidecar-managed processes** (via Bun NDJSON bridge) for Agent SDK. Single process, query-level multiplexing. Already supports concurrent queries via `queryId` correlation.

### Agent SDK (Claude)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@anthropic-ai/claude-agent-sdk` | ^0.2.63 | Claude agent sessions | Already in use. Use the V1 `query()` API in the sidecar for now. The V2 session API (`unstable_v2_createSession`/`send`/`stream`) is cleaner for multi-turn but still marked unstable and missing session forking. Migrate to V2 when it stabilizes (likely mid-2026). |

**Confidence:** HIGH -- V1 is production-ready and already integrated. V2 preview is documented but explicitly unstable.

**Key V2 changes to watch:**
- `send()`/`stream()` replaces async generator pattern
- `unstable_v2_createSession()` / `unstable_v2_resumeSession()` for session lifecycle
- `systemPrompt` field replaces `customSystemPrompt`/`appendSystemPrompt`
- `tools` option for allowlisting built-in tools

**Performance note:** The Agent SDK has ~12s cold-start overhead per `query()` call (spawns a new process internally). The sidecar pattern mitigates this for the bridge process itself, but each SDK query still incurs this cost. For fire-and-forget mode this is acceptable; for interactive use it's noticeable. No known workaround in the current SDK.

### MCP Server Lifecycle Management

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP client for spawning and managing MCP servers | The official TypeScript SDK provides `Client` + `StdioClientTransport` for connecting to MCP servers via stdio. Use this in the Bun sidecar to spawn MCP servers, handle lifecycle (initialize/operate/shutdown), and pass tool definitions to agent sessions. V2 of the SDK is expected Q1 2026 but v1.x is recommended for production. |

**Confidence:** MEDIUM -- The SDK is mature (97M monthly downloads), but integrating MCP client logic into the existing Bun sidecar adds complexity. The sidecar would need to manage MCP server processes alongside Agent SDK queries. Alternative: manage MCP servers from Rust side using Tokio.

**Architecture decision:** Manage MCP servers from the **Rust side** using `tokio::process::Command`, not from the Bun sidecar. Rationale:
1. MCP servers are long-lived processes with independent lifecycles (not tied to individual agent queries)
2. Rust already has the process management infrastructure (CodexService pattern)
3. Workspace-scoped MCP servers need to outlive individual threads
4. The MCP stdio protocol is simple JSONRPC -- Rust can handle it without the TypeScript SDK
5. Avoids bloating the sidecar with process management responsibilities

**MCP inheritance model (workspace defaults + thread overrides):** Store MCP configurations in SQLite:
- `mcp_servers` table: server name, command, args, env, workspace_id (nullable for global)
- `thread_mcp_overrides` table: thread_id, server_name, enabled/disabled, config overrides
- Resolution: thread overrides > workspace defaults > global defaults

### Dashboard & Layout UI

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `react-resizable-panels` | ^4.7.0 | Resizable split-pane layouts for dashboard | De facto standard for React resizable panels (1600+ dependents on npm). shadcn/ui's `Resizable` component wraps this library, so it integrates seamlessly with the existing component system. Use for: dashboard overview / thread detail split, multi-pane agent monitoring views. |

**Confidence:** HIGH -- Already the library that shadcn/ui Resizable wraps. Well-maintained (bvaughn is a React core contributor).

**What NOT to use:**
- `react-grid-layout`: Overkill for this use case. Grid layouts are for user-configurable widget dashboards. Pluribus needs structured split-pane layouts, not drag-and-drop widget grids.
- Custom CSS Grid: Tempting but lacks the resize handle UX that `react-resizable-panels` provides out of the box.

### State Management Additions

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Zustand (already installed) | ^5.0.11 | Expand existing stores for multi-agent state | No new library needed. Add new Zustand stores for: workspace state, agent process registry, dashboard view state. Zustand v5's selective subscriptions prevent re-renders when updating one agent's status from triggering re-renders in unrelated agent panels. |

**Confidence:** HIGH -- Already in the stack, well-suited for entity maps like `Record<ThreadId, AgentStatus>`.

**Store architecture for multi-agent:**
```
workspace-store.ts     - Active workspace, workspace list, workspace CRUD
agent-registry-store.ts - Map<ThreadId, AgentState> tracking all running/idle/error agents
dashboard-store.ts     - Active view, selected agents, filter state
thread-status-store.ts - (existing) Expand with richer status types
```

**What NOT to use:**
- Redux / Redux Toolkit: Unnecessary complexity for a single-user desktop app. Zustand provides the same selective subscription benefits with 90% less boilerplate.
- Jotai: Atom-based model doesn't suit the entity-map pattern needed for tracking N agents. Zustand's store-based model maps more naturally to `Record<ThreadId, State>`.
- XState: State machines are appropriate for individual agent lifecycle (and could be used internally within a Zustand store), but XState as the primary state layer adds learning curve without proportional benefit.

### Terminal/Output Display (Optional, Evaluate Later)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@xterm/xterm` | ^6.0.0 | Rich terminal rendering for agent CLI output | Consider for rendering raw CLI output streams with ANSI color support. The existing markdown-based rendering in assistant-ui handles structured output well, but fire-and-forget agents produce raw terminal output that markdown can't faithfully reproduce. Evaluate during implementation -- may not be needed if structured SDKMessage rendering is sufficient. |

**Confidence:** LOW -- May not be needed. Only add if structured rendering proves insufficient for raw CLI output streams.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Process management | Custom Rust (Tokio) | `tauri-sidecar-manager` | 1 commit, no releases, not production-ready |
| Process management | Custom Rust (Tokio) | Node.js child_process from sidecar | Rust already has the pattern (CodexService); duplicating in JS adds complexity |
| MCP management | Rust-side stdio | `@modelcontextprotocol/sdk` in Bun sidecar | MCP servers are workspace-scoped long-lived processes; mixing with query-scoped sidecar logic is messy |
| Layout | `react-resizable-panels` | `react-grid-layout` | Drag-and-drop widget grid is overkill; structured split-panes fit the mission control UX |
| State | Zustand v5 | Redux Toolkit | Already using Zustand; RTK adds boilerplate without benefit for single-user desktop app |
| State | Zustand v5 | Jotai | Atom model doesn't suit entity-map patterns for tracking N agents |
| Agent SDK | V1 `query()` API | V2 `createSession()` API | V2 is still unstable preview; session forking not yet available |
| Terminal | Evaluate later | Ship immediately | Structured SDKMessage rendering may be sufficient; avoid premature complexity |

## Dependencies NOT Needed

These might seem relevant but should be explicitly avoided:

| Library | Why Not |
|---------|---------|
| LangChain / LangGraph | Pluribus orchestrates CLI-based agents, not API-based LLM chains. The adapter pattern handles provider abstraction without a framework. |
| Electron | Already on Tauri 2; no reason to switch. |
| Socket.IO / WebSocket libs | All communication is local IPC (Tauri invoke, stdin/stdout, Tauri events). No network transport needed. |
| Docker / container libs | Agents run as native CLI processes; containerization adds latency and complexity for a desktop app. |
| Database ORMs (Prisma, Drizzle) | SQLite access is through `tauri-plugin-sql` with raw SQL. The schema is simple enough that an ORM adds overhead without benefit. |
| React Query / TanStack Query | No server state to cache. All data is local SQLite reads, which are synchronous-ish through Tauri IPC. |

## Installation

```bash
# New frontend dependency (if not already via shadcn Resizable)
bun add react-resizable-panels

# No other new frontend dependencies needed.
# Zustand, assistant-ui, Tauri plugins are already installed.

# Rust-side: no new crates needed beyond what's already in Cargo.toml.
# tokio (full), serde, serde_json, tauri-plugin-shell are already dependencies.

# Sidecar: consider adding MCP SDK only if Rust-side MCP management proves insufficient
# bun add @modelcontextprotocol/sdk  # (in sidecar directory, if needed)
```

## Sources

- [Claude Agent SDK TypeScript V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) -- V2 API reference, session management patterns
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- V1 API, current stable
- [Claude Agent SDK npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) -- v0.2.63, published March 2026
- [MCP Lifecycle Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle) -- Initialize/operate/shutdown protocol
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) -- v1.27.1, Client + StdioClientTransport
- [MCP One Year Anniversary Blog](https://blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/) -- SDK maturity, 97M monthly downloads
- [Tauri Shell Plugin](https://v2.tauri.app/plugin/shell/) -- Child process spawning from webview
- [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) -- v4.7.0, resizable split-pane layouts
- [shadcn/ui Resizable](https://ui.shadcn.com/docs/components/radix/resizable) -- Wraps react-resizable-panels
- [assistant-ui ThreadListRuntime](https://www.assistant-ui.com/docs/api-reference/runtimes/ThreadListRuntime) -- Thread list management API
- [assistant-ui Custom Thread List](https://www.assistant-ui.com/docs/runtimes/custom/custom-thread-list) -- RemoteThreadListAdapter patterns
- [Claude Agent SDK 12s overhead issue](https://github.com/anthropics/claude-agent-sdk-typescript/issues/34) -- Cold-start performance concern
- [tauri-sidecar-manager](https://github.com/radical-data/tauri-sidecar-manager) -- Evaluated and rejected (1 commit, no releases)
- [Zustand GitHub](https://github.com/pmndrs/zustand) -- v5, selective subscriptions for entity maps

---

*Stack research: 2026-03-05*

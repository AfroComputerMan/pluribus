# Pitfalls Research

**Domain:** Multi-agent AI orchestration desktop app (Tauri 2 + Claude CLI/SDK/Codex)
**Researched:** 2026-03-05
**Confidence:** HIGH (grounded in documented Claude CLI bugs, Tauri issues, and existing codebase analysis)

## Critical Pitfalls

### Pitfall 1: Claude CLI Concurrent Session Corruption

**What goes wrong:**
Running multiple Claude CLI processes simultaneously on the same machine causes `.claude.json` corruption via non-atomic read-modify-write cycles. The `cachedGrowthBookFeatures` object and `toolUsage` fields get truncated mid-write. This was reported as a critical regression (GitHub issue #28829) and happens ~16 times per hour with just two concurrent instances on Windows. Additionally, concurrent CLI processes race on OAuth token refresh (`~/.claude/.credentials.json`), where the loser gets a 404 and silently loses authentication with no recovery path (issue #27933). Context bleeding between sessions has also been documented (issue #2272).

**Why it happens:**
Claude CLI was designed as a single-user, single-instance tool. All sessions share a single global config file that gets written on every tool call. There is no file locking. Pluribus's core value proposition -- running multiple agents simultaneously -- directly conflicts with this design assumption.

**How to avoid:**
- Serialize writes to shared Claude CLI config files using a mutex or file lock managed by Pluribus before spawning CLI processes.
- Use `--no-stats` or equivalent flags (if available) to reduce write frequency to shared config.
- For the Agent SDK adapter path, bypass the CLI entirely -- the SDK does not share a global config file and is inherently safe for concurrent use.
- Isolate Claude CLI instances using separate `CLAUDE_CONFIG_DIR` environment variables per agent, if the CLI supports it.
- Implement an OAuth token management layer that handles refresh centrally rather than letting each CLI process race.

**Warning signs:**
- Agents randomly failing authentication mid-session
- Corrupted JSON parse errors in stderr from Claude CLI
- Agents seeing context or config from other sessions
- Sporadic 404 errors during otherwise normal operation

**Phase to address:**
Phase 1 (Provider Abstraction). When building the unified provider interface, the Claude CLI provider must include a concurrency guard. Prefer Agent SDK adapter for multi-agent use cases. The CLI path should enforce a configurable max-concurrent limit.

---

### Pitfall 2: Orphaned Child Processes on App Exit or Crash

**What goes wrong:**
When Pluribus exits (normally or via crash), spawned Claude CLI processes, Codex processes, and the agent-sdk-bridge sidecar continue running. Each Claude CLI process consumes 270-370MB RAM and 1.7-2.2% CPU. With 5-10 agents running, orphaned processes consume 1.5-3.5GB RAM and significant CPU indefinitely. On Windows, `child.kill()` in Tauri's shell plugin does not reliably terminate processes (tauri issue #4949). The `sh -c` wrapper currently used adds another layer: killing `sh` may not kill the `claude` child (though the current `exec` usage mitigates this for normal cases).

**Why it happens:**
Tauri kills sidecar processes on `App::drop`, but this only works for sidecars registered via `Command::new_sidecar`. Processes spawned via `Command.create("claude-stream-sh", ...)` from JavaScript are tracked but cleanup is best-effort. Crash exits skip cleanup entirely. Process trees (parent spawning children) are not tracked as groups.

**How to avoid:**
- Use process groups (`command_group` crate on Rust side) so killing the group kills all descendants.
- Implement a process registry in Rust (Tauri state) that tracks every spawned PID. On `ExitRequested` and `RunEvent::Exit`, iterate and kill all registered PIDs.
- Add a startup sweep: on app launch, check for and kill any orphaned processes from a previous session (store PIDs in SQLite, check if still running).
- For the `sh -c` wrapper, the `exec` replacement already helps, but switching to direct `Command.create("claude", [...args])` eliminates the shell layer entirely.
- Set process-level resource limits (e.g., `ulimit` on Linux/macOS) as a safety net.

**Warning signs:**
- Users reporting high CPU/memory usage after closing Pluribus
- `ps aux | grep claude` showing zombie processes
- System slowdown after repeated app crashes during agent runs

**Phase to address:**
Phase 1 (Provider Abstraction) -- process lifecycle management must be a core provider responsibility, not an afterthought. The provider interface should require `cleanup()` and `killAll()` methods.

---

### Pitfall 3: Unbounded Agent Spawning Exhausts System Resources

**What goes wrong:**
Users spin up 10+ concurrent agents across workspaces. Each agent consumes: one Claude CLI process (270-370MB), context window tokens (billed per session), and stdout streaming bandwidth through the Tauri IPC bridge. The system grinds to a halt as RAM fills, CPU saturates, and the Tauri webview becomes unresponsive because all IPC channels are flooded with streaming events from multiple agents simultaneously.

**Why it happens:**
There is no governor limiting concurrent agents. The UI makes it easy to "spin up another agent" without surfacing resource cost. The underlying APIs (Claude, Codex) have their own rate limits that are opaque to the user -- hitting them causes cryptic failures rather than graceful degradation.

**How to avoid:**
- Implement a hard cap on concurrent running agents (default: 5, configurable). Queue additional requests.
- Show real-time resource usage per agent in the dashboard (CPU, memory, tokens consumed).
- Implement backpressure: when the Tauri IPC bridge falls behind, batch or throttle streaming events rather than letting them queue unboundedly.
- Surface API rate limit errors with clear messaging: "You've hit the Claude API rate limit. Agent paused -- will auto-retry in X seconds."
- Add a "system health" indicator to the dashboard that warns when resource usage is high.

**Warning signs:**
- Increasing IPC message latency (events arriving seconds after generation)
- Webview frame drops or UI freezes when many agents are streaming
- OS-level memory pressure notifications
- Agents silently failing with rate limit errors that never surface to the user

**Phase to address:**
Phase 2 (Multi-Agent Orchestration). The concurrency governor and resource monitoring must ship with the multi-agent feature, not after it.

---

### Pitfall 4: MCP Server Lifecycle Mismanagement

**What goes wrong:**
MCP servers are spawned per-workspace or per-agent but never properly cleaned up. Duplicate MCP server instances accumulate (e.g., three filesystem MCP servers for the same workspace). MCP servers that crash are not restarted, leaving agents without tools mid-execution. The inheritance model (workspace defaults + per-thread overrides) creates confusion about which MCP servers are actually running for a given agent.

**Why it happens:**
MCP servers are long-lived processes with their own lifecycles that do not align with agent lifecycles. An agent may complete but its MCP servers keep running. A workspace MCP server may be shared by 5 agents, but who "owns" it for cleanup? The inheritance model adds complexity: if a thread overrides one MCP server, does it still share the workspace's other servers or get its own instances?

**How to avoid:**
- Implement reference counting for shared MCP servers: track which agents are using each server, shut down when refcount hits zero.
- MCP servers should be workspace-scoped singletons by default. Per-thread overrides spawn a thread-scoped instance of only the overridden server; other servers are still shared from workspace.
- Add health checks (periodic ping) for MCP servers. Auto-restart crashed servers and re-register tools with affected agents.
- Display MCP server status in the dashboard: running, crashed, idle, connections count.
- Set an idle timeout: if no agent has used an MCP server in N minutes, shut it down.

**Warning signs:**
- `ps aux` showing many MCP server processes that should not exist
- Agents reporting "tool not found" errors mid-conversation
- Increasing memory usage over time even with few active agents
- Conflicting tool definitions when multiple servers expose the same tool name

**Phase to address:**
Phase 3 (MCP Configuration). This must be solved as part of workspace-level MCP management, not bolted on later.

---

### Pitfall 5: State Synchronization Between Dashboard and Agent Threads

**What goes wrong:**
The dashboard shows an agent as "running" but the CLI process crashed 30 seconds ago. Or the dashboard shows "idle" but the agent is actively writing files. Users make decisions (approve tool calls, kill agents) based on stale state, causing data loss or confusion. When an agent completes in fire-and-forget mode, the notification fires but the thread view still shows "running" until the user navigates to it.

**Why it happens:**
State lives in multiple places: the CLI process (actual), the Rust Tauri backend (observed via stdout parsing), the React frontend (rendered). Each layer can lag. The existing codebase already has this problem in miniature -- session state is cached in-memory Maps that can diverge from SQLite. At multi-agent scale, the divergence windows multiply.

**How to avoid:**
- Single source of truth: agent state lives in SQLite, updated synchronously on every state transition. The dashboard queries SQLite, not in-memory caches.
- Use Tauri events for state change notifications (not polling). When the Rust side detects a process exit, emit a `agent-state-changed` event immediately.
- Implement heartbeat monitoring: if no stdout from an agent for N seconds, probe the process. Mark as "unresponsive" before "crashed."
- For fire-and-forget, persist the completion event to SQLite first, then emit the notification. The dashboard polls SQLite on focus, catching any missed events.
- Add a "last updated" timestamp to each agent's status display so users can see staleness.

**Warning signs:**
- Users reporting "ghost" agents that appear active but are not
- Tool call approvals sent to dead agents
- Notifications arriving for agents the user thought were idle
- State flickering in the dashboard (running -> idle -> running)

**Phase to address:**
Phase 2 (Multi-Agent Orchestration). State management is the foundation of the orchestration layer.

---

### Pitfall 6: assistant-ui Runtime Assumes Single Active Thread

**What goes wrong:**
assistant-ui's `useLocalRuntime` and its thread management primitives are designed around a single active thread with others backgrounded. Pluribus's pivot requires multiple threads to be simultaneously active (visible, streaming, accepting input). Forcing assistant-ui to render multiple concurrent active threads leads to: runtime state conflicts, thread switching that interrupts streams, and hooks (`useThread`, `useMessage`) returning data from the wrong thread context.

**Why it happens:**
assistant-ui is a chat UI framework, not an agent orchestration framework. Its mental model is "one conversation at a time." The existing Pluribus codebase already uses `unstable_` APIs to work around limitations. Multi-agent requires either multiple runtime instances or a complete rethinking of how assistant-ui is used.

**How to avoid:**
- Do NOT try to make one `AssistantRuntime` manage multiple simultaneously visible threads. Instead, instantiate one runtime per visible agent pane/tab.
- Use assistant-ui for the individual thread view (drill-down), but build the dashboard and multi-agent overview with custom components that read directly from SQLite/state.
- Isolate each agent's React component tree so assistant-ui hooks resolve to the correct thread context. React context boundaries are the key mechanism.
- Accept that fire-and-forget agents do not need assistant-ui at all -- they only need a status indicator and a log viewer. assistant-ui is for interactive sessions.

**Warning signs:**
- Hooks returning undefined or wrong-thread data
- Switching between agent views causes stream interruption
- Memory leaks from runtime instances not being cleaned up
- assistant-ui `unstable_` API breakage on minor version bumps

**Phase to address:**
Phase 1 (Provider Abstraction and Architecture). The decision about how assistant-ui fits the multi-pane architecture must be made before building the dashboard.

---

### Pitfall 7: Shell Security Escalation with Multiple Agents

**What goes wrong:**
The current `sh -c` wrapper with `"args": true` in Tauri capabilities allows arbitrary shell command execution from the webview. With a single chat thread, the attack surface is limited. With multiple concurrent agents that can each execute shell commands, tool calls, and file operations across different workspaces, a single XSS vulnerability in any rendered agent output gives an attacker simultaneous access to all workspaces and all agent permissions. An agent working on workspace A could be tricked into affecting workspace B's files.

**Why it happens:**
The current security model was designed for a single-chat prototype. `"args": true` is the broadest possible permission. The `sh` command entry in `default.json` effectively grants unrestricted shell access. As agent count grows, the blast radius of any security issue grows proportionally.

**How to avoid:**
- Replace `sh -c` wrapper with direct `Command.create("claude", [...args])` invocation (already noted as a known issue in CLAUDE.md).
- Remove the `claude-stream-sh` / `sh` entry from capabilities entirely once direct invocation works.
- Restrict `git` args to a whitelist of safe subcommands.
- Implement per-workspace file system boundaries: agents should not be able to access files outside their workspace CWD.
- Use Claude CLI's `--permission-mode` flag to enforce approval workflows consistently across all engines.
- Sanitize all rendered agent output (tool results, file contents) before inserting into the DOM.

**Warning signs:**
- Any agent output containing `<script>` tags or event handlers
- Agents executing commands outside their workspace directory
- The `sh` entry still existing in `default.json` after the multi-agent pivot

**Phase to address:**
Phase 1 (Provider Abstraction). Security hardening must happen before agents can operate across multiple workspaces. This is a prerequisite, not a follow-up.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Fire-and-forget DB writes (`void` prefix) | Non-blocking hot path | Silent data loss, inconsistent state across agents | Never in multi-agent -- agent state transitions must be reliable |
| In-memory session caches without eviction | Fast lookups | Memory grows linearly with thread count; with 10 workspaces x 10 agents, hundreds of entries accumulate | Only if bounded with LRU; otherwise never |
| Parsing stderr strings for error detection | Quick implementation | Breaks silently when Claude CLI updates error messages | Only for prototype; replace with structured error codes before v1 |
| Spawning separate process for title generation | Responsive UX | With 10 concurrent agents, that is 20 CLI processes at startup | Never at multi-agent scale; extract title from first response |
| One monolithic adapter file per engine | All logic co-located | Bug fixes must be applied 3x; divergence between engines | Only during initial pivot; extract BaseAdapter in Phase 1 |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude CLI `--resume` | Assuming resume always works; not handling "session in use" or "no conversation found" | Implement the full retry strategy (resume -> session-id -> fresh) with exponential backoff. The existing 3-retry loop is correct but needs per-agent isolation |
| Claude CLI OAuth | Letting multiple CLI processes refresh tokens concurrently | Centralize token refresh or use API keys. With Agent SDK, this is not an issue |
| Codex CLI JSON-RPC | Assuming thread ID is always in the same JSON path | The existing multi-path extraction (`threadId`, `thread_id`, `thread.id`, `turn.threadId`) is correct but fragile. Add fallback logging for unrecognized paths |
| Agent SDK Bun sidecar | Running one sidecar per agent | Run one sidecar with multiplexed NDJSON messages tagged by agent/thread ID. Multiple sidecars waste memory |
| MCP servers via stdio | Assuming MCP servers are stateless | MCP servers maintain session state. Restarting one mid-conversation loses tool context. Implement reconnection with session resumption |
| Tauri IPC for streaming | Sending every token delta as a separate IPC event | Batch deltas into chunks (e.g., every 50ms or 10 deltas). Unbatched streaming from 5+ agents saturates the IPC channel |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbatched IPC streaming from multiple agents | UI freezes, dropped frames, event queue grows | Batch streaming events per agent (50ms window or N-delta threshold) | 3+ agents streaming simultaneously |
| SQLite write contention from concurrent agents | "database is locked" errors, delayed state updates | Use WAL mode, serialize writes through a single writer, batch frequent updates | 5+ agents writing state concurrently |
| React re-renders from global state updates | Dashboard stutters when any agent emits events | Isolate agent state into per-agent stores (Zustand slices or separate atoms). Dashboard subscribes to summary state only | 5+ visible agent panels |
| Double JSON serialization in sidecar IPC | High CPU on serialization, visible latency | Switch to WebSocket or Tauri IPC channel for sidecar communication | High-throughput agents with large tool outputs |
| Dev event circular buffer per agent | 500 events x N agents = unbounded memory | Share one buffer with agent tagging, or disable dev events per-agent by default | 10+ agents over a long session |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `sh` with `"args": true` in Tauri capabilities | XSS in any agent output escalates to full system shell access | Remove `sh` entry; use direct CLI invocation |
| No workspace sandboxing for agents | Agent in workspace A can read/write files in workspace B | Enforce CWD boundaries; validate all file paths against workspace root |
| Rendering unsanitized tool output as HTML | Script injection via crafted file contents or command output | Sanitize all tool output; render as text/code, never raw HTML |
| Storing API keys in SQLite without encryption | Local DB theft exposes all API credentials | Use OS keychain (keytar/secret-service) for sensitive credentials |
| Broad `git` permissions with `"args": true` | `git push --force` or `git checkout -- .` from compromised agent | Whitelist safe git subcommands; require approval for destructive operations |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Dashboard showing raw stream events from all agents | Information overload; users cannot find what matters | Show summary status per agent (idle/running/error/done). Stream events only in drill-down view |
| No distinction between interactive and fire-and-forget agents | Users watch idle fire-and-forget agents expecting output | Visual differentiation: interactive agents show live stream, fire-and-forget show progress bar + notification on completion |
| Notification spam from concurrent completions | Multiple agents completing simultaneously floods notifications | Batch notifications: "3 agents completed in workspace X" instead of 3 separate notifications |
| Forcing users to configure MCP servers per-agent | Repetitive setup; users give up on MCP | Workspace-level defaults with one-click inheritance. Per-agent overrides should be the exception, not the default |
| No clear indication of agent resource consumption | Users unaware why system is slow; keep spawning agents | Show per-agent CPU/memory/token usage in dashboard; warn when approaching limits |
| Losing agent context when navigating between views | Switching from agent A to agent B clears A's scroll position and state | Preserve scroll position and UI state per agent; use virtualized tabs, not unmount/remount |

## "Looks Done But Isn't" Checklist

- [ ] **Process cleanup:** Often missing crash-exit cleanup -- verify that force-quitting the app leaves zero orphaned CLI processes
- [ ] **Agent status:** Often missing the "unresponsive" state -- verify that a hung CLI process (no stdout for 60s) is detected and surfaced, not shown as "running" forever
- [ ] **MCP server sharing:** Often missing reference counting -- verify that closing one agent does not kill MCP servers still used by other agents in the same workspace
- [ ] **Fire-and-forget completion:** Often missing persistent notification -- verify that completing while the app is minimized still notifies the user on next focus
- [ ] **Workspace isolation:** Often missing CWD enforcement -- verify that an agent cannot `cat /etc/passwd` or access files outside its workspace
- [ ] **Concurrent session limits:** Often missing the governor -- verify that spawning agent #6 when limit is 5 queues rather than crashes
- [ ] **Error recovery:** Often missing retry UI -- verify that a crashed agent shows a "Restart" button, not a permanent error state
- [ ] **Database migrations:** Often missing multi-agent schema changes -- verify that the sessions table supports multiple concurrent sessions per workspace, not just per thread

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Orphaned processes after crash | LOW | Startup sweep: query SQLite for last-known PIDs, check if alive, kill orphans, update status to "crashed" |
| Claude config corruption | MEDIUM | Detect corrupted `.claude.json` on CLI spawn failure, back up and reset, retry. Warn user about potential config loss |
| MCP server crash mid-agent | MEDIUM | Detect via health check failure, restart MCP server, re-register tools, resume agent if possible or surface error |
| State desync (dashboard vs reality) | LOW | Periodic reconciliation: every 30s, check all "running" agents against actual process status, fix discrepancies |
| SQLite "database locked" under contention | LOW | Switch to WAL mode (one-line config). If already WAL, increase busy_timeout. Serialize writes through a queue |
| Rate limit exhaustion | LOW | Pause affected agent, show countdown timer, auto-retry. Do not kill the session -- just wait |
| assistant-ui runtime conflict | HIGH | Requires architecture change. If hooks return wrong-thread data, the fix is isolating runtime instances per pane, which may require significant refactoring |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Claude CLI concurrent corruption | Phase 1 (Provider Abstraction) | Run 5 agents simultaneously for 1 hour; verify zero `.claude.json` corruption events |
| Orphaned processes | Phase 1 (Provider Abstraction) | Force-kill app during multi-agent run; verify zero orphan processes after restart |
| Resource exhaustion | Phase 2 (Multi-Agent Orchestration) | Attempt to spawn agents past the limit; verify queuing behavior and user-facing message |
| MCP server lifecycle | Phase 3 (MCP Configuration) | Start workspace with 3 MCP servers, run 3 agents, close 2 agents; verify shared servers survive, per-thread overrides are cleaned up |
| State synchronization | Phase 2 (Multi-Agent Orchestration) | Kill a Claude CLI process externally (`kill -9`); verify dashboard updates within 5 seconds |
| assistant-ui multi-pane | Phase 1 (Architecture) | Open 3 agent views simultaneously; verify each streams independently without cross-contamination |
| Shell security | Phase 1 (Provider Abstraction) | Audit capabilities file; verify `sh` entry is removed and all CLI invocations use direct `Command.create` |

## Sources

- [Claude CLI concurrent session corruption - GitHub #28829](https://github.com/anthropics/claude-code/issues/28829)
- [Claude CLI .claude.json corruption from concurrent instances - GitHub #29003](https://github.com/anthropics/claude-code/issues/29003)
- [OAuth token refresh race condition - GitHub #27933](https://github.com/anthropics/claude-code/issues/27933)
- [Multiple CLI processes accumulate causing high CPU - GitHub #11122](https://github.com/anthropics/claude-code/issues/11122)
- [Context bleeding between concurrent sessions - GitHub #2272](https://github.com/anthropics/claude-code/issues/2272)
- [Concurrent sessions block each other - GitHub #13352](https://github.com/anthropics/claude-code/issues/13352)
- [Tauri: spawned children cannot be killed on Windows - GitHub #4949](https://github.com/tauri-apps/tauri/issues/4949)
- [Tauri: kill sidecar child processes on App drop - GitHub commit 4bdc406](https://github.com/tauri-apps/tauri/commit/4bdc406679363f460e39079cb26319c39ab8cac8)
- [Tauri: shell plugin cannot fully terminate multi-process executables - GitHub #11686](https://github.com/tauri-apps/tauri/issues/11686)
- [Tauri: Sidecar Lifecycle Management Plugin request - GitHub #3062](https://github.com/tauri-apps/plugins-workspace/issues/3062)
- [Multi-agent workflows often fail - GitHub Blog](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/)
- [Designing Effective Multi-Agent Architectures - O'Reilly](https://www.oreilly.com/radar/designing-effective-multi-agent-architectures/)
- [Existing codebase CONCERNS.md analysis](../.planning/codebase/CONCERNS.md)

---
*Pitfalls research for: Multi-agent AI orchestration desktop app*
*Researched: 2026-03-05*

# Research Report: Building a Frontend UI on Claude Code CLI Output

**Date**: 2026-02-17
**Project**: Pluribus (Tauri 2 + React 19 desktop app wrapping Claude Code CLI)
**Confidence Level**: High (multiple independent sources corroborated)

---

## Executive Summary

There is a **thriving ecosystem** of 15+ projects building GUI frontends around Claude Code CLI. The most relevant to Pluribus is **opcode** (formerly Claudia) — a Tauri 2 + React + shadcn project with ~15K+ GitHub stars using the exact same tech stack. The **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) provides comprehensive TypeScript types and a programmatic API, but has a **critical Tauri blocker** — it requires Node.js `child_process` internally. The recommended path for Pluribus is to **continue using Tauri's shell plugin for subprocess management** but **import the Agent SDK's types** for type-safe event parsing.

---

## Table of Contents

1. [Claude Code CLI Output Format (stream-json)](#1-claude-code-cli-output-format)
2. [Claude Agent SDK Analysis](#2-claude-agent-sdk-analysis)
3. [Existing Projects Building UIs on Claude Code CLI](#3-existing-projects)
4. [Sub-Agent and Tool Event Structure](#4-sub-agent-and-tool-event-structure)
5. [Common Pitfalls and Tips](#5-common-pitfalls-and-tips)
6. [Recommendations for Pluribus](#6-recommendations-for-pluribus)
7. [Sources](#7-sources)

---

## 1. Claude Code CLI Output Format

### The Three Output Modes

| Mode | Flag | Description |
|------|------|-------------|
| `text` | `--output-format text` (default) | Plain text output |
| `json` | `--output-format json` | Full JSON blob at end with `result`, `session_id`, metadata |
| `stream-json` | `--output-format stream-json` | **NDJSON** — one JSON object per line, streamed in real-time |

For real-time UI rendering, `stream-json` is the only viable option. Pluribus already uses this correctly.

### The Five Top-Level Event Types

Every line in `stream-json` output has a `type` field from this union:

```typescript
type MessageType = "system" | "assistant" | "user" | "result" | "stream_event";
```

#### 1. `system` (subtype: `"init"`)
Emitted once at session start. Contains session metadata:
```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "abc123",
  "uuid": "...",
  "cwd": "/path/to/project",
  "model": "claude-opus-4-6",
  "tools": ["Read", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Task", ...],
  "mcp_servers": [{"name": "server1", "status": "connected"}],
  "permissionMode": "default",
  "apiKeySource": "user",
  "slash_commands": ["/commit", "/review-pr", ...],
  "agents": [...],
  "claude_code_version": "2.1.44"
}
```

#### 2. `assistant`
Complete assistant response with full `message.content` array:
```json
{
  "type": "assistant",
  "uuid": "...",
  "session_id": "abc123",
  "parent_tool_use_id": null,
  "message": {
    "content": [
      {"type": "text", "text": "Here's what I found..."},
      {"type": "tool_use", "id": "toolu_xxx", "name": "Read", "input": {"file_path": "/foo.ts"}},
      {"type": "thinking", "thinking": "Let me analyze..."}
    ]
  }
}
```

#### 3. `user`
Contains `tool_result` responses (what Claude sees after a tool runs):
```json
{
  "type": "user",
  "message": {
    "content": [
      {"type": "tool_result", "tool_use_id": "toolu_xxx", "content": "file contents here..."}
    ]
  }
}
```

#### 4. `result`
Final event, emitted once when the conversation turn ends:
```json
{
  "type": "result",
  "subtype": "success",
  "session_id": "abc123",
  "is_error": false,
  "duration_ms": 15000,
  "duration_api_ms": 12000,
  "num_turns": 3,
  "result": "I've updated the file...",
  "total_cost_usd": 0.045,
  "usage": {
    "input_tokens": 5000,
    "output_tokens": 2000,
    "cache_creation_input_tokens": 1000,
    "cache_read_input_tokens": 3000
  },
  "modelUsage": {
    "claude-opus-4-6": {
      "inputTokens": 5000,
      "outputTokens": 2000,
      "costUSD": 0.045,
      "contextWindow": 200000
    }
  }
}
```

Result subtypes include: `"success"`, `"error_max_turns"`, `"error_during_execution"`, `"error_max_budget_usd"`

#### 5. `stream_event` (requires `--verbose --include-partial-messages`)
Wraps raw Anthropic API streaming events for real-time token-by-token rendering:
```json
{
  "type": "stream_event",
  "uuid": "...",
  "session_id": "abc123",
  "parent_tool_use_id": null,
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {
      "type": "text_delta",
      "text": "Here's"
    }
  }
}
```

Inner event types: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`

### Flags for Full Streaming

```bash
claude -p "your prompt" \
  --output-format stream-json \
  --verbose \
  --include-partial-messages
```

Without `--verbose --include-partial-messages`, you only get `system`, `assistant`, `user`, and `result` events (no incremental streaming).

---

## 2. Claude Agent SDK Analysis

### What It Is

The **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk` on npm, formerly `@anthropic-ai/claude-code`) is Anthropic's first-party package that provides:

- **Complete TypeScript types** for all CLI output events
- **Programmatic `query()` API** — async generator yielding typed `SDKMessage` objects
- **Session management** — resume, continue, multi-turn conversations
- **Sub-agent support** via `parent_tool_use_id` tracking
- **Hook system** — `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, etc.
- **Typed tool inputs/outputs** for every built-in tool (Read, Edit, Bash, Glob, Grep, etc.)

### SDK Message Types

```typescript
type SDKMessage =
  | SDKAssistantMessage         // Complete assistant response
  | SDKUserMessage              // User input / tool results
  | SDKUserMessageReplay        // Replayed user message (on resume)
  | SDKResultMessage            // Final result with cost/usage
  | SDKSystemMessage            // Session init (tools, model, cwd, etc.)
  | SDKPartialAssistantMessage  // Streaming deltas (stream_event wrapper)
  | SDKCompactBoundaryMessage;  // Conversation compaction marker
```

### Key Type: `SDKAssistantMessage`

```typescript
type SDKAssistantMessage = {
  type: "assistant";
  uuid: string;
  session_id: string;
  message: APIAssistantMessage; // From @anthropic-ai/sdk
  parent_tool_use_id: string | null;  // KEY for sub-agent tracking
}
```

### Key Type: `SDKResultMessage`

```typescript
type SDKResultMessage = {
  type: "result";
  subtype: "success" | "error_max_turns" | "error_during_execution" | "error_max_budget_usd";
  session_id: string;
  is_error: boolean;
  duration_ms: number;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  usage: { input_tokens: number; output_tokens: number; ... };
  modelUsage: Record<string, ModelUsage>;
  permission_denials: SDKPermissionDenial[];
  structured_output?: unknown;
  errors?: string[];
}
```

### The Tauri Blocker

**The SDK internally spawns a Node.js subprocess** (bundles `cli.js`, runs via `child_process.spawn`). This is incompatible with Tauri's webview + Rust shell plugin architecture:

1. Tauri's frontend runs in a **webview** — no `child_process` access
2. Subprocess spawning goes through **Tauri's shell plugin** (Rust-side)
3. The SDK has no mechanism to use a custom subprocess spawner in the webview

### Can It Be Used Without API Keys?

**Not straightforwardly.** The SDK docs require `ANTHROPIC_API_KEY`. There is a known documentation inconsistency (GitHub issue #5891) — Claude Code CLI works with subscription auth but the SDK docs only show API key auth. The SDK does accept a `pathToClaudeCodeExecutable` option that could theoretically point to a user's existing Claude Code installation, but this is not officially supported for third-party products.

### Integration Paths for Pluribus

| Path | Description | Effort | Risk |
|------|-------------|--------|------|
| **A. Types-only import** | Import SDK types for type-safe parsing, keep Tauri shell plugin for subprocess | Low | Low |
| **B. Node.js sidecar** | Run SDK in a Node.js sidecar managed by Tauri IPC | High | Medium |
| **C. Continue as-is** | Keep hand-written types, no SDK dependency | None | Low (but no type safety) |
| **D. Wait for SDK improvements** | Python SDK already has `spawnClaudeCodeProcess` callback; TS may follow | N/A | Uncertain timing |

**Recommended: Path A** — Install `@anthropic-ai/claude-agent-sdk` as a dev/type dependency, import `SDKMessage` types, replace hand-written types in `claude-adapter.ts`.

---

## 3. Existing Projects

### Tier 1: Major Projects (1000+ stars)

#### opcode (formerly Claudia) — ~15K+ stars
- **GitHub**: [winfunc/opcode](https://github.com/winfunc/opcode)
- **Stack**: Tauri 2 + React 18 + TypeScript + Rust + SQLite + Tailwind v4 + shadcn/ui + Bun
- **Architecture**: Bridges Claude CLI binary and modern GUI. Manages processes, parses CLI output.
- **Features**: Visual project browser (`~/.claude/projects/`), checkpoint/timeline system, custom agent creation, background agents, usage tracking, session history
- **Relevance**: **Extremely high** — same tech stack as Pluribus

#### CodePilot — ~1,957 stars
- **GitHub**: [op7418/CodePilot](https://github.com/op7418/CodePilot)
- **Stack**: Electron + Next.js App Router + SQLite (WAL mode)
- **Features**: Per-session working directory, file/image attachments, visual project management

#### 1code — Y Combinator backed
- **GitHub**: [21st-dev/1code](https://github.com/21st-dev/1code)
- **Stack**: Electron + Vite + electron-builder
- **Novel approach**: Every agent session runs in its own **git worktree** — no conflicts, no stashing
- **Features**: Visual diff previews, built-in git client, PR management, background agents in isolated cloud sandboxes

### Tier 2: Notable Projects

#### claude-code-webui (by sugyan)
- **GitHub**: [sugyan/claude-code-webui](https://github.com/sugyan/claude-code-webui)
- **Stack**: Web-based (npm package + standalone binary)
- **Architecture**: CLI -> Backend NDJSON parser -> **Server-Sent Events (SSE)** -> React hook -> UI
- **Relevance**: **Cleanest documented example** of stream-json parsing with TypeScript types in `shared/types.ts`

#### claude-code-gui (by 5Gears0Chill)
- **GitHub**: [5Gears0Chill/claude-code-gui](https://github.com/5Gears0Chill/claude-code-gui)
- **Stack**: Tauri 2.0 + React + TypeScript
- **Alternative approach**: Uses **xterm.js + `portable-pty`** (Rust crate) for pseudo-terminal embedding instead of stream-json parsing. Full PTY approach gives raw CLI experience inside a GUI frame.

#### Claude Chic (by Matthew Rocklin)
- **Stack**: Python + Textual (terminal UI framework)
- **Approach**: Wraps Claude Agent SDK **directly** (not CLI subprocess), enabling true programmatic control
- **Features**: n concurrent Claude agents, each in separate git worktree

### Other Notable Projects
- **Claude Code UI (CloudCLI)** — [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) — React 18, desktop + mobile
- **simple-code-gui** — Multi-tool (Claude, Gemini CLI, Codex, OpenCode), tabbed sessions
- **claude-studio** — Electron + React + TypeScript
- **claude-forge** — Desktop GUI for Claude Code CLI
- **agent-monitor** — Pixel art office view GUI monitor (Tauri v2 + React)
- **cc-copilot** — Open-source desktop GUI, switch AI providers
- **Claude Agent Desktop** (Fergana Labs) — Built on Claude Agent SDK directly

### Comparison Table

| Project | Stack | Approach | Session Mgmt | Streaming |
|---------|-------|----------|-------------|-----------|
| **opcode** | Tauri 2+React+TS+Rust | CLI subprocess | SQLite + ~/.claude | Process management |
| **CodePilot** | Electron+Next.js | CLI subprocess | SQLite WAL | Next.js API routes |
| **1code** | Electron+Vite | CLI + worktrees | Git worktrees | Built-in terminal |
| **claude-code-webui** | Web (npm/binary) | CLI stream-json | Backend state | SSE + React hooks |
| **claude-code-gui** | Tauri 2+React+TS | PTY (xterm.js) | Tauri events | portable-pty |
| **Claude Chic** | Python+Textual | Agent SDK | SDK sessions | SDK async gen |
| **Pluribus** | Tauri 2+React+TS | CLI subprocess | localStorage Map | Tauri shell plugin |

---

## 4. Sub-Agent and Tool Event Structure

### How Sub-Agents Appear in stream-json

The critical field for sub-agent tracking is **`parent_tool_use_id`**. Every message includes this field:

- **`null`** — message belongs to the main conversation
- **`"toolu_xxx"`** — message belongs to a sub-agent spawned by that tool call

#### Lifecycle in the stream:

```
1. Assistant message with tool_use {name: "Task", id: "toolu_abc", input: {prompt: "...", subagent_type: "general-purpose"}}
2. [Sub-agent messages with parent_tool_use_id: "toolu_abc"]
   - system init (for sub-agent)
   - assistant messages (sub-agent's work)
   - user messages (tool results within sub-agent)
3. User message with tool_result {tool_use_id: "toolu_abc", content: "sub-agent result"}
4. Main conversation continues
```

### How Tool Calls Appear

#### In `assistant` events:
```json
{
  "type": "assistant",
  "message": {
    "content": [
      {"type": "text", "text": "Let me read that file."},
      {"type": "tool_use", "id": "toolu_123", "name": "Read", "input": {"file_path": "/src/app.ts"}}
    ]
  }
}
```

#### In `user` events (tool results):
```json
{
  "type": "user",
  "message": {
    "content": [
      {"type": "tool_result", "tool_use_id": "toolu_123", "content": "file contents...", "is_error": false}
    ]
  }
}
```

### Hook Events for Sub-Agent Lifecycle (via Agent SDK)

The Agent SDK provides typed hook events:

```typescript
type SubagentStartHookInput = {
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type: string;
  // ... base fields
}

type SubagentStopHookInput = {
  hook_event_name: "SubagentStop";
  stop_hook_active: boolean;
  // ... base fields
}
```

### Complete Tool Input/Output Types

The Agent SDK exports fully typed schemas for every tool. Key types:

```typescript
type ToolInput = AgentInput | BashInput | FileEditInput | FileReadInput | FileWriteInput | GlobInput | GrepInput | WebFetchInput | WebSearchInput | ...

type ToolOutput = TaskOutput | BashOutput | EditOutput | ReadOutput | WriteOutput | GlobOutput | GrepOutput | WebFetchOutput | WebSearchOutput | ...
```

Each has detailed fields. For example:

```typescript
// Task (sub-agent) output
interface TaskOutput {
  result: string;
  usage?: { input_tokens: number; output_tokens: number; ... };
  total_cost_usd?: number;
  duration_ms?: number;
}

// Bash output
interface BashOutput {
  output: string;
  exitCode: number;
  killed?: boolean;
  shellId?: string;  // for background processes
}
```

### Building a Tree View of Agent Activity

To separate main conversation from sub-agent activity, use this pattern:

```typescript
const agentTree = new Map<string | null, SDKMessage[]>();

for (const msg of messages) {
  const parentId = msg.parent_tool_use_id ?? null;
  if (!agentTree.has(parentId)) agentTree.set(parentId, []);
  agentTree.get(parentId)!.push(msg);
}

// agentTree.get(null) = main conversation messages
// agentTree.get("toolu_abc") = sub-agent messages
```

---

## 5. Common Pitfalls and Tips

### Process Management (Critical)

1. **Zombie/orphan processes**: Claude Code has documented bugs where child processes aren't properly terminated. On macOS, a child-process tracking loop can repeatedly spawn `pgrep`, exhausting the per-user process budget. **Must implement robust process cleanup in Tauri's close handler.**
   - Sources: [Issue #19201](https://github.com/anthropics/claude-code/issues/19201), [Process exhaustion blog](https://shivankaul.com/blog/claude-code-process-exhaustion)

2. **Debug messages corrupting JSON stream**: Debug/diagnostic messages can appear on stdout instead of stderr. **Always add `--debug-to-stderr` explicitly.**
   - Source: [Issue #12007](https://github.com/anthropics/claude-code/issues/12007)

3. **Node.js subprocess hanging**: Known issues when spawned from Node.js `child_process.spawn`. Process can stall instead of streaming.
   - Sources: [Issue #771](https://github.com/anthropics/claude-code/issues/771), [Issue #6775](https://github.com/anthropics/claude-code/issues/6775)

4. **stdin/stdout buffering on Windows**: Subprocess stdin/stdout buffering or communication issues when piping between processes.
   - Source: [Issue #3187](https://github.com/anthropics/claude-code/issues/3187)

### Stream Parsing

5. **UTF-8 boundary handling**: Streaming can split multi-byte UTF-8 characters across chunk boundaries. Buffer incomplete bytes between chunks.

6. **Missing final result event**: Some versions have bugs where the `result` event isn't emitted at end of stream-json output.
   - Source: [Issue #1920](https://github.com/anthropics/claude-code/issues/1920)

7. **Partial JSON in `stream_event` deltas**: The `partial_json` field in content_block_delta events contains fragments of tool input JSON. Need incremental JSON assembly.

### Architecture Decisions

8. **Terminal embedding vs stream parsing**: Two approaches exist:
   - **PTY approach** (xterm.js + portable-pty): Simpler, gives raw CLI experience, less UI control
   - **stream-json parsing** (what Pluribus does): Full UI control, requires handling all edge cases
   - **Hybrid**: Some projects (opcode) combine both — parsed events for the main UI + optional terminal view

9. **Session file management**: Claude stores sessions in `~/.claude/`. Projects like simple-code-gui auto-discover sessions. opcode reads `~/.claude/projects/` for project browsing.

10. **Concurrent session locking**: Multiple Claude CLI instances targeting the same session = problems. Pluribus's FIFO waiter queue is correct. opcode uses process isolation per agent.

---

## 6. Recommendations for Pluribus

### Immediate Actions

1. **Import Agent SDK types** — Install `@anthropic-ai/claude-agent-sdk` as a type dependency. Replace the hand-written `ClaudeStreamEventBase` (lines 7-70 of `claude-adapter.ts`) with `SDKMessage` union types. The stream-json output matches SDK types exactly since the SDK wraps the same CLI internally.

2. **Study opcode's architecture** — It's the closest analog to Pluribus with identical tech stack. Key areas to examine:
   - Process management and cleanup
   - Checkpoint/timeline system (save/restore/fork session states)
   - How they handle sub-agent rendering

3. **Add `--debug-to-stderr`** — Prevent debug messages from corrupting the JSON stream.

4. **Implement `parent_tool_use_id` tracking** — This is the key to separating main conversation from sub-agent activity in the UI. Currently not handled in `claude-adapter.ts`.

### Medium-Term Improvements

5. **Add `user` event parsing** — Currently `claude-adapter.ts` doesn't have a type for `user` events. These contain tool results and are important for showing what tools returned.

6. **Render tool calls richly** — Using the SDK's typed `ToolInput`/`ToolOutput` schemas, build specialized renderers for each tool (file diff view for Edit, code block for Read, terminal output for Bash, etc.)

7. **Consider the `CompactBoundaryMessage`** — When context gets large, Claude Code compacts the conversation. The SDK has a type for this event. Consider handling it in the UI.

### Future Architecture

8. **Watch for SDK custom spawner support** — The Python SDK already has `spawnClaudeCodeProcess` callback. If the TypeScript SDK adds this, Pluribus could use the full SDK with Tauri's shell plugin as the spawner.

9. **Consider Node.js sidecar** — If deeper SDK integration is needed, a Tauri sidecar running Node.js with the Agent SDK could communicate via IPC. This unlocks features like programmatic sub-agent definitions, hook callbacks, and tool approval callbacks.

---

## 7. Sources

### Official Documentation
- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK Streaming Output](https://platform.claude.com/docs/en/agent-sdk/streaming-output)
- [Agent SDK V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)
- [Agent SDK Migration Guide](https://platform.claude.com/docs/en/agent-sdk/migration-guide)
- [Run Claude Code Programmatically](https://code.claude.com/docs/en/headless)
- [CLI Reference](https://code.claude.com/docs/en/cli-reference)

### npm Packages
- [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) (new)
- [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code) (deprecated)

### GitHub Projects
- [winfunc/opcode](https://github.com/winfunc/opcode) — Tauri 2 + React, ~15K stars
- [op7418/CodePilot](https://github.com/op7418/CodePilot) — Electron + Next.js, ~2K stars
- [21st-dev/1code](https://github.com/21st-dev/1code) — YC-backed, git worktree isolation
- [sugyan/claude-code-webui](https://github.com/sugyan/claude-code-webui) — Cleanest stream-json parsing
- [5Gears0Chill/claude-code-gui](https://github.com/5Gears0Chill/claude-code-gui) — Tauri 2 + PTY approach
- [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) — React 18, desktop + mobile
- [Fergana-Labs/claude_agent_desktop](https://github.com/Fergana-Labs/claude_agent_desktop) — Agent SDK based

### GitHub Issues (Pitfalls)
- [#733 — stream-json feature request](https://github.com/anthropics/claude-code/issues/733)
- [#1920 — Missing final result event](https://github.com/anthropics/claude-code/issues/1920)
- [#3187 — stdin/stdout hang](https://github.com/anthropics/claude-code/issues/3187)
- [#5891 — SDK auth inconsistency](https://github.com/anthropics/claude-code/issues/5891)
- [#12007 — Debug messages corrupting JSON](https://github.com/anthropics/claude-code/issues/12007)
- [#19201 — Orphan processes on macOS](https://github.com/anthropics/claude-code/issues/19201)

### Community Resources
- [Claude Chic Architecture](https://matthewrocklin.com/claudechic/architecture/) — Agent SDK alternative approach
- [Inside the Claude Agent SDK Architecture](https://buildwithaws.substack.com/p/inside-the-claude-agent-sdk-from)
- [5 New Claude Code GUI Apps](https://medium.com/@joe.njenga/4-new-claude-code-gui-apps-you-should-try-and-more-to-come-e73971d3a561)
- [Cline CLI Return to the Primitives](https://cline.bot/blog/cline-cli-return-to-the-primitives)

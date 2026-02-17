# Plan: Enhanced Claude CLI Integration + assistant-ui Improvements

**Date**: 2026-02-11
**Status**: Proposed
**Related**: `claudedocs/research_acp_protocol_2026-02-10.md`, `docs/claudecode-cli-docs.md`

---

## Context

Pluribus currently integrates with Claude CLI via `claude -p --output-format stream-json`, parsed by a custom ~1350-line adapter (`claude-adapter.ts`). The [ACP research doc](../claudedocs/research_acp_protocol_2026-02-10.md) identified significant improvements possible in tool call visibility, session management, and security.

### Why Not ACP?

Three approaches were evaluated:

| Approach | Pros | Cons |
|----------|------|------|
| **ACP via `claude-code-acp`** | Standard protocol, multi-agent, rich tool reporting | Requires `ANTHROPIC_API_KEY` (no claude.ai OAuth). Anthropic closed native ACP request as ["NOT PLANNED"](https://github.com/anthropics/claude-code/issues/6686). Community bridge has known bugs. |
| **Agent SDK sidecar** | Official Anthropic SDK, direct programmatic control | Requires Node.js sidecar + API key auth. More moving parts. |
| **Enhanced current approach** | No new deps, keeps existing auth (claude.ai subscription OR API key), incremental improvement | No permission flow, no bidirectional comms, still custom parsing |

**Decision: Enhanced current approach.** The auth constraint is decisive — both ACP (`claude-code-acp`) and the Agent SDK require `ANTHROPIC_API_KEY`. Anthropic [explicitly prohibits](https://platform.claude.com/docs/en/agent-sdk/overview) third-party apps from using claude.ai OAuth with the SDK. By keeping `claude -p`, Pluribus works with whatever auth users have configured.

### Goals

- Replace `sh -c` shell wrapper with direct CLI invocation (security)
- Add structured tool call display with per-tool components (Read, Edit, Bash, etc.)
- Add tool call status progression (streaming → complete → error)
- Simplify session management (align with [CLI docs](https://code.claude.com/docs/en/cli-reference) patterns)
- Build sub-agent (Task tool) display with live streaming
- Lay groundwork for future ACP migration (clean abstractions)

---

## Phase 1: Security — Direct CLI Invocation

Replace the `sh -c` shell wrapper with direct `Command.create("claude", [...args])`.

### Files to modify:
- **`src/lib/claude-adapter.ts`** — Replace `CLAUDE_SHELL_SCRIPT` and `spawnClaudeStreaming()`
- **`src-tauri/capabilities/default.json`** — Update allowed commands

### Changes:

**`claude-adapter.ts` (~lines 996-1021):** Replace the shell script approach:
```typescript
// Before: Command.create("claude-stream-sh", ["-c", CLAUDE_SHELL_SCRIPT], { env })
// After:  Command.create("claude", buildClaudeArgs(config), { cwd })
```

Build args array directly:
```typescript
function buildClaudeArgs(config: StreamSpawnConfig): string[] {
  const args = ["-p", config.prompt, "--output-format", "stream-json",
                "--verbose", "--include-partial-messages"];
  if (config.sessionMode === "resume") {
    args.push("--resume", config.sessionId!);
  } else if (config.sessionMode === "session-id") {
    args.push("--session-id", config.sessionId!);
  }
  return args;
}
```

**Stdin handling:** The current `< /dev/null` trick closes stdin to prevent Claude CLI hanging. With direct spawn, we can write an empty buffer and close stdin via Tauri's `child.write()` API, or use the shell plugin's `encoding: "raw"` option. Need to verify that Tauri's shell plugin supports closing stdin on spawn — if not, keep a minimal shell wrapper (`sh -c "exec claude ... < /dev/null"`).

**`capabilities/default.json`:** Add direct `claude` command:
```json
{ "name": "claude-direct", "cmd": "claude", "args": true }
```
Remove `claude-stream-sh` once direct invocation is confirmed working.

---

## Phase 2: Tool-Specific Display Components

Create dedicated tool display components that parse `argsText` and `result` into rich UIs, reusing the existing `ToolFallback` compound component pattern.

### Files to create:
- **`src/components/assistant-ui/claude-tool-display.tsx`** — Per-tool renderers

### Files to modify:
- **`src/components/assistant-ui/thread.tsx`** — Wire tool components into `MessagePrimitive.Parts`

### Design:

The existing `ToolFallback` exports a compound component (`Root`, `Trigger`, `Content`, `Args`, `Result`, `Error`) at `tool-fallback.tsx:296-312`. New tool-specific components compose these primitives.

**`claude-tool-display.tsx`:**
```typescript
// One component per tool, each parsing args/result for rich display
const ReadTool: ToolCallMessagePartComponent = ({ toolName, argsText, result, status }) => {
  const args = safeParseArgs(argsText); // { file_path, offset?, limit? }
  return (
    <ToolFallback.Root>
      <ToolFallback.Trigger toolName={`Read: ${args?.file_path ?? toolName}`} status={status} />
      <ToolFallback.Content>
        {/* Show file content with syntax highlighting, truncated */}
        <TruncatedResult result={result} maxLines={20} />
      </ToolFallback.Content>
    </ToolFallback.Root>
  );
};
// Similar for: EditTool, WriteTool, BashTool, GrepTool, GlobTool, WebSearchTool, WebFetchTool
```

**Key tool renderers:**
| Tool | Rich display |
|------|-------------|
| `Read` | File path in trigger, syntax-highlighted content, line range |
| `Edit` | File path + old→new strings as inline diff |
| `Write` | File path, content preview |
| `Bash` | Command in trigger, output with exit code |
| `Grep` | Pattern + path in trigger, matched lines |
| `Glob` | Pattern in trigger, file list |
| `WebSearch` | Query in trigger, results summary |
| `WebFetch` | URL in trigger, fetched content preview |

**Shared utilities:**
- `safeParseArgs(argsText)` — Parse JSON args, return null on failure
- `TruncatedResult` — Show first N lines with "Show more" expand button
- `InlineDiff` — Simple old/new diff display for Edit tool

**Wire into thread.tsx (line 250):**
```typescript
tools: {
  by_name: {
    Read: ReadTool,
    Edit: EditTool,
    Write: WriteTool,
    Bash: BashTool,
    Grep: GrepTool,
    Glob: GlobTool,
    WebSearch: WebSearchTool,
    WebFetch: WebFetchTool,
  },
  Fallback: ToolFallback,
},
```

---

## Phase 3: Task Tool (Sub-Agent) Display

Create a dedicated component for the `Task` tool that shows sub-agent execution with live streaming activity.

### Files to create:
- **`src/components/assistant-ui/task-tool.tsx`** — Sub-agent display component

### Files to modify:
- **`src/lib/claude-adapter.ts`** — Export sub-agent state subscription API
- **`src/components/assistant-ui/thread.tsx`** — Add `Task: TaskTool` to `tools.by_name`

### Design:

The adapter already has sub-agent infrastructure (`claude-adapter.ts`):
- `SUB_AGENT_TOOL_NAMES = new Set(["Task"])` (~line 156-157)
- `subAgentStates: Map<toolCallId, SubAgentState>` with per-tool-call accumulators
- Content routing logic that separates main vs sub-agent events

**What's needed:**
1. **Export subscription API** from `claude-adapter.ts`:
   ```typescript
   export function subscribeSubAgentContent(toolCallId: string, listener: () => void): () => void
   export function getSubAgentContent(toolCallId: string): ContentPart[]
   ```

2. **TaskTool component** subscribes via `useSyncExternalStore` to get live sub-agent content:
   ```typescript
   const TaskTool: ToolCallMessagePartComponent = ({ toolCallId, argsText, result, status }) => {
     const args = safeParseArgs(argsText); // { prompt, subagent_type, description }
     const liveContent = useSyncExternalStore(
       (cb) => subscribeSubAgentContent(toolCallId, cb),
       () => getSubAgentContent(toolCallId),
     );
     // Show: agent type badge, description, live activity timeline, result
   };
   ```

3. **Activity timeline** renders the sub-agent's content parts as they stream:
   - Reasoning blocks → collapsible thinking
   - Tool calls → nested tool display
   - Text → streaming markdown

---

## Phase 4: Session Management Improvements

Simplify the session retry strategy using patterns from the [Claude Code CLI docs](https://code.claude.com/docs/en/cli-reference).

### Files to modify:
- **`src/lib/claude-adapter.ts`** — Simplify `chooseSessionStrategy()` and retry logic

### Changes:

**Current flow** (3-attempt cascade):
1. Resume → if stale, try session-id → if missing, try fresh

**Simplified flow** (2-attempt):
1. If we have a session ID: use `--resume <id>` (the CLI docs show this is the standard approach)
2. If resume fails with "No conversation found": start fresh (no session flags)
3. Drop the intermediate `--session-id` mode (it was a fallback for missing local cache, but `--resume` handles this)

**Also from CLI docs — `--continue` flag:**
> Use `--continue` to continue the most recent conversation

This could simplify single-thread usage. But for multi-thread (Pluribus), `--resume <session_id>` is the right approach since each thread tracks its own session.

**Session record simplification:**
```typescript
interface ClaudeSessionRecord {
  threadKey: string;
  sessionId: string;
  status: "active" | "stale" | "error";
  lastUpdatedAt: number;
}
```
Remove: `localCache`, `strategy`, `lastCheckedAt`, `lastError` (overly complex for 2-step flow).

---

## Phase 5: Content Accumulation Improvements

Improve how tool call results are reconciled and how status progression is tracked.

### Files to modify:
- **`src/lib/claude-adapter.ts`** — Enhance `ContentBlockAccumulator` and `processStreamEvent()`

### Changes:

**Add status tracking to accumulators:**
```typescript
interface ContentBlockAccumulator {
  blockType: "text" | "thinking" | "tool_use";
  text: string;
  toolCallId: string;
  toolName: string;
  argsJson: string;
  result: string | undefined;
  isError: boolean;
  status: "streaming" | "complete" | "error"; // NEW
}
```

**Update `buildContentFromAccumulators`** (line 752) to include status on tool-call parts:
```typescript
case "tool_use": {
  content.push({
    type: "tool-call",
    toolCallId: acc.toolCallId,
    toolName: acc.toolName,
    args,
    argsText: acc.argsJson,
    result: acc.result,
    status: acc.result !== undefined
      ? acc.isError ? { type: "incomplete", reason: "error" }
      : { type: "complete", reason: "stop" }
      : { type: "running" },
  });
}
```

**Track `content_block_stop`** (line 868) to mark tool completion:
```typescript
case "content_block_stop": {
  const acc = accumulators[event.index];
  if (acc && acc.blockType === "tool_use" && acc.status === "streaming") {
    acc.status = "complete"; // Args are fully accumulated
    contentChanged = true;
  }
  break;
}
```

---

## Phase 6: Wire Tool Display into Thread

### Files to modify:
- **`src/components/assistant-ui/thread.tsx`** (line 245-252)

### Current:
```typescript
tools: { Fallback: ToolFallback },
```

### After:
```typescript
tools: {
  by_name: {
    Task: TaskTool,
    Read: ReadTool,
    Edit: EditTool,
    Write: WriteTool,
    Bash: BashTool,
    Grep: GrepTool,
    Glob: GlobTool,
    WebSearch: WebSearchTool,
    WebFetch: WebFetchTool,
  },
  Fallback: ToolFallback,
},
```

assistant-ui's `MessagePrimitive.Parts` automatically routes tool-call parts to the matching `by_name` component based on `toolName`, falling back to `ToolFallback` for unknown tools.

---

## Implementation Order

```
Phase 1 (Security: direct CLI)     ← standalone, do first
    ↓
Phase 5 (Accumulator improvements) ← foundation for rich display
    ↓
Phase 2 (Tool display components)  ← depends on Phase 5 status tracking
Phase 3 (Task tool / sub-agents)   ← can parallel with Phase 2
    ↓
Phase 6 (Wire into thread)         ← depends on Phase 2+3
    ↓
Phase 4 (Session simplification)   ← standalone, can do anytime
```

---

## Key Files Summary

| File | Action | Phase |
|------|--------|-------|
| `src/lib/claude-adapter.ts` | Modify: direct CLI spawn, accumulator status, sub-agent exports, session simplification | 1, 3, 4, 5 |
| `src-tauri/capabilities/default.json` | Modify: add direct `claude` command | 1 |
| `src/components/assistant-ui/claude-tool-display.tsx` | **Create**: per-tool display components | 2 |
| `src/components/assistant-ui/task-tool.tsx` | **Create**: sub-agent live display | 3 |
| `src/components/assistant-ui/thread.tsx` | Modify: wire tool components into Parts | 6 |
| `src/components/assistant-ui/tool-fallback.tsx` | No changes (reuse as-is) | — |

---

## Existing Code to Reuse

- **`ToolFallback` compound component** (`tool-fallback.tsx:32-312`): Root/Trigger/Content/Args/Result/Error — compose these for per-tool renderers
- **`buildContentFromAccumulators()`** (`claude-adapter.ts:752`): Extend with status field
- **`processStreamEvent()`** (`claude-adapter.ts:796`): Add status tracking to content_block_stop
- **`spawnClaudeStreaming()`** (`claude-adapter.ts:1009`): Replace shell wrapper with direct args
- **`PermissionApprovalBar`** (`thread.tsx:115`): Already wired to `getClaudePermissionRequests` — stub functions exist in claude-adapter.ts, ready for future ACP activation
- **`useSyncExternalStore` pattern**: Used throughout for reactive external state (dev events, permissions) — reuse for sub-agent subscriptions
- **`cn()` utility** (`lib/utils.ts`): For className merging in new components
- **`safeParseArgs` pattern**: Already done inline in `buildContentFromAccumulators` — extract to shared utility

---

## Verification

### Phase 1 (Direct CLI):
1. `cargo tauri dev`
2. Send a prompt in any thread
3. Verify Claude CLI spawns correctly (check DevPanel for events)
4. Verify `--resume` works across prompts in the same thread
5. Verify abort/cancel kills the subprocess

### Phase 2+3 (Tool Display):
1. Send a prompt that triggers tool use (e.g., "Read the package.json file")
2. Verify the Read tool component renders with file path in trigger
3. Verify tool status shows spinning loader while running, check when complete
4. Verify Edit tool shows old/new diff
5. Verify Bash tool shows command and output
6. For Task tool: send a prompt that spawns a sub-agent, verify live streaming

### Phase 4 (Sessions):
1. Send a prompt, note the session ID in DevPanel
2. Send a follow-up prompt in same thread, verify `--resume` is used
3. Delete the session (clear localStorage), send prompt, verify fresh session starts
4. Verify session IDs persist across app restart

### Phase 5 (Accumulator):
1. Verify tool-call parts have correct `status.type` during streaming
2. Verify status transitions: `running` → `complete` as tool finishes
3. Verify error tool calls show `incomplete` status with error info

---

## Future ACP Migration Path

This plan creates clean abstractions that would ease a future ACP transition:
- Tool display components are transport-agnostic (they receive `toolName`, `args`, `result`, `status`)
- Sub-agent subscription API (`subscribeSubAgentContent`) maps directly to ACP's `tool_call_update`
- Session management simplification aligns with ACP's `session/new` + `session/load`
- The `PermissionApprovalBar` UI is ready — only the backing store needs ACP integration

If Anthropic adds native ACP support to Claude Code (or the `claude-code-acp` bridge stabilizes), the migration would replace `spawnClaudeStreaming()` and `processStreamEvent()` while keeping all UI components intact.

---

## ACP Research Summary (for reference)

Key findings from the ACP evaluation:
- **ACP** ([agentclientprotocol.com](https://agentclientprotocol.com)) is a JSON-RPC 2.0 protocol for editor↔agent communication, created by Zed with Google/JetBrains backing
- **`claude-code-acp`** ([github](https://github.com/zed-industries/claude-code-acp)): Community bridge by Zed that wraps the Agent SDK as an ACP server. Requires `ANTHROPIC_API_KEY`, Node.js 18+
- **`@anthropic-ai/claude-agent-sdk`** ([npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)): Official Anthropic SDK for programmatic Claude Code. TypeScript `query()` API with streaming, hooks, subagents, MCP. Requires API key auth.
- **`@agentclientprotocol/sdk`** ([npm](https://www.npmjs.com/package/@agentclientprotocol/sdk)): Official ACP TypeScript SDK. `ClientSideConnection` class, `ndJsonStream()` for stdio transport, typed `SessionUpdate` notifications.
- **Auth blocker**: Anthropic prohibits third-party OAuth; both SDK and ACP bridge require API keys. Current `claude -p` works with any auth the user has configured.
- **Native ACP in Claude Code**: [Rejected as NOT_PLANNED](https://github.com/anthropics/claude-code/issues/6686) by Anthropic.

# Claude CLI Stream Schema and Adapter Plan

## Goal
Document the real Claude CLI `stream-json` output observed in `reports/*.json`, then define an implementation plan for fixing parsing and display issues in `src/lib/claude-adapter.ts`.

## Source Data
- `reports/cloud-code-audit-beta-team.json`
- `reports/cloud-code-audit-beta-team-final-pass.json`
- `reports/cloud-code-audit-subagents.json`
- `reports/cloud-code-audit-subagents-standard.json`

## Observed Output Schema (NDJSON)

The reports are newline-delimited JSON (one object per line), not a single JSON array.

### 1. Top-level event families
- `type: "stream_event"`
- `type: "assistant"`
- `type: "user"`
- `type: "system"`
- `type: "result"`

### 2. Streaming envelope events
When `type === "stream_event"`, the actual streaming payload is in `event`.

- `event.type: "message_start" | "message_delta" | "message_stop"`
- `event.type: "content_block_start" | "content_block_delta" | "content_block_stop"`

Observed content block shapes:
- `content_block_start` with `content_block.type: "text" | "tool_use"`
- `content_block_delta` with `delta.type: "text_delta" | "input_json_delta"`
- `tool_use` blocks include:
  - `content_block.id` (tool call id, e.g. `toolu_...`)
  - `content_block.name` (tool name, e.g. `Task`, `Read`, `Bash`)
  - `content_block.input` (initial object, often `{}`)
  - Followed by `delta.partial_json` chunks

### 3. Tool result representations
Tool results appear in multiple formats:

1. Transcript message content:
- `message.content[]` entry with `type: "tool_result"`
- `tool_use_id` links the result back to a tool call
- `content` carries result payload (string/object)
- may include `is_error` or error-like values

2. Top-level `tool_use_result` field:
- present mostly on `type: "user"` events
- can be object/string/null
- includes async launch metadata in some runs:
  - `isAsync`, `status`, `agentId`, `description`, `prompt`, `outputFile`

### 4. Subagent / nested execution
Nested subagent streams are represented by:
- `parent_tool_use_id` on top-level events (`assistant` and `user` in observed data)
- parent tool call is usually a `Task` tool call with matching `toolu_...` id
- child transcript events carry `parent_tool_use_id = <parent Task tool call id>`

This means nested execution is recoverable from CLI output without ACP, provided we parse and route by `parent_tool_use_id`.

### 5. Thinking / reasoning
In these report files, no `thinking` or `reasoning` blocks were observed.
Support should remain in parser/UI, but current bug profile is mostly tool-call and nesting related.

## Current Adapter Gaps

In `src/lib/claude-adapter.ts`:

1. `processStreamEvent()` does not handle `type: "user"` events.
- Many real `tool_result` records are therefore ignored.

2. Tool result reconciliation is limited.
- Current logic mostly reconciles `assistant.message.content[].tool_result`.
- It misses `user.message.content[].tool_result` and top-level `tool_use_result` paths.

3. `parent_tool_use_id` is not modeled or routed.
- Subagent nesting is flattened/lost.

4. Envelope metadata gets dropped during unwrap.
- `unwrapStreamEvent()` does not preserve parent scope fields.

5. Accumulation is index-based (`accumulators[idx]`) instead of call-id/scope based.
- Late-arriving results can appear detached or visually re-ordered.

## Implementation Plan

### Phase 1: Normalize raw events
1. Add `parent_tool_use_id?: string | null` and `tool_use_result?: unknown` to typed event models.
2. Build a normalization step producing internal events:
- `scopeId` (`root` or `parent_tool_use_id`)
- `kind` (`tool_call_start`, `tool_call_args_delta`, `tool_result`, `text_delta`, `reasoning_delta`, `usage`, etc.)
- `toolCallId`, `toolName`, `payload`, `seq`
3. Preserve envelope metadata while unwrapping `stream_event`.

### Phase 2: Move from index-based to identity-based tool tracking
1. Maintain `toolCallsById: Map<string, ToolCallState>`.
2. Maintain scope timelines keyed by `scopeId`.
3. Keep stable ordering by insertion sequence, not mutable index positions.

### Phase 3: Reconcile all tool result paths
1. Parse and link `assistant.message.content[].tool_result`.
2. Parse and link `user.message.content[].tool_result`.
3. Parse top-level `tool_use_result` and attach to the active scope/call context.
4. Update existing tool-call parts in place (same `toolCallId`) when results arrive.

### Phase 4: Subagent nesting model
1. Represent each `parent_tool_use_id` as a child scope.
2. Keep parent `Task` tool call in root timeline.
3. Associate child scope timeline under that parent tool call for rendering.
4. Support multiple concurrent child scopes.

### Phase 5: Output contract for UI
1. Ensure emitted content parts have stable ids per tool call.
2. Emit tool status/result updates as updates to existing parts, not new detached parts.
3. Keep reasoning parts optional and independent from tool parts.

### Phase 6: Validation and regression safety
1. Add parser replay tests using all `reports/*.json` fixtures.
2. Assert:
- no dropped `tool_result` linkages
- stable tool-call ordering before/after result arrival
- correct subagent grouping by `parent_tool_use_id`
3. Add dev counters for unhandled event kinds and unresolved tool results.

### Phase 7: Stream and process hardening
1. Add `--debug-to-stderr` to Claude CLI invocation flags to reduce stdout stream pollution risk.
2. Replace per-chunk `split("\n")` parsing with a line buffer that carries incomplete JSON lines across stdout chunks.
3. Keep robust partial JSON assembly for `delta.partial_json` tool args and add explicit tests for fragmented chunks.
4. Add fallback behavior if `result` event is missing (finalize from accumulated content + process close) to avoid hanging UI states.
5. Review/strengthen process cleanup paths (abort, close, hot reload) to reduce orphan process risk.

### Phase 8: Type model upgrade
1. Consider importing Claude Agent SDK message types (types-only usage) to replace hand-maintained event unions.
2. Keep current Tauri shell spawn path, but align local normalization types with SDK message contracts.
3. Add compatibility mapping for less-common message types (for example compact boundary markers) so they are safely ignored or rendered.

## Expected Impact
- Fixes current UI bugs where tool calls appear once, then move to the bottom when results arrive.
- Produces stable, accurately linked tool call/result lifecycle.
- Enables real nested subagent display using existing CLI output fields.
- Reduces parser fragility by unifying all event paths into one normalized internal model.
- Improves stream resilience under noisy/fragmented stdout conditions.

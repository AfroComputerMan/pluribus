# Agent Coordination Board: Enhanced CLI Integration

**Last Updated**: 2026-02-11 (Post-Analysis)
**PM**: Orchestrator Agent

---

## Agent Status Board

| Agent | Status | Current Task | Blockers | Last Update |
|-------|--------|-------------|----------|-------------|
| Front-end Expert | `COMPLETE` | Phases 2, 3, 6 analysis done | None | 2026-02-11 |
| Back-end/Adapter Expert | `COMPLETE` | Phases 1, 4, 5 analysis done | None | 2026-02-11 |
| Rust/Tauri Expert | `COMPLETE` | Phase 1 (shell plugin) analysis done | None | 2026-02-11 |
| CLI Expert | `COMPLETE` | Phases 1, 4 (CLI behavior) analysis done | None | 2026-02-11 |
| Testing Expert | `COMPLETE` | Verification strategy designed | None | 2026-02-11 |

---

## Critical Findings (Cross-Agent Consensus)

### Finding 1: STDIN BLOCKER CONFIRMED -- Direct CLI invocation NOT viable with current Tauri plugin

**Consensus**: Rust/Tauri + Back-end experts agree.

- Tauri `tauri-plugin-shell` v2.3.5 has NO `closeStdin()`, `end()`, or `disconnect()` API
- `Child` class only exposes `write(data)` and `kill()` -- no stdin close
- `SpawnOptions` only has `cwd`, `env`, `encoding` -- no stdin control
- Open feature request [#2136](https://github.com/tauri-apps/plugins-workspace/issues/2136) has been open 3+ years, NOT implemented
- Writing empty bytes does NOT close the pipe -- Claude CLI sees open stdin and may hang
- `encoding: "raw"` only affects stdout/stderr decoding, NOT stdin

**Recommended approach**: Keep simplified `sh -c` wrapper with `< /dev/null`. The shell wrapper security is already well-mitigated (env vars prevent injection, `exec` eliminates orphan shell). A custom Rust `#[tauri::command]` with `Stdio::null()` is the clean future solution (~100-150 lines Rust).

**Empirical test needed**: Verify whether current Claude CLI version with `-p` flag still hangs on open piped stdin. If not, direct invocation works.

### Finding 2: BUG DISCOVERED -- Tool-call parts missing `result` and `isError`

**Discovered by**: Back-end Expert

`buildContentFromAccumulators()` at line 732-738 emits tool-call content parts WITHOUT `result` or `isError` fields, even though the accumulator has them populated from `assistant` events with `tool_result` blocks.

**Impact**: assistant-ui derives tool status from `part.result` (found in `toMessagePartStatus()` in the assistant-ui source). Since `result` is never emitted, ALL tool-call parts show as "running" until the entire message completes, instead of showing individual tool completion. This is a **user-visible bug** that exists today.

**Fix**: Add `result: acc.result` and `isError: acc.isError` to the tool-call content part in `buildContentFromAccumulators`. This is the single highest-value change and can be done in minutes.

### Finding 3: assistant-ui `tools.by_name` API CONFIRMED working

**Verified by**: Front-end Expert (reading node_modules source)

The `MessagePrimitive.Parts` component at `node_modules/@assistant-ui/react/src/primitives/message/MessagePrimitive.tsx` fully supports:

```typescript
tools: {
  by_name: Record<string, ToolCallMessagePartComponent | undefined>;
  Fallback: ComponentType<ToolCallMessagePartProps>;
}
```

Routing logic (line 272 of the source): `const Tool = tools.by_name?.[part.toolName] ?? tools.Fallback;`

No API issues. Phase 6 wiring is straightforward.

### Finding 4: Session management ALREADY simplified -- Plan is outdated

**Found by**: Back-end Expert

`chooseSessionStrategy()` at line 612-624 already returns only `"resume" | "none"`. The 3-step cascade the plan describes doesn't exist. However, there is significant **dead code** remaining:
- Dead `session-id` branches at lines 1120-1121, 1431-1434, 1461-1465
- Ghost fields (`localCache`, `strategy`, `lastCheckedAt`, `lastError`) passed to `upsertSessionRecord` but not in the `ClaudeSessionRecord` type
- DB schema has `NOT NULL` columns (`local_cache`, `strategy`) that are no longer populated
- Status values like `"resume_ok"`, `"session_id_ok"`, `"fallback_new"` used but not in the type union

Phase 4 becomes a **dead code cleanup** rather than a simplification.

### Finding 5: Sub-agent events LIKELY exist via `parent_tool_use_id` (REVISED)

**Initial finding**: Back-end Expert found no sub-agent infrastructure in `claude-adapter.ts`.
**Revised finding**: CLI Expert discovered `parent_tool_use_id` in SDK types.

The SDK's `SDKPartialAssistantMessage` and `SDKAssistantMessage` types both include a `parent_tool_use_id: string | null` field. When a sub-agent (Task tool) executes:
- Sub-agent stream events have `parent_tool_use_id` set to the Task tool's `tool_use_id`
- Main agent events have `parent_tool_use_id: null`

**However**: This needs empirical verification with actual `--output-format stream-json` CLI output. The SDK types suggest the field is present, but the CLI's NDJSON serialization has not been confirmed to include it.

**What the adapter needs (if confirmed)**:
1. Add `parent_tool_use_id?: string | null` to all event type definitions
2. Route events by `parent_tool_use_id` in `processStreamEvent()` — non-null goes to per-sub-agent accumulators
3. Build `Map<toolCallId, SubAgentState>` subscription API
4. The front-end expert also found assistant-ui has `parentId` and `messages` fields on `ToolCallMessagePart` that could enable native nested rendering

**Impact on Phase 3**: Phase 3 live streaming is **potentially feasible** but requires:
- Empirical verification of `parent_tool_use_id` in CLI output (run a prompt that triggers Task tool)
- Adapter work to add event routing infrastructure
- Decision: use assistant-ui's `parentId`/`messages` fields vs. custom `useSyncExternalStore`

Phase 3 scope is **conditionally restored** — implement basic Task renderer first, add live streaming after empirical verification.

### Finding 6: ToolFallback compound pattern is extensible

**Verified by**: Front-end Expert

The `ToolFallback` at `tool-fallback.tsx` exports composable primitives (`Root`, `Trigger`, `Content`, `Args`, `Result`, `Error`). Per-tool components can compose these directly.

**One limitation**: `ToolFallbackTrigger` hardcodes the label format as `"Used tool: <toolName>"` / `"Cancelled tool: <toolName>"`. Per-tool components that want custom trigger text (e.g., `"Read: /src/main.ts"`) should use `ToolFallbackRoot` + custom trigger, or the `toolName` prop can be set to `"Read: /src/main.ts"` directly.

---

## Blocking Questions (RESOLVED)

| # | Question | Asked By | Answered By | Answer | Status |
|---|----------|----------|-------------|--------|--------|
| 1 | Can Tauri shell plugin close stdin on spawn without `sh -c`? | Back-end | Rust/Tauri | **NO.** No `closeStdin()` API exists. `Child` has only `write()` and `kill()`. Plugin v2.3.5 has no stdin-related features. | RESOLVED |
| 2 | Does Claude CLI emit nested events for Task (sub-agent) tool calls? | Front-end | CLI Expert | **LIKELY YES** via `parent_tool_use_id` field on stream events (found in SDK types). Needs empirical verification with actual CLI NDJSON output. | REVISED |
| 3 | What is the exact `content_block_stop` event format for tool_use blocks? | Back-end | CLI Expert | `{"type": "content_block_stop", "index": N}` -- same as text blocks. No additional fields. | RESOLVED |
| 4 | Does assistant-ui v0.12.x support `tools.by_name` in `MessagePrimitive.Parts`? | Front-end | Front-end | **YES.** Fully supported. `tools.by_name?.[part.toolName] ?? tools.Fallback` routing confirmed in source. | RESOLVED |
| 5 | What session state survives a `--resume` after error exit? | Back-end | CLI Expert | Error format: `result` event with `subtype: "error_during_execution"` and `errors: ["No conversation found with session ID ..."]`. Session ID is returned in the event. | RESOLVED |

---

## Revised Phase Readiness Checklist

### Phase 5: Content Accumulation (DO FIRST -- bug fix)
- [x] Back-end: Design enhanced accumulator with `result`/`isError` emission
- [x] Back-end: Confirm `content_block_stop` should set `contentChanged = true`
- [x] Front-end: Confirmed assistant-ui derives status from `part.result`
- [x] Testing: Unit test plan for `processStreamEvent` and `buildContentFromAccumulators`
- **READY TO IMPLEMENT**

### Phase 2: Tool Display Components
- [x] Front-end: Component architecture designed (compose ToolFallback primitives)
- [x] Front-end: Verified `ToolFallback` compound component extensibility
- [x] Back-end: `argsText` is raw JSON string, `result` is string or JSON-stringified
- [x] Testing: Component test approach defined (Vitest + Testing Library)
- **READY TO IMPLEMENT** (after Phase 5)

### Phase 4: Session Dead Code Cleanup
- [x] Back-end: Identified all dead code branches and ghost fields
- [x] Testing: Session strategy unit tests defined
- **READY TO IMPLEMENT** (standalone)

### Phase 1: Security (Shell Wrapper Simplification)
- [x] Rust/Tauri: Confirmed NO stdin close API -- shell wrapper needed
- [x] CLI Expert: Confirmed arg format for `claude -p` direct invocation
- [x] Back-end: `buildClaudeArgs()` designed
- [ ] **NEEDS EMPIRICAL TEST**: Does current Claude CLI hang with open stdin in `-p` mode?
- **BLOCKED** on empirical stdin test

### Phase 6: Wire into Thread
- [x] Front-end: Confirmed `tools.by_name` API shape
- [x] Front-end: Import map straightforward
- [x] Testing: Integration test plan defined
- **READY TO IMPLEMENT** (after Phase 2)

### Phase 3: Task Tool / Sub-Agent Display (SCOPE CONDITIONAL)
- [x] CLI Expert: Found `parent_tool_use_id` in SDK types — sub-agent streaming likely available
- [x] Front-end Expert: Found assistant-ui has `parentId`/`messages` fields on `ToolCallMessagePart`
- [ ] **NEEDS EMPIRICAL TEST**: Trigger Task tool via CLI, capture NDJSON, verify `parent_tool_use_id` field
- **Phase 3a** (basic Task renderer): READY TO IMPLEMENT
- **Phase 3b** (live sub-agent streaming): BLOCKED on empirical verification

---

## Revised Implementation Order

```
1. Phase 5 (Bug fix: add result/isError to tool-call parts)   -- 30 min, highest value
   ↓
2. Phase 4 (Dead code cleanup: remove session-id ghost code)  -- 1-2 hours, reduces complexity
   ↓
3. Phase 2 (Tool display components: 8 renderers)             -- 4-6 hours, major UX improvement
   ↓
4. Phase 6 (Wire tool components into thread.tsx)              -- 30 min, depends on Phase 2
   ↓
5. Phase 1 (Shell wrapper simplification or direct CLI)        -- 2-4 hours, needs stdin test first
   ↓
6. Phase 3 (Basic Task tool renderer, no live streaming)       -- 1-2 hours, reduced scope
```

**Rationale for reorder** (Back-end Expert recommendation):
- Phase 5 fixes a real user-visible bug (tools never show individual completion)
- Phase 4 removes ~100 lines of dead code, making Phase 1 changes cleaner
- Phase 1 requires empirical investigation before code changes
- Phase 3 is descoped significantly since sub-agent streaming isn't available

---

## Testing Infrastructure (Testing Expert Recommendation)

**Framework**: Vitest (native to Vite, works with bun)

**Setup**:
1. `bun add -d vitest @testing-library/react`
2. Create `vitest.config.ts` extending `vite.config.ts`
3. Extract pure functions from `claude-adapter.ts` into `src/lib/stream-processing.ts`
4. Create `src/test/fixtures/stream-events.ts` with mock data catalog

**Priority test targets** (pure functions, no mocks needed):
- `processStreamEvent()` -- 15-20 tests
- `buildContentFromAccumulators()` -- 10 tests
- `unwrapStreamEvent()` -- 5 tests
- `chooseSessionStrategy()` -- 3 tests
- `extractUserPrompt()` -- 3 tests

**Recommendation**: Write tests BEFORE implementing Phase 5 (test-first for the bug fix).

---

## Findings Summary

### Front-end Expert Findings
- `tools.by_name` API confirmed working in assistant-ui v0.12.x
- `ToolCallMessagePartComponent` receives `{ toolName, argsText, result, status, toolCallId, addResult, resume }`
- Status is derived from `part.result` via `toMessagePartStatus()`, NOT from a custom field on the content part
- `ToolFallback` compound pattern is composable -- per-tool components wrap `Root`, `Trigger`, `Content`
- Custom trigger text possible by passing formatted string to `toolName` prop
- Phase 3 sub-agent streaming not feasible without transport change
- Shared utilities needed: `safeParseArgs()`, `TruncatedResult`, `InlineDiff`

### Back-end/Adapter Expert Findings
- **BUG**: `buildContentFromAccumulators` does not emit `result` or `isError` on tool-call parts
- assistant-ui uses `part.result` to determine tool completion status -- missing result = always "running"
- `chooseSessionStrategy()` already 2-step, but ~100 lines of dead session-id code remain
- Ghost fields (`localCache`, `strategy`, `lastCheckedAt`, `lastError`) pollute session records
- DB schema has NOT NULL columns (`local_cache`, `strategy`) no longer populated
- `content_block_stop` should set `contentChanged = true` to trigger prompt yield of final args
- Phase 1 stdin solution: test direct spawn first, fallback to custom Rust command or simplified wrapper
- Recommended order: Phase 5 first (bug fix), then Phase 4 (cleanup), then Phase 1

### Rust/Tauri Expert Findings
- `tauri-plugin-shell` v2.3.5: `Child` API has only `write()` and `kill()` -- NO stdin close
- `SpawnOptions`: only `cwd`, `env`, `encoding` -- no stdin control
- `encoding: "raw"` affects stdout/stderr only, not stdin
- Open issue #2136 (stdin close) unimplemented for 3+ years
- `child.kill()` sends SIGKILL on Unix (not SIGTERM) -- no graceful shutdown
- Plugin auto-kills children on `RunEvent::Exit` -- no orphan processes
- Shell wrapper security already good: env vars prevent injection, `exec` eliminates shell orphan
- Future clean solution: custom `#[tauri::command]` in lib.rs with `Stdio::null()` (~100-150 lines Rust)

### CLI Expert Findings
- Stream-JSON tool_use lifecycle: `content_block_start(tool_use, id, name)` → `content_block_delta(input_json_delta)` → `content_block_stop` → later `assistant(tool_result matching tool_use_id)`
- `content_block_stop` has minimal format: `{"type": "content_block_stop", "index": N}`
- Tool results arrive in `assistant` events with `message.content[].type === "tool_result"`
- `partial_json` in deltas accumulates to complete JSON (safe to parse after `content_block_stop`)
- **REVISED**: Sub-agent events LIKELY available via `parent_tool_use_id` field (found in SDK `SDKPartialAssistantMessage` and `SDKAssistantMessage` types). Sub-agent stream events tagged with `parent_tool_use_id` = Task tool's `tool_use_id`. Needs empirical verification with actual CLI output.
- `--resume` with invalid session produces: `result` event with `subtype: "error_during_execution"`, `errors: ["No conversation found with session ID ..."]`
- stdin behavior: Claude CLI checks for pipe on stdin in `-p` mode. `< /dev/null` provides immediate EOF
- Result event subtypes: `success`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd`
- `--session-id` is for pre-assigning UUIDs to new sessions, NOT for resuming (correctly dropped)
- `--fork-session` could be useful for Pluribus branching model (create new session from resume point)
- `--no-session-persistence` available for ephemeral threads
- `--fallback-model` available for rate limit resilience
- Extended thinking disables `StreamEvent` emission — risk if thinking features added later

### Testing Expert Findings
- Recommends **Vitest** (Vite-native, works with bun)
- Extract pure functions into `src/lib/stream-processing.ts` for testability
- Created comprehensive mock data catalog with `streamEventFixtures` and `streamSequences`
- Detailed unit test examples for `processStreamEvent` (20 tests), `buildContentFromAccumulators` (10 tests)
- Phase-specific status tracking tests for Phase 5 accumulator changes
- Manual testing checklist for all 6 phases
- CI pipeline: `bun run test:run` for unit tests, `cargo tauri build` for releases only
- Key insight: pure function tests need NO mocks -- extract from adapter for direct testing
- Recommended: **extract, then test, then implement** (test-first approach)

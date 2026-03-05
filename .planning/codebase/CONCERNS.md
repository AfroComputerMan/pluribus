# Codebase Concerns

**Analysis Date:** 2026-03-05

## Tech Debt

**Monolithic claude-adapter.ts (1990 lines):**
- Issue: `src/lib/claude-adapter.ts` is the largest file by far. It contains stream event types, session management, thread locking, dev event infrastructure, content block accumulation, CLI spawning, and the adapter factory -- all in one file.
- Files: `src/lib/claude-adapter.ts`
- Impact: Hard to reason about, test, or safely modify any one concern without risk of breaking another. New contributors face a steep onboarding curve.
- Fix approach: Extract into modules: `claude-types.ts` (stream event types), `claude-session.ts` (session cache + lock), `claude-dev-events.ts` (dev event circular buffer + snapshot), `claude-stream-processor.ts` (accumulator logic), `claude-spawn.ts` (shell spawning). Keep `claude-adapter.ts` as a thin orchestrator that imports from these.

**extractUserPrompt discards conversation history:**
- Issue: `extractUserPrompt()` at line 698 of `src/lib/claude-adapter.ts` takes only the last user message text. All prior messages are discarded because Claude CLI manages history via `--resume`. The same pattern is duplicated in `src/lib/agent-sdk-adapter.ts` (line 305) and `src/lib/codex-adapter.ts` (line 94-102).
- Files: `src/lib/claude-adapter.ts`, `src/lib/agent-sdk-adapter.ts`, `src/lib/codex-adapter.ts`
- Impact: assistant-ui edit/branch/regenerate operations diverge from what the CLI session actually sees. Users who edit a past message will not get the expected behavior -- the CLI session continues from its own history, not the UI's branched history.
- Fix approach: Either disable edit/branch/regenerate in the UI, or implement a mechanism to start fresh sessions with the full message history when the UI tree diverges from the linear session.

**Stub permission request system:**
- Issue: `getClaudePermissionRequests()`, `subscribeClaudePermissionRequests()`, and `respondToClaudePermissionRequest()` in `src/lib/claude-adapter.ts` (lines 351-368) are all no-ops that return empty arrays or void. They exist only to satisfy the type system for the shell adapter engine.
- Files: `src/lib/claude-adapter.ts` (lines 351-368)
- Impact: The shell adapter engine has no approval workflow -- Claude CLI runs with whatever permissions it has. The Codex adapter (`src/lib/codex-adapter.ts`) has a working approval system via `src/lib/codex-approval-store.ts`, creating an inconsistent experience between engines.
- Fix approach: Either implement real permission handling for the shell adapter (using Claude CLI's `--permission-mode` flag) or remove the stub functions and make the approval system adapter-aware.

**Duplicated adapter boilerplate across three adapters:**
- Issue: `src/lib/claude-adapter.ts`, `src/lib/agent-sdk-adapter.ts`, and `src/lib/codex-adapter.ts` each independently implement queue-based async generator patterns, thread key extraction via `unstable_threadId`, abort signal handling, and session persistence. The patterns are structurally identical but differ in details.
- Files: `src/lib/claude-adapter.ts`, `src/lib/agent-sdk-adapter.ts`, `src/lib/codex-adapter.ts`
- Impact: Bug fixes or behavioral changes must be applied to all three files. Divergence between them creates inconsistent behavior across engine modes.
- Fix approach: Extract a shared `BaseAdapter` or utility functions for the common patterns: thread key resolution, abort wiring, session persistence, and the queue-to-generator bridge.

**Heavy reliance on unstable assistant-ui APIs:**
- Issue: The codebase uses several `unstable_` prefixed APIs from assistant-ui: `unstable_useRemoteThreadListRuntime`, `unstable_RemoteThreadListAdapter`, `unstable_Provider`, `unstable_threadId`, and `unstable_memoizeMarkdownComponents`.
- Files: `src/components/RuntimeProvider.tsx`, `src/lib/sqlite-thread-list-adapter.ts`, `src/lib/sqlite-thread-history-adapter.tsx`, `src/lib/router-adapter.ts`, `src/lib/agent-sdk-adapter.ts`, `src/lib/codex-adapter.ts`
- Impact: These APIs may change or be removed in any minor version update of assistant-ui, requiring potentially significant rewrites. The thread ID extraction pattern (`(options as { unstable_threadId?: string }).unstable_threadId`) is particularly fragile as it relies on undocumented type casting.
- Fix approach: Monitor assistant-ui releases. When stable equivalents are available, migrate. Pin assistant-ui to a known-working version and upgrade deliberately.

**workspacesGetByCwd does full table scan:**
- Issue: `workspacesGetByCwd()` in `src/lib/db.ts` (line 400-414) loads ALL workspaces and iterates in JavaScript to find a CWD match, because CWD normalization logic (trailing slash removal, backslash conversion) cannot be expressed in a simple SQL WHERE clause.
- Files: `src/lib/db.ts` (lines 400-414)
- Impact: Negligible with current expected workspace counts (< 100). Would become a problem if workspaces grew to thousands.
- Fix approach: Store a normalized `cwd_key` column alongside `cwd` in the workspaces table, populated on insert/update. Query against that column directly.

## Known Bugs

**Duplicate workspace detection unreliable:**
- Symptoms: The TODO at line 424 of `src/lib/db.ts` states: "Duplicate workspace detection is still not fully reliable in the app flow."
- Files: `src/lib/db.ts` (line 424), `ensureWorkspaceCwdUniqueness()` (line 346)
- Trigger: Race conditions when creating workspaces concurrently or when the dedup migration (`ensureWorkspaceCwdUniqueness`) has not yet run for the current session.
- Workaround: The `ensureWorkspaceCwdUniqueness()` function runs lazily before workspace reads and merges duplicates, but only within a single session lifetime.

**Attachments non-functional:**
- Symptoms: The UI has attachment components wired up but files cannot be attached to messages.
- Files: `src/components/RuntimeProvider.tsx` (no `adapters.attachments` passed to `useLocalRuntime`)
- Trigger: User attempts to attach a file in the composer.
- Workaround: None -- the feature is silently broken.

## Security Considerations

**Shell wrapper allows arbitrary argument injection:**
- Risk: The `CLAUDE_SHELL_SCRIPT` constant in `src/lib/claude-adapter.ts` (line 1312-1313) uses `sh -c` with environment variable expansion. While the prompt and session ID are passed as environment variables (avoiding direct shell injection), the shell script uses unquoted `$MODEL_FLAG` and `$EFFORT_FLAG` which undergo word splitting. If model or effort values contained spaces or shell metacharacters, they could be misinterpreted.
- Files: `src/lib/claude-adapter.ts` (line 1312-1313), `src-tauri/capabilities/default.json`
- Current mitigation: Model and effort values come from a controlled set (resolved via `resolveModel` and `resolveEffort`). The `claude-stream-sh` Tauri shell scope allows `sh` with any args (`"args": true`).
- Recommendations: Replace `sh -c` wrapper with a direct `Command.create("claude", [...args])` invocation (noted in CLAUDE.md as a known issue). This eliminates the entire class of shell injection risks. At minimum, quote the `$MODEL_FLAG` and `$EFFORT_FLAG` expansions.

**Broad shell permissions:**
- Risk: `src-tauri/capabilities/default.json` grants `shell:allow-spawn` and `shell:allow-execute` for `claude`, `sh`, `git`, and `codex` all with `"args": true`, meaning any arguments are allowed. The `sh` entry is particularly broad -- it allows execution of arbitrary shell commands from the webview.
- Files: `src-tauri/capabilities/default.json`
- Current mitigation: The Tauri window only loads local content, so remote code cannot trigger these commands. But any XSS in a rendered message or tool result could escalate to full system access.
- Recommendations: Restrict `sh` to the specific script pattern needed. Consider removing `shell:allow-execute` for `sh` entirely and using only `shell:allow-spawn`. Restrict `git` args to a known set of safe subcommands.

**stderr parsing for error detection:**
- Risk: Session error detection relies on string matching against stderr output (e.g., `"No conversation found with session ID"`, `"already in use"` at lines 1654-1671 of `src/lib/claude-adapter.ts`). If Claude CLI changes its error messages, the retry logic silently breaks.
- Files: `src/lib/claude-adapter.ts` (lines 1654-1671)
- Current mitigation: None.
- Recommendations: Use structured error codes from the CLI's JSON output rather than parsing stderr strings. The `result` event with `subtype: "error_during_execution"` already provides structured error info -- prefer that path.

## Performance Bottlenecks

**Sidecar stdout JSON serialization overhead:**
- Problem: Every SDK message from the agent-sdk-bridge sidecar is serialized to JSON on stdout, parsed in the Tauri shell plugin, passed to the webview, and parsed again in JavaScript. For long tool outputs or many rapid deltas, this creates significant serialization overhead.
- Files: `sidecar/agent-sdk-bridge/index.ts`, `src/lib/agent-sdk-adapter.ts`
- Cause: NDJSON over stdin/stdout is the simplest IPC mechanism but creates double-serialization.
- Improvement path: Consider a localhost WebSocket or Tauri IPC channel for the sidecar bridge to reduce serialization overhead. Alternatively, batch rapid small messages in the sidecar before writing.

**Fire-and-forget database writes:**
- Problem: Several database writes use `void` prefix (fire-and-forget), meaning errors are silently swallowed: session upserts (`src/lib/claude-adapter.ts` line 461), usage snapshot inserts (line 1775), and dev panel state saves (`src/components/DevPanel.tsx` line 171).
- Files: `src/lib/claude-adapter.ts` (lines 461, 1775), `src/components/DevPanel.tsx` (line 171)
- Cause: Deliberate choice to avoid blocking the hot path on non-critical writes.
- Improvement path: Add a lightweight error reporter that logs failed fire-and-forget DB writes to the dev event system, so failures are at least visible during development.

**Title generation spawns extra Claude CLI process:**
- Problem: `prefetchTitle()` in `src/lib/sqlite-thread-list-adapter.ts` (line 46-72) spawns a separate `claude` CLI process with Haiku to generate thread titles. This means every new thread starts two CLI processes simultaneously.
- Files: `src/lib/sqlite-thread-list-adapter.ts` (lines 46-72)
- Cause: Title generation runs concurrently with the main query for UX responsiveness.
- Improvement path: Consider extracting the title from the first assistant response instead of spawning a parallel process. Alternatively, use a lightweight HTTP API call instead of a full CLI spawn.

## Fragile Areas

**Stream event accumulator state machine:**
- Files: `src/lib/claude-adapter.ts` (lines 728-1254, the `makeAccumulator`, `createIndexedAccumulator`, `processStreamEvent`, and `buildContentFromAccumulators` functions)
- Why fragile: The accumulator system tracks content blocks by composite keys (`scopeId:index:startCount:source`), handles multiple scopes for sub-agents, manages pending tool results, and handles out-of-order events. State transitions between `content_block_start`, `content_block_delta`, `content_block_stop`, and `assistant`/`user` message events have complex interaction patterns.
- Safe modification: Any changes to stream processing must be tested against all Claude CLI output formats (stream-json with and without `--include-partial-messages`). Use `runStreamDiagnostic()` to verify the pipeline.
- Test coverage: Zero automated tests. Only the manual `runStreamDiagnostic()` function exists.

**Session retry loop:**
- Files: `src/lib/claude-adapter.ts` (lines 1489-1868)
- Why fragile: The retry loop (up to 3 attempts) handles four different failure modes: missing conversation, session in use, non-zero exit code, and abort. Each retry clears different session state. The interaction between `chooseSessionStrategy`, `setSessionForThread`, `clearSessionForThread`, and `upsertSessionRecord` across retries creates subtle state machine behavior that is hard to reason about.
- Safe modification: Trace through all retry paths before changing session management. Ensure `releaseThreadRunLock` is always called in the `finally` block.
- Test coverage: None.

**Codex service Rust-side event routing:**
- Files: `src-tauri/src/codex/service.rs`
- Why fragile: The stdout reader task parses JSON-RPC notifications and maps method strings to `AgentEvent` variants. Thread ID extraction tries multiple JSON paths (`threadId`, `thread_id`, `thread.id`, `turn.threadId`). Events without a thread ID are emitted globally, which means any event routing bug could cause events to be lost or delivered to the wrong thread.
- Safe modification: Add logging for unrecognized methods and events that fail thread ID extraction.
- Test coverage: None.

## Scaling Limits

**In-memory session caches:**
- Current capacity: `sessionByThread`, `cwdByThread`, `gitBranchByThread`, `loadedThreadConfig` Maps grow without bound.
- Limit: With hundreds of threads opened in a single session, memory usage grows proportionally. No eviction.
- Scaling path: Add an LRU eviction policy or rely solely on SQLite reads with a small cache.

**Dev events circular buffer:**
- Current capacity: 500 events in memory (`MAX_DEV_EVENTS`), plus unbounded SQLite storage via `dev_events` table.
- Limit: The SQLite `dev_events` table has a `devEventsPrune()` function but it is not called automatically on any schedule.
- Scaling path: Add periodic pruning (e.g., on app startup or after every N inserts).

## Dependencies at Risk

**assistant-ui v0.12 unstable APIs:**
- Risk: Heavy dependence on `unstable_` prefixed APIs that may change without semver guarantees.
- Impact: A minor version bump could break thread list management, history persistence, and thread ID resolution.
- Migration plan: Pin version. Track the assistant-ui changelog. When stable APIs ship, migrate promptly.

**Bun sidecar compilation:**
- Risk: `bun --compile` creates a platform-specific binary that must be rebuilt for each target triple. The compiled binary's virtual FS (`/$bunfs/root/`) breaks libraries that resolve paths at runtime.
- Impact: Build pipeline fragility. The `Bun.which("claude")` workaround in `sidecar/agent-sdk-bridge/index.ts` (line 28) is necessary specifically because of this issue.
- Migration plan: If Bun's compile behavior changes, this workaround may need updating. Consider moving the sidecar to a Rust-native implementation or using Node.js with `pkg`.

## Missing Critical Features

**No attachment support:**
- Problem: `RuntimeProvider.tsx` does not pass an `adapters.attachments` to the runtime, so file attachments are non-functional despite UI components being present.
- Blocks: Users cannot share files, images, or code snippets as attachments with the AI.

**No error recovery UI:**
- Problem: When Claude CLI crashes or the sidecar dies, the user sees a generic error. There is no retry button, no session recovery UI, and no clear indication of what went wrong.
- Blocks: Non-technical users cannot recover from transient failures without restarting the app.

**No conversation export/import:**
- Problem: Thread data is locked in SQLite with no export mechanism.
- Blocks: Users cannot share conversations, back up important threads, or migrate data between machines.

## Test Coverage Gaps

**Zero automated tests:**
- What's not tested: The entire codebase has no test files outside of `node_modules`. No unit tests, no integration tests, no end-to-end tests.
- Files: Every file in `src/lib/` and `src/components/`
- Risk: Any refactoring or feature addition could introduce regressions that go unnoticed until manual testing or user reports. The stream accumulator logic, session retry loop, database operations, and adapter routing are all complex enough to warrant dedicated test suites.
- Priority: High -- particularly for `src/lib/claude-adapter.ts` (stream processing, session management), `src/lib/db.ts` (data integrity), and `src/lib/router-adapter.ts` (adapter selection logic).

---

*Concerns audit: 2026-03-05*

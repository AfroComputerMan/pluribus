# Gotchas & Pitfalls for Developers

## Stream Protocol: The Double-Envelope Problem

Claude CLI's `--output-format stream-json` emits two kinds of JSON on stdout:
1. **Top-level events** — `{ "type": "system" | "assistant" | "result", ... }`
2. **Envelope-wrapped events** — `{ "type": "stream_event", "event": { "type": "content_block_start|delta|stop", ... } }`

The adapter must **unwrap** `stream_event` envelopes before processing. The `unwrapStreamEvent()` function handles this. If you see `type: "stream_event"` in raw dev events, it's the envelope — the inner `.event` is the actual content block event.

**Gotcha:** New event types from Claude CLI may arrive as enveloped OR top-level. Always check both paths.

## Scope Hierarchy: Tool Results Are Nested

Content blocks arrive with a `parent_tool_use_id` field. When Claude CLI executes a tool (e.g., Bash), the tool's output arrives as content blocks scoped to that tool call's ID. The adapter tracks this via `scopeId`:
- Root scope (`""`) = top-level assistant messages
- Tool scope (`"toolu_xxx"`) = content emitted during a tool execution

**Gotcha:** Tool results can arrive **before** the corresponding `content_block_start` for the `tool_use`. The adapter buffers these in `pendingToolResultByCallId` and resolves them when the tool_use block is declared.

## Thread Locking: No Concurrent Runs Per Thread

The FIFO waiter queue (`pendingThreadRunWaiters`) ensures only one Claude CLI process runs per thread at a time. If a second `run()` call comes in while the first is still streaming:
1. The second caller **blocks** (await on a Promise)
2. When the first finishes, the second is released (FIFO order)
3. After 60s, a blocked waiter **times out** and throws

**Gotcha:** If an abort signal fires but the child process doesn't exit cleanly, the lock may be held longer than expected. Always handle `releaseThreadRunLock()` in a `finally` block.

## Session Stale Detection

The adapter parses stderr and result events for the string `"No conversation found"`. This triggers a stale session recovery:
1. Mark session as `stale` in SQLite
2. Clear the in-memory session mapping
3. Retry with a fresh session (no `--resume`)

**Gotcha:** The string match is fragile — if Claude CLI changes this error message, stale detection breaks silently and sessions will fail without recovery.

## NDJSON Line Buffering

Tauri's shell plugin delivers stdout in **chunks**, not lines. The adapter must manually buffer partial lines:
```
stdoutLineBuffer += chunk
split on "\n"
last element may be incomplete → keep in buffer
```

**Gotcha:** A single JSON event can span multiple chunks, and a single chunk can contain multiple events. Always handle the incomplete-last-line case.

## Branch Checkout Race Conditions

The adapter calls `ensureBranchCheckedOut()` before spawning Claude CLI. If two threads target the same `cwd` but different branches, they could race on `git checkout`. The thread lock prevents this **within** a single thread, but **cross-thread** races on the same cwd are not prevented.

## Title Generation Is Fire-and-Forget

`prefetchTitle()` spawns a separate Claude CLI call (using Haiku model) to generate a thread title. This runs concurrently and independently — if it fails, the title silently falls back to a truncated first message. The title callback system (`onTitleReady`) means the title may appear mid-conversation, causing a UI update.

## Dev Event Archival Is Lossy

Events are queued for SQLite batch insert (50 events or 200ms). If the app crashes between queue and flush, those events are lost. The in-memory circular buffer (500 max) is the primary real-time source; SQLite archival is best-effort for historical analysis.

## Message Serialization: JSON-in-JSON

Messages in SQLite store their `content`, `status`, `metadata`, and `run_config` as **JSON-stringified text columns**. When reading, these must be `JSON.parse()`'d. This is a common source of bugs when the serialization format changes — old messages may have different content part structures than new ones.

## Environment Variables as IPC

The shell wrapper uses env vars (`CLAUDE_PROMPT`, `CLAUDE_SESSION_ID`, `CLAUDE_MODE`) to pass data to the subprocess. This avoids shell injection but has a **size limit** — extremely long prompts may exceed the OS env var limit (typically 128KB on Linux, 32KB on macOS). No truncation or error handling exists for this edge case.

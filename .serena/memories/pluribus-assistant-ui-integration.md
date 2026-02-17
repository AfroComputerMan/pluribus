# assistant-ui Integration Patterns

## Framework Version & Key Concepts

Using **assistant-ui v0.12.9** — a primitives-based React chat framework. Key concepts:

### Runtime Layer (invisible)
- `useLocalRuntime(adapter)` — creates a runtime from a `ChatModelAdapter`
- `useRemoteThreadListRuntime(runtimeHook, threadListAdapter)` — wraps the local runtime with server-side thread management
- The runtime manages message state, streaming state, and thread lifecycle

### Adapter Interfaces (our implementation)
- **`ChatModelAdapter`** — must implement `async *run({messages, abortSignal})` that yields `ChatModelRunResult`
- **`RemoteThreadListAdapter`** — must implement `list`, `initialize`, `rename`, `archive`, `unarchive`, `delete`, `fetch`, `generateTitle`
- **`ThreadHistoryAdapter`** — must implement `load(threadId)` and `append(threadId, message)`

### Primitive Components (UI)
- `ThreadPrimitive.Root/Viewport/Messages/ScrollToBottom` — chat container
- `MessagePrimitive.Root/Content/InProgress` — individual messages
- `ComposerPrimitive.Root/Input/Send/Cancel` — input area
- `ThreadListPrimitive.Root/Items/Item/New` — thread sidebar

### What's Standard vs Custom

**Standard (from assistant-ui):**
- Runtime creation and thread lifecycle
- Message rendering pipeline (content parts → components)
- Composer input handling and send/cancel
- Thread list rendering and switching
- `makeAssistantToolUI()` for registering custom tool components

**Custom (Pluribus-specific):**
- `claude-adapter.ts` — ChatModelAdapter implementation (the whole CLI bridge)
- `sqlite-thread-list-adapter.ts` — RemoteThreadListAdapter backed by SQLite
- `sqlite-thread-history-adapter.tsx` — ThreadHistoryAdapter for SQLite persistence
- Tool display components — custom renderers for Claude CLI tools (Read, Write, Edit, Bash, etc.)
- WorkspacePicker — custom workspace assignment UI within thread
- DevPanel — custom telemetry viewer

### Content Part Types

assistant-ui expects content parts with specific types:
- `{ type: "text", text: string }` — rendered as markdown
- `{ type: "reasoning", text: string }` — rendered as collapsible thinking block
- `{ type: "tool-call", toolCallId, toolName, argsStringified, result }` — rendered via registered tool UIs

The adapter's `buildContentFromAccumulators()` maps Claude CLI's block types to these.

### Tool UI Registration

Custom tool UIs are registered via `makeAssistantToolUI({ toolName, render })`. Each tool component receives:
- `args` — parsed tool arguments
- `result` — tool execution result (may be undefined while running)
- `status` — "requires-action" | "running" | "complete"

## Key Integration Gotchas

1. **Runtime hook must be stable** — `useRemoteThreadListRuntime` calls the `runtimeHook` function to create per-thread runtimes. If this function's identity changes, all threads remount.

2. **Thread switching** — The old approach used `key={activeThread.id}` which destroyed the runtime. The `RemoteThreadListAdapter` approach lets the framework handle switching internally.

3. **Content part ordering matters** — assistant-ui renders parts in array order. The adapter must maintain consistent ordering across incremental yields. Reordering causes UI flicker.

4. **Abort signal cleanup** — When the user clicks "Stop", assistant-ui's abort signal fires. The adapter must clean up the child process AND release the thread lock. Missing cleanup = zombie processes or deadlocked threads.

5. **`unstable_threadId`** — The runtime passes the thread ID via `options.unstable_threadId`. The "unstable_" prefix means this API may change in future versions.

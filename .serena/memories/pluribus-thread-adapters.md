# Thread List & History Adapters

## SQLite Thread List Adapter — sqlite-thread-list-adapter.ts (163 lines)
Implements RemoteThreadListAdapter for assistant-ui.
- list/initialize/rename/archive/unarchive/delete/fetch
- Title generation: concurrent Haiku-based via Claude CLI, event channel for mid-stream updates, fallback to first message
- Pending thread options: setPendingThreadOptions() stores cwd/workspaceId/gitBranch before creation

## SQLite Thread History Adapter — sqlite-thread-history-adapter.tsx (108 lines)
- load(threadId), append(threadId, message), deleteAll(threadId)
- Converts between assistant-ui message format and SQLite rows

## Dev Event Batcher — dev-event-batcher.ts (36 lines)
- Accumulates events, flushes via db.devEvents.insertBatch()

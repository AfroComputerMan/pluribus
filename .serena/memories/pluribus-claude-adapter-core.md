# Claude Adapter (claude-adapter.ts) — Core Logic

## Location: `src/lib/claude-adapter.ts` (~1,354 lines)
The most important file in the project. Implements `ChatModelAdapter` from assistant-ui.

## Major Sections

### 1. Type Definitions (lines 1-165)
- `ClaudeStreamEvent` union type: system | assistant | result | content_block_start/delta/stop
- `ClaudeDevEvent` / `ClaudeDevSnapshot`: dev panel event tracking
- `ContentBlockAccumulator` interface: incremental state for text/thinking/tool_use blocks

### 2. Module-Level State (lines 166-245)
- `sessionByThread: Map<string, string>` — thread→sessionId mapping
- `sessionRecords: Map<string, SessionRecord>` — detailed session metadata
- `activeThreadRuns: Set<string>` — thread lock tracking
- `pendingThreadRunWaiters: Map<string, Array<{resolve, timeout}>>` — FIFO waiter queue
- `cwdByThread / gitBranchByThread` — per-thread config
- `activeChildByThread: Map<string, Child>` — active CLI processes
- `devEventsRing: ClaudeDevEvent[]` — circular buffer (500 max)

### 3. Session Management (lines 246-370)
- get/set/clearSessionForThread() — CRUD on sessionByThread
- upsertSessionRecord() — write-through to SQLite
- hydrateSessionCache() — load from SQLite on demand

### 4. Dev Event System (lines 371-445)
- Circular buffer with version tracking
- Categories: hooks, mcp, commands, skills, usage, messages, other
- useSyncExternalStore-compatible subscription

### 5. Thread Locking (lines 446-482)
- FIFO waiter queue with 60s timeout

### 6. Data Extraction (lines 483-862)
- extractUserPrompt(), chooseSessionStrategy(), processStreamEvent(), buildContentFromAccumulators()

### 7. Streaming (lines 862-960)
- spawnClaudeStreaming() — async generator bridging Tauri callbacks

### 8. Main Adapter (lines 960-end)
- createClaudeAdapter() with retry loop (up to 3), throttled yields (~60fps), hot reload cleanup

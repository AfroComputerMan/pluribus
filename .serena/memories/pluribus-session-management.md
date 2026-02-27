# Session Management System

## In-Memory State
- `sessionByThread: Map<string, string>` — threadKey→sessionId
- `sessionRecords: Map<string, SessionRecord>` — metadata per thread

## Session Statuses
unknown | resume_ok | stale | in_use | session_id_ok | fallback_new | error

## Strategy Cascade
1. **Resume**: sessionId exists, cache present, not stale → `--resume <id>`
2. **Session-ID**: sessionId exists, cache missing/stale → `--session-id <id>`
3. **Fresh**: no sessionId → no flags

## Retry Logic (max 3 attempts)
- Missing conversation during resume → mark stale, clear, retry fresh
- Missing conversation during session-id → clear, retry fresh
- Session in use → clear, retry fresh
- Non-zero exit (not recoverable) → throw

## Thread Locking
- activeThreadRuns Set + pendingThreadRunWaiters FIFO queue
- 60-second timeout protection
- Prevents concurrent CLI invocations per thread

## Persistence
- SQLite sessions table via upsertSessionRecord() (write-through)
- hydrateSessionCache() loads on first access per thread

# Pattern: Tauri Command DB Sync

**Category**: Command Reliability  
**Problem**: In-memory state updates without DB writes cause restart drift.  
**Solution**: Persist metadata changes in the same command handler that mutates runtime state.

## Apply To

- runtime-created sessions (`send_message` path)
- session identifiers returned by CLI (`claude_session_id`)
- status transitions that must survive restart
- process lifecycle transitions (`running`, `paused`, `killed`, `completed`, `failed`)

## Rules

1. Update memory state for immediate UX.
2. Persist to SQLite in the same handler call.
3. Add tests for idempotency and row update correctness.

## Reference

- `src-tauri/src/commands/chat.rs`

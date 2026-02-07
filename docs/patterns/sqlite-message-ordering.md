# Pattern: SQLite Message Ordering

**Category**: Chat Persistence  
**Problem**: Message history can become unstable if insertion order is implicit.  
**Solution**: Assign `order_index` at write time using `MAX(order_index)+1` scoped by `session_id`.

## Rules

1. Persist user message before process send/spawn.
2. Compute `order_index` with a session-scoped query.
3. Render/reload history ordered by `order_index ASC`.

## Reference

- `src-tauri/src/commands/chat.rs`

# Pattern: Tauri State Hydration From SQLite

**Category**: Desktop Backend Reliability  
**Problem**: Tauri in-memory state is empty on restart, causing `get/list` commands to return no sessions even though DB rows exist.  
**Solution**: Treat in-memory maps as cache and hydrate from SQLite on cache miss.

## Rules

1. `get_*` commands:
   - check in-memory first
   - fallback to DB lookup
   - repopulate cache when found
2. `list_*` commands:
   - return in-memory when non-empty
   - otherwise load all rows from DB and repopulate cache
3. Keep a small parser for string enum columns (e.g. session status) with safe defaults.

## Why

- preserves behavior across app restarts
- avoids frontend special-casing for startup state
- keeps command handlers deterministic

## Reference

- `src-tauri/src/commands/chat.rs`

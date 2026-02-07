# Pattern: Tauri IPC Contract Testing

**Category**: Desktop Integration  
**Problem**: Frontend `invoke()` payloads silently drift from Rust command signatures.  
**Solution**: Add a small payload-builder function and test it first.

## How

1. Create a typed input object in frontend IPC layer.
2. Add a pure builder function that returns the exact invoke argument shape.
3. Write a unit test for the builder before wiring UI/hooks.
4. Use the builder inside `invoke()` calls.

## Why

- Catches shape mismatches early (`sessionId` vs `session_id`, missing required args).
- Keeps UI wiring simple and avoids debugging at runtime.
- Works without launching the full Tauri app.

## Current Reference

- `src/ipc/commands.ts`
- `src/ipc/commands.test.ts`

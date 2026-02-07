# Pattern: Rust-Frontend Contract Fidelity

**Category**: IPC/Data Modeling  
**Problem**: UI loses important fields (like `name`) when Rust structs and frontend types drift.  
**Solution**: Treat serialized Rust structs as API contracts and add tests for critical fields.

## Practices

1. Add/rename fields in Rust structs deliberately (`SessionHandle` etc.).
2. Update DB hydration queries at the same time as struct changes.
3. Add/extend tests that assert user-visible fields are preserved.
4. Keep frontend normalizers for compatibility, but prefer correct Rust payloads first.

## Reference

- `src-tauri/src/state.rs`
- `src-tauri/src/commands/chat.rs`
- `src/ipc/commands.ts`

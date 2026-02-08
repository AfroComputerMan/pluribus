# Desktop Rust Code Patterns

## Patterns Established (2026-02-08 Rust Audit)

### 1. AppState::with_db() Helper
- Use `state.with_db(|db| { ... })` for all database access
- Eliminates repeated lock+unwrap boilerplate (was 4 lines per call, now 1)
- Handles lock acquisition and error propagation

### 2. SessionStatus::as_str() / ::parse()
- All status string conversion goes through enum methods
- No standalone parse functions or scattered match blocks
- Consistent format for DB persistence

### 3. Shared Row Mappers
- `session_row_mapper()` and `project_row_mapper()` extract row→struct logic
- Eliminates per-column .map_err() duplication
- Used by both single-row and multi-row queries

### 4. Dead Code Policy
- Remove unused transition methods even if they seem "useful later"
- The 5 `transition_to_*` methods and 7 tests were never called — removed -138 LOC
- Keep utility methods that ARE used (can_resume, is_active, is_terminal)

### 5. Safety Rules
- No unwrap() in production command handlers — use if let Ok(...) or ?
- Process group kill: SIGTERM to -pid (not just pid)
- setsid() creates new process group on spawn
- No locks held across .await points
- All lock acquisitions handle poison

### 6. Rust LOC Target
- Current: ~2000 production LOC + ~430 test LOC
- Original target (<1000) was unrealistic given DB hydration + process management
- Realistic target: <1500 production LOC after Phase 2-5 consolidation

### 7. Idiomatic Patterns
- Use .collect::<Result<Vec<_>, _>>() instead of manual push loops
- Use &str over String where lifetimes allow
- Use ? chains instead of nested match

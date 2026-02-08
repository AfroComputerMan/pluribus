# Desktop Database Patterns

## SQLite Schema (7 tables)

All table definitions exist in 3 locations that must be kept in sync:
1. `src/db/tauri-schema.ts` -- Drizzle ORM definitions (TypeScript)
2. `src/db/tauri-migrations.ts` -- Raw SQL migrations (TypeScript)
3. `src-tauri/src/state.rs` -- `AppState::init_db` CREATE TABLE statements (Rust)

## Critical Pragmas

Set in `init_db` (Rust) and `runMigrations` (TypeScript):
- `PRAGMA journal_mode=WAL` -- enables concurrent reads during writes
- `PRAGMA foreign_keys = ON` -- **required** for `REFERENCES` / `ON DELETE CASCADE` to work; SQLite defaults to OFF

## Indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_sessions_project` | sessions | project_id | Filter sessions by project |
| `idx_sessions_status` | sessions | status | Filter by status |
| `idx_messages_session_order` | messages | session_id, order_index | Message ordering within session |
| `idx_tasks_team` | tasks | team_id | Team-scoped task queries |
| `idx_usage_records_session` | usage_records | session_id | Cost aggregation per session |

## Timestamp Format

All timestamps use `YYYY-MM-DD HH:MM:SS` UTC format (matching SQLite's `datetime('now')`).
Rust code uses `utc_datetime_now()` from `state.rs` for consistent formatting.
Never use epoch seconds for `created_at` or similar columns.

## Query Patterns

- All SQL uses parameterized statements (`?1`, `?2` with `rusqlite::params![]`)
- No string concatenation in SQL anywhere
- `AppState::with_db()` helper provides ergonomic DB access with proper error handling
- Row mappers (`session_row_mapper`, `project_row_mapper`) centralize result parsing

## Migration System

- Version-tracked via `_migrations` table
- Migrations are additive DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
- No transaction wrapping -- partial failure leaves DB in inconsistent state (acceptable risk for IF NOT EXISTS DDL)
- No rollback support

## Data Access Pattern

- SQLite is the source of truth for persistence
- In-memory `AppState.sessions` HashMap is a cache
- `list_sessions_inner` always queries DB, then updates cache
- Individual session lookups check cache first, fall back to DB on miss

## Foreign Key Cascades

- `sessions.project_id` -> `projects.id` (CASCADE)
- `messages.session_id` -> `sessions.id` (CASCADE)
- `tasks.team_id` -> `teams.id` (CASCADE)
- `usage_records.session_id` -> `sessions.id` (CASCADE)
- `teams.project_id` -> `projects.id` (no cascade -- deliberate)

# Database Layer (db.ts)

## Location: `src/lib/db.ts` (~723 lines)
Connection: `sqlite:pluribus.db` via @tauri-apps/plugin-sql. Singleton. 4 migrations.

## Tables
- **threads** — id, title, status, session_id, cwd, workspace_id, git_branch, dev_panel_open, timestamps
- **workspaces** — id, name, cwd, timestamps. Deduplicated by cwd.
- **messages** — id, thread_id (FK), parent_id (branching), role, content, status, metadata/run_config (JSON), created_at
- **sessions** — thread_id (PK), session_id, status, local_cache, strategy, last_checked_at, last_error
- **dev_events** — id, thread_id, seq, category, raw (JSON), created_at
- **mcp_snapshots** — id, thread_id, session_id, servers/tools/skills/etc (JSON), captured_at
- **mcp_invocations** — id, thread_id (FK CASCADE), tool_name, server_name, tokens, cost, duration, success, error
- **usage_snapshots** — id, thread_id, session_id, tokens, cost, model_id, context_window, captured_at

## Query Namespaces
- db.threads — list, get, create, rename, archive/unarchive, delete, updateSessionId/Cwd/Workspace/GitBranch
- db.workspaces — list, get, getByCwd, create, rename
- db.messages — loadByThread, append (idempotent), deleteByThread
- db.sessions — get, upsert, delete
- db.devEvents — insertBatch, queryByThread/Category, count, prune
- db.mcpSnapshots — insert, getByThread, getLatest
- db.mcpInvocations — insert (lazy table creation), getByThread, getByTool
- db.usageSnapshots — insert, getByThread, getLatest

## Patterns: No ORM, parameterized SQL, ISO timestamps, ON CONFLICT upserts, batch inserts

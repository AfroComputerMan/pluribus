CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  cwd         TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_workspaces_name ON workspaces(name COLLATE NOCASE);

ALTER TABLE threads
ADD COLUMN workspace_id TEXT;

ALTER TABLE threads
ADD COLUMN git_branch TEXT;

INSERT OR IGNORE INTO workspaces (id, name, cwd, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),
  trim(cwd),
  trim(cwd),
  strftime('%Y-%m-%dT%H:%M:%f', 'now'),
  strftime('%Y-%m-%dT%H:%M:%f', 'now')
FROM threads
WHERE cwd IS NOT NULL AND trim(cwd) <> '';

UPDATE threads
SET workspace_id = (
  SELECT w.id FROM workspaces w WHERE w.cwd = trim(threads.cwd) LIMIT 1
)
WHERE workspace_id IS NULL AND cwd IS NOT NULL AND trim(cwd) <> '';

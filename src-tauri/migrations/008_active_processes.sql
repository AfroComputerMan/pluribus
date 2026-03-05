CREATE TABLE IF NOT EXISTS active_processes (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  pid         INTEGER NOT NULL,
  thread_id   TEXT,
  spawned_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_active_processes_provider ON active_processes(provider);

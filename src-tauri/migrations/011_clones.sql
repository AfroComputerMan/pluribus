CREATE TABLE IF NOT EXISTS clones (
  clone_id         TEXT PRIMARY KEY,
  thread_id        TEXT,
  source_repo_path TEXT NOT NULL,
  clone_dir        TEXT NOT NULL,
  base_sha         TEXT NOT NULL,
  agent_branch     TEXT NOT NULL,
  container_id     TEXT,
  status           TEXT NOT NULL DEFAULT 'active',  -- active|merged|discarded
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now'))
);
CREATE INDEX IF NOT EXISTS idx_clones_thread_id ON clones(thread_id);
CREATE INDEX IF NOT EXISTS idx_clones_status    ON clones(status);

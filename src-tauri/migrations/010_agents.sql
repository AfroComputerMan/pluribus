CREATE TABLE IF NOT EXISTS agents (
  agent_id        TEXT PRIMARY KEY,
  session_id      TEXT,
  thread_id       TEXT,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running', -- running|completed|error
  current_turn_id TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now')),
  exited_at       TEXT,
  exit_code       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agents_thread_id ON agents(thread_id);
CREATE INDEX IF NOT EXISTS idx_agents_status    ON agents(status);

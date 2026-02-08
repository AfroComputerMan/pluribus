CREATE TABLE IF NOT EXISTS mcp_invocations (
  id              TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL,
  session_id      TEXT,
  tool_name       TEXT NOT NULL,
  server_name     TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cost_usd        REAL,
  duration_ms     INTEGER,
  success         INTEGER NOT NULL DEFAULT 1,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_invocations_thread ON mcp_invocations(thread_id);
CREATE INDEX IF NOT EXISTS idx_mcp_invocations_tool ON mcp_invocations(tool_name);

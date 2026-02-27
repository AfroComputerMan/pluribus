CREATE TABLE IF NOT EXISTS config_overrides (
  id        INTEGER PRIMARY KEY,
  scope_type TEXT    NOT NULL CHECK (scope_type IN ('workspace', 'thread')),
  scope_id   TEXT    NOT NULL,
  item_type  TEXT    NOT NULL CHECK (item_type IN ('mcp_server', 'skill', 'permission', 'command')),
  item_name  TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(scope_type, scope_id, item_type, item_name)
);

CREATE INDEX idx_config_overrides_scope
  ON config_overrides (scope_type, scope_id);

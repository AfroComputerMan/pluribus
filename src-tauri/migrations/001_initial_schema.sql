-- Enable WAL mode for better concurrent read/write performance
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

------------------------------------------------------------
-- threads: Thread metadata (drives RemoteThreadListAdapter)
------------------------------------------------------------
CREATE TABLE threads (
  id          TEXT PRIMARY KEY,              -- assistant-ui thread ID (UUID)
  remote_id   TEXT UNIQUE,                   -- ID returned by initialize() — same as id for us
  title       TEXT,                          -- Thread title (nullable, set by generateTitle)
  status      TEXT NOT NULL DEFAULT 'regular' CHECK (status IN ('regular', 'archived')),
  session_id  TEXT,                          -- Claude CLI session ID (nullable)
  cwd         TEXT,                          -- Working directory for this thread
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);

CREATE INDEX idx_threads_status ON threads(status);
CREATE INDEX idx_threads_updated ON threads(updated_at DESC);

------------------------------------------------------------
-- messages: Conversation messages (drives ThreadHistoryAdapter)
------------------------------------------------------------
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,              -- ThreadMessage.id
  thread_id   TEXT NOT NULL,                 -- FK → threads.id
  parent_id   TEXT,                          -- Parent message ID (branching support)
  role        TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content     TEXT NOT NULL,                 -- JSON: ThreadMessage.content array
  status      TEXT,                          -- JSON: MessageStatus (for assistant messages)
  metadata    TEXT,                          -- JSON: ThreadMessage.metadata
  run_config  TEXT,                          -- JSON: RunConfig
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_parent ON messages(parent_id);

------------------------------------------------------------
-- sessions: Claude CLI session records
------------------------------------------------------------
CREATE TABLE sessions (
  thread_id       TEXT NOT NULL,             -- FK → threads.id (or threadKey)
  session_id      TEXT NOT NULL,             -- Claude CLI session ID
  status          TEXT NOT NULL DEFAULT 'unknown',
  local_cache     TEXT NOT NULL DEFAULT 'unknown',
  strategy        TEXT NOT NULL DEFAULT 'none',
  last_checked_at TEXT,                      -- ISO timestamp
  last_updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  last_error      TEXT,

  PRIMARY KEY (thread_id),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

------------------------------------------------------------
-- dev_events: Archived dev events from Claude CLI stream
------------------------------------------------------------
CREATE TABLE dev_events (
  id          TEXT PRIMARY KEY,              -- Same ID format as in-memory events
  thread_id   TEXT NOT NULL,                 -- Thread that generated this event
  seq         INTEGER NOT NULL,              -- Monotonic sequence number
  category    TEXT NOT NULL,                 -- hooks|mcp|commands|skills|usage|messages|other
  raw         TEXT NOT NULL,                 -- Raw JSON line from Claude CLI
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_dev_events_thread ON dev_events(thread_id);
CREATE INDEX idx_dev_events_category ON dev_events(category);
CREATE INDEX idx_dev_events_created ON dev_events(created_at DESC);

------------------------------------------------------------
-- mcp_snapshots: Per-session MCP server/tool state
------------------------------------------------------------
CREATE TABLE mcp_snapshots (
  id          TEXT PRIMARY KEY,              -- Generated UUID
  thread_id   TEXT NOT NULL,                 -- FK → threads.id
  session_id  TEXT,                          -- Claude CLI session ID at capture time
  servers     TEXT NOT NULL,                 -- JSON: Array<{ name, status }>
  tools       TEXT NOT NULL,                 -- JSON: string[] (all tool names)
  mcp_tools   TEXT NOT NULL,                 -- JSON: string[] (only mcp__* prefixed)
  builtin_tools TEXT NOT NULL,               -- JSON: string[] (non-mcp tools)
  skills      TEXT,                          -- JSON: string[] (skills available)
  slash_commands TEXT,                       -- JSON: string[] (slash commands available)
  captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_mcp_snapshots_thread ON mcp_snapshots(thread_id);

------------------------------------------------------------
-- mcp_invocations: Per-call MCP tool telemetry
------------------------------------------------------------
CREATE TABLE mcp_invocations (
  id              TEXT PRIMARY KEY,          -- Generated UUID
  thread_id       TEXT NOT NULL,             -- FK → threads.id
  session_id      TEXT,                      -- Claude CLI session at invocation time
  tool_name       TEXT NOT NULL,             -- Full tool name (e.g. "mcp__slack__read_channel")
  server_name     TEXT,                      -- Extracted MCP server name (e.g. "slack")
  input_tokens    INTEGER,                   -- Token cost of tool input
  output_tokens   INTEGER,                   -- Token cost of tool output
  cost_usd        REAL,                      -- USD cost (if available)
  duration_ms     INTEGER,                   -- Execution duration (if available)
  success         INTEGER NOT NULL DEFAULT 1, -- 1=success, 0=error
  error           TEXT,                      -- Error message if failed
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_mcp_invocations_thread ON mcp_invocations(thread_id);
CREATE INDEX idx_mcp_invocations_tool ON mcp_invocations(tool_name);

------------------------------------------------------------
-- usage_snapshots: Context window utilization tracking
------------------------------------------------------------
CREATE TABLE usage_snapshots (
  id                          TEXT PRIMARY KEY,
  thread_id                   TEXT NOT NULL,
  session_id                  TEXT,
  input_tokens                INTEGER,
  output_tokens               INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens     INTEGER,
  total_cost_usd              REAL,
  model_id                    TEXT,          -- Which model was used (if available)
  context_window              INTEGER,       -- Context window size (if available)
  captured_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),

  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_usage_snapshots_thread ON usage_snapshots(thread_id);

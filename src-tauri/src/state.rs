use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tokio::process::{Child, ChildStdin};

/// Application-wide state managed by Tauri
#[derive(Debug)]
pub struct AppState {
    /// Active chat sessions by session ID
    pub sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
    /// Active Claude Code processes by session ID
    pub processes: Arc<Mutex<HashMap<String, ProcessHandle>>>,
    /// SQLite database connection for Drizzle proxy
    pub db: Arc<Mutex<Option<rusqlite::Connection>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            processes: Arc::new(Mutex::new(HashMap::new())),
            db: Arc::new(Mutex::new(None)),
        }
    }
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Initialize the SQLite database connection and create tables
    pub fn init_db(&self, db_path: &str) -> Result<(), String> {
        let conn = rusqlite::Connection::open(db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

        // Create tables if they don't exist (matches tauri-schema.ts)
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                default_model TEXT DEFAULT 'sonnet',
                default_autonomy TEXT DEFAULT 'supervised',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'created',
                claude_session_id TEXT,
                model TEXT NOT NULL DEFAULT 'sonnet',
                autonomy_level TEXT DEFAULT 'supervised',
                worktree_path TEXT,
                worktree_branch TEXT,
                allowed_tools TEXT,
                system_prompt_append TEXT,
                max_turns INTEGER,
                max_budget_usd REAL,
                total_cost_usd REAL DEFAULT 0,
                total_input_tokens INTEGER DEFAULT 0,
                total_output_tokens INTEGER DEFAULT 0,
                turn_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                content_type TEXT DEFAULT 'text',
                tool_name TEXT,
                tool_input TEXT,
                tool_use_id TEXT,
                is_error INTEGER DEFAULT 0,
                model TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER,
                cost_usd REAL,
                order_index INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_messages_session_order ON messages(session_id, order_index);

            CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY,
                project_id TEXT REFERENCES projects(id),
                name TEXT NOT NULL,
                status TEXT DEFAULT 'idle',
                claude_team_dir TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                assigned_agent TEXT,
                dependencies TEXT,
                file_path TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS usage_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                model TEXT NOT NULL,
                input_tokens INTEGER NOT NULL,
                output_tokens INTEGER NOT NULL,
                cost_usd REAL NOT NULL,
                timestamp TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );"
        ).map_err(|e| format!("Failed to create tables: {}", e))?;

        let mut db = self.db.lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;
        *db = Some(conn);

        Ok(())
    }
}

/// Session lifecycle status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Created,
    Running,
    Completed,
    Failed,
    Killed,
    Paused,
}

/// Process status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessStatus {
    Spawning,
    Running,
    Exited(i32),
    Killed,
}

/// Handle to an active session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHandle {
    pub id: String,
    pub status: SessionStatus,
    pub claude_session_id: Option<String>,
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub model: String,
    pub autonomy_level: String,
    pub created_at: String,
}

impl SessionHandle {
    pub fn new(
        id: String,
        project_path: String,
        worktree_path: Option<String>,
        model: String,
        autonomy_level: String,
    ) -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        Self {
            id,
            status: SessionStatus::Created,
            claude_session_id: None,
            project_path,
            worktree_path,
            model,
            autonomy_level,
            created_at: timestamp.to_string(),
        }
    }
}

/// Handle to an active Claude Code process
#[derive(Debug)]
pub struct ProcessHandle {
    pub session_id: String,
    pub child: Option<Child>,
    pub pid: Option<u32>,
    pub stdin_writer: Option<ChildStdin>,
    pub status: ProcessStatus,
}

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Application-wide state managed by Tauri
#[derive(Debug, Default)]
pub struct AppState {
    /// Active chat sessions by session ID
    pub sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
    /// Active Claude Code processes by session ID
    pub processes: Arc<Mutex<HashMap<String, ProcessHandle>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Handle to an active session
#[derive(Debug, Clone)]
pub struct SessionHandle {
    pub id: String,
    pub worktree_id: String,
    pub team_id: Option<String>,
}

/// Handle to an active Claude Code process
#[derive(Debug)]
pub struct ProcessHandle {
    pub session_id: String,
    pub pid: Option<u32>,
}

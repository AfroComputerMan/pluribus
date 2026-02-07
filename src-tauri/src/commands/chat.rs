/// Chat-related Tauri commands for managing Claude CLI sessions

use crate::error::AppError;
use crate::process::{abort_session as abort_session_impl, send_to_stdin, spawn_session, SpawnConfig};
use crate::state::{AppState, SessionHandle, SessionStatus};
use tauri::State;

/// Information about Claude CLI installation
#[derive(Debug, serde::Serialize)]
pub struct CliInfo {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

/// Check if Claude CLI is installed and accessible
#[tauri::command]
pub async fn check_claude_cli() -> Result<CliInfo, AppError> {
    use tokio::process::Command;

    let output = Command::new("which")
        .arg("claude")
        .output()
        .await;

    match output {
        Ok(out) if out.status.success() => {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();

            // Try to get version
            let version_output = Command::new("claude")
                .arg("--version")
                .output()
                .await;

            let version = version_output
                .ok()
                .and_then(|v| {
                    if v.status.success() {
                        Some(String::from_utf8_lossy(&v.stdout).trim().to_string())
                    } else {
                        None
                    }
                });

            Ok(CliInfo {
                available: true,
                version,
                path: Some(path),
            })
        }
        _ => Ok(CliInfo {
            available: false,
            version: None,
            path: None,
        }),
    }
}

/// Create a new session and spawn the Claude CLI process
#[tauri::command]
pub async fn send_message(
    state: State<'_, AppState>,
    session_id: String,
    project_path: String,
    worktree_path: Option<String>,
    model: String,
    autonomy_level: String,
    message: String,
    max_turns: Option<u32>,
    allowed_tools: Option<Vec<String>>,
    channel: tauri::ipc::Channel<String>,
) -> Result<(), AppError> {
    // Create or get session
    let session = {
        let mut sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

        if let Some(existing_session) = sessions.get(&session_id) {
            existing_session.clone()
        } else {
            let new_session = SessionHandle::new(
                session_id.clone(),
                format!("Session {}", &session_id[..session_id.len().min(8)]),
                project_path.clone(),
                worktree_path.clone(),
                model.clone(),
                autonomy_level.clone(),
            );
            sessions.insert(session_id.clone(), new_session.clone());
            new_session
        }
    };

    // Check if we need to spawn a new process or use existing
    let needs_spawn = {
        let processes = state.processes.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
        !processes.contains_key(&session_id)
    };

    // Ensure runtime-created sessions are persisted (idempotent).
    upsert_runtime_session_in_db(&state, &session)?;
    persist_user_message_in_db(&state, &session_id, &message)?;

    if needs_spawn {
        // Spawn new process
        let config = SpawnConfig {
            session_id: session_id.clone(),
            project_path,
            worktree_path,
            model: Some(model),
            max_turns,
            resume_session_id: session.claude_session_id.clone(),
            allowed_tools,
            append_system_prompt: Some(message),
        };

        spawn_session(&state, config, channel).await?;
    } else {
        // Send to existing process stdin
        send_to_stdin(&state, &session_id, &message).await?;
    }

    Ok(())
}

/// Abort a running session
#[tauri::command]
pub async fn abort_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), AppError> {
    abort_session_impl(&state, &session_id).await
}

/// Get session status
#[tauri::command]
pub async fn get_session_status(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SessionStatus, AppError> {
    get_session_status_inner(&state, &session_id)
}

/// Get session details
#[tauri::command]
pub async fn get_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SessionHandle, AppError> {
    {
        let sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
        if let Some(session) = sessions.get(&session_id) {
            return Ok(session.clone());
        }
    }

    if let Some(session) = load_session_from_db(&state, &session_id)? {
        let mut sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
        sessions.insert(session_id.clone(), session.clone());
        Ok(session)
    } else {
        Err(AppError::SessionNotFound(session_id))
    }
}

/// List all sessions
#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Vec<SessionHandle>, AppError> {
    {
        let sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
        if !sessions.is_empty() {
            let values = sessions.values().cloned().collect::<Vec<_>>();
            if let Some(ref pid) = project_id {
                return Ok(values.into_iter().filter(|s| s.project_path == *pid).collect());
            }
            return Ok(values);
        }
    }

    let loaded = load_sessions_from_db(&state, project_id.as_deref())?;
    if loaded.is_empty() {
        return Ok(loaded);
    }

    let mut sessions = state.sessions.lock()
        .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
    for session in &loaded {
        sessions.insert(session.id.clone(), session.clone());
    }

    Ok(loaded)
}

/// Pause a running session (Unix only)
#[cfg(unix)]
#[tauri::command]
pub async fn pause_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), AppError> {
    crate::process::pause_session(&state, &session_id).await
}

/// Resume a paused session (Unix only)
#[cfg(unix)]
#[tauri::command]
pub async fn resume_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), AppError> {
    crate::process::resume_session(&state, &session_id).await
}

/// Create a new session (AppState + SQLite row)
#[tauri::command]
pub async fn create_session(
    state: State<'_, AppState>,
    input: serde_json::Value,
) -> Result<SessionHandle, AppError> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let project_id = input.get("projectId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let name = input.get("name").and_then(|v| v.as_str()).unwrap_or("New Session").to_string();
    let model = input.get("model").and_then(|v| v.as_str()).unwrap_or("sonnet").to_string();
    let autonomy_level = input.get("autonomyLevel").and_then(|v| v.as_str()).unwrap_or("supervised").to_string();
    let max_turns = input.get("maxTurns").and_then(|v| v.as_u64()).map(|v| v as i64);
    let max_budget_usd = input.get("maxBudgetUsd").and_then(|v| v.as_f64());
    let system_prompt_append = input.get("systemPromptAppend").and_then(|v| v.as_str()).map(|s| s.to_string());
    let allowed_tools = input.get("allowedTools").map(|v| v.to_string());

    let resolved_project_path = resolve_project_path(&state, &project_id)?;

    let session = SessionHandle::new(
        session_id.clone(),
        name.clone(),
        resolved_project_path,
        None,
        model.clone(),
        autonomy_level.clone(),
    );

    // Insert into AppState
    {
        let mut sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
        sessions.insert(session_id.clone(), session.clone());
    }

    // Insert into SQLite
    {
        let db = state.db.lock()
            .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
        if let Some(db) = db.as_ref() {
            db.execute(
                "INSERT INTO sessions (id, project_id, name, status, model, autonomy_level, max_turns, max_budget_usd, system_prompt_append, allowed_tools) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    &session_id,
                    &project_id,
                    &name,
                    "created",
                    &model,
                    &autonomy_level,
                    max_turns,
                    max_budget_usd,
                    system_prompt_append,
                    allowed_tools,
                ],
            ).map_err(|e| AppError::Database(format!("Failed to insert session: {}", e)))?;
        }
    }

    Ok(session)
}

/// Delete a session (AppState + SQLite + optional worktree cleanup)
#[tauri::command]
pub async fn delete_session(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    // Remove from AppState
    let session = {
        let mut sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
        sessions.remove(&id)
    };

    // Kill process if running
    if state.processes.lock()
        .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?
        .contains_key(&id)
    {
        let _ = crate::process::abort_session(&state, &id).await;
    }

    // Clean up worktree if one was assigned
    if let Some(session) = &session {
        if session.worktree_path.is_some() {
            let _ = crate::worktree::manager::WorktreeManager::remove(
                &session.project_path, &id, true
            ).await;
        }
    }

    // Delete from SQLite
    {
        let db = state.db.lock()
            .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
        if let Some(db) = db.as_ref() {
            db.execute("DELETE FROM sessions WHERE id = ?1", rusqlite::params![&id])
                .map_err(|e| AppError::Database(format!("Failed to delete session: {}", e)))?;
        }
    }

    Ok(())
}

/// Update session's Claude session ID (from SystemMessage)
#[tauri::command]
pub async fn update_claude_session_id(
    state: State<'_, AppState>,
    session_id: String,
    claude_session_id: String,
) -> Result<(), AppError> {
    let mut sessions = state.sessions.lock()
        .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

    let session = sessions.get_mut(&session_id)
        .ok_or_else(|| AppError::SessionNotFound(session_id.clone()))?;

    session.set_claude_session_id(claude_session_id);
    persist_claude_session_id_in_db(&state, &session_id, session.claude_session_id.as_deref().unwrap_or(""))?;
    Ok(())
}

fn parse_session_status(status: &str) -> SessionStatus {
    match status {
        "created" => SessionStatus::Created,
        "running" => SessionStatus::Running,
        "completed" => SessionStatus::Completed,
        "failed" => SessionStatus::Failed,
        "killed" => SessionStatus::Killed,
        "paused" => SessionStatus::Paused,
        _ => SessionStatus::Created,
    }
}

fn get_session_status_inner(state: &AppState, session_id: &str) -> Result<SessionStatus, AppError> {
    {
        let sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
        if let Some(session) = sessions.get(session_id) {
            return Ok(session.status.clone());
        }
    }

    if let Some(session) = load_session_from_db(state, session_id)? {
        let status = session.status.clone();
        let mut sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
        sessions.insert(session_id.to_string(), session);
        Ok(status)
    } else {
        Err(AppError::SessionNotFound(session_id.to_string()))
    }
}

fn upsert_runtime_session_in_db(state: &AppState, session: &SessionHandle) -> Result<(), AppError> {
    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let conn = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    conn.execute(
        "INSERT OR IGNORE INTO sessions (id, project_id, name, status, model, autonomy_level, worktree_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            &session.id,
            &session.project_path,
            &session.name,
            format!("{:?}", session.status).to_lowercase(),
            &session.model,
            &session.autonomy_level,
            &session.worktree_path,
            &session.created_at,
        ],
    ).map_err(|e| AppError::Database(format!("Failed to upsert runtime session: {}", e)))?;

    Ok(())
}

fn persist_claude_session_id_in_db(state: &AppState, session_id: &str, claude_session_id: &str) -> Result<(), AppError> {
    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let conn = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    conn.execute(
        "UPDATE sessions SET claude_session_id = ?1 WHERE id = ?2",
        rusqlite::params![claude_session_id, session_id],
    ).map_err(|e| AppError::Database(format!("Failed to persist claude session id: {}", e)))?;
    Ok(())
}

fn resolve_project_path(state: &AppState, project_id: &str) -> Result<String, AppError> {
    if project_id.is_empty() {
        return Ok(String::new());
    }

    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let conn = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    let maybe_path: Option<String> = conn.query_row(
        "SELECT path FROM projects WHERE id = ?1",
        rusqlite::params![project_id],
        |row| row.get(0),
    ).ok();

    Ok(maybe_path.unwrap_or_else(|| project_id.to_string()))
}

fn persist_user_message_in_db(state: &AppState, session_id: &str, content: &str) -> Result<(), AppError> {
    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let conn = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    let next_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(order_index), -1) + 1 FROM messages WHERE session_id = ?1",
        rusqlite::params![session_id],
        |row| row.get(0),
    ).map_err(|e| AppError::Database(format!("Failed to get next order index: {}", e)))?;

    let message_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, content_type, order_index, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
        rusqlite::params![message_id, session_id, "user", content, "text", next_order],
    ).map_err(|e| AppError::Database(format!("Failed to persist user message: {}", e)))?;

    Ok(())
}

fn load_session_from_db(state: &AppState, session_id: &str) -> Result<Option<SessionHandle>, AppError> {
    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let conn = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    let mut stmt = conn.prepare(
        "SELECT id, name, status, claude_session_id, project_id, worktree_path, model, autonomy_level, created_at
         FROM sessions WHERE id = ?1"
    ).map_err(|e| AppError::Database(format!("Failed to prepare query: {}", e)))?;

    let mut rows = stmt.query(rusqlite::params![session_id])
        .map_err(|e| AppError::Database(format!("Failed to query session: {}", e)))?;

    if let Some(row) = rows.next().map_err(|e| AppError::Database(format!("Failed to read row: {}", e)))? {
        let status_str: String = row.get(2)
            .map_err(|e| AppError::Database(format!("Failed to read status: {}", e)))?;
        Ok(Some(SessionHandle {
            id: row.get(0).map_err(|e| AppError::Database(format!("Failed to read id: {}", e)))?,
            name: row.get(1).map_err(|e| AppError::Database(format!("Failed to read name: {}", e)))?,
            status: parse_session_status(&status_str),
            claude_session_id: row.get(3).map_err(|e| AppError::Database(format!("Failed to read claude_session_id: {}", e)))?,
            project_path: row.get(4).map_err(|e| AppError::Database(format!("Failed to read project_id: {}", e)))?,
            worktree_path: row.get(5).map_err(|e| AppError::Database(format!("Failed to read worktree_path: {}", e)))?,
            model: row.get(6).map_err(|e| AppError::Database(format!("Failed to read model: {}", e)))?,
            autonomy_level: row.get(7).map_err(|e| AppError::Database(format!("Failed to read autonomy_level: {}", e)))?,
            created_at: row.get(8).map_err(|e| AppError::Database(format!("Failed to read created_at: {}", e)))?,
        }))
    } else {
        Ok(None)
    }
}

fn load_sessions_from_db(state: &AppState, project_id: Option<&str>) -> Result<Vec<SessionHandle>, AppError> {
    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let conn = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    let mapper = |row: &rusqlite::Row<'_>| -> rusqlite::Result<SessionHandle> {
            let status_str: String = row.get(2)?;
            Ok(SessionHandle {
                id: row.get(0)?,
                name: row.get(1)?,
                status: parse_session_status(&status_str),
                claude_session_id: row.get(3)?,
                project_path: row.get(4)?,
                worktree_path: row.get(5)?,
                model: row.get(6)?,
                autonomy_level: row.get(7)?,
                created_at: row.get(8)?,
            })
        };

    let mut sessions = Vec::new();
    if let Some(pid) = project_id {
        let mut stmt = conn.prepare(
            "SELECT id, name, status, claude_session_id, project_id, worktree_path, model, autonomy_level, created_at
             FROM sessions WHERE project_id = ?1 ORDER BY created_at DESC"
        ).map_err(|e| AppError::Database(format!("Failed to prepare query: {}", e)))?;

        let rows = stmt.query_map([pid], mapper)
            .map_err(|e| AppError::Database(format!("Failed to map rows: {}", e)))?;
        for row in rows {
            sessions.push(row.map_err(|e| AppError::Database(format!("Failed to parse row: {}", e)))?);
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, name, status, claude_session_id, project_id, worktree_path, model, autonomy_level, created_at
             FROM sessions ORDER BY created_at DESC"
        ).map_err(|e| AppError::Database(format!("Failed to prepare query: {}", e)))?;

        let rows = stmt.query_map([], mapper)
            .map_err(|e| AppError::Database(format!("Failed to map rows: {}", e)))?;
        for row in rows {
            sessions.push(row.map_err(|e| AppError::Database(format!("Failed to parse row: {}", e)))?);
        }
    }
    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_state() -> AppState {
        let state = AppState::new();
        state.init_db(":memory:").expect("db should initialize");
        state
    }

    #[test]
    fn parse_session_status_defaults_for_unknown() {
        assert_eq!(parse_session_status("weird"), SessionStatus::Created);
        assert_eq!(parse_session_status("running"), SessionStatus::Running);
    }

    #[test]
    fn load_session_from_db_returns_saved_session() {
        let state = setup_state();
        {
            let db = state.db.lock().unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                rusqlite::params!["/tmp/repo", "Repo", "/tmp/repo"]
            ).unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO sessions (id, project_id, name, status, model, autonomy_level, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params!["s1", "/tmp/repo", "Session", "created", "sonnet", "supervised", "2026-02-07T00:00:00Z"]
            ).unwrap();
        }

        let loaded = load_session_from_db(&state, "s1").unwrap().expect("session should exist");
        assert_eq!(loaded.id, "s1");
        assert_eq!(loaded.name, "Session");
        assert_eq!(loaded.project_path, "/tmp/repo");
        assert_eq!(loaded.model, "sonnet");
    }

    #[test]
    fn load_all_sessions_from_db_returns_all_saved_sessions() {
        let state = setup_state();
        {
            let db = state.db.lock().unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                rusqlite::params!["/tmp/repo-a", "Repo A", "/tmp/repo-a"]
            ).unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                rusqlite::params!["/tmp/repo-b", "Repo B", "/tmp/repo-b"]
            ).unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO sessions (id, project_id, name, status, model, autonomy_level, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params!["s1", "/tmp/repo-a", "Session A", "created", "sonnet", "supervised", "2026-02-07T00:00:00Z"]
            ).unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO sessions (id, project_id, name, status, model, autonomy_level, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params!["s2", "/tmp/repo-b", "Session B", "running", "opus", "ask", "2026-02-07T00:01:00Z"]
            ).unwrap();
        }

        let loaded = load_sessions_from_db(&state, None).unwrap();
        assert_eq!(loaded.len(), 2);
        assert!(loaded.iter().any(|s| s.id == "s1" && s.project_path == "/tmp/repo-a"));
        assert!(loaded.iter().any(|s| s.id == "s2" && s.status == SessionStatus::Running));
    }

    #[test]
    fn get_session_status_inner_hydrates_from_db_when_cache_is_empty() {
        let state = setup_state();
        {
            let db = state.db.lock().unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                rusqlite::params!["/tmp/repo-c", "Repo C", "/tmp/repo-c"]
            ).unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO sessions (id, project_id, name, status, model, autonomy_level, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params!["s3", "/tmp/repo-c", "Session C", "paused", "sonnet", "supervised", "2026-02-07T00:02:00Z"]
            ).unwrap();
        }

        let status = get_session_status_inner(&state, "s3").unwrap();
        assert_eq!(status, SessionStatus::Paused);

        // Confirm cache was hydrated.
        let sessions = state.sessions.lock().unwrap();
        assert!(sessions.contains_key("s3"));
    }

    #[test]
    fn upsert_runtime_session_inserts_and_is_idempotent() {
        let state = setup_state();

        // project id is used as project_path in current runtime session shape
        {
            let db = state.db.lock().unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                rusqlite::params!["/tmp/repo-r", "Repo Runtime", "/tmp/repo-r"]
            ).unwrap();
        }

        let session = SessionHandle::new(
            "runtime-s1".to_string(),
            "Runtime Session".to_string(),
            "/tmp/repo-r".to_string(),
            None,
            "sonnet".to_string(),
            "supervised".to_string(),
        );

        upsert_runtime_session_in_db(&state, &session).unwrap();
        upsert_runtime_session_in_db(&state, &session).unwrap();

        let db = state.db.lock().unwrap();
        let count: i64 = db.as_ref().unwrap().query_row(
            "SELECT COUNT(*) FROM sessions WHERE id = ?1",
            rusqlite::params!["runtime-s1"],
            |row| row.get(0)
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn persist_claude_session_id_updates_session_row() {
        let state = setup_state();
        {
            let db = state.db.lock().unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                rusqlite::params!["/tmp/repo-d", "Repo DB", "/tmp/repo-d"]
            ).unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO sessions (id, project_id, name, status, model, autonomy_level, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params!["s-db-1", "/tmp/repo-d", "Session DB", "created", "sonnet", "supervised", "2026-02-07T00:03:00Z"]
            ).unwrap();
        }

        persist_claude_session_id_in_db(&state, "s-db-1", "claude-abc").unwrap();

        let db = state.db.lock().unwrap();
        let value: String = db.as_ref().unwrap().query_row(
            "SELECT claude_session_id FROM sessions WHERE id = ?1",
            rusqlite::params!["s-db-1"],
            |row| row.get(0)
        ).unwrap();
        assert_eq!(value, "claude-abc");
    }

    #[test]
    fn load_sessions_from_db_filters_by_project_id() {
        let state = setup_state();
        {
            let db = state.db.lock().unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                rusqlite::params!["/tmp/repo-f1", "Repo F1", "/tmp/repo-f1"]
            ).unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                rusqlite::params!["/tmp/repo-f2", "Repo F2", "/tmp/repo-f2"]
            ).unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO sessions (id, project_id, name, status, model, autonomy_level, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params!["s-f1", "/tmp/repo-f1", "Session F1", "created", "sonnet", "supervised", "2026-02-07T00:05:00Z"]
            ).unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO sessions (id, project_id, name, status, model, autonomy_level, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params!["s-f2", "/tmp/repo-f2", "Session F2", "created", "sonnet", "supervised", "2026-02-07T00:06:00Z"]
            ).unwrap();
        }

        let filtered = load_sessions_from_db(&state, Some("/tmp/repo-f1")).unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "s-f1");
    }

    #[test]
    fn resolve_project_path_uses_projects_table_when_id_exists() {
        let state = setup_state();
        {
            let db = state.db.lock().unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                rusqlite::params!["proj-1", "Project 1", "/tmp/project-1"]
            ).unwrap();
        }

        let path = resolve_project_path(&state, "proj-1").unwrap();
        assert_eq!(path, "/tmp/project-1");
    }

    #[test]
    fn resolve_project_path_falls_back_to_project_id_when_missing() {
        let state = setup_state();
        let path = resolve_project_path(&state, "/tmp/direct-path").unwrap();
        assert_eq!(path, "/tmp/direct-path");
    }

    #[test]
    fn persist_user_message_in_db_increments_order_index() {
        let state = setup_state();
        {
            let db = state.db.lock().unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                rusqlite::params!["/tmp/repo-msg", "Repo Msg", "/tmp/repo-msg"]
            ).unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO sessions (id, project_id, name, status, model, autonomy_level, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params!["s-msg-1", "/tmp/repo-msg", "Session Msg", "created", "sonnet", "supervised", "2026-02-07T00:07:00Z"]
            ).unwrap();
        }

        persist_user_message_in_db(&state, "s-msg-1", "first").unwrap();
        persist_user_message_in_db(&state, "s-msg-1", "second").unwrap();

        let db = state.db.lock().unwrap();
        let mut stmt = db.as_ref().unwrap().prepare(
            "SELECT content, order_index FROM messages WHERE session_id = ?1 ORDER BY order_index ASC"
        ).unwrap();
        let rows = stmt.query_map(rusqlite::params!["s-msg-1"], |row| {
            let content: String = row.get(0)?;
            let order_index: i64 = row.get(1)?;
            Ok((content, order_index))
        }).unwrap();

        let collected: Vec<(String, i64)> = rows.map(|r| r.unwrap()).collect();
        assert_eq!(collected.len(), 2);
        assert_eq!(collected[0], ("first".to_string(), 0));
        assert_eq!(collected[1], ("second".to_string(), 1));
    }
}

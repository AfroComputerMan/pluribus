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
    let sessions = state.sessions.lock()
        .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

    sessions.get(&session_id)
        .map(|s| s.status.clone())
        .ok_or_else(|| AppError::SessionNotFound(session_id))
}

/// Get session details
#[tauri::command]
pub async fn get_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SessionHandle, AppError> {
    let sessions = state.sessions.lock()
        .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

    sessions.get(&session_id)
        .cloned()
        .ok_or_else(|| AppError::SessionNotFound(session_id))
}

/// List all sessions
#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<SessionHandle>, AppError> {
    let sessions = state.sessions.lock()
        .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

    Ok(sessions.values().cloned().collect())
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

    let session = SessionHandle::new(
        session_id.clone(),
        project_id.clone(),
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
        .ok_or_else(|| AppError::SessionNotFound(session_id))?;

    session.set_claude_session_id(claude_session_id);
    Ok(())
}

use crate::error::{AppError, AppResult};
use crate::state::{AppState, ProcessHandle, ProcessStatus, SessionStatus};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Configuration for spawning a Claude CLI session
#[derive(Debug, Clone)]
pub struct SpawnConfig {
    pub session_id: String,
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub model: Option<String>,
    pub max_turns: Option<u32>,
    pub resume_session_id: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub append_system_prompt: Option<String>,
}

/// Information about spawned session
#[derive(Debug, serde::Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub pid: Option<u32>,
}

/// Spawn a new Claude CLI process and stream its output
pub async fn spawn_session(
    state: &AppState,
    config: SpawnConfig,
    channel: tauri::ipc::Channel<String>,
) -> AppResult<SessionInfo> {
    // Build command arguments
    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
    ];

    // Add optional model
    if let Some(model) = &config.model {
        args.push("--model".to_string());
        args.push(model.clone());
    }

    // Add max turns
    if let Some(max_turns) = config.max_turns {
        args.push("--max-turns".to_string());
        args.push(max_turns.to_string());
    }

    // Add resume session
    if let Some(resume_id) = &config.resume_session_id {
        args.push("--resume".to_string());
        args.push(resume_id.clone());
    }

    // Add allowed tools
    if let Some(tools) = &config.allowed_tools {
        for tool in tools {
            args.push("--allowedTools".to_string());
            args.push(tool.clone());
        }
    }

    // Add system prompt
    if let Some(prompt) = &config.append_system_prompt {
        args.push("--append-system-prompt".to_string());
        args.push(prompt.clone());
    }

    // Determine working directory
    let working_dir = config.worktree_path.as_ref()
        .unwrap_or(&config.project_path);

    // Build command
    let mut cmd = Command::new("claude");
    cmd.args(&args)
        .current_dir(working_dir)
        .stdout(Stdio::piped())
        .stdin(Stdio::piped())
        .stderr(Stdio::piped());

    // On Unix, use process groups for proper cleanup
    #[cfg(unix)]
    {
        unsafe {
            cmd.pre_exec(|| {
                // Create new process group
                libc::setsid();
                Ok(())
            });
        }
    }

    // Spawn process
    let mut child = cmd.spawn()
        .map_err(|e| AppError::Process(format!("Failed to spawn claude: {}", e)))?;

    let pid = child.id();

    // Take stdin for later use
    let stdin_writer = child.stdin.take();

    // Take stdout for streaming
    let stdout = child.stdout.take()
        .ok_or_else(|| AppError::Process("Failed to capture stdout".to_string()))?;

    // Take stderr for error capture
    let stderr = child.stderr.take()
        .ok_or_else(|| AppError::Process("Failed to capture stderr".to_string()))?;

    // Store process handle
    let process_handle = ProcessHandle {
        session_id: config.session_id.clone(),
        child: Some(child),
        pid,
        stdin_writer,
        status: ProcessStatus::Running,
    };

    {
        let mut processes = state.processes.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
        processes.insert(config.session_id.clone(), process_handle);
    }

    // Update session status
    {
        let mut sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
        if let Some(session) = sessions.get_mut(&config.session_id) {
            session.status = SessionStatus::Running;
        }
    }

    // Spawn task to read stdout and send to channel
    let state_stdout = state.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            // Send line to frontend
            if channel.send(line).is_err() {
                // Channel closed, stop reading
                break;
            }
        }
    });

    // Spawn task to read stderr
    let session_id_stderr = config.session_id.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[Session {}] STDERR: {}", session_id_stderr, line);
        }
    });

    // Spawn task to wait for process exit
    let session_id_wait = config.session_id.clone();
    let state_wait = state_stdout;
    tokio::spawn(async move {
        if let Err(e) = wait_for_exit(&state_wait, &session_id_wait).await {
            eprintln!("[Session {}] Error waiting for exit: {}", session_id_wait, e);
        }
    });

    Ok(SessionInfo {
        session_id: config.session_id,
        pid,
    })
}

/// Wait for process to exit and clean up state
async fn wait_for_exit(state: &AppState, session_id: &str) -> AppResult<()> {
    // Take the child process to wait on it
    let child = {
        let mut processes = state.processes.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

        if let Some(handle) = processes.get_mut(session_id) {
            handle.child.take()
        } else {
            return Ok(());
        }
    };

    if let Some(mut child) = child {
        let exit_status = child.wait().await?;
        let exit_code = exit_status.code().unwrap_or(-1);

        // Update process status
        {
            let mut processes = state.processes.lock()
                .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

            if let Some(handle) = processes.get_mut(session_id) {
                handle.status = ProcessStatus::Exited(exit_code);
            }
        }

        // Update session status
        {
            let mut sessions = state.sessions.lock()
                .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

            if let Some(session) = sessions.get_mut(session_id) {
                session.status = if exit_code == 0 {
                    SessionStatus::Completed
                } else {
                    SessionStatus::Failed
                };
                persist_session_status_in_db(state, session_id, &session.status)?;
            }
        }

        // Clean up process handle after a delay
        let session_id_cleanup = session_id.to_string();
        let state_cleanup = state.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            let mut processes = state_cleanup.processes.lock().unwrap();
            processes.remove(&session_id_cleanup);
        });
    }

    Ok(())
}

/// Abort a running session by killing the process
pub async fn abort_session(state: &AppState, session_id: &str) -> AppResult<()> {
    let child = {
        let mut processes = state.processes.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

        let handle = processes.get_mut(session_id)
            .ok_or_else(|| AppError::SessionNotFound(session_id.to_string()))?;

        handle.status = ProcessStatus::Killed;
        handle.child.take()
    };

    if let Some(mut child) = child {
        #[cfg(unix)]
        {
            // Kill the process group
            if let Some(pid) = child.id() {
                unsafe {
                    // Send SIGTERM to process group
                    libc::kill(-(pid as i32), libc::SIGTERM);
                }
            }
        }

        // Fallback: kill individual process
        child.kill().await
            .map_err(|e| AppError::Process(format!("Failed to kill process: {}", e)))?;
    }

    // Update session status
    {
        let mut sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

        if let Some(session) = sessions.get_mut(session_id) {
            session.status = SessionStatus::Killed;
            persist_session_status_in_db(state, session_id, &session.status)?;
        }
    }

    Ok(())
}

/// Send a message to the process stdin
pub async fn send_to_stdin(state: &AppState, session_id: &str, message: &str) -> AppResult<()> {
    use tokio::io::AsyncWriteExt;

    // Take stdin out of the shared map before awaiting, so no std::sync::MutexGuard
    // is held across .await (required by Tauri command futures).
    let mut stdin_writer = {
        let mut processes = state.processes.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

        let handle = processes.get_mut(session_id)
            .ok_or_else(|| AppError::SessionNotFound(session_id.to_string()))?;

        handle.stdin_writer.take()
            .ok_or_else(|| AppError::Process("No stdin available".to_string()))?
    };

    stdin_writer.write_all(message.as_bytes()).await?;
    stdin_writer.write_all(b"\n").await?;
    stdin_writer.flush().await?;

    // Put stdin writer back for future sends.
    let mut processes = state.processes.lock()
        .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;
    if let Some(handle) = processes.get_mut(session_id) {
        if handle.stdin_writer.is_none() {
            handle.stdin_writer = Some(stdin_writer);
        }
    }

    Ok(())
}

/// Pause a running session (SIGSTOP)
#[cfg(unix)]
pub async fn pause_session(state: &AppState, session_id: &str) -> AppResult<()> {
    let processes = state.processes.lock()
        .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

    let handle = processes.get(session_id)
        .ok_or_else(|| AppError::SessionNotFound(session_id.to_string()))?;

    if let Some(pid) = handle.pid {
        unsafe {
            libc::kill(pid as i32, libc::SIGSTOP);
        }

        drop(processes); // Release lock before updating sessions

        let mut sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

        if let Some(session) = sessions.get_mut(session_id) {
            session.status = SessionStatus::Paused;
            persist_session_status_in_db(state, session_id, &session.status)?;
        }
    }

    Ok(())
}

/// Resume a paused session (SIGCONT)
#[cfg(unix)]
pub async fn resume_session(state: &AppState, session_id: &str) -> AppResult<()> {
    let processes = state.processes.lock()
        .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

    let handle = processes.get(session_id)
        .ok_or_else(|| AppError::SessionNotFound(session_id.to_string()))?;

    if let Some(pid) = handle.pid {
        unsafe {
            libc::kill(pid as i32, libc::SIGCONT);
        }

        drop(processes); // Release lock before updating sessions

        let mut sessions = state.sessions.lock()
            .map_err(|e| AppError::Internal(format!("Lock poisoned: {}", e)))?;

        if let Some(session) = sessions.get_mut(session_id) {
            session.status = SessionStatus::Running;
            persist_session_status_in_db(state, session_id, &session.status)?;
        }
    }

    Ok(())
}

fn persist_session_status_in_db(state: &AppState, session_id: &str, status: &SessionStatus) -> AppResult<()> {
    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let conn = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    let status_str = match status {
        SessionStatus::Created => "created",
        SessionStatus::Running => "running",
        SessionStatus::Completed => "completed",
        SessionStatus::Failed => "failed",
        SessionStatus::Killed => "killed",
        SessionStatus::Paused => "paused",
    };

    conn.execute(
        "UPDATE sessions SET status = ?1 WHERE id = ?2",
        rusqlite::params![status_str, session_id],
    ).map_err(|e| AppError::Database(format!("Failed to persist session status: {}", e)))?;
    Ok(())
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
    fn persist_session_status_in_db_updates_row() {
        let state = setup_state();
        {
            let db = state.db.lock().unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                rusqlite::params!["/tmp/repo-status", "Repo Status", "/tmp/repo-status"]
            ).unwrap();
            db.as_ref().unwrap().execute(
                "INSERT INTO sessions (id, project_id, name, status, model, autonomy_level, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params!["s-status-1", "/tmp/repo-status", "Session Status", "created", "sonnet", "supervised", "2026-02-07T00:04:00Z"]
            ).unwrap();
        }

        persist_session_status_in_db(&state, "s-status-1", &SessionStatus::Paused).unwrap();

        let db = state.db.lock().unwrap();
        let value: String = db.as_ref().unwrap().query_row(
            "SELECT status FROM sessions WHERE id = ?1",
            rusqlite::params!["s-status-1"],
            |row| row.get(0)
        ).unwrap();
        assert_eq!(value, "paused");
    }
}

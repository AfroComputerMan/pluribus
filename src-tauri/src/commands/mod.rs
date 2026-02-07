/// Tauri commands for IPC bridge
///
/// Commands are async functions that can be invoked from the frontend
/// via the Tauri IPC bridge. They typically interact with AppState
/// and return Result<T, AppError>.

pub mod chat;
pub mod db;
pub mod project;
pub mod worktree;

// Re-export worktree commands for easy registration
pub use worktree::{
    create_worktree, remove_worktree, list_worktrees, prune_worktrees,
    is_git_repo, get_default_branch,
};

// Re-export chat commands
pub use chat::{
    check_claude_cli, send_message, abort_session, get_session_status,
    get_session, list_sessions, update_claude_session_id,
    create_session, delete_session,
};

#[cfg(unix)]
pub use chat::{pause_session, resume_session};

// Re-export DB proxy commands
pub use db::{execute_sql, select_sql};

// Re-export project commands
pub use project::{open_project, list_projects, get_project};

use crate::error::AppError;
use crate::worktree::manager::{WorktreeInfo, WorktreeManager};

/// Create a new worktree for a session
#[tauri::command]
pub async fn create_worktree(
    project_path: String,
    session_id: String,
    base_branch: Option<String>,
) -> Result<WorktreeInfo, AppError> {
    WorktreeManager::create(
        &project_path,
        &session_id,
        base_branch.as_deref(),
    )
    .await
}

/// Remove a worktree and optionally its branch
#[tauri::command]
pub async fn remove_worktree(
    project_path: String,
    session_id: String,
    delete_branch: bool,
) -> Result<(), AppError> {
    WorktreeManager::remove(&project_path, &session_id, delete_branch).await
}

/// List all pluribus worktrees for a repository
#[tauri::command]
pub async fn list_worktrees(project_path: String) -> Result<Vec<WorktreeInfo>, AppError> {
    WorktreeManager::list(&project_path).await
}

/// Prune stale worktrees
#[tauri::command]
pub async fn prune_worktrees(project_path: String) -> Result<u32, AppError> {
    WorktreeManager::prune(&project_path, true).await
}

/// Check if a path is a git repository
#[tauri::command]
pub async fn is_git_repo(path: String) -> Result<bool, AppError> {
    Ok(WorktreeManager::is_git_repo(&path).await)
}

/// Get the default branch name for a repository
#[tauri::command]
pub async fn get_default_branch(project_path: String) -> Result<String, AppError> {
    WorktreeManager::get_default_branch(&project_path).await
}

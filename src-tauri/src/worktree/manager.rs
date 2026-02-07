use serde::{Deserialize, Serialize};
use std::path::Path;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub session_id: String,
    pub head_commit: String,
    pub is_locked: bool,
}

pub struct WorktreeManager;

impl WorktreeManager {
    /// Create a new worktree for a session
    /// Branch naming: pluribus/<session-short-id>
    /// Worktree path: <repo>/../.pluribus-worktrees/<session-short-id>
    pub async fn create(
        repo_path: &str,
        session_id: &str,
        base_branch: Option<&str>,
    ) -> AppResult<WorktreeInfo> {
        // 1. Validate repo_path is a git repo
        if !Self::is_git_repo(repo_path).await {
            return Err(AppError::InvalidInput(format!(
                "Path is not a git repository: {}",
                repo_path
            )));
        }

        // 2. Generate short_id from session_id (first 8 chars)
        let short_id = if session_id.len() >= 8 {
            &session_id[..8]
        } else {
            session_id
        };

        // 3. Branch name: pluribus/<short_id>
        let branch_name = format!("pluribus/{}", short_id);

        // 4. Worktree path: <repo>/../.pluribus-worktrees/<short_id>
        let repo_parent = Path::new(repo_path)
            .parent()
            .ok_or_else(|| AppError::InvalidInput("Invalid repository path".to_string()))?;

        let worktrees_dir = repo_parent.join(".pluribus-worktrees");
        let worktree_path = worktrees_dir.join(short_id);

        // 5. Ensure parent dir exists (create if needed)
        if !worktrees_dir.exists() {
            tokio::fs::create_dir_all(&worktrees_dir).await?;
        }

        // Check if worktree path already exists
        if worktree_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "Worktree path already exists: {}",
                worktree_path.display()
            )));
        }

        // 6. Run: git -C <repo> worktree add -b pluribus/<id> <path> [<base>]
        let mut args = vec!["worktree", "add", "-b", &branch_name];
        let path_str = worktree_path.to_string_lossy().to_string();
        args.push(&path_str);

        let base_ref = base_branch.unwrap_or("HEAD");
        args.push(base_ref);

        run_git(repo_path, &args).await?;

        // 7. Get HEAD commit of new worktree
        let head_commit = run_git(
            &worktree_path.to_string_lossy(),
            &["rev-parse", "HEAD"]
        ).await?;

        // 8. Return WorktreeInfo
        Ok(WorktreeInfo {
            path: worktree_path.to_string_lossy().to_string(),
            branch: branch_name,
            session_id: session_id.to_string(),
            head_commit,
            is_locked: false,
        })
    }

    /// Remove a worktree and its branch
    pub async fn remove(
        repo_path: &str,
        session_id: &str,
        delete_branch: bool,
    ) -> AppResult<()> {
        // 1. Get worktree path from session_id
        let short_id = if session_id.len() >= 8 {
            &session_id[..8]
        } else {
            session_id
        };

        let repo_parent = Path::new(repo_path)
            .parent()
            .ok_or_else(|| AppError::InvalidInput("Invalid repository path".to_string()))?;

        let worktree_path = repo_parent
            .join(".pluribus-worktrees")
            .join(short_id);

        let path_str = worktree_path.to_string_lossy().to_string();

        // 2. Run: git -C <repo> worktree remove <path> --force
        run_git(repo_path, &["worktree", "remove", &path_str, "--force"]).await?;

        // 3. If delete_branch: git -C <repo> branch -D pluribus/<short_id>
        if delete_branch {
            let branch_name = format!("pluribus/{}", short_id);
            // Ignore errors if branch doesn't exist
            let _ = run_git(repo_path, &["branch", "-D", &branch_name]).await;
        }

        // 4. Clean up empty parent directory if needed
        let worktrees_dir = repo_parent.join(".pluribus-worktrees");
        if worktrees_dir.exists() {
            if let Ok(mut entries) = tokio::fs::read_dir(&worktrees_dir).await {
                if entries.next_entry().await?.is_none() {
                    // Directory is empty, remove it
                    let _ = tokio::fs::remove_dir(&worktrees_dir).await;
                }
            }
        }

        Ok(())
    }

    /// List all pluribus worktrees for a repo
    pub async fn list(repo_path: &str) -> AppResult<Vec<WorktreeInfo>> {
        // 1. Run: git -C <repo> worktree list --porcelain
        let output = run_git(repo_path, &["worktree", "list", "--porcelain"]).await?;

        // 2. Parse porcelain output
        let mut worktrees = Vec::new();
        let mut current_worktree: Option<PartialWorktreeInfo> = None;

        for line in output.lines() {
            if line.starts_with("worktree ") {
                // Save previous worktree if it exists and is a pluribus worktree
                if let Some(wt) = current_worktree.take() {
                    if let Some(info) = wt.finalize() {
                        worktrees.push(info);
                    }
                }
                // Start new worktree
                let path = line.strip_prefix("worktree ").unwrap_or("").to_string();
                current_worktree = Some(PartialWorktreeInfo {
                    path,
                    head: None,
                    branch: None,
                    is_locked: false,
                });
            } else if line.starts_with("HEAD ") {
                if let Some(ref mut wt) = current_worktree {
                    wt.head = Some(line.strip_prefix("HEAD ").unwrap_or("").to_string());
                }
            } else if line.starts_with("branch ") {
                if let Some(ref mut wt) = current_worktree {
                    let branch_ref = line.strip_prefix("branch ").unwrap_or("");
                    // Extract branch name from refs/heads/pluribus/xxx
                    if let Some(branch_name) = branch_ref.strip_prefix("refs/heads/") {
                        wt.branch = Some(branch_name.to_string());
                    }
                }
            } else if line.starts_with("locked") {
                if let Some(ref mut wt) = current_worktree {
                    wt.is_locked = true;
                }
            }
        }

        // Don't forget the last worktree
        if let Some(wt) = current_worktree.take() {
            if let Some(info) = wt.finalize() {
                worktrees.push(info);
            }
        }

        // 3. Filter to only pluribus/* branches
        let pluribus_worktrees = worktrees
            .into_iter()
            .filter(|wt| wt.branch.starts_with("pluribus/"))
            .collect();

        Ok(pluribus_worktrees)
    }

    /// Prune stale worktrees and optionally remove orphaned directories
    pub async fn prune(repo_path: &str, cleanup_dirs: bool) -> AppResult<u32> {
        let mut pruned_count = 0;

        // 1. Run: git -C <repo> worktree prune
        let output = run_git(repo_path, &["worktree", "prune", "--verbose"]).await?;

        // Count pruned worktrees from verbose output
        pruned_count += output.lines().count() as u32;

        // 2. If cleanup_dirs: scan .pluribus-worktrees/ for dirs not in git worktree list
        if cleanup_dirs {
            let repo_parent = Path::new(repo_path)
                .parent()
                .ok_or_else(|| AppError::InvalidInput("Invalid repository path".to_string()))?;

            let worktrees_dir = repo_parent.join(".pluribus-worktrees");

            if worktrees_dir.exists() {
                // Get list of valid worktree paths
                let valid_worktrees = Self::list(repo_path).await?;
                let valid_paths: std::collections::HashSet<String> = valid_worktrees
                    .iter()
                    .map(|wt| wt.path.clone())
                    .collect();

                // Scan directory for orphaned directories
                let mut entries = tokio::fs::read_dir(&worktrees_dir).await?;
                while let Some(entry) = entries.next_entry().await? {
                    let path = entry.path();
                    if path.is_dir() {
                        let path_str = path.to_string_lossy().to_string();
                        if !valid_paths.contains(&path_str) {
                            // 3. Remove orphaned dirs
                            if tokio::fs::remove_dir_all(&path).await.is_ok() {
                                pruned_count += 1;
                            }
                        }
                    }
                }

                // Clean up empty parent directory
                if let Ok(mut entries) = tokio::fs::read_dir(&worktrees_dir).await {
                    if entries.next_entry().await?.is_none() {
                        let _ = tokio::fs::remove_dir(&worktrees_dir).await;
                    }
                }
            }
        }

        // 4. Return count of pruned items
        Ok(pruned_count)
    }

    /// Check if a path is a valid git repository
    pub async fn is_git_repo(path: &str) -> bool {
        // Run: git -C <path> rev-parse --is-inside-work-tree
        match run_git(path, &["rev-parse", "--is-inside-work-tree"]).await {
            Ok(output) => output.trim() == "true",
            Err(_) => false,
        }
    }

    /// Get the default branch name (main or master)
    pub async fn get_default_branch(repo_path: &str) -> AppResult<String> {
        // Try: git -C <repo> symbolic-ref refs/remotes/origin/HEAD
        if let Ok(output) = run_git(
            repo_path,
            &["symbolic-ref", "refs/remotes/origin/HEAD"]
        ).await {
            // Parse out branch name from refs/remotes/origin/main
            if let Some(branch) = output.strip_prefix("refs/remotes/origin/") {
                return Ok(branch.to_string());
            }
        }

        // Fallback: check if main exists
        if run_git(repo_path, &["rev-parse", "--verify", "main"]).await.is_ok() {
            return Ok("main".to_string());
        }

        // Fallback: check if master exists
        if run_git(repo_path, &["rev-parse", "--verify", "master"]).await.is_ok() {
            return Ok("master".to_string());
        }

        Err(AppError::Process(
            "Could not determine default branch".to_string()
        ))
    }
}

/// Helper struct for parsing worktree list output
struct PartialWorktreeInfo {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    is_locked: bool,
}

impl PartialWorktreeInfo {
    fn finalize(self) -> Option<WorktreeInfo> {
        // Only include if it has a branch that starts with pluribus/
        let branch = self.branch?;
        if !branch.starts_with("pluribus/") {
            return None;
        }

        // Extract session_id from branch name (pluribus/<short_id>)
        let short_id = branch.strip_prefix("pluribus/")?.to_string();

        Some(WorktreeInfo {
            path: self.path,
            branch,
            session_id: short_id,
            head_commit: self.head.unwrap_or_default(),
            is_locked: self.is_locked,
        })
    }
}

/// Helper function for running git commands
async fn run_git(repo_path: &str, args: &[&str]) -> AppResult<String> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .await
        .map_err(|e| AppError::Process(format!("Failed to run git: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Process(format!("git error: {}", stderr)));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

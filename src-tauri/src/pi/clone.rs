//! Host-side per-agent clone lifecycle (#19).
//!
//! Each agent gets an isolated working copy created with `git clone --local`
//! (hardlinked `.git/objects` — *not* `--shared`, so the source's `gc` can't
//! corrupt the clone). The clone is bind-mounted into the per-agent sandbox
//! container (#18) and Pi operates on it natively, on its own branch
//! `agent/<thread-id>`. The source repo on disk is never mutated.
//!
//! `base_sha` is captured from the source HEAD *before* `checkout -b` (== the
//! clone's HEAD immediately after `git clone`), so #21 can run a deterministic
//! `git diff <base_sha> HEAD`.
//!
//! Uses host `git` via `std::process::Command` (confirmed 2.43).

use std::path::Path;
use std::process::Command;

use serde::Serialize;

/// Result of a successful clone, returned to TS so it can persist the
/// `clones` row (migration 011).
#[derive(Serialize, Clone, Debug)]
pub struct CloneInfo {
    pub clone_dir: String,
    pub base_sha: String,
    pub agent_branch: String,
}

/// Create an isolated working copy of `source` under `<clone_root>/<thread_id>`.
///
/// Steps:
/// 1. Validate `source` is a git work-tree.
/// 2. Capture `base_sha` = source HEAD (before branching).
/// 3. Refuse if the clone dir already exists non-empty (idempotency guard).
/// 4. `git clone --local <source> <clone_dir>`.
/// 5. `git -C <clone_dir> checkout -b agent/<thread_id>`.
///
/// On any failure *after* the clone dir is created, best-effort remove it so no
/// half-clone is left behind.
pub async fn create_agent_clone(
    source: &str,
    clone_root: &str,
    thread_id: &str,
) -> Result<CloneInfo, String> {
    // 0. Bound `thread_id` to a single safe path segment. It feeds both the
    //    clone dir and the recursive `dispose_clone` remove — reject anything
    //    that could escape `clone_root` (`..`, separators, leading dash).
    if thread_id.is_empty()
        || thread_id.contains('/')
        || thread_id.contains('\\')
        || thread_id.contains("..")
        || thread_id.starts_with('-')
    {
        return Err(format!("invalid thread_id for clone dir: {thread_id:?}"));
    }

    // 1. Validate the source is a git work-tree.
    let is_work_tree = Command::new("git")
        .args(["-C", source, "rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !is_work_tree.status.success() {
        return Err(format!("not a git repository: {source}"));
    }

    // 2. Capture base_sha (source HEAD) before any branching.
    let rev_parse = Command::new("git")
        .args(["-C", source, "rev-parse", "HEAD"])
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !rev_parse.status.success() {
        return Err(format!(
            "failed to resolve HEAD of {source}: {}",
            String::from_utf8_lossy(&rev_parse.stderr).trim()
        ));
    }
    let base_sha = String::from_utf8_lossy(&rev_parse.stdout).trim().to_string();

    // 3. Compute the clone dir; refuse if it already exists non-empty.
    let clone_dir = format!("{clone_root}/{thread_id}");
    let clone_path = Path::new(&clone_dir);
    if clone_path.exists() {
        let non_empty = std::fs::read_dir(clone_path)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(true);
        if non_empty {
            return Err(format!(
                "clone dir already exists and is non-empty: {clone_dir}"
            ));
        }
    }

    // 4. git clone --local <source> <clone_dir>  (NOT --shared).
    //    `--end-of-options` stops a source path beginning with `-` from being
    //    parsed as a git flag (option-injection hardening).
    let clone_out = Command::new("git")
        .args(["clone", "--local", "--end-of-options", source, &clone_dir])
        .output()
        .map_err(|e| format!("failed to run git clone: {e}"))?;
    if !clone_out.status.success() {
        // No dir created on a failed clone (git removes its own partial target),
        // but clean up best-effort regardless.
        dispose_clone(&clone_dir).ok();
        return Err(format!(
            "git clone failed: {}",
            String::from_utf8_lossy(&clone_out.stderr).trim()
        ));
    }

    // 5. git -C <clone_dir> checkout -b agent/<thread_id>.
    let agent_branch = format!("agent/{thread_id}");
    let checkout_out = Command::new("git")
        .args(["-C", &clone_dir, "checkout", "-b", &agent_branch])
        .output()
        .map_err(|e| {
            // Half-clone exists at this point — clean it up.
            dispose_clone(&clone_dir).ok();
            format!("failed to run git checkout: {e}")
        })?;
    if !checkout_out.status.success() {
        dispose_clone(&clone_dir).ok();
        return Err(format!(
            "git checkout -b {agent_branch} failed: {}",
            String::from_utf8_lossy(&checkout_out.stderr).trim()
        ));
    }

    Ok(CloneInfo {
        clone_dir,
        base_sha,
        agent_branch,
    })
}

/// Best-effort removal of a clone dir. Used by the dispose command and the
/// startup orphan reconcile. Missing dirs are treated as success.
pub fn dispose_clone(clone_dir: &str) -> Result<(), String> {
    match std::fs::remove_dir_all(clone_dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("failed to remove clone dir {clone_dir}: {e}")),
    }
}

//! Post-run clone diff (#21).
//!
//! Computes what an agent changed in its per-agent clone (#19) by diffing the
//! clone's **working tree** against the captured `base_sha`, then renders it in
//! the UI as a unified diff.
//!
//! ## Diff semantics (load-bearing — see plan §3)
//!
//! Pi's native `write`/`edit` tools mutate the working tree and do **not**
//! commit, so the `agent/<id>` branch still points at `base_sha` (HEAD == base).
//! That means `git diff <base_sha> HEAD` (two-dot, the issue's literal command)
//! returns **0 lines** and is WRONG for this model.
//!
//! The correct command is **base commit vs current working tree**:
//!   1. `git -C <dir> add -A -N`  — intent-to-add: registers untracked files
//!      (and deletions) so they show up in the diff, without staging content.
//!      Best-effort; a failure here never fails the diff.
//!   2. `git -C <dir> --no-pager diff --find-renames --end-of-options <base_sha>`
//!      — compares the base tree directly to the working tree (NOT `base..HEAD`),
//!      so it's the correct superset of "everything that differs from the start".

use std::path::Path;
use std::process::Command;

use serde::Serialize;

/// Cap on cumulative diff lines appended across files. Once exceeded, we stop
/// adding more files and set `truncated = true`. Bounds pathological diffs.
const MAX_DIFF_LINES: usize = 10_000;

/// Discriminated result of a clone diff. `#[serde(tag = "kind", ...)]` makes the
/// TS side a tagged union (`{ kind: "no_clone" } | { kind: "diff", files, ... }`),
/// so the UI never conflates an empty diff with a missing clone or a git error.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DiffResult {
    /// The clone dir no longer exists on disk (e.g. disposed/reaped).
    NoClone,
    /// The clone exists but the agent changed nothing (empty diff).
    Empty,
    /// `git diff` exited non-zero; `message` carries stderr.
    GitError { message: String },
    /// One or more files changed. `truncated` is set when the 10k-line cap was
    /// hit; `total_lines` is the line count of the raw diff (pre-truncation).
    Diff {
        files: Vec<FileDiff>,
        truncated: bool,
        total_lines: u32,
    },
}

/// A single changed file's unified-diff chunk plus parsed metadata.
#[derive(Serialize)]
pub struct FileDiff {
    /// The `b/<path>` side (post-image). For a rename, the destination path.
    pub path: String,
    /// `Some(<a/path>)` only when the file was renamed (the source path).
    pub base_path: Option<String>,
    /// `"added"` | `"deleted"` | `"renamed"` | `"modified"`.
    pub status: String,
    /// The chunk's full text (the `diff --git ...` block, headers + hunks).
    pub hunks: String,
}

/// Compute the clone's diff against its base commit (base vs working tree,
/// including untracked files — see module docs / plan §3).
#[tauri::command]
pub async fn pi_clone_diff(clone_dir: String, base_sha: String) -> Result<DiffResult, String> {
    // 1. Missing clone dir on disk → NoClone (distinct from an empty diff).
    if !Path::new(&clone_dir).exists() {
        return Ok(DiffResult::NoClone);
    }

    // 2. Best-effort intent-to-add so untracked files (and deletions) appear in
    //    the diff. Never fail the diff on this — just log on error.
    match Command::new("git")
        .args(["-C", &clone_dir, "add", "-A", "-N"])
        .output()
    {
        Ok(out) if !out.status.success() => {
            eprintln!(
                "pi_clone_diff: `git add -A -N` failed in {clone_dir}: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        Err(e) => {
            eprintln!("pi_clone_diff: failed to run `git add -A -N` in {clone_dir}: {e}");
        }
        Ok(_) => {}
    }

    // 3. Diff base commit vs working tree (NOT `base..HEAD`). `--find-renames`
    //    surfaces `rename from/to` headers; `--end-of-options` stops a base_sha
    //    beginning with `-` from being parsed as a flag (option-injection guard).
    let diff_out = Command::new("git")
        .args([
            "-C",
            &clone_dir,
            "--no-pager",
            "diff",
            "--find-renames",
            "--end-of-options",
            &base_sha,
        ])
        .output()
        .map_err(|e| format!("failed to run git diff: {e}"))?;

    if !diff_out.status.success() {
        return Ok(DiffResult::GitError {
            message: String::from_utf8_lossy(&diff_out.stderr).trim().to_string(),
        });
    }

    let stdout = String::from_utf8_lossy(&diff_out.stdout);

    // 4. Empty stdout → no changes (distinct from NoClone / GitError).
    if stdout.trim().is_empty() {
        return Ok(DiffResult::Empty);
    }

    // 5. Split into per-file chunks on lines beginning `diff --git `, parse each,
    //    and cap cumulative appended lines at MAX_DIFF_LINES.
    let total_lines = stdout.lines().count() as u32;
    let mut files: Vec<FileDiff> = Vec::new();
    let mut truncated = false;
    let mut appended_lines: usize = 0;

    for chunk in split_into_file_chunks(&stdout) {
        let chunk_lines = chunk.lines().count();
        // Once the cap is exceeded, line-truncate this chunk rather than dropping
        // it whole — otherwise a single oversized file (its chunk alone > cap)
        // would yield `files: []` with `truncated = true`, showing the user none
        // of a real, large change. We push a line-truncated copy + notice, then stop.
        if appended_lines + chunk_lines > MAX_DIFF_LINES {
            truncated = true;
            let remaining = MAX_DIFF_LINES - appended_lines;
            let mut kept: String = chunk
                .split_inclusive('\n')
                .take(remaining)
                .collect();
            if !kept.ends_with('\n') {
                kept.push('\n');
            }
            kept.push_str("[diff truncated: file exceeds the 10000-line cap]\n");
            let mut file = parse_file_chunk(chunk);
            file.hunks = kept;
            files.push(file);
            break;
        }
        files.push(parse_file_chunk(chunk));
        appended_lines += chunk_lines;
    }

    Ok(DiffResult::Diff {
        files,
        truncated,
        total_lines,
    })
}

/// Split a unified diff into per-file chunks, each starting with `diff --git `.
/// Returns the chunk text slices in order. Anything before the first
/// `diff --git ` line (there shouldn't be any) is ignored.
fn split_into_file_chunks(diff: &str) -> Vec<&str> {
    let mut chunks: Vec<&str> = Vec::new();
    let mut start: Option<usize> = None;
    let mut idx = 0usize;

    for line in diff.split_inclusive('\n') {
        if line.starts_with("diff --git ") {
            if let Some(s) = start {
                chunks.push(&diff[s..idx]);
            }
            start = Some(idx);
        }
        idx += line.len();
    }
    if let Some(s) = start {
        chunks.push(&diff[s..]);
    }
    chunks
}

/// Derive `path`, `base_path`, and `status` from a single file chunk's headers.
fn parse_file_chunk(chunk: &str) -> FileDiff {
    let mut status = "modified";
    let mut rename_from: Option<String> = None;
    let mut rename_to: Option<String> = None;
    let mut a_path: Option<String> = None;
    let mut b_path: Option<String> = None;

    for line in chunk.lines() {
        if line.starts_with("new file") {
            status = "added";
        } else if line.starts_with("deleted file") {
            status = "deleted";
        } else if let Some(rest) = line.strip_prefix("rename from ") {
            status = "renamed";
            rename_from = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("rename to ") {
            status = "renamed";
            rename_to = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("--- ") {
            a_path = strip_diff_path_prefix(rest.trim());
        } else if let Some(rest) = line.strip_prefix("+++ ") {
            b_path = strip_diff_path_prefix(rest.trim());
        }
    }

    // `path` = the post-image (b/) side, preferring the rename destination; fall
    // back to the `diff --git a/… b/…` header when there's no `---/+++` (binary).
    let path = rename_to
        .clone()
        .or(b_path)
        .or_else(|| parse_diff_git_paths(chunk).map(|(_, b)| b))
        .unwrap_or_default();

    // `base_path` is set only on a rename (the source path).
    let base_path = if status == "renamed" {
        rename_from.or(a_path)
    } else {
        None
    };

    FileDiff {
        path,
        base_path,
        status: status.to_string(),
        hunks: chunk.to_string(),
    }
}

/// Strip a leading `a/` or `b/` prefix from a `---`/`+++` header path. Returns
/// `None` for `/dev/null` (added/deleted sentinel).
fn strip_diff_path_prefix(p: &str) -> Option<String> {
    if p == "/dev/null" {
        return None;
    }
    let stripped = p.strip_prefix("a/").or_else(|| p.strip_prefix("b/")).unwrap_or(p);
    Some(stripped.to_string())
}

/// Parse the `a/<path>` and `b/<path>` operands from a `diff --git ...` header
/// line. Used as a fallback when there are no `---`/`+++` lines (e.g. binary or
/// pure-rename chunks). Returns `(a_path, b_path)` with prefixes stripped.
fn parse_diff_git_paths(chunk: &str) -> Option<(String, String)> {
    let header = chunk.lines().next()?;
    let rest = header.strip_prefix("diff --git ")?;
    // Format: `a/<path> b/<path>`. Paths without spaces (common case); a more
    // robust quoted-path parse is deferred (binary/rename fall through fine).
    let (a, b) = rest.split_once(" b/")?;
    let a = a.strip_prefix("a/").unwrap_or(a).to_string();
    Some((a, b.to_string()))
}

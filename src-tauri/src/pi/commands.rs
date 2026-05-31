use std::collections::HashMap;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use super::clone::{self, CloneInfo};
use super::container::ContainerExec;
use super::io::{HostProcess, PiIo};
use super::service::PiService;

/// Per-session store of live `pi` sessions (NOT an `Option<T>` singleton).
/// One `PiService` per session id; concurrent threads spawn distinct sessions.
pub type PiState = Mutex<HashMap<String, PiService>>;

/// How long to wait for pi to acknowledge `get_state` before declaring the
/// session dead (covers `docker exec` start latency before pi binds stdin).
const READY_TIMEOUT: Duration = Duration::from_secs(10);

/// Resolve the env-var NAME that holds the API key for `provider`.
///
/// POC: `openrouter` -> `OPENROUTER_API_KEY`. Generalize this map as more
/// providers are added (#17 ships OpenRouter only).
fn key_name_for_provider(provider: &str) -> Result<&'static str, String> {
    match provider {
        "openrouter" => Ok("OPENROUTER_API_KEY"),
        other => Err(format!("Unsupported pi provider: {other}")),
    }
}

/// Deterministic per-session container name: `pluribus-sandbox-<id-prefix>`.
/// Bounded to 12 chars of the session id (Docker names allow far more, but a
/// short, stable prefix is enough to disambiguate and read in `docker ps`).
fn container_name_for_session(session_id: &str) -> String {
    let prefix: String = session_id.chars().take(12).collect();
    format!("pluribus-sandbox-{prefix}")
}

/// Start (idempotent) a `pi --mode rpc` session for `session_id`.
///
/// `sandbox` selects the transport: `Some("host")` runs pi on the host (#17 dev
/// fallback); anything else (incl. `None`) runs pi inside a per-agent Docker
/// container (#18 default). The frontend reads `global_settings.pi_sandbox` and
/// passes it here (Settings UI deferred — DB row drives it).
///
/// The API key is read from the env by a provider-derived name and injected into
/// pi explicitly (host: child env; container: exec env — never baked in the image).
///
/// #25 lock discipline: the `PiState` map lock is NEVER held across `io.spawn`
/// (bollard create/start/exec) or the readiness `get_state`/`wait_ready` awaits.
/// The guard is taken only for the idempotency check and the final insert.
#[tauri::command]
pub async fn pi_start_session(
    app_handle: AppHandle,
    state: State<'_, PiState>,
    session_id: String,
    provider: String,
    model: String,
    sandbox: Option<String>,
    source_repo: Option<String>,
    clone_root: Option<String>,
) -> Result<Option<CloneInfo>, String> {
    {
        let guard = state.lock().await;
        if guard.contains_key(&session_id) {
            return Ok(None); // idempotent — no new clone created
        }
        // guard drops here — no lock held across spawn/await (#25).
    }

    let key_name = key_name_for_provider(&provider)?;
    let api_key = std::env::var(key_name).map_err(|_| format!("{key_name} not set"))?;

    // Pick transport. Default (and any non-"host" value) is the container.
    let use_host = sandbox.as_deref() == Some("host");

    // #19: when running in the container AND a source repo + clone root are
    // supplied, create a per-agent `git clone --local` and bind-mount it into
    // the container at `/workspaces/<thread_id>`. The clone is created OUTSIDE
    // the map lock (#25). A clone failure surfaces as `Err` (TS sets the thread
    // to `error`). The mount container path and the clone dir use the SAME
    // thread-id basis (the full `session_id`).
    let clone_info: Option<CloneInfo> = if !use_host {
        match (source_repo.as_deref(), clone_root.as_deref()) {
            (Some(source_repo), Some(clone_root)) => Some(
                clone::create_agent_clone(source_repo, clone_root, &session_id).await?,
            ),
            _ => None,
        }
    } else {
        None
    };

    // Build the transport. The container carries the optional clone mount; the
    // host transport ignores clones entirely.
    let mount = clone_info
        .as_ref()
        .map(|info| (info.clone_dir.clone(), format!("/workspaces/{session_id}")));
    let host = HostProcess;
    let container = ContainerExec {
        container_name: container_name_for_session(&session_id),
        mount,
    };
    let io: &dyn PiIo = if use_host { &host } else { &container };

    // Helper: on any failure AFTER the clone is created, dispose the half-clone
    // (the clone is retained ONLY on success — retention-until-dispose applies
    // to completed runs per plan §1).
    let cleanup_clone = |clone_info: &Option<CloneInfo>| {
        if let Some(info) = clone_info {
            let _ = clone::dispose_clone(&info.clone_dir);
        }
    };

    let svc = match PiService::start(
        session_id.clone(),
        provider,
        model,
        key_name.to_string(),
        api_key,
        app_handle,
        io,
    )
    .await
    {
        Ok(svc) => svc,
        Err(e) => {
            cleanup_clone(&clone_info);
            return Err(e);
        }
    };

    // Readiness gate: nudge pi with `get_state` and await the first `response`
    // (or timeout). On failure, teardown the transport (stop+remove the
    // container) AND dispose the clone before surfacing the error so nothing is
    // orphaned. None of this holds the map lock (#25).
    let _ = svc.get_state().await;
    if let Err(e) = svc.wait_ready(READY_TIMEOUT).await {
        svc.teardown().await;
        cleanup_clone(&clone_info);
        return Err(format!("pi did not become ready: {e}"));
    }

    let mut guard = state.lock().await;
    // Re-check under the lock in case of a concurrent start. If we lost the
    // race, tear down OUR freshly-started session (the winner is already
    // inserted) and dispose OUR clone — but do the teardown AFTER dropping the
    // guard (#25).
    if guard.contains_key(&session_id) {
        drop(guard);
        svc.teardown().await;
        cleanup_clone(&clone_info);
        return Ok(None);
    }
    guard.insert(session_id, svc);
    // On success the clone is retained; return its info so TS persists the
    // `clones` row (`None` for host / no-clone starts).
    Ok(clone_info)
}

/// Send a prompt to an existing pi session (fire-and-forget; events stream back).
///
/// The guard is held only across `svc.prompt`, which is an `mpsc` channel send
/// drained by the writer task (NOT a direct container/stdin write) — it returns
/// promptly and never touches bollard, so #25's "no lock across bollard/stdin
/// IO await" rule is satisfied. Mirrors the codex lock pattern.
#[tauri::command]
pub async fn pi_prompt(
    state: State<'_, PiState>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    let guard = state.lock().await;
    let svc = guard
        .get(&session_id)
        .ok_or_else(|| format!("No pi session for {session_id}"))?;
    svc.prompt(message).await?;
    Ok(())
    // guard drops here
}

/// Abort the current turn (mid-turn cancel; the session stays alive and reusable).
#[tauri::command]
pub async fn pi_abort(state: State<'_, PiState>, session_id: String) -> Result<(), String> {
    let guard = state.lock().await;
    let svc = guard
        .get(&session_id)
        .ok_or_else(|| format!("No pi session for {session_id}"))?;
    svc.abort().await?;
    Ok(())
}

/// Steer the current turn (#20): queue mid-run guidance that Pi applies at the
/// next turn/tool boundary (one-at-a-time mode) — NOT a mid-token interrupt.
///
/// The `message` is serialized Rust-side by `serde_json`, so newlines are
/// escaped and the LF JSONL framing into pi's stdin stays intact. Mirrors
/// `pi_abort`: the guard is held only across `svc.steer`, which is an `mpsc`
/// channel send drained by the writer task — it never touches bollard/stdin IO
/// under the lock, satisfying #25's "no lock across an .await" discipline.
#[tauri::command]
pub async fn pi_steer_agent(
    state: State<'_, PiState>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    let guard = state.lock().await;
    let svc = guard
        .get(&session_id)
        .ok_or_else(|| format!("No pi session for {session_id}"))?;
    svc.steer(message).await?;
    Ok(())
    // guard drops here
}

/// Stop a pi session (transport-aware).
///
/// Remove the `PiService` from the map FIRST (so it is no longer reachable), then
/// `teardown()` stops+removes the container (host arm is a no-op). The host child
/// is reaped by the alive-gated `Drop` when `svc` drops at the end of this
/// function — `Drop` only signals while the supervisor still considers the child
/// live, so a recycled PID is never SIGTERM'd (#26 review). Ordering:
/// `guard.remove()` → drop guard → `svc.teardown().await` → `svc` drops →
/// `Drop` kills the host child if still alive.
///
/// #25: the map lock is dropped before any `teardown`/bollard `.await`.
#[tauri::command]
pub async fn pi_stop(state: State<'_, PiState>, session_id: String) -> Result<(), String> {
    let svc = {
        let mut guard = state.lock().await;
        guard.remove(&session_id)
        // guard drops here — no lock across teardown (#25).
    };
    if let Some(svc) = svc {
        // Container: explicit stop+remove (host arm is a no-op). The host child
        // is reaped by the alive-gated `Drop` when `svc` drops below.
        svc.teardown().await;
    }
    Ok(())
}

/// Probe session liveness. Returns a small JSON object and (best effort) nudges
/// pi with a `get_state` command (ack parsing deferred to #20).
#[tauri::command]
pub async fn pi_get_state(
    state: State<'_, PiState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().await;
    match guard.get(&session_id) {
        Some(svc) => {
            let pid = svc.pid();
            // Authoritative mid-turn flag (#20): `running` = session alive,
            // `agent_running` = agent actively mid-turn (gates UI controls).
            let agent_running = svc.agent_running();
            // Fire-and-forget probe; ack correlation is deferred to #20.
            let _ = svc.get_state().await;
            Ok(json!({ "running": true, "pid": pid, "agent_running": agent_running }))
        }
        None => Ok(json!({ "running": false })),
    }
}

/// Read the authoritative mid-turn flag for `session_id` WITHOUT nudging pi.
///
/// `pi_get_state` fires a `get_state` line into pi's stdin on every call; the UI
/// polls run-state ~1/s while a turn is active, so it uses this probe-free
/// command instead to avoid recurring mid-run stdin traffic (#20). Reads the
/// `AtomicBool` directly; returns `false` if the session is gone.
#[tauri::command]
pub async fn pi_agent_running(
    state: State<'_, PiState>,
    session_id: String,
) -> Result<bool, String> {
    let guard = state.lock().await;
    Ok(guard
        .get(&session_id)
        .map(|svc| svc.agent_running())
        .unwrap_or(false))
}

/// Dispose a per-agent clone dir (#19): best-effort `rm -rf` of the clone's
/// working tree. The command surface only — TS marks the `clones` row
/// `discarded` after a successful call (no UI in #19; #21 adds the button).
/// Missing dirs are treated as success.
#[tauri::command]
pub async fn dispose_clone(clone_dir: String) -> Result<(), String> {
    clone::dispose_clone(&clone_dir)
}

/// Probe whether a clone dir still exists on disk. Used by the TS startup
/// orphan-clone reconcile (#19 TASK 6): an `active` row whose dir has vanished
/// is logged as an orphan. Read-only — never mutates the filesystem.
#[tauri::command]
pub async fn clone_dir_exists(clone_dir: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&clone_dir).exists())
}

/// List the immediate subdirectories of `clone_root` as absolute paths (#19
/// TASK 6). Used by the TS startup orphan-clone reconcile to walk the on-disk
/// `clones/` tree and compare it against the `clones` table: dirs with no row
/// or a `discarded` row are reaped via `dispose_clone`; `active` dirs survive.
///
/// Read-only — never mutates the filesystem. A missing `clone_root` (no clone
/// has ever been created) yields an empty list, not an error.
#[tauri::command]
pub async fn list_clone_dirs(clone_root: String) -> Result<Vec<String>, String> {
    let root = std::path::Path::new(&clone_root);
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("failed to read clone root {clone_root}: {e}")),
    };
    let mut dirs = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read clone root entry: {e}"))?;
        if entry.path().is_dir() {
            dirs.push(entry.path().to_string_lossy().into_owned());
        }
    }
    Ok(dirs)
}

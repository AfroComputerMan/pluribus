use std::collections::HashMap;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

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
) -> Result<(), String> {
    {
        let guard = state.lock().await;
        if guard.contains_key(&session_id) {
            return Ok(()); // idempotent
        }
        // guard drops here — no lock held across spawn/await (#25).
    }

    let key_name = key_name_for_provider(&provider)?;
    let api_key = std::env::var(key_name).map_err(|_| format!("{key_name} not set"))?;

    // Pick transport. Default (and any non-"host" value) is the container.
    let use_host = sandbox.as_deref() == Some("host");
    let host = HostProcess;
    let container = ContainerExec {
        container_name: container_name_for_session(&session_id),
    };
    let io: &dyn PiIo = if use_host { &host } else { &container };

    let svc = PiService::start(
        session_id.clone(),
        provider,
        model,
        key_name.to_string(),
        api_key,
        app_handle,
        io,
    )
    .await?;

    // Readiness gate: nudge pi with `get_state` and await the first `response`
    // (or timeout). On failure, teardown the transport (stop+remove the
    // container) before surfacing the error so nothing is orphaned. None of
    // this holds the map lock (#25).
    let _ = svc.get_state().await;
    if let Err(e) = svc.wait_ready(READY_TIMEOUT).await {
        svc.teardown().await;
        return Err(format!("pi did not become ready: {e}"));
    }

    let mut guard = state.lock().await;
    // Re-check under the lock in case of a concurrent start. If we lost the
    // race, tear down OUR freshly-started session (the winner is already
    // inserted) — but do the teardown AFTER dropping the guard (#25).
    if guard.contains_key(&session_id) {
        drop(guard);
        svc.teardown().await;
        return Ok(());
    }
    guard.insert(session_id, svc);
    Ok(())
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

/// Stop a pi session (transport-aware).
///
/// Remove the `PiService` from the map FIRST (dropping it closes stdin → pi gets
/// EOF), then `teardown()`: host → no-op + `kill_pid` safety-net via the pid;
/// container → `stop_container(t:10)` + `remove_container(force,v)`.
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
        if let Some(pid) = svc.pid() {
            // Host safety-net — dropping svc already closes stdin (EOF -> exit).
            let _ = crate::kill_pid(pid);
        }
        // Container: explicit stop+remove (host arm is a no-op).
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
            // Fire-and-forget probe; ack correlation is deferred to #20.
            let _ = svc.get_state().await;
            Ok(json!({ "running": true, "pid": pid }))
        }
        None => Ok(json!({ "running": false })),
    }
}

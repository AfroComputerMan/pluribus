use std::collections::HashMap;

use serde_json::json;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use super::io::HostProcess;
use super::service::PiService;

/// Per-session store of live `pi` processes (NOT an `Option<T>` singleton).
/// One `PiService` per session id; concurrent threads spawn distinct children.
pub type PiState = Mutex<HashMap<String, PiService>>;

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

/// Start (idempotent) a `pi --mode rpc` session for `session_id`.
///
/// If a session already exists for `session_id` this is a no-op — prevents
/// spawning duplicate children per session. The API key is read from the env by
/// a provider-derived name and injected into the child via `HostProcess`.
#[tauri::command]
pub async fn pi_start_session(
    app_handle: AppHandle,
    state: State<'_, PiState>,
    session_id: String,
    provider: String,
    model: String,
) -> Result<(), String> {
    {
        let guard = state.lock().await;
        if guard.contains_key(&session_id) {
            return Ok(()); // idempotent
        }
    }

    let key_name = key_name_for_provider(&provider)?;
    let api_key = std::env::var(key_name).map_err(|_| format!("{key_name} not set"))?;

    let svc = PiService::start(
        session_id.clone(),
        provider,
        model,
        key_name.to_string(),
        api_key,
        app_handle,
        &HostProcess,
    )
    .await?;

    let mut guard = state.lock().await;
    // Re-check under the lock in case of a concurrent start (last writer wins is
    // fine — but avoid leaking the first child if both raced).
    guard.entry(session_id).or_insert(svc);
    Ok(())
}

/// Send a prompt to an existing pi session (fire-and-forget; events stream back).
///
/// Locks the map only to look up the service and call `prompt`, then drops the
/// guard before any streaming (events flow via the reader's emit). Mirrors the
/// codex lock-release-before-stream pattern.
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

/// Abort the current turn (mid-turn cancel; the process stays alive and reusable).
#[tauri::command]
pub async fn pi_abort(state: State<'_, PiState>, session_id: String) -> Result<(), String> {
    let guard = state.lock().await;
    let svc = guard
        .get(&session_id)
        .ok_or_else(|| format!("No pi session for {session_id}"))?;
    svc.abort().await?;
    Ok(())
}

/// Stop a pi session: remove it from the map (drops `PiService` -> drops
/// `stdin_tx` -> pi gets EOF -> exits code 0), then best-effort kill as a safety net.
#[tauri::command]
pub async fn pi_stop(state: State<'_, PiState>, session_id: String) -> Result<(), String> {
    let svc = {
        let mut guard = state.lock().await;
        guard.remove(&session_id)
    };
    if let Some(svc) = svc {
        if let Some(pid) = svc.pid() {
            // Safety net — dropping svc already closes stdin (EOF -> clean exit).
            let _ = crate::kill_pid(pid);
        }
    }
    Ok(())
}

/// Probe session liveness. For #17 this returns a small JSON object and (best
/// effort) nudges pi with a `get_state` command (ack parsing deferred to #20).
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

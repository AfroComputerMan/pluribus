use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use super::service::CodexService;
use super::types::AgentEvent;

type LazyService = Mutex<Option<CodexService>>;

#[tauri::command]
pub async fn codex_start_thread(
    app_handle: AppHandle,
    state: State<'_, LazyService>,
    model: Option<String>,
    reasoning_effort: Option<String>,
) -> Result<String, String> {
    let mut guard = state.lock().await;
    if guard.is_none() {
        *guard = Some(CodexService::start(app_handle.clone()).await?);
    }
    let svc = guard.as_ref().unwrap();

    let mut params = json!({});
    if let Some(m) = model {
        params["model"] = json!(m);
    }
    if let Some(effort) = reasoning_effort {
        params["reasoningEffort"] = json!(effort);
    }
    let result = svc.request("thread/start", params).await?;
    result
        .get("threadId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Missing threadId in response".to_string())
}

#[tauri::command]
pub async fn codex_send_turn(
    app_handle: AppHandle,
    state: State<'_, LazyService>,
    thread_id: String,
    input: String,
    cwd: Option<String>,
) -> Result<String, String> {
    let mut params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": input }],
    });
    if let Some(dir) = cwd {
        params["cwd"] = json!(dir);
    }

    // Hold the lock only while subscribing and starting the turn
    let (mut rx, turn_id) = {
        let mut guard = state.lock().await;
        if guard.is_none() {
            *guard = Some(CodexService::start(app_handle.clone()).await?);
        }
        let svc = guard.as_ref().unwrap();

        // Subscribe before sending the request so we don't miss early events
        let rx = svc.subscribe(&thread_id).await;

        let result = svc.request("turn/start", params).await?;
        let turn_id = result
            .get("turnId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        (rx, turn_id)
        // guard drops here
    };

    // Spawn a task to stream events from the broadcast receiver as Tauri events
    let stream_turn_id = turn_id.clone();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let is_turn_completed = matches!(
                        &event,
                        AgentEvent::TurnCompleted { turn_id, .. }
                            if *turn_id == stream_turn_id
                    );
                    let _ = app_handle.emit("agent:event", &event);
                    if is_turn_completed {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    });

    Ok(turn_id)
}

#[tauri::command]
pub async fn codex_interrupt_turn(
    app_handle: AppHandle,
    state: State<'_, LazyService>,
    thread_id: String,
    turn_id: String,
) -> Result<(), String> {
    let mut guard = state.lock().await;
    if guard.is_none() {
        *guard = Some(CodexService::start(app_handle.clone()).await?);
    }
    let svc = guard.as_ref().unwrap();
    svc.request(
        "turn/interrupt",
        json!({
            "threadId": thread_id,
            "turnId": turn_id,
        }),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn codex_approve_tool(
    app_handle: AppHandle,
    state: State<'_, LazyService>,
    approval_id: String,
    allow: bool,
) -> Result<(), String> {
    let mut guard = state.lock().await;
    if guard.is_none() {
        *guard = Some(CodexService::start(app_handle.clone()).await?);
    }
    let svc = guard.as_ref().unwrap();
    let decision = if allow { "allow" } else { "deny" };
    svc.request(
        "turn/approval/respond",
        json!({
            "approvalId": approval_id,
            "decision": decision,
        }),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn codex_get_auth_status(
    app_handle: AppHandle,
    state: State<'_, LazyService>,
) -> Result<serde_json::Value, String> {
    let mut guard = state.lock().await;
    if guard.is_none() {
        *guard = Some(CodexService::start(app_handle.clone()).await?);
    }
    let svc = guard.as_ref().unwrap();
    svc.request("account/read", json!({})).await
}

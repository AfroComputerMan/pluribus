use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use super::service::CodexService;
use super::types::AgentEvent;

#[tauri::command]
pub async fn codex_start_thread(
    state: State<'_, CodexService>,
    model: Option<String>,
) -> Result<String, String> {
    let mut params = json!({});
    if let Some(m) = model {
        params["model"] = json!(m);
    }
    let result = state.request("thread/start", params).await?;
    result
        .get("threadId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Missing threadId in response".to_string())
}

#[tauri::command]
pub async fn codex_send_turn(
    app_handle: AppHandle,
    state: State<'_, CodexService>,
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

    // Subscribe before sending the request so we don't miss early events
    let mut rx = state.subscribe(&thread_id).await;

    let result = state.request("turn/start", params).await?;
    let turn_id = result
        .get("turnId")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

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
    state: State<'_, CodexService>,
    thread_id: String,
    turn_id: String,
) -> Result<(), String> {
    state
        .request(
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
    state: State<'_, CodexService>,
    approval_id: String,
    allow: bool,
) -> Result<(), String> {
    let decision = if allow { "allow" } else { "deny" };
    state
        .request(
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
    state: State<'_, CodexService>,
) -> Result<serde_json::Value, String> {
    state.request("account/read", json!({})).await
}

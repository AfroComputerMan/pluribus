use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};

use super::types::{AgentEvent, Usage};

pub struct CodexService {
    /// Write JSON-RPC requests here; stdin_writer task drains this.
    stdin_tx: mpsc::Sender<String>,
    /// Pending request/response correlations (by JSON-RPC id).
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    /// Per-thread broadcast channels for streaming turn events.
    thread_subs: Arc<Mutex<HashMap<String, broadcast::Sender<AgentEvent>>>>,
    /// Monotonic request ID counter.
    next_id: Arc<AtomicU64>,
}

impl CodexService {
    /// Spawn `codex app-server` and wire up the three Tokio tasks.
    pub async fn start(app_handle: AppHandle) -> Result<Self, String> {
        let mut child = Command::new("codex")
            .arg("app-server")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn codex app-server: {e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture codex stdout".to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture codex stdin".to_string())?;

        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let thread_subs: Arc<Mutex<HashMap<String, broadcast::Sender<AgentEvent>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (stdin_tx, stdin_rx) = mpsc::channel::<String>(256);

        // stdout_reader task
        {
            let pending = Arc::clone(&pending);
            let thread_subs = Arc::clone(&thread_subs);
            let app_handle = app_handle.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let msg: Value = match serde_json::from_str(&line) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    // Response: has "id" field — route to pending oneshot
                    if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                        let mut map = pending.lock().await;
                        if let Some(tx) = map.remove(&id) {
                            let response = if let Some(err) = msg.get("error") {
                                let message = err
                                    .get("message")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Unknown JSON-RPC error");
                                let code = err
                                    .get("code")
                                    .and_then(|v| v.as_i64())
                                    .unwrap_or(-1);
                                Err(format!("JSON-RPC error {code}: {message}"))
                            } else {
                                Ok(msg
                                    .get("result")
                                    .cloned()
                                    .unwrap_or_else(|| msg.clone()))
                            };
                            let _ = tx.send(response);
                        }
                        continue;
                    }

                    // Notification: no "id", has "method"
                    let method = match msg.get("method").and_then(|v| v.as_str()) {
                        Some(m) => m.to_string(),
                        None => continue,
                    };
                    let params = msg.get("params").cloned().unwrap_or(json!({}));

                    let thread_id = params
                        .get("threadId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let event = match method.as_str() {
                        "turn/started" => {
                            let tid = thread_id.clone().unwrap_or_default();
                            let turn_id = params
                                .get("turnId")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            Some(AgentEvent::TurnStarted {
                                thread_id: tid,
                                turn_id,
                            })
                        }
                        "item/agentMessage/delta" => {
                            let tid = thread_id.clone().unwrap_or_default();
                            let item_id = params
                                .get("itemId")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let delta = params
                                .get("delta")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            Some(AgentEvent::ItemDelta {
                                thread_id: tid,
                                item_id,
                                delta,
                            })
                        }
                        "item/completed" => {
                            let tid = thread_id.clone().unwrap_or_default();
                            let item = params.get("item").cloned().unwrap_or(json!({}));
                            let item_id = item
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            Some(AgentEvent::ItemCompleted {
                                thread_id: tid,
                                item_id,
                                item,
                            })
                        }
                        "turn/completed" => {
                            let tid = thread_id.clone().unwrap_or_default();
                            let turn_id = params
                                .get("turn")
                                .and_then(|t| t.get("id"))
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let usage: Usage = serde_json::from_value(
                                params.get("usage").cloned().unwrap_or(json!({
                                    "input_tokens": 0,
                                    "output_tokens": 0,
                                })),
                            )
                            .unwrap_or(Usage {
                                input_tokens: 0,
                                output_tokens: 0,
                            });
                            Some(AgentEvent::TurnCompleted {
                                thread_id: tid,
                                turn_id,
                                usage,
                            })
                        }
                        "turn/approval/requested" => {
                            let tid = thread_id.clone().unwrap_or_default();
                            let approval_id = params
                                .get("approvalId")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let command = params
                                .get("command")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let reason = params
                                .get("reason")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            Some(AgentEvent::ApprovalNeeded {
                                thread_id: tid,
                                approval_id,
                                command,
                                reason,
                            })
                        }
                        "account/updated" => {
                            let auth_mode = params
                                .get("authMode")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let username = params
                                .get("username")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            let event = AgentEvent::AuthChanged {
                                auth_mode,
                                username,
                            };
                            let _ = app_handle.emit("agent:auth", &event);
                            Some(event)
                        }
                        _ => None,
                    };

                    // Broadcast event to thread subscribers
                    if let (Some(event), Some(tid)) = (event, &thread_id) {
                        let subs = thread_subs.lock().await;
                        if let Some(tx) = subs.get(tid) {
                            let _ = tx.send(event);
                        }
                    }
                }
            });
        }

        // stdin_writer task
        {
            let mut stdin = stdin;
            let mut stdin_rx = stdin_rx;
            tokio::spawn(async move {
                while let Some(line) = stdin_rx.recv().await {
                    if stdin.write_all(line.as_bytes()).await.is_err() {
                        break;
                    }
                    if stdin.write_all(b"\n").await.is_err() {
                        break;
                    }
                    if stdin.flush().await.is_err() {
                        break;
                    }
                }
            });
        }

        // supervisor task
        {
            let app_handle = app_handle.clone();
            tokio::spawn(async move {
                let status = child.wait().await;
                let msg = match status {
                    Ok(s) => format!("codex app-server exited with status: {s}"),
                    Err(e) => format!("codex app-server process error: {e}"),
                };
                let event = AgentEvent::ProcessError { message: msg };
                let _ = app_handle.emit("agent:event", &event);
            });
        }

        let svc = Self {
            stdin_tx,
            pending,
            thread_subs,
            next_id: Arc::new(AtomicU64::new(1)),
        };

        // The app-server protocol requires an initialize handshake before any
        // other requests can be made.
        svc.request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": env!("CARGO_PKG_NAME"),
                    "version": env!("CARGO_PKG_VERSION"),
                }
            }),
        )
        .await
        .map_err(|e| format!("codex app-server initialize failed: {e}"))?;

        Ok(svc)
    }

    /// Send a JSON-RPC request and await its response.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();

        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }

        let msg = json!({
            "method": method,
            "id": id,
            "params": params,
        });
        let line = serde_json::to_string(&msg).map_err(|e| format!("Serialize error: {e}"))?;
        self.stdin_tx
            .send(line)
            .await
            .map_err(|e| format!("Failed to send to stdin: {e}"))?;

        rx.await
            .map_err(|_| "Response channel closed".to_string())?
    }

    /// Subscribe to streaming events for a specific thread.
    /// Lazily creates the broadcast channel if it doesn't exist.
    pub async fn subscribe(&self, thread_id: &str) -> broadcast::Receiver<AgentEvent> {
        let mut subs = self.thread_subs.lock().await;
        let tx = subs
            .entry(thread_id.to_string())
            .or_insert_with(|| broadcast::channel(256).0);
        tx.subscribe()
    }
}

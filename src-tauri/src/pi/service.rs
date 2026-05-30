use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{broadcast, mpsc};

use super::io::PiIo;
use super::types::PiEvent;

/// A single, per-session `pi --mode rpc` process and its three Tokio tasks.
///
/// One `PiService` lives per session inside the `Mutex<HashMap<String, PiService>>`
/// managed state (NOT a singleton — unlike `CodexService`). Pi's protocol is
/// type-framed JSONL with NO `initialize` handshake (ADR 0005).
pub struct PiService {
    /// Write JSONL commands here; the stdin_writer task drains this.
    stdin_tx: mpsc::Sender<String>,
    /// Per-session broadcast of events (seed for #20 get_state/set_model ack
    /// correlation). The reader emits to the frontend directly; this is best-effort.
    events: broadcast::Sender<PiEvent>,
    /// Monotonic id counter, seeded for future get_state/set_model ack correlation.
    #[allow(dead_code)]
    next_id: Arc<AtomicU64>,
    /// PID of the `pi` child (captured before moving child into the supervisor).
    child_pid: u32,
    /// This session's id, injected into every emitted `PiEvent` (Pi carries none).
    session_id: String,
}

impl PiService {
    /// Spawn `pi --mode rpc` for `session_id` and wire up reader/writer/supervisor.
    ///
    /// On spawn failure returns `Err` inline (the caller surfaces it as a crash
    /// toast). The supervisor only emits `ProcessExit` — exit code 0 is normal
    /// (stdin EOF / abort), so it is NOT treated as an error.
    pub async fn start(
        session_id: String,
        provider: String,
        model: String,
        key_name: String,
        api_key: String,
        app_handle: AppHandle,
        io: &dyn PiIo,
    ) -> Result<Self, String> {
        let (mut child, stdout, stdin) = io.spawn(&provider, &model, &key_name, &api_key)?;

        // Higher capacity than codex (256): Pi emits high-rate token deltas; a
        // lagged receiver drops events. The frontend gets events via direct emit.
        let (events, _) = broadcast::channel::<PiEvent>(1024);
        let (stdin_tx, stdin_rx) = mpsc::channel::<String>(256);

        // stdout_reader task
        {
            let events = events.clone();
            let app_handle = app_handle.clone();
            let session_id = session_id.clone();
            // Clone so the reader can auto-answer extension_ui_request via stdin.
            let reader_stdin_tx = stdin_tx.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let msg: Value = match serde_json::from_str(&line) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    let kind = match msg.get("type").and_then(|v| v.as_str()) {
                        Some(k) => k,
                        None => continue,
                    };

                    let ev: Option<PiEvent> = match kind {
                        // Command ack ({type:"response",command,success}). The id is
                        // an echo, not a terminator — ignore (no pending-oneshot map).
                        "response" => None,

                        "agent_start" => Some(PiEvent::AgentStart {
                            session_id: session_id.clone(),
                        }),
                        "turn_start" => Some(PiEvent::TurnStart {
                            session_id: session_id.clone(),
                        }),
                        "turn_end" => Some(PiEvent::TurnEnd {
                            session_id: session_id.clone(),
                        }),
                        // TERMINATOR for the prompt (NOT turn_end).
                        "agent_end" => Some(PiEvent::AgentEnd {
                            session_id: session_id.clone(),
                        }),

                        // The prompt is echoed back as role:"user"; tool results
                        // arrive as role:"toolResult". Both are skipped — deltas
                        // (message_update) and tool_execution_* carry the content.
                        "message_start" | "message_end" => None,

                        // Streaming deltas live in assistantMessageEvent.{type,contentIndex,delta}.
                        // Read `delta` only — never `message.content` (ADR 0005).
                        "message_update" => {
                            let ame = msg.get("assistantMessageEvent");
                            match ame {
                                Some(ame) => {
                                    let sub = ame.get("type").and_then(|v| v.as_str());
                                    let content_index = ame
                                        .get("contentIndex")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0)
                                        as u32;
                                    let delta = ame
                                        .get("delta")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or_default()
                                        .to_string();
                                    match sub {
                                        Some("text_delta") => Some(PiEvent::TextDelta {
                                            session_id: session_id.clone(),
                                            content_index,
                                            delta,
                                        }),
                                        Some("thinking_delta") => Some(PiEvent::ThinkingDelta {
                                            session_id: session_id.clone(),
                                            content_index,
                                            delta,
                                        }),
                                        // *_start / *_end sub-events: ignore (provider
                                        // resets indices on turn_start instead).
                                        _ => None,
                                    }
                                }
                                None => None,
                            }
                        }

                        "tool_execution_start" => {
                            let tool_call_id = msg
                                .get("toolCallId")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let tool_name = msg
                                .get("toolName")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let args = msg.get("args").cloned().unwrap_or(json!({}));
                            Some(PiEvent::ToolStart {
                                session_id: session_id.clone(),
                                tool_call_id,
                                tool_name,
                                args,
                            })
                        }
                        "tool_execution_end" => {
                            let tool_call_id = msg
                                .get("toolCallId")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let tool_name = msg
                                .get("toolName")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let result = msg.get("result").cloned().unwrap_or(json!(null));
                            let is_error =
                                msg.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
                            Some(PiEvent::ToolEnd {
                                session_id: session_id.clone(),
                                tool_call_id,
                                tool_name,
                                result,
                                is_error,
                            })
                        }

                        // A Skill/Extension can call extension_ui_request and will
                        // BLOCK the agent indefinitely until answered. Auto-cancel
                        // (VERIFIED shape: {type:"extension_ui_response",id,cancelled:true};
                        // keyed by id, NOT action:"cancel"). Not surfaced to the UI in #17.
                        "extension_ui_request" => {
                            let id = msg.get("id").cloned();
                            if let Some(id) = id {
                                let reply = json!({
                                    "type": "extension_ui_response",
                                    "id": id,
                                    "cancelled": true,
                                });
                                if let Ok(line) = serde_json::to_string(&reply) {
                                    let _ = reader_stdin_tx.send(line).await;
                                }
                            }
                            None
                        }

                        _ => None,
                    };

                    if let Some(ev) = ev {
                        // Best-effort broadcast (seed for #20). Lagged receivers
                        // drop, which is why the authoritative path is direct emit.
                        let _ = events.send(ev.clone());
                        // Events already carry session_id, so emit directly — the
                        // frontend listener filters by session_id.
                        let _ = app_handle.emit("pi:event", &ev);
                    }
                }
            });
        }

        // stdin_writer task — strict LF JSONL (write_all + b"\n" + flush).
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

        // Capture PID before moving child into the supervisor task.
        let child_pid = child.id().unwrap_or(0);

        // supervisor task — exit code 0 is NORMAL (stdin EOF / abort).
        {
            let app_handle = app_handle.clone();
            let session_id = session_id.clone();
            tokio::spawn(async move {
                let status = child.wait().await;
                let code = match status {
                    Ok(s) => s.code(),
                    Err(_) => None,
                };
                let _ = app_handle.emit(
                    "pi:event",
                    &PiEvent::ProcessExit {
                        session_id: session_id.clone(),
                        code,
                    },
                );
            });
        }

        Ok(Self {
            stdin_tx,
            events,
            next_id: Arc::new(AtomicU64::new(1)),
            child_pid,
            session_id,
        })
    }

    /// Send a raw JSONL command line to pi (fire-and-forget).
    async fn send(&self, value: Value) -> Result<(), String> {
        let line = serde_json::to_string(&value).map_err(|e| format!("Serialize error: {e}"))?;
        self.stdin_tx
            .send(line)
            .await
            .map_err(|e| format!("Failed to send to pi stdin: {e}"))
    }

    /// Send `{type:"prompt",message}` — fire-and-forget; events arrive on the stream.
    pub async fn prompt(&self, message: String) -> Result<(), String> {
        self.send(json!({ "type": "prompt", "message": message }))
            .await
    }

    /// Send `{type:"abort"}` — halts the current turn promptly (~6ms to agent_end).
    pub async fn abort(&self) -> Result<(), String> {
        self.send(json!({ "type": "abort" })).await
    }

    /// Send `{type:"set_model",provider,model}` (internal seed for #20).
    #[allow(dead_code)]
    pub async fn set_model(&self, provider: String, model_id: String) -> Result<(), String> {
        self.send(json!({ "type": "set_model", "provider": provider, "model": model_id }))
            .await
    }

    /// Send `{type:"get_state"}` (fire-and-forget; ack parsing deferred to #20).
    pub async fn get_state(&self) -> Result<(), String> {
        self.send(json!({ "type": "get_state" })).await
    }

    /// Subscribe to this session's event broadcast (seed for #20).
    #[allow(dead_code)]
    pub fn subscribe(&self) -> broadcast::Receiver<PiEvent> {
        self.events.subscribe()
    }

    /// This session's id.
    #[allow(dead_code)]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// PID of the `pi` child, or `None` if it was not captured.
    pub fn pid(&self) -> Option<u32> {
        if self.child_pid == 0 {
            None
        } else {
            Some(self.child_pid)
        }
    }
}

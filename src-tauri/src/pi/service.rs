use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex as TokioMutex};

use super::io::{PiHandle, PiIo, PiTransport};
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
    /// Host PID for the `pi_stop` kill safety-net (`None` for container transport).
    pid: Option<u32>,
    /// Transport teardown view: host (no-op — drop EOFs stdin, `pi_stop` kills
    /// the pid) or container (stop+remove). This is a clone-free *teardown-only*
    /// projection of the spawn `PiHandle`; the owning `PiHandle` (with the host
    /// child / the exec wait state) is moved into the supervisor task, so the
    /// two never contend.
    teardown: PiTeardown,
    /// One-shot readiness signal (#18): resolved by the reader on the first
    /// `{type:"response"}`. `wait_ready` takes it (once) and awaits with a
    /// timeout so `pi_start_session` can gate the first prompt on pi being live.
    ready_rx: TokioMutex<Option<oneshot::Receiver<()>>>,
    /// This session's id, injected into every emitted `PiEvent` (Pi carries none).
    session_id: String,
    /// Authoritative agent run-state (#20): `true` between `agent_start`/
    /// `turn_start` and `agent_end`; cleared on process exit. The reader and
    /// supervisor own writers; `pi_get_state` reads it to gate the UI steer/
    /// abort controls (instead of relying on `thread.isRunning`).
    running: Arc<AtomicBool>,
}

impl Drop for PiService {
    /// Host backstop (#26): kill the pid so the child is reaped regardless of
    /// stdin EOF (the stdout reader holds a stdin_tx clone, so dropping alone
    /// never EOFs the child). Container reaping stays on the explicit async
    /// path (`teardown`) plus the startup label reconcile — Drop cannot run
    /// bollard's async teardown. A `None` pid (container transport) is a no-op.
    fn drop(&mut self) {
        if let Some(pid) = self.pid {
            let _ = crate::kill_pid(pid);
        }
    }
}

/// Teardown-only projection of `PiHandle`, owned by `PiService` so `pi_stop` /
/// window-close can stop+remove the container without touching the supervisor's
/// owned handle. Host is a pure no-op; the container variant carries a cloned
/// bollard client + the container id (both cheap to clone).
enum PiTeardown {
    Host,
    Container {
        docker: bollard::Docker,
        container_id: String,
    },
}

impl PiTeardown {
    /// Derive a teardown view from the spawn handle WITHOUT consuming it (the
    /// handle itself is moved into the supervisor for `wait()`).
    fn from_handle(handle: &PiHandle) -> Self {
        match handle {
            PiHandle::Host(_) => PiTeardown::Host,
            PiHandle::Container {
                docker,
                container_id,
                ..
            } => PiTeardown::Container {
                docker: docker.clone(),
                container_id: container_id.clone(),
            },
        }
    }

    /// Stop+remove the container (best-effort); host is a no-op. Mirrors
    /// `PiHandle::teardown` for the container path.
    async fn teardown(&self) {
        match self {
            PiTeardown::Host => { /* drop EOFs stdin; pi_stop kills the pid */ }
            PiTeardown::Container {
                docker,
                container_id,
            } => {
                super::container::stop_and_remove(docker, container_id).await;
            }
        }
    }
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
        let PiTransport {
            stdout,
            stdin,
            handle,
        } = io.spawn(&provider, &model, &key_name, &api_key).await?;

        // Host PID for the kill safety-net; teardown view for container stop+remove.
        // Derive both BEFORE the handle is moved into the supervisor task.
        let pid = handle.pid();
        let teardown = PiTeardown::from_handle(&handle);

        // Higher capacity than codex (256): Pi emits high-rate token deltas; a
        // lagged receiver drops events. The frontend gets events via direct emit.
        let (events, _) = broadcast::channel::<PiEvent>(1024);
        let (stdin_tx, stdin_rx) = mpsc::channel::<String>(256);

        // Readiness gate (#18): `start_exec`/spawn returns BEFORE pi is listening.
        // The reader resolves this oneshot on the first `{type:"response"}` (the
        // `get_state` ack the caller sends); `wait_ready` awaits it with a timeout.
        // Host resolves it just as fast (pi acks immediately).
        let (ready_tx, ready_rx) = oneshot::channel::<()>();

        // Authoritative agent run-state (#20). Cloned into the reader (flips on
        // agent_start/turn_start/agent_end) and the supervisor (clears on exit).
        let running = Arc::new(AtomicBool::new(false));

        // stdout_reader task
        {
            let events = events.clone();
            let app_handle = app_handle.clone();
            let session_id = session_id.clone();
            // Clone so the reader can auto-answer extension_ui_request via stdin.
            let reader_stdin_tx = stdin_tx.clone();
            // Clone the run-state Arc so the reader can flip it (like session_id).
            let running = running.clone();
            let mut ready_tx = Some(ready_tx);
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
                        // Additionally resolve the readiness gate on the FIRST
                        // response (#18): pi is now listening on stdin.
                        "response" => {
                            if let Some(tx) = ready_tx.take() {
                                let _ = tx.send(());
                            }
                            None
                        }

                        "agent_start" => {
                            running.store(true, Ordering::SeqCst);
                            Some(PiEvent::AgentStart {
                                session_id: session_id.clone(),
                            })
                        }
                        "turn_start" => {
                            running.store(true, Ordering::SeqCst);
                            Some(PiEvent::TurnStart {
                                session_id: session_id.clone(),
                            })
                        }
                        "turn_end" => Some(PiEvent::TurnEnd {
                            session_id: session_id.clone(),
                        }),
                        // TERMINATOR for the prompt (NOT turn_end).
                        "agent_end" => {
                            running.store(false, Ordering::SeqCst);
                            Some(PiEvent::AgentEnd {
                                session_id: session_id.clone(),
                            })
                        }

                        // A steer queued in Pi's default one-at-a-time mode (#20):
                        // surfaced to the UI as a transient "steer queued" signal.
                        // Pi emits queue_update TWICE — once when a steer is
                        // QUEUED (`steering` non-empty) and again when it is
                        // CONSUMED at the next turn (`steering` empty). Only emit
                        // on the queued edge so the UI doesn't flash "queued"
                        // when the steer is actually being applied (verified
                        // shape: {type:"queue_update",steering:[...],followUp:[...]}).
                        "queue_update" => {
                            let queued = msg
                                .get("steering")
                                .and_then(|v| v.as_array())
                                .map(|a| !a.is_empty())
                                .unwrap_or(false);
                            if queued {
                                Some(PiEvent::QueueUpdate {
                                    session_id: session_id.clone(),
                                })
                            } else {
                                None
                            }
                        }

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

        // supervisor task — exit code 0 is NORMAL (stdin EOF / abort).
        // Owns the spawn `PiHandle` and blocks on `handle.wait()` (host:
        // child.wait().code(); container: poll inspect_exec until running:false).
        {
            let app_handle = app_handle.clone();
            let session_id = session_id.clone();
            let mut handle = handle;
            // Clone so the supervisor can clear the run-state on process exit.
            let running = running.clone();
            tokio::spawn(async move {
                let code = handle.wait().await;
                running.store(false, Ordering::SeqCst);
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
            pid,
            teardown,
            ready_rx: TokioMutex::new(Some(ready_rx)),
            session_id,
            running,
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

    /// Send `{type:"steer",message}` (#20) — queues mid-run guidance, applied at
    /// the next turn/tool boundary (one-at-a-time mode), NOT a mid-token
    /// interrupt. `serde_json` escapes newlines, so LF JSONL framing is safe.
    pub async fn steer(&self, message: String) -> Result<(), String> {
        self.send(json!({ "type": "steer", "message": message }))
            .await
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

    /// Host PID for the `pi_stop` kill safety-net; `None` for container sessions.
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// Authoritative agent run-state (#20): `true` while the agent is mid-turn
    /// (between `agent_start`/`turn_start` and `agent_end`/exit). Used by
    /// `pi_get_state` to gate the UI steer/abort controls.
    pub fn agent_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Block until pi is ready (first `{type:"response"}`) or `timeout` elapses.
    ///
    /// Returns `Ok(())` on the readiness signal, `Err` on timeout / channel drop
    /// (the reader task died before any response). Idempotent-ish: the receiver
    /// is consumed on first call, so a second call returns `Err` immediately.
    pub async fn wait_ready(&self, timeout: std::time::Duration) -> Result<(), String> {
        let rx = {
            let mut guard = self.ready_rx.lock().await;
            guard.take()
        };
        let rx = rx.ok_or_else(|| "readiness already consumed".to_string())?;
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(_)) => Err("pi reader closed before ready".to_string()),
            Err(_) => Err("pi did not become ready in time".to_string()),
        }
    }

    /// Transport-aware session-end teardown: container → stop+remove; host → no-op
    /// (the `pi_stop` `kill_pid` safety-net handles the host child).
    pub async fn teardown(&self) {
        self.teardown.teardown().await;
    }
}

use serde::Serialize;

/// Outbound Tauri events (Rust -> frontend) for the Pi RPC bridge.
///
/// Pi's `--mode rpc` protocol is type-framed JSONL (NOT JSON-RPC). The raw
/// `AgentEvent` stream carries NO session/thread id, so the reader injects
/// `PiService.session_id` into every variant. The frontend `pi-provider.ts`
/// filters incoming `pi:event` payloads by `session_id`.
///
/// Serialized with `#[serde(tag = "type", rename_all = "snake_case")]` so the
/// TS union in `pi-provider.ts` can discriminate on the `type` field.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PiEvent {
    AgentStart {
        session_id: String,
    },
    TurnStart {
        session_id: String,
    },
    TextDelta {
        session_id: String,
        content_index: u32,
        delta: String,
    },
    ThinkingDelta {
        session_id: String,
        content_index: u32,
        delta: String,
    },
    ToolStart {
        session_id: String,
        tool_call_id: String,
        tool_name: String,
        args: serde_json::Value,
    },
    ToolEnd {
        session_id: String,
        tool_call_id: String,
        tool_name: String,
        result: serde_json::Value,
        is_error: bool,
    },
    TurnEnd {
        session_id: String,
    },
    /// Terminator for a prompt (NOT `turn_end`).
    AgentEnd {
        session_id: String,
    },
    ProcessExit {
        session_id: String,
        code: Option<i32>,
    },
    ProcessError {
        session_id: String,
        message: String,
    },
}

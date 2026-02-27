use serde::{Deserialize, Serialize};

/// Outbound Tauri events (Rust -> frontend).
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TurnStarted {
        thread_id: String,
        turn_id: String,
    },
    ItemDelta {
        thread_id: String,
        item_id: String,
        delta: String,
    },
    ItemCompleted {
        thread_id: String,
        item_id: String,
        item: serde_json::Value,
    },
    TurnCompleted {
        thread_id: String,
        turn_id: String,
        usage: Usage,
    },
    ApprovalNeeded {
        thread_id: String,
        approval_id: String,
        command: String,
        reason: Option<String>,
    },
    AuthChanged {
        auth_mode: String,
        username: Option<String>,
    },
    ProcessError {
        message: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

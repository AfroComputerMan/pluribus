/// Process management for spawning and monitoring Claude Code instances
///
/// This module handles:
/// - Spawning claude CLI processes with proper stdio pipes
/// - Managing process lifecycle (start, stop, restart)
/// - Streaming stdout/stderr to frontend via events
/// - Session state machine transitions

pub mod manager;
pub mod session;

pub use manager::{abort_session, send_to_stdin, spawn_session, SpawnConfig, SessionInfo};

#[cfg(unix)]
pub use manager::{pause_session, resume_session};

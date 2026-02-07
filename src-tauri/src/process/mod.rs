/// Process management for spawning and monitoring Claude Code instances
///
/// This module will handle:
/// - Spawning claude CLI processes with proper stdio pipes
/// - Managing process lifecycle (start, stop, restart)
/// - Streaming stdout/stderr to frontend via events
/// - Process health monitoring and automatic restart

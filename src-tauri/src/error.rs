use serde::{Deserialize, Serialize};

/// Application-level errors
#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
pub enum AppError {
    #[error("Process error: {0}")]
    Process(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Worktree not found: {0}")]
    WorktreeNotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::InvalidInput(err.to_string())
    }
}

/// Result type alias for application operations
pub type AppResult<T> = Result<T, AppError>;

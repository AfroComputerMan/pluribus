use crate::error::{AppError, AppResult};
use crate::state::{SessionHandle, SessionStatus};

/// Session state machine transitions
impl SessionHandle {
    /// Transition to Running state
    pub fn transition_to_running(&mut self) -> AppResult<()> {
        match self.status {
            SessionStatus::Created => {
                self.status = SessionStatus::Running;
                Ok(())
            }
            SessionStatus::Paused => {
                self.status = SessionStatus::Running;
                Ok(())
            }
            SessionStatus::Completed | SessionStatus::Failed => {
                // Allow resuming completed/failed sessions
                self.status = SessionStatus::Running;
                Ok(())
            }
            _ => Err(AppError::InvalidInput(format!(
                "Cannot transition from {:?} to Running",
                self.status
            ))),
        }
    }

    /// Transition to Completed state
    pub fn transition_to_completed(&mut self) -> AppResult<()> {
        match self.status {
            SessionStatus::Running => {
                self.status = SessionStatus::Completed;
                Ok(())
            }
            _ => Err(AppError::InvalidInput(format!(
                "Cannot transition from {:?} to Completed",
                self.status
            ))),
        }
    }

    /// Transition to Failed state
    pub fn transition_to_failed(&mut self) -> AppResult<()> {
        match self.status {
            SessionStatus::Running => {
                self.status = SessionStatus::Failed;
                Ok(())
            }
            _ => Err(AppError::InvalidInput(format!(
                "Cannot transition from {:?} to Failed",
                self.status
            ))),
        }
    }

    /// Transition to Killed state
    pub fn transition_to_killed(&mut self) -> AppResult<()> {
        match self.status {
            SessionStatus::Running | SessionStatus::Paused => {
                self.status = SessionStatus::Killed;
                Ok(())
            }
            _ => Err(AppError::InvalidInput(format!(
                "Cannot transition from {:?} to Killed",
                self.status
            ))),
        }
    }

    /// Transition to Paused state
    pub fn transition_to_paused(&mut self) -> AppResult<()> {
        match self.status {
            SessionStatus::Running => {
                self.status = SessionStatus::Paused;
                Ok(())
            }
            _ => Err(AppError::InvalidInput(format!(
                "Cannot transition from {:?} to Paused",
                self.status
            ))),
        }
    }

    /// Check if session can be resumed
    pub fn can_resume(&self) -> bool {
        matches!(
            self.status,
            SessionStatus::Paused | SessionStatus::Completed | SessionStatus::Failed
        )
    }

    /// Check if session is active
    pub fn is_active(&self) -> bool {
        matches!(self.status, SessionStatus::Running | SessionStatus::Paused)
    }

    /// Check if session is terminal
    pub fn is_terminal(&self) -> bool {
        matches!(
            self.status,
            SessionStatus::Completed | SessionStatus::Failed | SessionStatus::Killed
        )
    }

    /// Set the Claude session ID from SystemMessage
    pub fn set_claude_session_id(&mut self, claude_session_id: String) {
        self.claude_session_id = Some(claude_session_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_session() -> SessionHandle {
        SessionHandle::new(
            "test-123".to_string(),
            "/tmp/project".to_string(),
            None,
            "claude-opus-4".to_string(),
            "autonomous".to_string(),
        )
    }

    #[test]
    fn test_created_to_running() {
        let mut session = create_test_session();
        assert_eq!(session.status, SessionStatus::Created);
        assert!(session.transition_to_running().is_ok());
        assert_eq!(session.status, SessionStatus::Running);
    }

    #[test]
    fn test_running_to_completed() {
        let mut session = create_test_session();
        session.status = SessionStatus::Running;
        assert!(session.transition_to_completed().is_ok());
        assert_eq!(session.status, SessionStatus::Completed);
    }

    #[test]
    fn test_running_to_failed() {
        let mut session = create_test_session();
        session.status = SessionStatus::Running;
        assert!(session.transition_to_failed().is_ok());
        assert_eq!(session.status, SessionStatus::Failed);
    }

    #[test]
    fn test_running_to_killed() {
        let mut session = create_test_session();
        session.status = SessionStatus::Running;
        assert!(session.transition_to_killed().is_ok());
        assert_eq!(session.status, SessionStatus::Killed);
    }

    #[test]
    fn test_running_to_paused() {
        let mut session = create_test_session();
        session.status = SessionStatus::Running;
        assert!(session.transition_to_paused().is_ok());
        assert_eq!(session.status, SessionStatus::Paused);
    }

    #[test]
    fn test_paused_to_running() {
        let mut session = create_test_session();
        session.status = SessionStatus::Paused;
        assert!(session.transition_to_running().is_ok());
        assert_eq!(session.status, SessionStatus::Running);
    }

    #[test]
    fn test_completed_to_running() {
        let mut session = create_test_session();
        session.status = SessionStatus::Completed;
        assert!(session.transition_to_running().is_ok());
        assert_eq!(session.status, SessionStatus::Running);
    }

    #[test]
    fn test_invalid_transition() {
        let mut session = create_test_session();
        session.status = SessionStatus::Completed;
        assert!(session.transition_to_failed().is_err());
    }

    #[test]
    fn test_can_resume() {
        let mut session = create_test_session();
        session.status = SessionStatus::Paused;
        assert!(session.can_resume());

        session.status = SessionStatus::Completed;
        assert!(session.can_resume());

        session.status = SessionStatus::Failed;
        assert!(session.can_resume());

        session.status = SessionStatus::Running;
        assert!(!session.can_resume());
    }

    #[test]
    fn test_is_active() {
        let mut session = create_test_session();
        session.status = SessionStatus::Running;
        assert!(session.is_active());

        session.status = SessionStatus::Paused;
        assert!(session.is_active());

        session.status = SessionStatus::Completed;
        assert!(!session.is_active());
    }

    #[test]
    fn test_is_terminal() {
        let mut session = create_test_session();
        session.status = SessionStatus::Completed;
        assert!(session.is_terminal());

        session.status = SessionStatus::Failed;
        assert!(session.is_terminal());

        session.status = SessionStatus::Killed;
        assert!(session.is_terminal());

        session.status = SessionStatus::Running;
        assert!(!session.is_terminal());
    }

    #[test]
    fn test_set_claude_session_id() {
        let mut session = create_test_session();
        assert!(session.claude_session_id.is_none());
        session.set_claude_session_id("claude-456".to_string());
        assert_eq!(session.claude_session_id, Some("claude-456".to_string()));
    }
}

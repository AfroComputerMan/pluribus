use crate::state::SessionHandle;

/// Session utility methods
impl SessionHandle {
    /// Check if session can be resumed
    pub fn can_resume(&self) -> bool {
        use crate::state::SessionStatus;
        matches!(
            self.status,
            SessionStatus::Paused | SessionStatus::Completed | SessionStatus::Failed
        )
    }

    /// Check if session is active
    pub fn is_active(&self) -> bool {
        use crate::state::SessionStatus;
        matches!(self.status, SessionStatus::Running | SessionStatus::Paused)
    }

    /// Check if session is terminal
    pub fn is_terminal(&self) -> bool {
        use crate::state::SessionStatus;
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
    use crate::state::SessionStatus;

    fn create_test_session() -> SessionHandle {
        SessionHandle::new(
            "test-123".to_string(),
            "Test Session".to_string(),
            "/tmp/project".to_string(),
            None,
            "claude-opus-4".to_string(),
            "autonomous".to_string(),
        )
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

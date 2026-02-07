/// Worktree management for project directory handling
///
/// This module provides git worktree operations for Pluribus sessions:
/// - Creating isolated worktrees per session
/// - Managing pluribus/* branches
/// - Listing and pruning worktrees
/// - Repository validation

pub mod manager;

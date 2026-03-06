/**
 * AgentStatus - 5-status FSM with transition validation.
 *
 * Statuses: queued, running, error, waiting-approval, completed
 * Used by the AgentRegistry to track per-agent lifecycle state.
 */

export type AgentStatus =
  | "running"
  | "error"
  | "waiting-approval"
  | "completed"
  | "queued";

export interface AgentStatusRecord {
  status: AgentStatus;
  unread: boolean;
  title?: string;
  cwd?: string;
  providerType?: string;
  finishedAt?: number;
  errorHint?: string;
}

/**
 * Valid state transitions for the agent lifecycle FSM.
 */
export const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  queued: ["running", "error"],
  running: ["completed", "error", "waiting-approval"],
  "waiting-approval": ["running", "error"],
  completed: ["running"],
  error: ["running", "queued"],
};

/**
 * Check whether a status transition is valid per the FSM.
 */
export function isValidTransition(
  from: AgentStatus,
  to: AgentStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

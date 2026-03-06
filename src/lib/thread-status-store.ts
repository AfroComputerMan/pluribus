// DEPRECATED: Use useAgentStatusStore from @/lib/orchestration/agent-status-store
// This file re-exports from the new agent-status-store for backward compatibility.

export { useAgentStatusStore as useThreadStatusStore } from "@/lib/orchestration/agent-status-store";
export type { AgentStatus as ThreadStatus } from "@/lib/orchestration/agent-status";
export type { AgentStatusRecord as ThreadStatusRecord } from "@/lib/orchestration/agent-status";

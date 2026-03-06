import { create } from "zustand";
import {
  type AgentStatus,
  type AgentStatusRecord,
  isValidTransition,
} from "@/lib/orchestration/agent-status";

// Re-export for convenience
export type { AgentStatus, AgentStatusRecord };

interface AgentStatusState {
  statuses: Map<string, AgentStatusRecord>;
  currentThreadId: string | null;

  setCurrentThread: (threadId: string | null) => void;

  setStatus: (
    threadId: string,
    status: AgentStatus,
    opts?: {
      title?: string;
      cwd?: string;
      providerType?: string;
      errorHint?: string;
    },
  ) => void;

  markRead: (threadId: string) => void;

  removeStatus: (threadId: string) => void;

  loadFromDb: (
    records: Array<{ threadId: string } & AgentStatusRecord>,
  ) => void;
}

const TERMINAL_STATUSES: AgentStatus[] = ["completed", "error"];

export const useAgentStatusStore = create<AgentStatusState>((set, get) => ({
  statuses: new Map(),
  currentThreadId: null,

  setCurrentThread: (threadId) => set({ currentThreadId: threadId }),

  setStatus: (threadId, status, opts) => {
    const { statuses, currentThreadId } = get();
    const existing = statuses.get(threadId);

    // Validate transition if there is an existing status
    if (existing) {
      if (!isValidTransition(existing.status, status)) {
        console.warn(
          `[AgentStatusStore] Invalid transition: ${existing.status} -> ${status} for thread ${threadId}`,
        );
      }
    }

    const isTerminal = TERMINAL_STATUSES.includes(status);
    const isBackground = currentThreadId !== threadId;

    const next = new Map(statuses);
    next.set(threadId, {
      status,
      unread: isTerminal && isBackground ? true : (existing?.unread ?? false),
      title: opts?.title ?? existing?.title,
      cwd: opts?.cwd ?? existing?.cwd,
      providerType: opts?.providerType ?? existing?.providerType,
      finishedAt: isTerminal ? Date.now() : existing?.finishedAt,
      errorHint: opts?.errorHint ?? (status === "error" ? existing?.errorHint : undefined),
    });
    set({ statuses: next });
  },

  markRead: (threadId) => {
    const { statuses } = get();
    const existing = statuses.get(threadId);
    if (!existing?.unread) return;
    const next = new Map(statuses);
    next.set(threadId, { ...existing, unread: false });
    set({ statuses: next });
  },

  removeStatus: (threadId) => {
    const { statuses } = get();
    if (!statuses.has(threadId)) return;
    const next = new Map(statuses);
    next.delete(threadId);
    set({ statuses: next });
  },

  loadFromDb: (records) => {
    const next = new Map<string, AgentStatusRecord>();
    for (const { threadId, ...record } of records) {
      next.set(threadId, record);
    }
    set({ statuses: next });
  },
}));

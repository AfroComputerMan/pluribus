import { create } from "zustand";

export type ThreadStatus = "idle" | "running" | "waiting-approval" | "error";

export interface ThreadStatusRecord {
  status: ThreadStatus;
  unread: boolean;
  title?: string;
  finishedAt?: number;
}

interface ThreadStatusState {
  statuses: Map<string, ThreadStatusRecord>;
  currentThreadId: string | null;
  setCurrentThread: (threadId: string | null) => void;
  setStatus: (threadId: string, status: ThreadStatus, title?: string) => void;
  markRead: (threadId: string) => void;
}

export const useThreadStatusStore = create<ThreadStatusState>((set, get) => ({
  statuses: new Map(),
  currentThreadId: null,

  setCurrentThread: (threadId) => set({ currentThreadId: threadId }),

  setStatus: (threadId, status, title) => {
    const { statuses, currentThreadId } = get();
    const existing = statuses.get(threadId) ?? { status: "idle", unread: false };
    const isTerminal = status === "idle" || status === "error";
    const isBackground = currentThreadId !== threadId;
    const next = new Map(statuses);
    next.set(threadId, {
      status,
      title: title ?? existing.title,
      unread: isTerminal && isBackground ? true : existing.unread,
      finishedAt: isTerminal ? Date.now() : existing.finishedAt,
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
}));

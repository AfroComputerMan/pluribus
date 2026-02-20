import { create } from "zustand";

export interface ApprovalPayload {
  thread_id: string;
  approval_id: string;
  command: string;
  reason?: string;
}

interface CodexApprovalStore {
  pending: ApprovalPayload[];
  push: (payload: ApprovalPayload) => void;
  dismiss: (approvalId: string) => void;
}

export const useCodexApprovalStore = create<CodexApprovalStore>((set) => ({
  pending: [],
  push: (payload) =>
    set((state) => ({ pending: [...state.pending, payload] })),
  dismiss: (approvalId) =>
    set((state) => ({
      pending: state.pending.filter((p) => p.approval_id !== approvalId),
    })),
}));

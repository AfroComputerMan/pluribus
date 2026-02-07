import { create } from 'zustand';
import type { SessionSummary } from '../types/session';

interface SessionState {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  sidebarCollapsed: boolean;

  addSession: (session: SessionSummary) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  updateSession: (id: string, updates: Partial<SessionSummary>) => void;
  setSessions: (sessions: SessionSummary[]) => void;
  toggleSidebar: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  sidebarCollapsed: false,

  addSession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),

  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    })),

  setActiveSession: (id) =>
    set({ activeSessionId: id }),

  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s,
      ),
    })),

  setSessions: (sessions) =>
    set({ sessions }),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));

/** Selector: get the currently active session */
export const selectActiveSession = (state: SessionState): SessionSummary | undefined =>
  state.sessions.find((s) => s.id === state.activeSessionId);

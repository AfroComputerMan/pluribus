import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore, selectActiveSession } from './sessionStore';
import type { SessionSummary } from '../types/session';

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: overrides.id ?? 'session-1',
    projectId: 'project-1',
    name: 'Test Session',
    status: 'created',
    model: 'sonnet',
    autonomyLevel: 'supervised',
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    turnCount: 0,
    createdAt: '2026-02-08T00:00:00Z',
    ...overrides,
  };
}

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      sidebarCollapsed: false,
    });
  });

  describe('addSession', () => {
    it('adds a session to an empty list', () => {
      const session = makeSession();
      useSessionStore.getState().addSession(session);
      expect(useSessionStore.getState().sessions).toEqual([session]);
    });

    it('appends to existing sessions', () => {
      const s1 = makeSession({ id: 'a' });
      const s2 = makeSession({ id: 'b' });
      useSessionStore.getState().addSession(s1);
      useSessionStore.getState().addSession(s2);
      expect(useSessionStore.getState().sessions).toHaveLength(2);
      expect(useSessionStore.getState().sessions[0].id).toBe('a');
      expect(useSessionStore.getState().sessions[1].id).toBe('b');
    });
  });

  describe('removeSession', () => {
    it('removes a session by id', () => {
      const s1 = makeSession({ id: 'a' });
      const s2 = makeSession({ id: 'b' });
      useSessionStore.setState({ sessions: [s1, s2] });

      useSessionStore.getState().removeSession('a');
      expect(useSessionStore.getState().sessions).toEqual([s2]);
    });

    it('clears activeSessionId when removing the active session', () => {
      const session = makeSession({ id: 'active-one' });
      useSessionStore.setState({ sessions: [session], activeSessionId: 'active-one' });

      useSessionStore.getState().removeSession('active-one');
      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });

    it('preserves activeSessionId when removing a different session', () => {
      const s1 = makeSession({ id: 'a' });
      const s2 = makeSession({ id: 'b' });
      useSessionStore.setState({ sessions: [s1, s2], activeSessionId: 'b' });

      useSessionStore.getState().removeSession('a');
      expect(useSessionStore.getState().activeSessionId).toBe('b');
    });

    it('does nothing when id does not exist', () => {
      const session = makeSession({ id: 'a' });
      useSessionStore.setState({ sessions: [session] });

      useSessionStore.getState().removeSession('nonexistent');
      expect(useSessionStore.getState().sessions).toEqual([session]);
    });
  });

  describe('setActiveSession', () => {
    it('sets the active session id', () => {
      useSessionStore.getState().setActiveSession('some-id');
      expect(useSessionStore.getState().activeSessionId).toBe('some-id');
    });

    it('clears active session when set to null', () => {
      useSessionStore.setState({ activeSessionId: 'was-active' });
      useSessionStore.getState().setActiveSession(null);
      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });
  });

  describe('updateSession', () => {
    it('partially updates a session', () => {
      const session = makeSession({ id: 'x', name: 'Original' });
      useSessionStore.setState({ sessions: [session] });

      useSessionStore.getState().updateSession('x', { name: 'Updated', status: 'running' });
      const updated = useSessionStore.getState().sessions[0];
      expect(updated.name).toBe('Updated');
      expect(updated.status).toBe('running');
      expect(updated.id).toBe('x');
    });

    it('does not affect other sessions', () => {
      const s1 = makeSession({ id: 'a', name: 'A' });
      const s2 = makeSession({ id: 'b', name: 'B' });
      useSessionStore.setState({ sessions: [s1, s2] });

      useSessionStore.getState().updateSession('a', { name: 'A-updated' });
      expect(useSessionStore.getState().sessions[1].name).toBe('B');
    });
  });

  describe('setSessions', () => {
    it('replaces all sessions', () => {
      const old = makeSession({ id: 'old' });
      useSessionStore.setState({ sessions: [old] });

      const newSessions = [makeSession({ id: 'new-1' }), makeSession({ id: 'new-2' })];
      useSessionStore.getState().setSessions(newSessions);
      expect(useSessionStore.getState().sessions).toEqual(newSessions);
    });

    it('can set to empty array', () => {
      useSessionStore.setState({ sessions: [makeSession()] });
      useSessionStore.getState().setSessions([]);
      expect(useSessionStore.getState().sessions).toEqual([]);
    });
  });

  describe('toggleSidebar', () => {
    it('toggles from false to true', () => {
      expect(useSessionStore.getState().sidebarCollapsed).toBe(false);
      useSessionStore.getState().toggleSidebar();
      expect(useSessionStore.getState().sidebarCollapsed).toBe(true);
    });

    it('toggles from true to false', () => {
      useSessionStore.setState({ sidebarCollapsed: true });
      useSessionStore.getState().toggleSidebar();
      expect(useSessionStore.getState().sidebarCollapsed).toBe(false);
    });

    it('toggles back and forth', () => {
      useSessionStore.getState().toggleSidebar();
      useSessionStore.getState().toggleSidebar();
      expect(useSessionStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe('selectActiveSession', () => {
    it('returns the active session when one is set', () => {
      const s1 = makeSession({ id: 'a' });
      const s2 = makeSession({ id: 'b', name: 'Active One' });
      useSessionStore.setState({ sessions: [s1, s2], activeSessionId: 'b' });

      const result = selectActiveSession(useSessionStore.getState());
      expect(result).toBeDefined();
      expect(result!.id).toBe('b');
      expect(result!.name).toBe('Active One');
    });

    it('returns undefined when no active session', () => {
      useSessionStore.setState({ sessions: [makeSession()], activeSessionId: null });
      const result = selectActiveSession(useSessionStore.getState());
      expect(result).toBeUndefined();
    });

    it('returns undefined when active id does not match any session', () => {
      useSessionStore.setState({ sessions: [makeSession({ id: 'a' })], activeSessionId: 'nonexistent' });
      const result = selectActiveSession(useSessionStore.getState());
      expect(result).toBeUndefined();
    });
  });
});

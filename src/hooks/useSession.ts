import { useCallback, useEffect } from 'react';
import { sessionCommands, type CreateSessionInput } from '@/ipc/commands';
import { onSessionStatusChanged } from '@/ipc/events';
import { useSessionStore, selectActiveSession } from '@/stores/sessionStore';

export function useSession() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = useSessionStore(selectActiveSession);
  const addSession = useSessionStore((s) => s.addSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setSessions = useSessionStore((s) => s.setSessions);
  const updateSession = useSessionStore((s) => s.updateSession);

  const createSession = useCallback(async (config: CreateSessionInput) => {
    const session = await sessionCommands.create(config);
    addSession(session);
    return session;
  }, [addSession]);

  const deleteSession = useCallback(async (id: string) => {
    await sessionCommands.delete(id);
    removeSession(id);
  }, [removeSession]);

  const loadSessions = useCallback(async (projectId?: string) => {
    const list = await sessionCommands.list(projectId);
    setSessions(list);
  }, [setSessions]);

  const setActive = useCallback((id: string) => {
    setActiveSession(id);
  }, [setActiveSession]);

  useEffect(() => {
    const unlistenPromise = onSessionStatusChanged((payload) => {
      updateSession(payload.sessionId, { status: payload.status });
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [updateSession]);

  return {
    createSession,
    deleteSession,
    loadSessions,
    setActive,
    sessions,
    activeSession,
  };
}

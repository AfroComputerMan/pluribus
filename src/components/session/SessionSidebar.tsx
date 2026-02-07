import { useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { SessionItem } from './SessionItem';
import { NewSessionDialog } from './NewSessionDialog';
import { sessionCommands } from '@/ipc/commands';
import type { CreateSessionInput } from '@/ipc/commands';

export function SessionSidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const addSession = useSessionStore((s) => s.addSession);
  const [dialogOpen, setDialogOpen] = useState(false);

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const handleCreate = async (input: CreateSessionInput) => {
    try {
      const session = await sessionCommands.create(input);
      addSession(session);
      setActiveSession(session.id);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sessions</h2>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="New session"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 1v12M1 7h12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No sessions yet. Create one to get started.
          </div>
        ) : (
          sorted.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onClick={() => setActiveSession(session.id)}
            />
          ))
        )}
      </div>

      <NewSessionDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}

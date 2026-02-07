import { AppShell } from '@/components/layout/AppShell';
import { useSessionStore } from '@/stores/sessionStore';

export function ChatPage() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  return (
    <AppShell>
      <div className="flex flex-col h-full">
        {activeSessionId ? (
          <div className="flex-1 flex flex-col">
            {/* ChatPanel will be rendered here by the chat-ui teammate */}
            <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
              Chat panel loading for session {activeSessionId}...
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Pluribus Desktop
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Select a session or create a new one to get started.
              </p>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

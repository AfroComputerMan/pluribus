import { AppShell } from '@/components/layout/AppShell';
import { ChatPanel } from '@/components/chat';
import { useChatStream } from '@/hooks/useChatStream';
import { selectActiveSession, useSessionStore } from '@/stores/sessionStore';

export function ChatPage() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSession = useSessionStore(selectActiveSession);
  const { sendMessage } = useChatStream();

  return (
    <AppShell>
      <div className="flex flex-col h-full">
        {activeSessionId ? (
          <div className="flex-1 flex flex-col">
            <ChatPanel
              sessionId={activeSessionId}
              onSendMessage={
                activeSession
                  ? (message) => {
                    void sendMessage(activeSession, message);
                  }
                  : undefined
              }
            />
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

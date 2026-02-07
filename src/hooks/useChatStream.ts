import { useCallback, useRef, useState } from 'react';
import { createStreamChannel } from '@/ipc/channels';
import { chatCommands } from '@/ipc/commands';
import { parseCLILine, cliMessageToUIActions } from '@/lib/ndjson-parser';
import { useChatStore } from '@/stores/chatStore';
import type { SessionSummary } from '@/types/session';

export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const streamingRef = useRef(false);

  const sendMessage = useCallback(async (session: SessionSummary, message: string) => {
    if (streamingRef.current) return;

    setIsStreaming(true);
    streamingRef.current = true;
    const sessionId = session.id;

    const channel = createStreamChannel({
      onLine: (line) => {
        const msg = parseCLILine(line);
        if (!msg) return;

        const actions = cliMessageToUIActions(msg);
        for (const action of actions) {
          useChatStore.getState().dispatch(sessionId, action);
        }
      },
      onError: (error) => {
        useChatStore.getState().dispatch(sessionId, {
          type: 'session_error',
          sessionId,
          error,
        });
        setIsStreaming(false);
        streamingRef.current = false;
      },
      onEnd: () => {
        setIsStreaming(false);
        streamingRef.current = false;
      },
    });

    try {
      await chatCommands.sendMessage({
        sessionId,
        projectPath: session.projectPath ?? session.projectId,
        worktreePath: session.worktreePath ?? null,
        model: session.model,
        autonomyLevel: session.autonomyLevel,
        maxTurns: null,
        allowedTools: null,
        message,
        channel,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      useChatStore.getState().dispatch(sessionId, {
        type: 'session_error',
        sessionId,
        error: errorMessage,
      });
      setIsStreaming(false);
      streamingRef.current = false;
    }
  }, []);

  return { sendMessage, isStreaming };
}

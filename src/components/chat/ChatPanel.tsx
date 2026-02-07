import { useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import type { ChatMessage } from '@/types/chat';
import { MessageBubble } from './MessageBubble';
import { StreamingMessage } from './StreamingMessage';
import { ChatInput } from './ChatInput';

interface ChatPanelProps {
  sessionId?: string;
  onSendMessage?: (message: string) => void;
}

export function ChatPanel({ sessionId, onSendMessage }: ChatPanelProps) {
  const messages: ChatMessage[] = useChatStore(
    (state) => (sessionId ? state.messages[sessionId] ?? [] : [])
  );
  const streamingState = useChatStore(
    (state) => (sessionId ? state.streamingState[sessionId] : undefined)
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingState?.contentBlocks.length]);

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        Select or create a session
      </div>
    );
  }

  const isStreaming = streamingState?.isStreaming ?? false;

  const handleSend = (message: string) => {
    onSendMessage?.(message);
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-3">
        <div className="flex flex-col gap-3">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {streamingState && (
            <StreamingMessage streamingState={streamingState} />
          )}
        </div>
      </div>
      <ChatInput
        onSend={handleSend}
        disabled={!onSendMessage}
        isStreaming={isStreaming}
      />
    </div>
  );
}

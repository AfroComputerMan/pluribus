import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from '@/types/chat';
import { ToolCallCard } from './ToolCallCard';
import { ToolResultCard } from './ToolResultCard';

interface MessageBubbleProps {
  message: ChatMessage;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === 'tool_use') {
    return (
      <div className="w-full px-3">
        <ToolCallCard
          toolName={message.toolName ?? 'Unknown'}
          toolInput={message.content}
        />
        <div className="mt-1 text-xs text-gray-400 text-right">
          {formatTime(message.createdAt)}
        </div>
      </div>
    );
  }

  if (message.role === 'tool_result') {
    return (
      <div className="w-full px-3">
        <ToolResultCard
          content={message.content}
          isError={message.isError}
          toolName={message.toolName}
        />
        <div className="mt-1 text-xs text-gray-400 text-right">
          {formatTime(message.createdAt)}
        </div>
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div className="flex justify-center px-3">
        <div className="max-w-md text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">
            {message.content}
          </p>
          <div className="mt-1 text-xs text-gray-400">
            {formatTime(message.createdAt)}
          </div>
        </div>
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end px-3">
        <div className="max-w-[80%]">
          <div className="bg-blue-600 text-white rounded-lg rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap">
            {message.content}
          </div>
          <div className="mt-1 text-xs text-gray-400 text-right">
            {formatTime(message.createdAt)}
          </div>
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div className="flex justify-start px-3">
      <div className="max-w-full w-full">
        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg rounded-bl-sm px-3 py-2 text-sm prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
        <div className="mt-1 text-xs text-gray-400">
          {formatTime(message.createdAt)}
        </div>
      </div>
    </div>
  );
}

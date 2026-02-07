import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { StreamingState } from '@/types/chat';

interface StreamingMessageProps {
  streamingState: StreamingState;
}

export function StreamingMessage({ streamingState }: StreamingMessageProps) {
  const [thinkingOpen, setThinkingOpen] = useState(true);

  if (!streamingState.isStreaming) {
    return null;
  }

  const thinkingBlocks = streamingState.contentBlocks.filter(b => b.type === 'thinking');
  const textBlocks = streamingState.contentBlocks.filter(b => b.type === 'text');
  const thinkingText = thinkingBlocks.map(b => b.content).join('');
  const currentText = textBlocks.map(b => b.content).join('');

  return (
    <div className="flex justify-start px-3">
      <div className="max-w-full w-full">
        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg rounded-bl-sm px-3 py-2 text-sm">
          {thinkingText && (
            <div className="mb-2">
              <button
                onClick={() => setThinkingOpen(!thinkingOpen)}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
              >
                <span>{thinkingOpen ? '\u25B4' : '\u25BE'}</span>
                <span className="italic">Thinking...</span>
              </button>
              {thinkingOpen && (
                <div className="mt-1 pl-3 border-l-2 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 text-xs whitespace-pre-wrap">
                  {thinkingText}
                </div>
              )}
            </div>
          )}
          {currentText && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{currentText}</ReactMarkdown>
            </div>
          )}
          <span className="inline-block w-2 h-4 bg-gray-500 dark:bg-gray-400 animate-pulse ml-0.5 align-text-bottom" />
        </div>
      </div>
    </div>
  );
}

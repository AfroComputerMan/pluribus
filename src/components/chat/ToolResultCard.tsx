import { useState } from 'react';

interface ToolResultCardProps {
  content: string;
  isError?: boolean;
  toolName?: string;
}

const TRUNCATE_LENGTH = 500;
const MAX_HEIGHT = '300px';

export function ToolResultCard({ content, isError, toolName }: ToolResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showFull, setShowFull] = useState(false);

  const isTruncated = content.length > TRUNCATE_LENGTH;
  const displayContent = showFull ? content : content.slice(0, TRUNCATE_LENGTH);

  const borderColor = isError
    ? 'border-red-300 dark:border-red-700'
    : 'border-gray-200 dark:border-gray-700';

  const headerColor = isError
    ? 'text-red-600 dark:text-red-400'
    : 'text-gray-700 dark:text-gray-300';

  return (
    <div className={`border ${borderColor} rounded-md overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 text-left text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
      >
        <span className={headerColor}>
          {isError ? 'Error' : 'Result'}
          {toolName ? ` (${toolName})` : ''}
        </span>
        <span className="ml-auto text-gray-400">{expanded ? '\u25B4' : '\u25BE'}</span>
      </button>
      {expanded && (
        <div className="bg-white dark:bg-gray-900">
          <pre
            className="p-3 text-sm text-gray-800 dark:text-gray-200 overflow-auto whitespace-pre-wrap break-words"
            style={{ maxHeight: MAX_HEIGHT }}
          >
            <code>{displayContent}</code>
          </pre>
          {isTruncated && !showFull && (
            <button
              onClick={() => setShowFull(true)}
              className="w-full px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800 border-t border-gray-200 dark:border-gray-700"
            >
              Show more ({content.length - TRUNCATE_LENGTH} more characters)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

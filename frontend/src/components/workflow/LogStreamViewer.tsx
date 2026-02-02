// frontend/src/components/workflow/LogStreamViewer.tsx
// Phase 6: Docker execution monitoring - real-time log streaming

import { useState, useEffect, useRef, useMemo } from 'react';
import type { LogEntry, LogLevel } from '../../api/client';

interface LogStreamViewerProps {
  logs: LogEntry[];
  filterNodeId?: string;
  filterLevel?: LogLevel;
  searchText?: string;
  autoScroll?: boolean;
  isLoading?: boolean;
  isStreaming?: boolean;
  maxHeight?: string;
  showLevelFilter?: boolean;
  showAutoScrollToggle?: boolean;
  showSearch?: boolean;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString();
}

/**
 * Get log level styling
 */
function getLevelClass(level: LogLevel): string {
  switch (level) {
    case 'error':
      return 'text-red-600 bg-red-50';
    case 'warn':
      return 'text-yellow-600 bg-yellow-50';
    case 'info':
      return 'text-blue-600 bg-blue-50';
    case 'debug':
      return 'text-gray-500 bg-gray-100';
    default:
      return 'text-gray-500 bg-gray-100';
  }
}

/**
 * Highlight search text in message
 */
function highlightText(text: string, search: string): React.ReactNode {
  if (!search) return text;

  const parts = text.split(new RegExp(`(${search})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === search.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function LogStreamViewer({
  logs,
  filterNodeId,
  filterLevel: externalFilterLevel,
  searchText: externalSearchText,
  autoScroll: autoScrollProp = true,
  isLoading = false,
  isStreaming = false,
  maxHeight = '300px',
  showLevelFilter = false,
  showAutoScrollToggle = false,
  showSearch = false,
}: LogStreamViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [internalAutoScroll, setInternalAutoScroll] = useState(autoScrollProp);
  const [internalLevelFilter, setInternalLevelFilter] = useState<LogLevel | ''>('');
  const [internalSearchText, setInternalSearchText] = useState('');

  const autoScroll = autoScrollProp !== undefined ? autoScrollProp : internalAutoScroll;
  const levelFilter = externalFilterLevel || internalLevelFilter || undefined;
  const searchText = externalSearchText !== undefined ? externalSearchText : internalSearchText;

  // Filter logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Filter by node ID
      if (filterNodeId && log.nodeExecutionId !== filterNodeId) {
        return false;
      }

      // Filter by level
      if (levelFilter && log.level !== levelFilter) {
        return false;
      }

      // Filter by search text
      if (searchText && !log.message.toLowerCase().includes(searchText.toLowerCase())) {
        return false;
      }

      return true;
    });
  }, [logs, filterNodeId, levelFilter, searchText]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  return (
    <div className="flex flex-col bg-gray-900 rounded-lg overflow-hidden">
      {/* Toolbar */}
      {(showLevelFilter || showAutoScrollToggle || showSearch) && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700">
          {showSearch && (
            <input
              type="text"
              placeholder="Search logs..."
              value={internalSearchText}
              onChange={(e) => setInternalSearchText(e.target.value)}
              className="flex-1 px-2 py-1 text-sm bg-gray-700 text-gray-100 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            />
          )}

          {showLevelFilter && (
            <select
              data-testid="level-filter"
              value={internalLevelFilter}
              onChange={(e) => setInternalLevelFilter(e.target.value as LogLevel | '')}
              className="px-2 py-1 text-sm bg-gray-700 text-gray-100 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            >
              <option value="">All levels</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          )}

          {showAutoScrollToggle && (
            <button
              onClick={() => setInternalAutoScroll(!internalAutoScroll)}
              className={`px-2 py-1 text-xs rounded ${
                internalAutoScroll
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300'
              }`}
              aria-label={internalAutoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
            >
              Auto-scroll
            </button>
          )}
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div
          data-testid="loading-indicator"
          className="flex items-center justify-center py-4 bg-gray-800"
        >
          <div className="animate-spin w-5 h-5 border-2 border-gray-500 border-t-blue-500 rounded-full" />
          <span className="ml-2 text-sm text-gray-400">Loading logs...</span>
        </div>
      )}

      {/* Log container */}
      <div
        ref={containerRef}
        data-testid="log-container"
        data-auto-scroll={autoScroll.toString()}
        className="overflow-y-auto font-mono text-sm"
        style={{ maxHeight }}
      >
        {filteredLogs.length === 0 && !isLoading ? (
          <div className="px-4 py-8 text-center text-gray-500">
            No logs available
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                className="px-3 py-1.5 hover:bg-gray-800/50 flex items-start gap-2"
              >
                {/* Timestamp */}
                <span className="text-gray-500 shrink-0 w-20 text-xs">
                  {formatTimestamp(log.timestamp)}
                </span>

                {/* Level badge */}
                <span
                  className={`shrink-0 px-1.5 py-0.5 text-xs font-medium rounded ${getLevelClass(log.level)}`}
                >
                  {log.level}
                </span>

                {/* Source */}
                <span className="text-purple-400 shrink-0 text-xs">
                  {log.source}
                </span>

                {/* Message */}
                <span className="text-gray-100 break-all">
                  {highlightText(log.message, searchText)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <div
          data-testid="streaming-indicator"
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-t border-gray-700"
        >
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-xs text-gray-400">Streaming live logs...</span>
        </div>
      )}
    </div>
  );
}

/**
 * JsonViewer Component
 * Collapsible JSON display component with syntax highlighting
 */

import { useState } from 'react';

interface JsonViewerProps {
  data: unknown;
  title?: string;
  defaultExpanded?: boolean;
}

export function JsonViewer({ data, title, defaultExpanded = false }: JsonViewerProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const jsonString = JSON.stringify(data, null, 2);

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      {title && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-2 bg-gray-50 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 flex items-center justify-between"
        >
          <span>{title}</span>
          <span className="text-gray-500">{isExpanded ? '−' : '+'}</span>
        </button>
      )}
      {isExpanded && (
        <pre className="p-4 bg-gray-900 text-gray-100 text-sm overflow-x-auto">
          <code>{jsonString}</code>
        </pre>
      )}
    </div>
  );
}

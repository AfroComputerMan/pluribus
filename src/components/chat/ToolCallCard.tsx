import { useState } from 'react';
import { JsonViewer } from '@/components/common';

interface ToolCallCardProps {
  toolName: string;
  toolInput: string;
  isExpanded?: boolean;
}

const toolIcons: Record<string, string> = {
  Read: '\u{1F4C4}',
  Edit: '\u{270F}\u{FE0F}',
  Bash: '\u{1F4BB}',
  Glob: '\u{1F50D}',
  Grep: '\u{1F50E}',
  Write: '\u{1F4DD}',
  WebSearch: '\u{1F310}',
};

const defaultCollapsed = new Set(['Read', 'Glob', 'Grep']);

export function ToolCallCard({ toolName, toolInput, isExpanded }: ToolCallCardProps) {
  const defaultExpanded = isExpanded ?? !defaultCollapsed.has(toolName);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const icon = toolIcons[toolName] ?? '\u{1F527}';

  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(toolInput);
  } catch {
    parsedInput = toolInput;
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
      >
        <span>{icon}</span>
        <span className="font-mono">{toolName}</span>
        <span className="ml-auto text-gray-400">{expanded ? '\u25B4' : '\u25BE'}</span>
      </button>
      {expanded && (
        <div className="p-3 bg-white dark:bg-gray-900">
          <JsonViewer data={parsedInput} defaultExpanded />
        </div>
      )}
    </div>
  );
}

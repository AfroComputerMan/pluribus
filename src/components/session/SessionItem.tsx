import type { SessionSummary } from '@/types/session';

interface SessionItemProps {
  session: SessionSummary;
  isActive: boolean;
  onClick: () => void;
}

const statusDotColors: Record<string, string> = {
  created: 'bg-gray-400',
  running: 'bg-green-500 animate-pulse',
  completed: 'bg-blue-500',
  failed: 'bg-red-500',
  killed: 'bg-orange-500',
  paused: 'bg-yellow-500',
};

const modelLabels: Record<string, string> = {
  sonnet: 'sonnet',
  opus: 'opus',
  haiku: 'haiku',
};

export function SessionItem({ session, isActive, onClick }: SessionItemProps) {
  const dotColor = statusDotColors[session.status] ?? 'bg-gray-400';
  const modelLabel = modelLabels[session.model] ?? session.model;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 cursor-pointer transition-colors ${
        isActive
          ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500'
          : 'border-l-2 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`shrink-0 w-2 h-2 rounded-full ${dotColor}`} />
        <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {session.name}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1 ml-4">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          ${session.totalCostUsd.toFixed(2)}
        </span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
          {modelLabel}
        </span>
      </div>
    </button>
  );
}

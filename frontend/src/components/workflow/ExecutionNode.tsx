/**
 * ExecutionNode
 * Wrapper component that adds execution status styling to workflow nodes
 */

import type { ReactNode } from 'react';
import type { ExecutionStatus } from './ExecutionOverlay';

interface ExecutionNodeWrapperProps {
  children: ReactNode;
  status?: ExecutionStatus;
  duration?: string;
  selected?: boolean;
}

/**
 * Get border color class based on execution status
 */
function getStatusBorderClass(status?: ExecutionStatus): string {
  switch (status) {
    case 'running':
      return 'border-blue-500 ring-2 ring-blue-200';
    case 'completed':
      return 'border-green-500';
    case 'failed':
      return 'border-red-500';
    case 'skipped':
      return 'border-gray-400 opacity-50';
    case 'pending':
    default:
      return 'border-gray-300';
  }
}

/**
 * Get status indicator styles
 */
function getStatusIndicator(status?: ExecutionStatus): { color: string; animate: boolean } {
  switch (status) {
    case 'running':
      return { color: 'bg-blue-500', animate: true };
    case 'completed':
      return { color: 'bg-green-500', animate: false };
    case 'failed':
      return { color: 'bg-red-500', animate: false };
    case 'skipped':
      return { color: 'bg-gray-400', animate: false };
    case 'pending':
    default:
      return { color: 'bg-gray-400', animate: false };
  }
}

export function ExecutionNodeWrapper({
  children,
  status,
  duration,
  selected,
}: ExecutionNodeWrapperProps) {
  const borderClass = getStatusBorderClass(status);
  const indicator = getStatusIndicator(status);

  return (
    <div
      className={`relative px-4 py-3 rounded-lg border-2 bg-white min-w-[180px] shadow ${borderClass} ${
        selected ? 'shadow-lg' : ''
      }`}
    >
      {/* Status indicator */}
      {status && (
        <div className="absolute -top-1.5 -right-1.5 flex items-center gap-1">
          <span
            className={`w-3 h-3 rounded-full ${indicator.color} ${
              indicator.animate ? 'animate-pulse' : ''
            }`}
          />
        </div>
      )}

      {children}

      {/* Duration badge */}
      {duration && (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full border border-gray-200">
            {duration}
          </span>
        </div>
      )}
    </div>
  );
}

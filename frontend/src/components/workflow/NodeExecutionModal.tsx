/**
 * NodeExecutionModal
 * Modal component for displaying node execution details
 */

import type { NodeRun } from '../../api/client';

interface NodeExecutionModalProps {
  execution: NodeRun | null;
  onClose: () => void;
}

/**
 * Calculate duration between two timestamps
 */
function calculateDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt) return null;

  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const durationMs = end - start;

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

/**
 * Get status badge styling
 */
function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'running':
      return 'bg-blue-100 text-blue-800';
    case 'completed':
      return 'bg-green-100 text-green-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'skipped':
      return 'bg-gray-100 text-gray-600';
    case 'pending':
    default:
      return 'bg-yellow-100 text-yellow-800';
  }
}

export function NodeExecutionModal({ execution, onClose }: NodeExecutionModalProps) {
  if (!execution) {
    return null;
  }

  const duration = calculateDuration(execution.startedAt, execution.completedAt);
  const statusClass = getStatusBadgeClass(execution.status);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="modal-backdrop"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal */}
      <div
        className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Node Execution Details</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Node Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-500">Node ID</div>
              <div className="font-mono text-sm text-gray-900">{execution.nodeId}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Status</div>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>
                {execution.status}
              </span>
            </div>
          </div>

          {/* Timestamps */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-gray-500">Started</div>
              <div className="text-sm text-gray-900">{formatTimestamp(execution.startedAt)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Completed</div>
              <div className="text-sm text-gray-900">{formatTimestamp(execution.completedAt)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Duration</div>
              <div className="text-sm text-gray-900">{duration || '-'}</div>
            </div>
          </div>

          {/* Error (if any) */}
          {execution.error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <div className="text-sm font-medium text-red-800">Error</div>
              <div className="mt-1 text-sm text-red-700">{execution.error}</div>
            </div>
          )}

          {/* Input */}
          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">Input</div>
            <pre className="p-3 bg-gray-50 rounded-md text-xs text-gray-800 overflow-x-auto max-h-48 overflow-y-auto">
              {JSON.stringify(execution.input, null, 2)}
            </pre>
          </div>

          {/* Output */}
          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">Output</div>
            {execution.output ? (
              <pre className="p-3 bg-gray-50 rounded-md text-xs text-gray-800 overflow-x-auto max-h-48 overflow-y-auto">
                {JSON.stringify(execution.output, null, 2)}
              </pre>
            ) : (
              <div className="p-3 bg-gray-50 rounded-md text-sm text-gray-500 italic">
                No output
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

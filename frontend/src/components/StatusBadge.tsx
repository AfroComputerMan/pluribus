/**
 * StatusBadge Component
 * Displays a colored status badge for workflow runs and node executions
 */

type Status = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

interface StatusBadgeProps {
  status: Status;
}

const statusStyles: Record<Status, string> = {
  pending: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-yellow-100 text-yellow-800',
  skipped: 'bg-gray-100 text-gray-600',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[status]}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

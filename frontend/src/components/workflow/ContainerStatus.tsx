// frontend/src/components/workflow/ContainerStatus.tsx
// Phase 6: Docker execution monitoring - container status display

import type { ResourceUsage, ResourceLimits } from '../../api/client';

interface ContainerStatusProps {
  isolationLevel?: 'shared' | 'process' | 'container';
  resourceUsage?: ResourceUsage;
  resourceLimits?: ResourceLimits;
  compact?: boolean;
}

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Get progress bar color based on usage percentage
 */
function getProgressBarColor(percentage: number): string {
  if (percentage >= 90) return 'bg-red-500';
  if (percentage >= 75) return 'bg-yellow-500';
  return 'bg-green-500';
}

/**
 * Get isolation level display info
 */
function getIsolationInfo(level: string | undefined): { label: string; icon: string; description: string } {
  switch (level) {
    case 'container':
      return {
        label: 'Container',
        icon: '📦',
        description: 'Isolated Docker container',
      };
    case 'process':
      return {
        label: 'Process',
        icon: '⚙️',
        description: 'Separate process',
      };
    case 'shared':
      return {
        label: 'Shared',
        icon: '🔗',
        description: 'Shared execution context',
      };
    default:
      return {
        label: 'Unknown',
        icon: '❓',
        description: 'Unknown isolation level',
      };
  }
}

export function ContainerStatus({
  isolationLevel,
  resourceUsage,
  resourceLimits,
  compact = false,
}: ContainerStatusProps) {
  const isolationInfo = getIsolationInfo(isolationLevel);

  // Calculate memory usage percentage
  const memoryPercentage =
    resourceUsage?.memoryPeakMB && resourceLimits?.maxMemoryMB
      ? Math.round((resourceUsage.memoryPeakMB / resourceLimits.maxMemoryMB) * 100)
      : null;

  return (
    <div
      data-testid="container-status"
      className={`bg-gray-50 rounded-lg border border-gray-200 ${compact ? 'compact p-2' : 'p-4'}`}
    >
      {/* Isolation Level */}
      <div className="flex items-center gap-2 mb-3">
        <span data-testid="isolation-icon" className="text-lg">
          {isolationInfo.icon}
        </span>
        <div>
          <span className="font-medium text-gray-900">{isolationInfo.label}</span>
          {!compact && (
            <p className="text-xs text-gray-500">{isolationInfo.description}</p>
          )}
        </div>
      </div>

      {/* Resource Limits */}
      <div className="mb-3">
        <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
          Limits
        </h4>
        {resourceLimits ? (
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <span className="text-gray-500">Memory:</span>{' '}
              <span className="font-medium">{resourceLimits.maxMemoryMB} MB</span>
            </div>
            <div>
              <span className="text-gray-500">CPU:</span>{' '}
              <span className="font-medium">{resourceLimits.maxCpuPercent}%</span>
            </div>
            <div>
              <span className="text-gray-500">Timeout:</span>{' '}
              <span className="font-medium">
                {resourceLimits.maxDurationMs
                  ? formatDuration(resourceLimits.maxDurationMs)
                  : '-'}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">No limits configured</p>
        )}
      </div>

      {/* Resource Usage */}
      <div>
        <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
          Usage
        </h4>
        {resourceUsage ? (
          <div className="space-y-2">
            {/* Memory Usage with Progress Bar */}
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Peak Memory:</span>
                <span className="font-medium">
                  {resourceUsage.memoryPeakMB} MB
                  {memoryPercentage !== null && (
                    <span className="text-gray-400 ml-1">({memoryPercentage}%)</span>
                  )}
                </span>
              </div>
              {memoryPercentage !== null && (
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    data-testid="memory-progress-bar"
                    className={`h-full ${getProgressBarColor(memoryPercentage)} transition-all`}
                    style={{ width: `${Math.min(memoryPercentage, 100)}%` }}
                  />
                </div>
              )}
            </div>

            {/* CPU Time */}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">CPU Time:</span>
              <span className="font-medium">{formatDuration(resourceUsage.cpuTimeMs)}</span>
            </div>

            {/* Wall Time */}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Wall Time:</span>
              <span className="font-medium">{formatDuration(resourceUsage.wallTimeMs)}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">No usage data available</p>
        )}
      </div>
    </div>
  );
}

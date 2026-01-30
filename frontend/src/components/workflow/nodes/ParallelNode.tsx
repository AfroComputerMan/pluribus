/**
 * ParallelNode
 * Custom node for parallel execution branches
 */

import { Handle, Position } from '@xyflow/react';

interface ParallelNodeProps {
  data: Record<string, unknown>;
  selected?: boolean;
}

export function ParallelNode({ data, selected }: ParallelNodeProps) {
  const branches = data.branches as string[] | undefined;
  const branchCount = branches?.length || 2;

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[180px] ${
        selected ? 'border-purple-500 shadow-lg' : 'border-gray-300 shadow'
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-purple-500" />
        <div className="font-medium text-sm text-gray-900">Parallel</div>
      </div>

      <div className="text-xs text-gray-600">
        {String(data.label || 'Parallel Node')}
      </div>

      <div className="text-xs text-gray-500 mt-1">
        {branchCount} branches | {String(data.joinStrategy || 'all')}
      </div>

      {/* Multiple output handles for parallel branches */}
      {Array.from({ length: branchCount }).map((_, index) => (
        <Handle
          key={index}
          type="source"
          position={Position.Bottom}
          id={`branch-${index}`}
          className="w-3 h-3"
          style={{ left: `${(100 / (branchCount + 1)) * (index + 1)}%` }}
        />
      ))}
    </div>
  );
}

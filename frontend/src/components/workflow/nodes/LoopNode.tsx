/**
 * LoopNode
 * Custom node for iteration/looping
 */

import { Handle, Position } from '@xyflow/react';

interface LoopNodeProps {
  data: Record<string, unknown>;
  selected?: boolean;
}

export function LoopNode({ data, selected }: LoopNodeProps) {
  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[180px] ${
        selected ? 'border-green-500 shadow-lg' : 'border-gray-300 shadow'
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <div className="font-medium text-sm text-gray-900">Loop</div>
      </div>

      <div className="text-xs text-gray-600">
        {String(data.label || 'Loop Node')}
      </div>

      {data.maxIterations ? (
        <div className="text-xs text-gray-500 mt-1">
          Max: {String(data.maxIterations)} iterations
        </div>
      ) : null}

      {data.condition ? (
        <div className="text-xs text-gray-500 mt-1 font-mono truncate">
          {String(data.condition)}
        </div>
      ) : null}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
}

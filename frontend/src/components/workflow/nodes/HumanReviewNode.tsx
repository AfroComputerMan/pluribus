/**
 * HumanReviewNode
 * Custom node for manual approval/review
 */

import { Handle, Position } from '@xyflow/react';

interface HumanReviewNodeProps {
  data: Record<string, unknown>;
  selected?: boolean;
}

export function HumanReviewNode({ data, selected }: HumanReviewNodeProps) {
  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[180px] ${
        selected ? 'border-orange-500 shadow-lg' : 'border-gray-300 shadow'
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-orange-500" />
        <div className="font-medium text-sm text-gray-900">Human Review</div>
      </div>

      <div className="text-xs text-gray-600">
        {String(data.label || 'Human Review Node')}
      </div>

      {data.prompt ? (
        <div className="text-xs text-gray-500 mt-1 truncate">
          {String(data.prompt)}
        </div>
      ) : null}

      {data.timeout ? (
        <div className="text-xs text-gray-500 mt-1">
          Timeout: {String(data.timeout)}s
        </div>
      ) : null}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
}

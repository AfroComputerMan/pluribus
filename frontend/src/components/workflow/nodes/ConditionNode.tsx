/**
 * ConditionNode
 * Custom node for branching logic
 */

import { Handle, Position } from '@xyflow/react';

interface ConditionNodeProps {
  data: Record<string, unknown>;
  selected?: boolean;
}

export function ConditionNode({ data, selected }: ConditionNodeProps) {
  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[180px] ${
        selected ? 'border-yellow-500 shadow-lg' : 'border-gray-300 shadow'
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-yellow-500" />
        <div className="font-medium text-sm text-gray-900">Condition</div>
      </div>

      <div className="text-xs text-gray-600">
        {String(data.label || 'Condition Node')}
      </div>

      {data.expression ? (
        <div className="text-xs text-gray-500 mt-1 font-mono">
          {String(data.expression)}
        </div>
      ) : null}

      {/* True branch handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="w-3 h-3"
        style={{ left: '30%' }}
      />

      {/* False branch handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="w-3 h-3"
        style={{ left: '70%' }}
      />
    </div>
  );
}

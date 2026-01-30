/**
 * AgentNode
 * Custom node for agent execution
 */

import { Handle, Position } from '@xyflow/react';

interface AgentNodeProps {
  data: Record<string, unknown>;
  selected?: boolean;
}

export function AgentNode({ data, selected }: AgentNodeProps) {
  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[180px] ${
        selected ? 'border-blue-500 shadow-lg' : 'border-gray-300 shadow'
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-blue-500" />
        <div className="font-medium text-sm text-gray-900">Agent</div>
      </div>

      <div className="text-xs text-gray-600">
        {String(data.label || 'Agent Node')}
      </div>

      {data.agentId ? (
        <div className="text-xs text-gray-500 mt-1">
          ID: {String(data.agentId)}
        </div>
      ) : null}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
}

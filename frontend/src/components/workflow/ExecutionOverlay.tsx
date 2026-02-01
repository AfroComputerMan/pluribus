/**
 * ExecutionOverlay
 * Read-only React Flow canvas for visualizing workflow execution with real-time status updates
 */

import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import type { NodeRun } from '../../api/client';

import { AgentNode } from './nodes/AgentNode';
import { ConditionNode } from './nodes/ConditionNode';
import { ParallelNode } from './nodes/ParallelNode';
import { LoopNode } from './nodes/LoopNode';
import { HumanReviewNode } from './nodes/HumanReviewNode';

import '@xyflow/react/dist/style.css';

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

interface ExecutionNodeData extends Record<string, unknown> {
  label?: string;
  executionStatus?: ExecutionStatus;
  duration?: string;
  error?: string;
}

export type ExecutionNode = Node<ExecutionNodeData, string>;

interface ExecutionOverlayProps {
  nodes: ExecutionNode[];
  edges: Edge[];
  nodeExecutions: NodeRun[];
  onNodeClick?: (nodeId: string) => void;
  isConnected?: boolean;
  showMiniMap?: boolean;
}

// Custom node types
const nodeTypes = {
  agent: AgentNode,
  condition: ConditionNode,
  parallel: ParallelNode,
  loop: LoopNode,
  humanReview: HumanReviewNode,
};

/**
 * Calculate duration string from start and end times
 */
function calculateDuration(startedAt: string | null, completedAt: string | null): string | undefined {
  if (!startedAt || !completedAt) return undefined;

  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const durationMs = end - start;

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Merge node execution data with workflow nodes
 */
function mergeExecutionData(
  nodes: ExecutionNode[],
  nodeExecutions: NodeRun[],
): ExecutionNode[] {
  // Create a map of nodeId -> execution data
  const executionMap = new Map<string, NodeRun>();
  for (const exec of nodeExecutions) {
    executionMap.set(exec.nodeId, exec);
  }

  return nodes.map((node) => {
    const execution = executionMap.get(node.id);

    if (!execution) {
      return node;
    }

    return {
      ...node,
      data: {
        ...node.data,
        executionStatus: execution.status,
        duration: calculateDuration(execution.startedAt, execution.completedAt),
        error: execution.error || undefined,
      },
    };
  });
}

export function ExecutionOverlay({
  nodes,
  edges,
  nodeExecutions,
  onNodeClick,
  isConnected,
  showMiniMap = false,
}: ExecutionOverlayProps) {
  // Merge execution data into nodes
  const nodesWithExecution = useMemo(
    () => mergeExecutionData(nodes, nodeExecutions),
    [nodes, nodeExecutions],
  );

  const handleNodeClick = (_event: React.MouseEvent, node: { id: string }) => {
    onNodeClick?.(node.id);
  };

  return (
    <div className="w-full h-full relative">
      {/* Connection status indicator */}
      {isConnected !== undefined && (
        <div className="absolute top-4 right-4 z-10">
          {isConnected ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              Disconnected
            </span>
          )}
        </div>
      )}

      <ReactFlow
        nodes={nodesWithExecution}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        // Read-only mode
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        // Viewport settings
        fitView
        fitViewOptions={{ padding: 0.2 }}
        // Interaction settings
        panOnScroll
        zoomOnScroll
        minZoom={0.1}
        maxZoom={2}
      >
        <Background />
        <Controls showInteractive={false} />
        {showMiniMap && <MiniMap />}
      </ReactFlow>
    </div>
  );
}

/**
 * ExecutionPage
 * Displays real-time workflow execution visualization using SSE
 */

import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { NodeRun } from '../api/client';
import { ExecutionOverlay } from '../components/workflow/ExecutionOverlay';
import { NodeExecutionModal } from '../components/workflow/NodeExecutionModal';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { useWorkflowEvents } from '../hooks/useWorkflowEvents';
import { fromBackendFormat } from '../lib/workflow/serialization';
import { applyDagreLayout } from '../lib/autoLayout';

export function ExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Fetch run details
  const {
    data: runResponse,
    isLoading: runLoading,
    error: runError,
  } = useQuery({
    queryKey: ['run', id],
    queryFn: () => api.workflowRuns.get(id!),
    enabled: !!id,
  });
  const run = runResponse?.data;

  // Fetch workflow details
  const { data: workflowResponse, isLoading: workflowLoading } = useQuery({
    queryKey: ['workflow', run?.workflowId],
    queryFn: () => api.workflows.get(run!.workflowId),
    enabled: !!run?.workflowId,
  });
  const workflow = workflowResponse?.data;

  // Fetch node executions
  const { data: nodeRunsResponse, isLoading: nodesLoading } = useQuery({
    queryKey: ['run-nodes', id],
    queryFn: () => api.nodeRuns.list(id!),
    enabled: !!id,
  });
  const nodeRuns = nodeRunsResponse?.data || [];

  // SSE for real-time updates
  const isRunActive = run?.status === 'running' || run?.status === 'pending';

  const handleSSEEvent = useCallback(() => {
    // Refetch node runs when we receive an event
    queryClient.invalidateQueries({ queryKey: ['run-nodes', id] });
    queryClient.invalidateQueries({ queryKey: ['run', id] });
  }, [id, queryClient]);

  const { isConnected } = useWorkflowEvents(
    isRunActive ? id : undefined,
    {
      enabled: isRunActive,
      onEvent: handleSSEEvent,
    },
  );

  // Convert workflow to React Flow format
  const { nodes, edges } = useMemo(() => {
    if (!workflow) {
      return { nodes: [], edges: [] };
    }

    const { nodes: backendNodes, edges: backendEdges } = workflow;
    const converted = fromBackendFormat({ nodes: backendNodes, edges: backendEdges });

    // Apply auto-layout
    const layoutedNodes = applyDagreLayout(converted.nodes, converted.edges);

    return { nodes: layoutedNodes, edges: converted.edges };
  }, [workflow]);

  // Handle node click
  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  // Get selected node execution
  const selectedExecution = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodeRuns.find((nr: NodeRun) => nr.nodeId === selectedNodeId) || null;
  }, [selectedNodeId, nodeRuns]);

  // Close modal
  const handleCloseModal = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Loading state
  const isLoading = runLoading || workflowLoading || nodesLoading;

  if (isLoading && !run) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading execution...</div>
      </div>
    );
  }

  if (runError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-500">Error loading execution</div>
      </div>
    );
  }

  if (!run || !workflow) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Run not found</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-gray-900">{workflow.name}</h1>
          <StatusBadge status={run.status} />
          {isRunActive && (
            <span className="text-sm text-gray-500">
              {isConnected ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  Live
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-red-500">
                  <span className="w-2 h-2 bg-red-500 rounded-full" />
                  Disconnected
                </span>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => navigate(`/runs/${id}`)}
          >
            View Details
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate(`/workflows/${run.workflowId}/runs`)}
          >
            Back to Runs
          </Button>
        </div>
      </header>

      {/* Canvas */}
      <main className="flex-1 relative">
        <ExecutionOverlay
          nodes={nodes}
          edges={edges}
          nodeExecutions={nodeRuns}
          onNodeClick={handleNodeClick}
          isConnected={isRunActive ? isConnected : undefined}
          showMiniMap
        />
      </main>

      {/* Node Execution Modal */}
      <NodeExecutionModal
        execution={selectedExecution}
        onClose={handleCloseModal}
      />
    </div>
  );
}

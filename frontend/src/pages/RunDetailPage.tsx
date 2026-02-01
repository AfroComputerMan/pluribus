/**
 * RunDetailPage
 * Displays detailed view of a workflow run with real-time node execution updates via SSE
 */

import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type WorkflowRun } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { JsonViewer } from '../components/JsonViewer';
import { Button } from '../components/Button';
import { useSSE } from '../hooks/useSSE';

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Fetch run details
  const { data: runResponse, isLoading: runLoading } = useQuery({
    queryKey: ['run', id],
    queryFn: () => api.workflowRuns.get(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const response = query.state.data as { data: WorkflowRun } | undefined;
      const run = response?.data;
      // Auto-refresh every 2 seconds if run is active
      return run?.status === 'running' || run?.status === 'pending' ? 2000 : false;
    },
  });
  const runData = runResponse?.data;

  // Fetch workflow details to get the name
  const { data: workflowResponse } = useQuery({
    queryKey: ['workflow', runData?.workflowId],
    queryFn: () => api.workflows.get(runData!.workflowId),
    enabled: !!runData?.workflowId,
  });
  const workflowData = workflowResponse?.data;

  // Fetch node executions
  const { data: nodesResponse, isLoading: nodesLoading } = useQuery({
    queryKey: ['run-nodes', id],
    queryFn: () => api.nodeRuns.list(id!),
    enabled: !!id,
    // Note: SSE handles real-time updates, so we don't need aggressive refetching
    refetchInterval: false,
  });
  const nodesData = nodesResponse?.data;

  // SSE connection for real-time updates
  const handleSSEMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      console.log('[SSE Event]', event.type, data);

      // Invalidate queries to refetch updated data
      if (event.type === 'node:started' || event.type === 'node:completed' || event.type === 'node:failed') {
        queryClient.invalidateQueries({ queryKey: ['run-nodes', id] });
      }

      if (event.type === 'run:completed' || event.type === 'run:failed') {
        queryClient.invalidateQueries({ queryKey: ['run', id] });
        queryClient.invalidateQueries({ queryKey: ['run-nodes', id] });
      }
    } catch (error) {
      console.error('[SSE] Failed to parse message', error);
    }
  }, [id, queryClient]);

  const sseUrl = id ? `/api/runs/${id}/events` : null;
  const { isConnected: sseConnected } = useSSE(sseUrl, {
    onMessage: handleSSEMessage,
    enabled: !!id && (runData?.status === 'running' || runData?.status === 'pending'),
  });

  const toggleNodeExpansion = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatDuration = (startedAt: string | null, completedAt: string | null) => {
    if (!startedAt) return '-';
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const durationMs = end - start;
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);

    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  if (runLoading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Run Detail</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          Loading run details...
        </div>
      </div>
    );
  }

  if (!runData) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Run Detail</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-red-500">
          Run not found
        </div>
      </div>
    );
  }

  const run = runData;
  const nodes = nodesData || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {workflowData?.name || 'Workflow'} Run
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-gray-500 font-mono text-sm">{run.id}</p>
            {sseConnected && (run.status === 'running' || run.status === 'pending') && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Live Updates
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => navigate(`/runs/${run.id}/visualize`)}
          >
            Visualize
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate(`/workflows/${run.workflowId}/runs`)}
          >
            Back to Runs
          </Button>
        </div>
      </div>

      {/* Run Metadata */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Run Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-gray-500">Status</div>
            <div className="mt-1">
              <StatusBadge status={run.status} />
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Duration</div>
            <div className="mt-1 text-sm text-gray-900">
              {formatDuration(run.startedAt, run.completedAt)}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Created</div>
            <div className="mt-1 text-sm text-gray-900">{formatTimestamp(run.createdAt)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Started</div>
            <div className="mt-1 text-sm text-gray-900">{formatTimestamp(run.startedAt)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Completed</div>
            <div className="mt-1 text-sm text-gray-900">{formatTimestamp(run.completedAt)}</div>
          </div>
        </div>

        {/* Input/Output */}
        {run.input && Object.keys(run.input).length > 0 && (
          <div className="mt-4">
            <JsonViewer data={run.input} title="Input" />
          </div>
        )}
        {run.output && (
          <div className="mt-4">
            <JsonViewer data={run.output} title="Output" />
          </div>
        )}
        {run.error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <div className="text-sm font-medium text-red-800">Error</div>
            <div className="mt-1 text-sm text-red-700">{run.error}</div>
          </div>
        )}
      </div>

      {/* Node Executions */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Node Executions {nodesLoading && <span className="text-sm text-gray-500">(updating...)</span>}
        </h2>

        {nodes.length === 0 ? (
          <p className="text-gray-500 text-center py-4">No node executions yet</p>
        ) : (
          <div className="space-y-3">
            {nodes.map((node) => (
              <div
                key={node.id}
                className="border border-gray-200 rounded-md overflow-hidden"
              >
                {/* Node Header */}
                <button
                  onClick={() => toggleNodeExpansion(node.id)}
                  className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left flex items-center justify-between"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <StatusBadge status={node.status} />
                    <div>
                      <div className="font-medium text-gray-900">Node: {node.nodeId}</div>
                      <div className="text-xs text-gray-500">
                        {formatTimestamp(node.startedAt)}
                        {node.completedAt && ` • ${formatDuration(node.startedAt, node.completedAt)}`}
                      </div>
                    </div>
                  </div>
                  <span className="text-gray-500">
                    {expandedNodes.has(node.id) ? '−' : '+'}
                  </span>
                </button>

                {/* Node Details */}
                {expandedNodes.has(node.id) && (
                  <div className="p-4 space-y-3 bg-white">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-gray-500">Node ID</div>
                        <div className="font-mono text-gray-900">{node.nodeId}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Execution ID</div>
                        <div className="font-mono text-xs text-gray-900">{node.id}</div>
                      </div>
                    </div>

                    {node.input && Object.keys(node.input).length > 0 && (
                      <JsonViewer data={node.input} title="Input" defaultExpanded />
                    )}
                    {node.output && (
                      <JsonViewer data={node.output} title="Output" defaultExpanded />
                    )}
                    {node.error && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                        <div className="text-sm font-medium text-red-800">Error</div>
                        <div className="mt-1 text-sm text-red-700">{node.error}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

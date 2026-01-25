/**
 * WorkflowRunsPage
 * Displays list of runs for a specific workflow
 */

import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, WorkflowRun } from '../api/client';
import { DataTable, Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';

export function WorkflowRunsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch workflow details
  const { data: workflowResponse } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => api.workflows.get(id!),
    enabled: !!id,
  });
  const workflow = workflowResponse?.data;

  // Fetch workflow runs
  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-runs', id],
    queryFn: () => api.workflowRuns.list(id!),
    enabled: !!id,
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  // Create new run
  const createRunMutation = useMutation({
    mutationFn: () => api.workflowRuns.create(id!, {}),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs', id] });
      navigate(`/runs/${result.data.id}`);
    },
  });

  const handleRowClick = (run: WorkflowRun) => {
    navigate(`/runs/${run.id}`);
  };

  const handleNewRun = () => {
    createRunMutation.mutate();
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

  const columns: Column<WorkflowRun>[] = [
    {
      key: 'status',
      header: 'Status',
      render: (run) => <StatusBadge status={run.status} />,
    },
    {
      key: 'createdAt',
      header: 'Started',
      render: (run) => {
        const date = new Date(run.createdAt);
        return (
          <div>
            <div>{date.toLocaleDateString()}</div>
            <div className="text-xs text-gray-500">{date.toLocaleTimeString()}</div>
          </div>
        );
      },
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (run) => formatDuration(run.startedAt, run.completedAt),
    },
    {
      key: 'id',
      header: 'Run ID',
      render: (run) => (
        <span className="font-mono text-xs text-gray-600">
          {run.id.slice(0, 8)}...
        </span>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Workflow Runs</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          Loading runs...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Workflow Runs</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-red-500">
          Error loading runs: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {workflow?.name || 'Workflow'} Runs
          </h1>
          {workflow?.description && (
            <p className="text-gray-600 mt-1">{workflow.description}</p>
          )}
        </div>
        <Button onClick={handleNewRun} disabled={createRunMutation.isPending}>
          {createRunMutation.isPending ? 'Creating...' : 'New Run'}
        </Button>
      </div>

      {/* Runs table */}
      <DataTable
        columns={columns}
        data={data?.data || []}
        onRowClick={handleRowClick}
        emptyMessage="No runs yet. Click 'New Run' to start one."
      />
    </div>
  );
}

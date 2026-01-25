/**
 * WorkflowsPage
 * Displays list of workflows with ability to trigger runs
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, Workflow } from '../api/client';
import { DataTable, Column } from '../components/DataTable';
import { Button } from '../components/Button';

export function WorkflowsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch workflows
  const { data, isLoading, error } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => api.workflows.list(),
  });

  // Trigger workflow run
  const runWorkflowMutation = useMutation({
    mutationFn: (workflowId: string) => api.workflowRuns.create(workflowId, {}),
    onSuccess: (result) => {
      // Navigate to the run detail page
      navigate(`/runs/${result.data.id}`);
    },
  });

  const handleRunWorkflow = (workflow: Workflow, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click navigation
    runWorkflowMutation.mutate(workflow.id);
  };

  const handleRowClick = (workflow: Workflow) => {
    navigate(`/workflows/${workflow.id}/runs`);
  };

  // Filter workflows based on search term
  const filteredWorkflows = data?.data.filter((workflow) =>
    workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    workflow.description?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const columns: Column<Workflow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (workflow) => (
        <div>
          <div className="font-medium text-gray-900">{workflow.name}</div>
          {workflow.description && (
            <div className="text-sm text-gray-500">{workflow.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (workflow) => new Date(workflow.createdAt).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (workflow) => (
        <Button
          variant="primary"
          onClick={(e) => handleRunWorkflow(workflow, e)}
          disabled={runWorkflowMutation.isPending}
        >
          {runWorkflowMutation.isPending ? 'Running...' : 'Run'}
        </Button>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Workflows</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          Loading workflows...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Workflows</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-red-500">
          Error loading workflows: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Workflows</h1>
      </div>

      {/* Search input */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search workflows..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Workflows table */}
      <DataTable
        columns={columns}
        data={filteredWorkflows}
        onRowClick={handleRowClick}
        emptyMessage="No workflows found. Create one using the API."
      />
    </div>
  );
}

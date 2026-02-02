/**
 * AgentsPage
 * Displays list of agents with ability to create, edit, and delete
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Agent } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Button } from '../components/Button';

export function AgentsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch agents
  const { data, isLoading, error } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.agents.list(),
  });

  // Delete agent mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.agents.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const handleDelete = (agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click navigation
    if (window.confirm(`Are you sure you want to delete "${agent.name}"?`)) {
      deleteMutation.mutate(agent.id);
    }
  };

  const handleRowClick = (agent: Agent) => {
    navigate(`/agents/${agent.id}/edit`);
  };

  // Filter agents based on search term
  const filteredAgents =
    data?.data.filter(
      (agent) =>
        agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        agent.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        agent.tags.some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase())),
    ) || [];

  const columns: Column<Agent>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (agent) => (
        <div>
          <div className="font-medium text-gray-900">{agent.name}</div>
          {agent.description && <div className="text-sm text-gray-500">{agent.description}</div>}
        </div>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      render: (agent) => (
        <div className="text-sm">
          <div className="text-gray-900">{agent.modelConfig.model}</div>
          <div className="text-gray-500 text-xs">{agent.modelConfig.provider}</div>
        </div>
      ),
    },
    {
      key: 'integration',
      header: 'Integration',
      render: (agent) => (
        <span className="text-sm text-gray-600">
          {agent.integration?.type || <span className="text-gray-400">None</span>}
        </span>
      ),
    },
    {
      key: 'tags',
      header: 'Tags',
      render: (agent) => (
        <div className="flex flex-wrap gap-1">
          {agent.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
            >
              {tag}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (agent) => new Date(agent.createdAt).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (agent) => (
        <Button
          variant="secondary"
          onClick={(e) => handleDelete(agent, e)}
          disabled={deleteMutation.isPending}
        >
          Delete
        </Button>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Agents</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          Loading agents...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Agents</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-red-500">
          Error loading agents: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Agents</h1>
        <Button variant="primary" onClick={() => navigate('/agents/new')}>
          Create Agent
        </Button>
      </div>

      {/* Search input */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search agents..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Agents table */}
      <DataTable
        columns={columns}
        data={filteredAgents}
        onRowClick={handleRowClick}
        emptyMessage="No agents found. Create one to get started."
      />
    </div>
  );
}

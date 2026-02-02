/**
 * AgentForm
 * Form component for creating and editing agents
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CreateAgentInput, type UpdateAgentInput } from '../../api/client';
import { Button } from '../Button';

interface FormData {
  name: string;
  description: string;
  model: string;
  provider: 'anthropic' | 'openai' | 'custom';
  tags: string;
  memoryMode: 'stateless' | 'session' | 'persistent';
  isolationLevel: 'shared' | 'process' | 'container';
  canSpawnSubAgents: boolean;
  maxSubAgents: string;
}

const initialFormData: FormData = {
  name: '',
  description: '',
  model: 'claude-3-opus',
  provider: 'anthropic',
  tags: '',
  memoryMode: 'stateless',
  isolationLevel: 'shared',
  canSpawnSubAgents: false,
  maxSubAgents: '',
};

export function AgentForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(id);

  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch existing agent in edit mode
  const {
    data: agentData,
    isLoading,
    error: fetchError,
  } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.agents.get(id!),
    enabled: isEditMode,
  });

  // Populate form with agent data when loaded
  useEffect(() => {
    if (agentData?.data) {
      const agent = agentData.data;
      setFormData({
        name: agent.name,
        description: agent.description || '',
        model: agent.modelConfig.model,
        provider: agent.modelConfig.provider,
        tags: agent.tags.join(', '),
        memoryMode: agent.memoryMode,
        isolationLevel: agent.isolationLevel,
        canSpawnSubAgents: agent.canSpawnSubAgents,
        maxSubAgents: agent.maxSubAgents?.toString() || '',
      });
    }
  }, [agentData]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (input: CreateAgentInput) => api.agents.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      navigate('/agents');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (input: UpdateAgentInput) => api.agents.update(id!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent', id] });
      navigate('/agents');
    },
  });

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!formData.model.trim()) {
      newErrors.model = 'Model is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    const tags = formData.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    const input: CreateAgentInput = {
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      modelConfig: {
        provider: formData.provider,
        model: formData.model.trim(),
      },
      tags,
      memoryMode: formData.memoryMode,
      isolationLevel: formData.isolationLevel,
      canSpawnSubAgents: formData.canSpawnSubAgents,
      maxSubAgents: formData.maxSubAgents ? parseInt(formData.maxSubAgents, 10) : null,
    };

    if (isEditMode) {
      updateMutation.mutate(input);
    } else {
      createMutation.mutate(input);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    // Clear error when field is edited
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleCancel = () => {
    navigate('/agents');
  };

  if (isEditMode && isLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Edit Agent</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          Loading agent...
        </div>
      </div>
    );
  }

  if (isEditMode && fetchError) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Edit Agent</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-red-500">
          Error loading agent: {fetchError.message}
        </div>
      </div>
    );
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">
        {isEditMode ? 'Edit Agent' : 'Create Agent'}
      </h1>

      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6 space-y-6">
        {/* Name */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className={`w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
              errors.name ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="Enter agent name"
          />
          {errors.name && <p className="mt-1 text-sm text-red-500">{errors.name}</p>}
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Describe what this agent does"
          />
        </div>

        {/* Model Configuration */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="provider" className="block text-sm font-medium text-gray-700 mb-1">
              Provider
            </label>
            <select
              id="provider"
              name="provider"
              value={formData.provider}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div>
            <label htmlFor="model" className="block text-sm font-medium text-gray-700 mb-1">
              Model
            </label>
            <input
              type="text"
              id="model"
              name="model"
              value={formData.model}
              onChange={handleChange}
              className={`w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.model ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="e.g., claude-3-opus"
            />
            {errors.model && <p className="mt-1 text-sm text-red-500">{errors.model}</p>}
          </div>
        </div>

        {/* Tags */}
        <div>
          <label htmlFor="tags" className="block text-sm font-medium text-gray-700 mb-1">
            Tags
          </label>
          <input
            type="text"
            id="tags"
            name="tags"
            value={formData.tags}
            onChange={handleChange}
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter tags, separated by commas"
          />
          <p className="mt-1 text-xs text-gray-500">Separate multiple tags with commas</p>
        </div>

        {/* Memory Mode */}
        <div>
          <label htmlFor="memoryMode" className="block text-sm font-medium text-gray-700 mb-1">
            Memory Mode
          </label>
          <select
            id="memoryMode"
            name="memoryMode"
            value={formData.memoryMode}
            onChange={handleChange}
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="stateless">Stateless - No memory between runs</option>
            <option value="session">Session - Memory within session</option>
            <option value="persistent">Persistent - Memory across sessions</option>
          </select>
        </div>

        {/* Isolation Level */}
        <div>
          <label htmlFor="isolationLevel" className="block text-sm font-medium text-gray-700 mb-1">
            Isolation Level
          </label>
          <select
            id="isolationLevel"
            name="isolationLevel"
            value={formData.isolationLevel}
            onChange={handleChange}
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="shared">Shared - Run in shared environment</option>
            <option value="process">Process - Run in isolated process</option>
            <option value="container">Container - Run in Docker container</option>
          </select>
        </div>

        {/* Sub-agents */}
        <div className="space-y-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="canSpawnSubAgents"
              name="canSpawnSubAgents"
              checked={formData.canSpawnSubAgents}
              onChange={handleChange}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="canSpawnSubAgents" className="ml-2 text-sm text-gray-700">
              Can spawn sub-agents
            </label>
          </div>

          {formData.canSpawnSubAgents && (
            <div>
              <label htmlFor="maxSubAgents" className="block text-sm font-medium text-gray-700 mb-1">
                Max Sub-Agents
              </label>
              <input
                type="number"
                id="maxSubAgents"
                name="maxSubAgents"
                value={formData.maxSubAgents}
                onChange={handleChange}
                min="1"
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Maximum number of sub-agents"
              />
            </div>
          )}
        </div>

        {/* Error display */}
        {(createMutation.error || updateMutation.error) && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-red-600 text-sm">
            {createMutation.error?.message || updateMutation.error?.message}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-4 border-t border-gray-200">
          <Button variant="secondary" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={isSaving}>
            {isSaving ? 'Saving...' : isEditMode ? 'Update Agent' : 'Create Agent'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * WorkflowBuilderPage
 * Visual workflow builder with drag-and-drop DAG editor
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { WorkflowCanvas } from '../components/workflow/WorkflowCanvas';
import { NodePalette } from '../components/workflow/NodePalette';
import { NodeConfigPanel } from '../components/workflow/NodeConfigPanel';
import { Button } from '../components/Button';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';

export function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditMode = Boolean(id);
  const [workflowName, setWorkflowName] = useState('Untitled Workflow');
  const [workflowDescription, setWorkflowDescription] = useState('');

  const { reset, nodes, edges, selectedNode } = useWorkflowBuilderStore();

  // Load existing workflow in edit mode
  const { data: workflow } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => api.workflows.get(id!),
    enabled: isEditMode,
  });

  // Initialize workflow data when loaded
  useEffect(() => {
    if (workflow?.data) {
      setWorkflowName(workflow.data.name);
      setWorkflowDescription(workflow.data.description || '');

      // Load workflow definition into store
      const definition = workflow.data.definition;
      if (definition.nodes && definition.edges) {
        // Convert backend nodes to React Flow nodes will be handled by store
        // For now, we'll need to transform the data
        // This is a placeholder - actual transformation will be done
      }
    }
  }, [workflow]);

  // Reset store on unmount
  useEffect(() => {
    return () => reset();
  }, [reset]);

  const handleSave = async () => {
    // TODO: Validate workflow before saving
    const definition = {
      nodes,
      edges,
    };

    try {
      if (isEditMode && id) {
        await api.workflows.update(id, {
          name: workflowName,
          description: workflowDescription,
          definition,
        });
      } else {
        const result = await api.workflows.create({
          name: workflowName,
          description: workflowDescription,
          definition,
        });
        navigate(`/workflows/${result.data.id}/edit`);
      }
    } catch (error) {
      console.error('Failed to save workflow:', error);
    }
  };

  const handleCancel = () => {
    navigate('/');
  };

  return (
    <div className="fixed inset-0 bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1">
          <input
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="text-xl font-semibold border-none focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
            placeholder="Workflow name"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            {isEditMode ? 'Save' : 'Create'}
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Node Palette Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <NodePalette />
        </aside>

        {/* Canvas */}
        <main className="flex-1 relative">
          <WorkflowCanvas />
        </main>

        {/* Node Config Panel - shows when node is selected */}
        {selectedNode && (
          <aside className="w-80 bg-white border-l border-gray-200 overflow-y-auto">
            <NodeConfigPanel />
          </aside>
        )}
      </div>
    </div>
  );
}

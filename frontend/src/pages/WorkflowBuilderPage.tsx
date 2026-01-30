// frontend/src/pages/WorkflowBuilderPage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { WorkflowCanvas } from '../components/workflow/WorkflowCanvas';
import { NodePalette } from '../components/workflow/NodePalette';
import { NodeConfigPanel } from '../components/workflow/NodeConfigPanel';
import { Button } from '../components/Button';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';
import { useWorkflowMutations } from '../hooks/useWorkflowMutations';
import { fromBackendFormat, type BackendWorkflowDefinition } from '../lib/workflow/serialization';

export function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditMode = Boolean(id);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const {
    reset,
    loadWorkflow,
    selectedNode,
    workflowName,
    setWorkflowName,
    isDirty,
  } = useWorkflowBuilderStore();

  const { saveWorkflow, isSaving } = useWorkflowMutations();

  // Load existing workflow in edit mode
  const { data: workflow, isLoading } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => api.workflows.get(id!),
    enabled: isEditMode,
  });

  // Initialize workflow data when loaded
  useEffect(() => {
    if (workflow?.data) {
      const definition = workflow.data.definition as BackendWorkflowDefinition;
      const { nodes, edges } = fromBackendFormat(definition);

      loadWorkflow({
        id: workflow.data.id,
        name: workflow.data.name,
        description: workflow.data.description || '',
        nodes,
        edges,
      });
    }
  }, [workflow, loadWorkflow]);

  // Reset store on unmount
  useEffect(() => {
    return () => reset();
  }, [reset]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleSave = async () => {
    setValidationErrors([]);
    const result = await saveWorkflow();

    if (!result.success) {
      if (result.validationResult) {
        setValidationErrors(result.validationResult.errors.map((e) => e.message));
      } else if (result.error) {
        setValidationErrors([result.error.message]);
      }
      return;
    }

    // Navigate to edit mode if was creating new
    if (!isEditMode && result.workflowId) {
      navigate(`/workflows/${result.workflowId}/edit`, { replace: true });
    }
  };

  const handleCancel = () => {
    if (isDirty && !confirm('Discard unsaved changes?')) {
      return;
    }
    navigate('/');
  };

  if (isEditMode && isLoading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

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
          {isDirty && <span className="text-sm text-gray-500">(unsaved)</span>}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : isEditMode ? 'Save' : 'Create'}
          </Button>
        </div>
      </header>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2">
          <ul className="text-sm text-red-600">
            {validationErrors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

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

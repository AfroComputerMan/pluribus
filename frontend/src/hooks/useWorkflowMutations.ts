// frontend/src/hooks/useWorkflowMutations.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore';
import { toBackendFormat } from '@/lib/workflow/serialization';
import { validateWorkflow, type WorkflowValidationResult } from '@/lib/workflow/validation';

interface SaveResult {
  success: boolean;
  workflowId?: string;
  validationResult?: WorkflowValidationResult;
  error?: Error;
}

export function useWorkflowMutations() {
  const queryClient = useQueryClient();

  const {
    workflowId,
    workflowName,
    workflowDescription,
    nodes,
    edges,
    triggers,
    errorStrategy,
    setWorkflowId,
    markClean,
  } = useWorkflowBuilderStore();

  const createMutation = useMutation({
    mutationFn: api.workflows.create,
    onSuccess: (data) => {
      setWorkflowId(data.data.id);
      markClean();
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof api.workflows.update>[1]) =>
      api.workflows.update(id, input),
    onSuccess: () => {
      markClean();
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
    },
  });

  const saveWorkflow = async (): Promise<SaveResult> => {
    // Validate first
    const validationResult = validateWorkflow(nodes, edges);
    if (!validationResult.isValid) {
      return { success: false, validationResult };
    }

    const { nodes: backendNodes, edges: backendEdges } = toBackendFormat(nodes, edges);

    try {
      if (workflowId) {
        // Update existing
        await updateMutation.mutateAsync({
          id: workflowId,
          name: workflowName,
          description: workflowDescription || undefined,
          nodes: backendNodes,
          edges: backendEdges,
          triggers,
          errorStrategy,
        });
        return { success: true, workflowId };
      } else {
        // Create new workflow with triggers and error strategy from store
        const result = await createMutation.mutateAsync({
          name: workflowName,
          description: workflowDescription || undefined,
          nodes: backendNodes,
          edges: backendEdges,
          triggers,
          errorStrategy,
        });
        return { success: true, workflowId: result.data.id };
      }
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      return { success: false, error: normalizedError };
    }
  };

  return {
    saveWorkflow,
    isSaving: createMutation.isPending || updateMutation.isPending,
    saveError: createMutation.error || updateMutation.error,
  };
}

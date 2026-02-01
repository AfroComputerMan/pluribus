// frontend/src/hooks/useWorkflowMutations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useWorkflowMutations } from './useWorkflowMutations';
import { api } from '@/api/client';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore';

vi.mock('@/api/client', () => ({
  api: {
    workflows: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useWorkflowMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkflowBuilderStore.getState().reset();
  });

  it('creates new workflow when no workflowId', async () => {
    const mockWorkflow = { id: 'new-id', name: 'Test', definition: {} };
    vi.mocked(api.workflows.create).mockResolvedValue({ data: mockWorkflow });

    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowName('Test Workflow');
    store.addNode({ id: 'n1', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } });

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    const saveResult = await result.current.saveWorkflow();

    expect(saveResult.success).toBe(true);
    expect(api.workflows.create).toHaveBeenCalled();
  });

  it('updates existing workflow when workflowId exists', async () => {
    const mockWorkflow = { id: 'existing-id', name: 'Test', definition: {} };
    vi.mocked(api.workflows.update).mockResolvedValue({ data: mockWorkflow });

    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowId('existing-id');
    store.setWorkflowName('Test Workflow');

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    const saveResult = await result.current.saveWorkflow();

    expect(saveResult.success).toBe(true);
    expect(api.workflows.update).toHaveBeenCalledWith('existing-id', expect.any(Object));
  });

  it('returns validation errors when workflow is invalid', async () => {
    const store = useWorkflowBuilderStore.getState();
    // Add node with missing required field (no agentId)
    store.addNode({ id: 'n1', type: 'agent', position: { x: 0, y: 0 }, data: {} });

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    const saveResult = await result.current.saveWorkflow();

    expect(saveResult.success).toBe(false);
    expect(saveResult.validationResult?.errors.length).toBeGreaterThan(0);
  });

  it('sets workflowId in store after creating new workflow', async () => {
    const mockWorkflow = { id: 'new-workflow-id', name: 'Test', definition: {} };
    vi.mocked(api.workflows.create).mockResolvedValue({ data: mockWorkflow });

    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowName('New Workflow');

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    await result.current.saveWorkflow();

    expect(useWorkflowBuilderStore.getState().workflowId).toBe('new-workflow-id');
  });

  it('marks store as clean after successful save', async () => {
    const mockWorkflow = { id: 'new-id', name: 'Test', definition: {} };
    vi.mocked(api.workflows.create).mockResolvedValue({ data: mockWorkflow });

    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowName('Test Workflow');
    // Store should be dirty after setting name
    expect(useWorkflowBuilderStore.getState().isDirty).toBe(true);

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    await result.current.saveWorkflow();

    expect(useWorkflowBuilderStore.getState().isDirty).toBe(false);
  });

  it('returns error when API call fails', async () => {
    const apiError = new Error('Network error');
    vi.mocked(api.workflows.create).mockRejectedValue(apiError);

    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowName('Test Workflow');

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    const saveResult = await result.current.saveWorkflow();

    expect(saveResult.success).toBe(false);
    expect(saveResult.error).toBe(apiError);
  });

  it('tracks saving state during mutation', async () => {
    let resolveCreate: (value: unknown) => void;
    const createPromise = new Promise((resolve) => {
      resolveCreate = resolve;
    });
    vi.mocked(api.workflows.create).mockReturnValue(createPromise as never);

    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowName('Test Workflow');

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    expect(result.current.isSaving).toBe(false);

    const savePromise = result.current.saveWorkflow();

    await waitFor(() => {
      expect(result.current.isSaving).toBe(true);
    });

    resolveCreate!({ data: { id: 'new-id', name: 'Test', definition: {} } });
    await savePromise;

    await waitFor(() => {
      expect(result.current.isSaving).toBe(false);
    });
  });

  it('includes workflow description in create payload', async () => {
    const mockWorkflow = { id: 'new-id', name: 'Test', definition: {} };
    vi.mocked(api.workflows.create).mockResolvedValue({ data: mockWorkflow });

    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowName('Test Workflow');
    store.setWorkflowDescription('A test description');

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    await result.current.saveWorkflow();

    expect(api.workflows.create).toHaveBeenCalled();
    const callArgs = vi.mocked(api.workflows.create).mock.calls[0][0];
    expect(callArgs.name).toBe('Test Workflow');
    expect(callArgs.description).toBe('A test description');
  });

  it('serializes nodes and edges to backend format', async () => {
    const mockWorkflow = { id: 'new-id', name: 'Test', definition: {} };
    vi.mocked(api.workflows.create).mockResolvedValue({ data: mockWorkflow });

    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowName('Test Workflow');
    store.addNode({
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { agentId: '123e4567-e89b-12d3-a456-426614174000', input: { key: 'value' } },
    });
    store.addNode({
      id: 'agent-2',
      type: 'agent',
      position: { x: 200, y: 0 },
      data: { agentId: '223e4567-e89b-12d3-a456-426614174000' },
    });
    store.addEdge({ id: 'e1', source: 'agent-1', target: 'agent-2' });

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    await result.current.saveWorkflow();

    expect(api.workflows.create).toHaveBeenCalled();
    const callArgs = vi.mocked(api.workflows.create).mock.calls[0][0];

    // Check nodes are serialized correctly (now top-level, not nested in definition)
    expect(callArgs.nodes).toHaveLength(2);
    expect(callArgs.nodes).toContainEqual(
      expect.objectContaining({ id: 'agent-1', type: 'agent', agentId: '123e4567-e89b-12d3-a456-426614174000' })
    );
    expect(callArgs.nodes).toContainEqual(
      expect.objectContaining({ id: 'agent-2', type: 'agent', agentId: '223e4567-e89b-12d3-a456-426614174000' })
    );

    // Check edges are serialized correctly (source/target become from/to)
    expect(callArgs.edges).toHaveLength(1);
    expect(callArgs.edges[0]).toMatchObject({ id: 'e1', from: 'agent-1', to: 'agent-2' });

    // Check default triggers and errorStrategy are included
    expect(callArgs.triggers).toEqual([{ type: 'manual' }]);
    expect(callArgs.errorStrategy).toMatchObject({ retries: 0, onFailure: 'stop' });
  });
});

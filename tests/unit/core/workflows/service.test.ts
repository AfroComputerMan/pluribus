import { describe, expect, it, mock, beforeEach, spyOn } from 'bun:test';
import { WorkflowService } from '@/core/workflows/service';
import { WorkflowRepository } from '@/core/workflows/repository';
import { ValidationError } from '@/lib/errors';
import type { CreateWorkflowInput, Workflow } from '@/core/workflows/types';

describe('WorkflowService', () => {
  // Create a mock repository
  const mockRepository = {
    findById: mock(() => Promise.resolve({})),
    findAll: mock(() => Promise.resolve([])),
    create: mock(() => Promise.resolve({})),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve(true)),
    findRunById: mock(() => Promise.resolve({})),
    findRuns: mock(() => Promise.resolve([])),
    createRun: mock(() => Promise.resolve({ id: 'run-123' })),
    updateRun: mock(() => Promise.resolve({})),
    cancelRun: mock(() => Promise.resolve({})),
    findNodeExecutions: mock(() => Promise.resolve([])),
    findNodeExecution: mock(() => Promise.resolve(null)),
    createNodeExecution: mock(() => Promise.resolve({})),
    updateNodeExecution: mock(() => Promise.resolve({})),
    getRunProgress: mock(() => Promise.resolve({ total: 0, completed: 0, failed: 0, running: 0, pending: 0 })),
    getRunStats: mock(() => Promise.resolve({ totalRuns: 0, successfulRuns: 0, failedRuns: 0, avgDurationMs: null })),
  } as unknown as WorkflowRepository;

  let service: WorkflowService;

  beforeEach(() => {
    // Reset all mocks
    Object.values(mockRepository).forEach((fn) => {
      if (typeof fn === 'function' && 'mockClear' in fn) {
        (fn as ReturnType<typeof mock>).mockClear();
      }
    });

    service = new WorkflowService(mockRepository);
  });

  describe('createWorkflow', () => {
    it('should validate DAG structure before creating', async () => {
      const input: CreateWorkflowInput = {
        name: 'Test Workflow',
        description: 'A test workflow',
        nodes: [
          { id: 'A', type: 'agent', agentId: 'agent-1', input: {} },
          { id: 'B', type: 'agent', agentId: 'agent-2', input: {} },
        ],
        edges: [{ id: 'e1', from: 'A', to: 'B' }],
        triggers: [{ type: 'manual' }],
        errorStrategy: { retries: 0, retryDelay: 5000, onFailure: 'stop' },
      };

      (mockRepository.create as ReturnType<typeof mock>).mockResolvedValue({
        id: 'workflow-123',
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createWorkflow(input);

      expect(mockRepository.create).toHaveBeenCalledWith(input);
      expect(result.id).toBe('workflow-123');
    });

    it('should reject workflows with cycles', async () => {
      const input: CreateWorkflowInput = {
        name: 'Cyclic Workflow',
        description: null,
        nodes: [
          { id: 'A', type: 'agent', agentId: 'agent-1', input: {} },
          { id: 'B', type: 'agent', agentId: 'agent-2', input: {} },
        ],
        edges: [
          { id: 'e1', from: 'A', to: 'B' },
          { id: 'e2', from: 'B', to: 'A' }, // Creates cycle
        ],
        triggers: [{ type: 'manual' }],
        errorStrategy: { retries: 0, retryDelay: 5000, onFailure: 'stop' },
      };

      await expect(service.createWorkflow(input)).rejects.toThrow(ValidationError);
    });

    it('should reject workflows with invalid edge references', async () => {
      const input: CreateWorkflowInput = {
        name: 'Invalid Workflow',
        description: null,
        nodes: [{ id: 'A', type: 'agent', agentId: 'agent-1', input: {} }],
        edges: [{ id: 'e1', from: 'A', to: 'C' }], // C doesn't exist
        triggers: [{ type: 'manual' }],
        errorStrategy: { retries: 0, retryDelay: 5000, onFailure: 'stop' },
      };

      await expect(service.createWorkflow(input)).rejects.toThrow(ValidationError);
    });
  });

  describe('updateWorkflow', () => {
    it('should validate DAG when nodes or edges change', async () => {
      const existingWorkflow = {
        id: 'workflow-123',
        name: 'Existing',
        description: null,
        nodes: [{ id: 'A', type: 'agent', agentId: 'agent-1', input: {} }],
        edges: [],
        triggers: [{ type: 'manual' }],
        errorStrategy: { retries: 0, retryDelay: 5000, onFailure: 'stop' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockRepository.findById as ReturnType<typeof mock>).mockResolvedValue(existingWorkflow);

      const update = {
        edges: [{ id: 'e1', from: 'A', to: 'B' }], // B doesn't exist
      };

      await expect(service.updateWorkflow('workflow-123', update)).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe('triggerRun', () => {
    it('should create run and enqueue workflow', async () => {
      const workflow = {
        id: 'workflow-123',
        name: 'Test',
        description: null,
        nodes: [{ id: 'A', type: 'agent', agentId: 'agent-1', input: {} }],
        edges: [],
        triggers: [{ type: 'manual' }],
        errorStrategy: { retries: 0, retryDelay: 5000, onFailure: 'stop' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockRepository.findById as ReturnType<typeof mock>).mockResolvedValue(workflow);
      (mockRepository.createRun as ReturnType<typeof mock>).mockResolvedValue({
        id: 'run-123',
        workflowId: 'workflow-123',
        status: 'pending',
        triggerType: 'manual',
        input: { key: 'value' },
        createdAt: new Date(),
      });

      const result = await service.triggerRun('workflow-123', 'manual', { key: 'value' });

      expect(result.id).toBe('run-123');
      expect(mockRepository.createRun).toHaveBeenCalledWith(
        'workflow-123',
        'manual',
        { key: 'value' }
      );
    });
  });

  describe('cancelRun', () => {
    it('should cancel a running workflow', async () => {
      (mockRepository.findRunById as ReturnType<typeof mock>).mockResolvedValue({
        id: 'run-123',
        status: 'running',
      });

      (mockRepository.cancelRun as ReturnType<typeof mock>).mockResolvedValue({
        id: 'run-123',
        status: 'cancelled',
        completedAt: new Date(),
      });

      const result = await service.cancelRun('run-123');

      expect(result.status).toBe('cancelled');
    });

    it('should reject cancelling completed runs', async () => {
      (mockRepository.findRunById as ReturnType<typeof mock>).mockResolvedValue({
        id: 'run-123',
        status: 'completed',
      });

      await expect(service.cancelRun('run-123')).rejects.toThrow(ValidationError);
    });
  });

  describe('retryRun', () => {
    it('should create new run for failed workflows', async () => {
      const originalRun = {
        id: 'run-123',
        workflowId: 'workflow-123',
        status: 'failed',
        triggerType: 'manual',
        input: { key: 'value' },
      };

      const workflow = {
        id: 'workflow-123',
        name: 'Test',
        description: null,
        nodes: [{ id: 'A', type: 'agent', agentId: 'agent-1', input: {} }],
        edges: [],
        triggers: [{ type: 'manual' }],
        errorStrategy: { retries: 0, retryDelay: 5000, onFailure: 'stop' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockRepository.findRunById as ReturnType<typeof mock>).mockResolvedValue(originalRun);
      (mockRepository.findById as ReturnType<typeof mock>).mockResolvedValue(workflow);
      (mockRepository.createRun as ReturnType<typeof mock>).mockResolvedValue({
        id: 'run-456',
        workflowId: 'workflow-123',
        status: 'pending',
        triggerType: 'manual',
        input: { key: 'value' },
        createdAt: new Date(),
      });

      const result = await service.retryRun('run-123');

      expect(result.id).toBe('run-456');
    });

    it('should reject retrying non-failed runs', async () => {
      (mockRepository.findRunById as ReturnType<typeof mock>).mockResolvedValue({
        id: 'run-123',
        status: 'running',
      });

      await expect(service.retryRun('run-123')).rejects.toThrow(ValidationError);
    });
  });

  describe('analyzeWorkflow', () => {
    it('should return DAG analysis', async () => {
      const workflow = {
        id: 'workflow-123',
        name: 'Test',
        description: null,
        nodes: [
          { id: 'A', type: 'agent', agentId: 'agent-1', input: {} },
          { id: 'B', type: 'agent', agentId: 'agent-2', input: {} },
          { id: 'C', type: 'agent', agentId: 'agent-3', input: {} },
        ],
        edges: [
          { id: 'e1', from: 'A', to: 'B' },
          { id: 'e2', from: 'A', to: 'C' },
        ],
        triggers: [{ type: 'manual' }],
        errorStrategy: { retries: 0, retryDelay: 5000, onFailure: 'stop' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockRepository.findById as ReturnType<typeof mock>).mockResolvedValue(workflow);

      const analysis = await service.analyzeWorkflow('workflow-123');

      expect(analysis.nodeCount).toBe(3);
      expect(analysis.entryNodes).toEqual(['A']);
      expect(analysis.exitNodes.sort()).toEqual(['B', 'C']);
      expect(analysis.executionOrder[0]).toBe('A');
    });
  });
});

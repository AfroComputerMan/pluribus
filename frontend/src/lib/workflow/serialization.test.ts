// frontend/src/lib/workflow/serialization.test.ts
import { describe, it, expect } from 'vitest';
import { toBackendFormat } from './serialization';
import type { WorkflowNode, WorkflowEdge } from '@/stores/workflowBuilderStore';

describe('serialization', () => {
  describe('toBackendFormat', () => {
    it('converts React Flow nodes to backend format', () => {
      const nodes: WorkflowNode[] = [
        {
          id: 'node-1',
          type: 'agent',
          position: { x: 100, y: 200 },
          data: {
            label: 'Test Agent',
            agentId: '123e4567-e89b-12d3-a456-426614174000',
            input: { prompt: 'Hello' },
            timeout: 30,
          },
        },
      ];

      const result = toBackendFormat(nodes, []);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toEqual({
        id: 'node-1',
        type: 'agent',
        agentId: '123e4567-e89b-12d3-a456-426614174000',
        input: { prompt: 'Hello' },
        timeout: 30,
      });
    });

    it('converts condition node to backend format', () => {
      const nodes: WorkflowNode[] = [
        {
          id: 'condition-1',
          type: 'condition',
          position: { x: 100, y: 200 },
          data: {
            label: 'Check Status',
            expression: 'status === "success"',
            trueBranch: 'node-success',
            falseBranch: 'node-failure',
          },
        },
      ];

      const result = toBackendFormat(nodes, []);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toEqual({
        id: 'condition-1',
        type: 'condition',
        expression: 'status === "success"',
        trueBranch: 'node-success',
        falseBranch: 'node-failure',
      });
    });

    it('converts parallel node to backend format', () => {
      const nodes: WorkflowNode[] = [
        {
          id: 'parallel-1',
          type: 'parallel',
          position: { x: 100, y: 200 },
          data: {
            label: 'Parallel Execution',
            branches: ['branch-1', 'branch-2', 'branch-3'],
            joinStrategy: 'any',
          },
        },
      ];

      const result = toBackendFormat(nodes, []);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toEqual({
        id: 'parallel-1',
        type: 'parallel',
        branches: ['branch-1', 'branch-2', 'branch-3'],
        joinStrategy: 'any',
      });
    });

    it('converts parallel node with default values', () => {
      const nodes: WorkflowNode[] = [
        {
          id: 'parallel-2',
          type: 'parallel',
          position: { x: 100, y: 200 },
          data: {
            label: 'Parallel Execution',
          },
        },
      ];

      const result = toBackendFormat(nodes, []);

      expect(result.nodes[0]).toEqual({
        id: 'parallel-2',
        type: 'parallel',
        branches: [],
        joinStrategy: 'all',
      });
    });

    it('converts loop node to backend format', () => {
      const nodes: WorkflowNode[] = [
        {
          id: 'loop-1',
          type: 'loop',
          position: { x: 100, y: 200 },
          data: {
            label: 'Retry Loop',
            condition: 'retryCount < 3',
            maxIterations: 5,
            body: 'node-to-retry',
          },
        },
      ];

      const result = toBackendFormat(nodes, []);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toEqual({
        id: 'loop-1',
        type: 'loop',
        condition: 'retryCount < 3',
        maxIterations: 5,
        body: 'node-to-retry',
      });
    });

    it('converts human-review node to backend format', () => {
      const nodes: WorkflowNode[] = [
        {
          id: 'review-1',
          type: 'human-review',
          position: { x: 100, y: 200 },
          data: {
            label: 'Manager Approval',
            prompt: 'Please review and approve this request',
            timeout: 3600,
            options: ['approve', 'reject', 'escalate'],
          },
        },
      ];

      const result = toBackendFormat(nodes, []);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toEqual({
        id: 'review-1',
        type: 'human-review',
        prompt: 'Please review and approve this request',
        timeout: 3600,
        options: ['approve', 'reject', 'escalate'],
      });
    });

    it('converts React Flow edges to backend format', () => {
      const edges: WorkflowEdge[] = [
        { id: 'edge-1', source: 'node-1', target: 'node-2' },
      ];

      const result = toBackendFormat([], edges);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({
        id: 'edge-1',
        from: 'node-1',
        to: 'node-2',
      });
    });

    it('converts React Flow edges with label to backend format', () => {
      const edges: WorkflowEdge[] = [
        { id: 'edge-1', source: 'node-1', target: 'node-2', label: 'on success' },
      ];

      const result = toBackendFormat([], edges);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({
        id: 'edge-1',
        from: 'node-1',
        to: 'node-2',
        label: 'on success',
      });
    });
  });
});

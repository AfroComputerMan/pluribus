// frontend/src/lib/workflow/serialization.test.ts
import { describe, it, expect } from 'vitest';
import { toBackendFormat, fromBackendFormat, type BackendWorkflowDefinition } from './serialization';
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

  describe('fromBackendFormat', () => {
    it('converts backend agent node to React Flow format', () => {
      const definition: BackendWorkflowDefinition = {
        nodes: [
          {
            id: 'node-1',
            type: 'agent',
            agentId: '123e4567-e89b-12d3-a456-426614174000',
            input: { prompt: 'Hello' },
            timeout: 30,
          },
        ],
        edges: [],
      };

      const result = fromBackendFormat(definition);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('node-1');
      expect(result.nodes[0].type).toBe('agent');
      expect(result.nodes[0].data.agentId).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(result.nodes[0].data.input).toEqual({ prompt: 'Hello' });
      expect(result.nodes[0].data.timeout).toBe(30);
      expect(result.nodes[0].position).toBeDefined();
    });

    it('converts backend condition node to React Flow format', () => {
      const definition: BackendWorkflowDefinition = {
        nodes: [
          {
            id: 'condition-1',
            type: 'condition',
            expression: 'status === "success"',
            trueBranch: 'node-success',
            falseBranch: 'node-failure',
          },
        ],
        edges: [],
      };

      const result = fromBackendFormat(definition);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('condition-1');
      expect(result.nodes[0].type).toBe('condition');
      expect(result.nodes[0].data.expression).toBe('status === "success"');
      expect(result.nodes[0].data.trueBranch).toBe('node-success');
      expect(result.nodes[0].data.falseBranch).toBe('node-failure');
      expect(result.nodes[0].position).toBeDefined();
    });

    it('converts backend parallel node to React Flow format', () => {
      const definition: BackendWorkflowDefinition = {
        nodes: [
          {
            id: 'parallel-1',
            type: 'parallel',
            branches: ['branch-1', 'branch-2', 'branch-3'],
            joinStrategy: 'any',
          },
        ],
        edges: [],
      };

      const result = fromBackendFormat(definition);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('parallel-1');
      expect(result.nodes[0].type).toBe('parallel');
      expect(result.nodes[0].data.branches).toEqual(['branch-1', 'branch-2', 'branch-3']);
      expect(result.nodes[0].data.joinStrategy).toBe('any');
      expect(result.nodes[0].position).toBeDefined();
    });

    it('converts backend loop node to React Flow format', () => {
      const definition: BackendWorkflowDefinition = {
        nodes: [
          {
            id: 'loop-1',
            type: 'loop',
            condition: 'retryCount < 3',
            maxIterations: 5,
            body: 'node-to-retry',
          },
        ],
        edges: [],
      };

      const result = fromBackendFormat(definition);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('loop-1');
      expect(result.nodes[0].type).toBe('loop');
      expect(result.nodes[0].data.condition).toBe('retryCount < 3');
      expect(result.nodes[0].data.maxIterations).toBe(5);
      expect(result.nodes[0].data.body).toBe('node-to-retry');
      expect(result.nodes[0].position).toBeDefined();
    });

    it('converts backend human-review node to React Flow format', () => {
      const definition: BackendWorkflowDefinition = {
        nodes: [
          {
            id: 'review-1',
            type: 'human-review',
            prompt: 'Please review and approve this request',
            timeout: 3600,
            options: ['approve', 'reject', 'escalate'],
          },
        ],
        edges: [],
      };

      const result = fromBackendFormat(definition);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('review-1');
      expect(result.nodes[0].type).toBe('human-review');
      expect(result.nodes[0].data.prompt).toBe('Please review and approve this request');
      expect(result.nodes[0].data.timeout).toBe(3600);
      expect(result.nodes[0].data.options).toEqual(['approve', 'reject', 'escalate']);
      expect(result.nodes[0].position).toBeDefined();
    });

    it('converts backend edges to React Flow format', () => {
      const definition: BackendWorkflowDefinition = {
        nodes: [],
        edges: [{ id: 'edge-1', from: 'node-1', to: 'node-2' }],
      };

      const result = fromBackendFormat(definition);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        label: undefined,
      });
    });

    it('converts backend edges with label to React Flow format', () => {
      const definition: BackendWorkflowDefinition = {
        nodes: [],
        edges: [{ id: 'edge-1', from: 'node-1', to: 'node-2', label: 'on success' }],
      };

      const result = fromBackendFormat(definition);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        label: 'on success',
      });
    });

    it('generates grid positions for multiple nodes', () => {
      const definition: BackendWorkflowDefinition = {
        nodes: [
          { id: 'node-1', type: 'agent' },
          { id: 'node-2', type: 'agent' },
          { id: 'node-3', type: 'agent' },
          { id: 'node-4', type: 'agent' },
        ],
        edges: [],
      };

      const result = fromBackendFormat(definition);

      // Nodes should be positioned in a grid pattern
      expect(result.nodes[0].position).toEqual({ x: 0, y: 0 });
      expect(result.nodes[1].position).toEqual({ x: 200, y: 0 });
      expect(result.nodes[2].position).toEqual({ x: 400, y: 0 });
      expect(result.nodes[3].position).toEqual({ x: 0, y: 150 }); // Wraps to next row
    });
  });
});

// Auto-layout integration tests
import { applyDagreLayout } from '../autoLayout';

describe('fromBackendFormat with auto-layout', () => {
  it('positions nodes using dagre when loading', () => {
    const definition: BackendWorkflowDefinition = {
      nodes: [
        { id: 'node-1', type: 'agent', agentId: '123e4567-e89b-12d3-a456-426614174000', input: {} },
        { id: 'node-2', type: 'agent', agentId: '123e4567-e89b-12d3-a456-426614174000', input: {} },
      ],
      edges: [{ id: 'edge-1', from: 'node-1', to: 'node-2' }],
    };

    const { nodes, edges } = fromBackendFormat(definition);
    const layoutedNodes = applyDagreLayout(nodes, edges);

    // Dagre should position node-2 below node-1 (top-to-bottom layout)
    expect(layoutedNodes[1].position.y).toBeGreaterThan(layoutedNodes[0].position.y);
  });
});

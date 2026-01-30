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
  });
});

// frontend/src/lib/workflow/validation.test.ts
import { describe, it, expect } from 'vitest';
import { validateWorkflow } from './validation';
import type { WorkflowNode, WorkflowEdge } from '../../stores/workflowBuilderStore';

describe('validateWorkflow', () => {
  it('returns valid for empty workflow', () => {
    const result = validateWorkflow([], []);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing required agent fields', () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { label: 'Test' }, // missing agentId
      },
    ];

    const result = validateWorkflow(nodes, []);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        nodeId: 'node-1',
        message: expect.stringContaining('agentId'),
      }),
    );
  });

  it('detects cycles in workflow graph', () => {
    const nodes: WorkflowNode[] = [
      { id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } },
      { id: 'node-2', type: 'agent', position: { x: 0, y: 100 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'edge-1', source: 'node-1', target: 'node-2' },
      { id: 'edge-2', source: 'node-2', target: 'node-1' }, // cycle!
    ];

    const result = validateWorkflow(nodes, edges);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('cycle'),
      }),
    );
  });

  it('detects orphaned nodes', () => {
    const nodes: WorkflowNode[] = [
      { id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } },
      { id: 'node-2', type: 'agent', position: { x: 0, y: 100 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } },
      { id: 'node-3', type: 'agent', position: { x: 0, y: 200 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } }, // orphan
    ];
    const edges: WorkflowEdge[] = [
      { id: 'edge-1', source: 'node-1', target: 'node-2' },
    ];

    const result = validateWorkflow(nodes, edges);

    // Orphans should be warnings, not errors (isValid should still be true if configs are valid)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        nodeId: 'node-3',
        message: expect.stringContaining('disconnected'),
      }),
    );
  });
});

import { describe, expect, it } from 'bun:test';
import { analyzeDAG, getReadyNodes, validateDAG } from '@/queue/workers/dag';
import type { WorkflowNode, WorkflowEdge, AgentNode, ConditionNode } from '@/db/schema';

describe('DAG Analysis', () => {
  // Helper to create agent nodes
  const createAgentNode = (id: string): AgentNode => ({
    id,
    type: 'agent',
    agentId: `agent-${id}`,
    input: {},
  });

  // Helper to create condition nodes
  const createConditionNode = (
    id: string,
    trueBranch: string,
    falseBranch: string
  ): ConditionNode => ({
    id,
    type: 'condition',
    expression: 'true',
    trueBranch,
    falseBranch,
  });

  // Helper to create edges
  const createEdge = (from: string, to: string): WorkflowEdge => ({
    id: `${from}->${to}`,
    from,
    to,
  });

  describe('analyzeDAG', () => {
    it('should identify entry nodes (nodes with no dependencies)', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('B', 'C'),
      ];

      const dag = analyzeDAG(nodes, edges);

      expect(dag.entryNodes).toEqual(['A']);
    });

    it('should identify multiple entry nodes', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'C'),
        createEdge('B', 'C'),
      ];

      const dag = analyzeDAG(nodes, edges);

      expect(dag.entryNodes.sort()).toEqual(['A', 'B']);
    });

    it('should identify exit nodes (nodes with no dependents)', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('A', 'C'),
      ];

      const dag = analyzeDAG(nodes, edges);

      expect(dag.exitNodes.sort()).toEqual(['B', 'C']);
    });

    it('should compute correct topological order for linear graph', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('B', 'C'),
      ];

      const dag = analyzeDAG(nodes, edges);

      expect(dag.topologicalOrder).toEqual(['A', 'B', 'C']);
    });

    it('should compute topological order for diamond graph', () => {
      // A -> B -> D
      // A -> C -> D
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
        createAgentNode('D'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('A', 'C'),
        createEdge('B', 'D'),
        createEdge('C', 'D'),
      ];

      const dag = analyzeDAG(nodes, edges);

      // A must come first, D must come last
      expect(dag.topologicalOrder[0]).toBe('A');
      expect(dag.topologicalOrder[3]).toBe('D');

      // B and C can be in any order, but both before D
      expect(dag.topologicalOrder.indexOf('B')).toBeLessThan(
        dag.topologicalOrder.indexOf('D')
      );
      expect(dag.topologicalOrder.indexOf('C')).toBeLessThan(
        dag.topologicalOrder.indexOf('D')
      );
    });

    it('should throw error for cyclic graph', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('B', 'C'),
        createEdge('C', 'A'), // Creates cycle
      ];

      expect(() => analyzeDAG(nodes, edges)).toThrow('cycle');
    });

    it('should handle graph with no edges (all independent nodes)', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
      ];

      const edges: WorkflowEdge[] = [];

      const dag = analyzeDAG(nodes, edges);

      // All nodes are entry nodes
      expect(dag.entryNodes.sort()).toEqual(['A', 'B', 'C']);
      // All nodes are also exit nodes
      expect(dag.exitNodes.sort()).toEqual(['A', 'B', 'C']);
      // Topological order should contain all nodes
      expect(dag.topologicalOrder.sort()).toEqual(['A', 'B', 'C']);
    });

    it('should correctly map dependencies and dependents', () => {
      // A -> B -> C
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('B', 'C'),
      ];

      const dag = analyzeDAG(nodes, edges);

      expect(dag.nodes.get('A')?.dependencies).toEqual([]);
      expect(dag.nodes.get('A')?.dependents).toEqual(['B']);

      expect(dag.nodes.get('B')?.dependencies).toEqual(['A']);
      expect(dag.nodes.get('B')?.dependents).toEqual(['C']);

      expect(dag.nodes.get('C')?.dependencies).toEqual(['B']);
      expect(dag.nodes.get('C')?.dependents).toEqual([]);
    });
  });

  describe('getReadyNodes', () => {
    it('should return entry nodes when no nodes are completed', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('B', 'C'),
      ];

      const dag = analyzeDAG(nodes, edges);
      const ready = getReadyNodes(dag, new Set());

      expect(ready).toEqual(['A']);
    });

    it('should return next nodes when dependencies are completed', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('B', 'C'),
      ];

      const dag = analyzeDAG(nodes, edges);
      const ready = getReadyNodes(dag, new Set(['A']));

      expect(ready).toEqual(['B']);
    });

    it('should return node only when all dependencies are completed', () => {
      // Diamond: A -> B, A -> C, B -> D, C -> D
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
        createAgentNode('D'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('A', 'C'),
        createEdge('B', 'D'),
        createEdge('C', 'D'),
      ];

      const dag = analyzeDAG(nodes, edges);

      // Only B completed - D not ready yet
      expect(getReadyNodes(dag, new Set(['A', 'B']))).toContain('C');
      expect(getReadyNodes(dag, new Set(['A', 'B']))).not.toContain('D');

      // Both B and C completed - D is ready
      expect(getReadyNodes(dag, new Set(['A', 'B', 'C']))).toEqual(['D']);
    });

    it('should return empty array when all nodes completed', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
      ];

      const edges: WorkflowEdge[] = [createEdge('A', 'B')];

      const dag = analyzeDAG(nodes, edges);
      const ready = getReadyNodes(dag, new Set(['A', 'B']));

      expect(ready).toEqual([]);
    });

    it('should handle parallel branches correctly', () => {
      // A -> B
      // A -> C
      // (B and C are parallel)
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
        createAgentNode('C'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('A', 'C'),
      ];

      const dag = analyzeDAG(nodes, edges);
      const ready = getReadyNodes(dag, new Set(['A']));

      expect(ready.sort()).toEqual(['B', 'C']);
    });
  });

  describe('validateDAG', () => {
    it('should validate a correct DAG', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
      ];

      const edges: WorkflowEdge[] = [createEdge('A', 'B')];

      const result = validateDAG(nodes, edges);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should detect duplicate node IDs', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('A'), // Duplicate
      ];

      const edges: WorkflowEdge[] = [];

      const result = validateDAG(nodes, edges);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Duplicate node IDs found');
    });

    it('should detect edges referencing non-existent nodes', () => {
      const nodes: WorkflowNode[] = [createAgentNode('A')];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'), // B doesn't exist
      ];

      const result = validateDAG(nodes, edges);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('non-existent target node'))).toBe(true);
    });

    it('should detect cycles', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('B', 'A'),
      ];

      const result = validateDAG(nodes, edges);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('cycle'))).toBe(true);
    });

    it('should detect no entry nodes (all nodes have dependencies)', () => {
      const nodes: WorkflowNode[] = [
        createAgentNode('A'),
        createAgentNode('B'),
      ];

      const edges: WorkflowEdge[] = [
        createEdge('A', 'B'),
        createEdge('B', 'A'),
      ];

      const result = validateDAG(nodes, edges);

      expect(result.valid).toBe(false);
      // Will detect cycle, which also means no entry nodes
    });
  });
});

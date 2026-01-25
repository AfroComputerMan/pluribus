import type { WorkflowEdge, WorkflowNode } from '@/db/schema';
import type { DAGAnalysis, DAGNode } from './types';

/**
 * Analyzes a workflow DAG structure and returns useful metadata
 * for execution planning.
 */
export function analyzeDAG(nodes: WorkflowNode[], edges: WorkflowEdge[]): DAGAnalysis {
  // Build node map
  const nodeMap = new Map<string, DAGNode>();

  for (const node of nodes) {
    nodeMap.set(node.id, {
      id: node.id,
      node,
      dependencies: [],
      dependents: [],
    });
  }

  // Build dependency relationships from edges
  for (const edge of edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);

    if (fromNode && toNode) {
      toNode.dependencies.push(edge.from);
      fromNode.dependents.push(edge.to);
    }
  }

  // Find entry nodes (no dependencies)
  const entryNodes = Array.from(nodeMap.values())
    .filter((n) => n.dependencies.length === 0)
    .map((n) => n.id);

  // Find exit nodes (no dependents)
  const exitNodes = Array.from(nodeMap.values())
    .filter((n) => n.dependents.length === 0)
    .map((n) => n.id);

  // Compute topological order using Kahn's algorithm
  const topologicalOrder = topologicalSort(nodeMap);

  return {
    nodes: nodeMap,
    entryNodes,
    exitNodes,
    topologicalOrder,
  };
}

/**
 * Kahn's algorithm for topological sorting.
 * Returns nodes in execution order.
 */
function topologicalSort(nodeMap: Map<string, DAGNode>): string[] {
  const result: string[] = [];
  const inDegree = new Map<string, number>();
  const queue: string[] = [];

  // Calculate in-degree for each node
  for (const [id, node] of nodeMap) {
    inDegree.set(id, node.dependencies.length);
    if (node.dependencies.length === 0) {
      queue.push(id);
    }
  }

  // Process nodes with zero in-degree
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    result.push(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    for (const dependentId of node.dependents) {
      const currentDegree = inDegree.get(dependentId) ?? 0;
      const newDegree = currentDegree - 1;
      inDegree.set(dependentId, newDegree);

      if (newDegree === 0) {
        queue.push(dependentId);
      }
    }
  }

  // Check for cycles
  if (result.length !== nodeMap.size) {
    throw new Error('Workflow contains a cycle - cannot determine execution order');
  }

  return result;
}

/**
 * Gets nodes that are ready to execute given the current completed nodes.
 */
export function getReadyNodes(dag: DAGAnalysis, completedNodes: Set<string>): string[] {
  const ready: string[] = [];

  for (const [nodeId, dagNode] of dag.nodes) {
    // Skip already completed nodes
    if (completedNodes.has(nodeId)) continue;

    // Check if all dependencies are completed
    const allDepsCompleted = dagNode.dependencies.every((dep) => completedNodes.has(dep));

    if (allDepsCompleted) {
      ready.push(nodeId);
    }
  }

  return ready;
}

/**
 * Validates that a DAG is well-formed.
 */
export function validateDAG(nodes: WorkflowNode[], edges: WorkflowEdge[]): ValidationResult {
  const errors: string[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Check for duplicate node IDs
  if (nodeIds.size !== nodes.length) {
    errors.push('Duplicate node IDs found');
  }

  // Check that all edges reference valid nodes
  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge references non-existent source node: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge references non-existent target node: ${edge.to}`);
    }
  }

  // Check for at least one entry node
  try {
    const dag = analyzeDAG(nodes, edges);
    if (dag.entryNodes.length === 0) {
      errors.push('No entry nodes found - workflow has no starting point');
    }
  } catch (e) {
    if (e instanceof Error) {
      errors.push(e.message);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

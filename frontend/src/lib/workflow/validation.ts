// frontend/src/lib/workflow/validation.ts
import type { WorkflowNode, WorkflowEdge } from '../../stores/workflowBuilderStore';
import { validateNodeConfig, type WorkflowNodeType } from '../validation/nodeSchemas';

export interface ValidationIssue {
  nodeId?: string;
  edgeId?: string;
  message: string;
  field?: string;
}

export interface WorkflowValidationResult {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/**
 * Validates workflow before saving
 * Checks:
 * 1. Node configuration completeness
 * 2. Graph structure (no cycles via Kahn's algorithm)
 * 3. Connectivity (warns about orphans)
 */
export function validateWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Empty workflow is valid
  if (nodes.length === 0) {
    return { isValid: true, errors: [], warnings: [] };
  }

  // 1. Validate each node's configuration
  for (const node of nodes) {
    const result = validateNodeConfig(node.type as WorkflowNodeType, node.data);
    if (!result.success) {
      for (const err of result.errors) {
        errors.push({
          nodeId: node.id,
          message: `${err.path.join('.')}: ${err.message}`,
          field: err.path.join('.'),
        });
      }
    }
  }

  // 2. Check for cycles using Kahn's algorithm
  const cycleResult = detectCycles(nodes, edges);
  if (cycleResult.hasCycle) {
    errors.push({
      message: 'Workflow contains a cycle - DAG required',
    });
  }

  // 3. Check for orphaned nodes (not connected to graph)
  const orphans = findOrphanedNodes(nodes, edges);
  for (const nodeId of orphans) {
    warnings.push({
      nodeId,
      message: 'Node is disconnected from the workflow',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function detectCycles(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): { hasCycle: boolean } {
  // Check for self-loops first (edge case Kahn's doesn't catch)
  for (const edge of edges) {
    if (edge.source === edge.target) {
      return { hasCycle: true };
    }
  }

  // Kahn's algorithm for topological sort
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Build graph
  for (const edge of edges) {
    const current = inDegree.get(edge.target) ?? 0;
    inDegree.set(edge.target, current + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }

  // Find nodes with no incoming edges
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return { hasCycle: processed !== nodes.length };
}

function findOrphanedNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] {
  if (nodes.length <= 1) return [];

  const connected = new Set<string>();

  // Add all nodes that are part of any edge
  for (const edge of edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  // Find nodes not in any edge
  return nodes
    .filter((node) => !connected.has(node.id))
    .map((node) => node.id);
}

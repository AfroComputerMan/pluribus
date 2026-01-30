// frontend/src/lib/workflow/serialization.ts
import type { WorkflowNode, WorkflowEdge } from '@/stores/workflowBuilderStore';

interface BackendNode {
  id: string;
  type: string;
  agentId?: string;
  input?: Record<string, unknown>;
  timeout?: number;
  expression?: string;
  trueBranch?: string;
  falseBranch?: string;
  branches?: string[];
  joinStrategy?: 'all' | 'any' | 'race';
  condition?: string;
  maxIterations?: number;
  body?: string;
  prompt?: string;
  options?: string[];
}

interface BackendEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface BackendWorkflowDefinition {
  nodes: BackendNode[];
  edges: BackendEdge[];
}

export function toBackendFormat(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): BackendWorkflowDefinition {
  const backendNodes: BackendNode[] = nodes.map((node) => {
    const base = { id: node.id, type: node.type ?? 'agent' };
    const data = node.data;

    switch (node.type) {
      case 'agent':
        return {
          ...base,
          agentId: data.agentId,
          input: data.input ?? {},
          timeout: data.timeout,
        };
      case 'condition':
        return {
          ...base,
          expression: data.expression,
          trueBranch: data.trueBranch,
          falseBranch: data.falseBranch,
        };
      case 'parallel':
        return {
          ...base,
          branches: data.branches ?? [],
          joinStrategy: data.joinStrategy ?? 'all',
        };
      case 'loop':
        return {
          ...base,
          condition: data.condition,
          maxIterations: data.maxIterations,
          body: data.body,
        };
      case 'human-review':
        return {
          ...base,
          prompt: data.prompt,
          timeout: data.timeout,
          options: data.options,
        };
      default:
        return base;
    }
  });

  const backendEdges: BackendEdge[] = edges.map((edge) => ({
    id: edge.id,
    from: edge.source,
    to: edge.target,
    label: edge.label,
  }));

  return { nodes: backendNodes, edges: backendEdges };
}

export function fromBackendFormat(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  definition: BackendWorkflowDefinition,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  // Will implement in next task
  return { nodes: [], edges: [] };
}

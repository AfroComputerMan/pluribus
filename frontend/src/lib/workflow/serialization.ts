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
  definition: BackendWorkflowDefinition,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes: WorkflowNode[] = definition.nodes.map((node, index) => {
    // Generate position in a grid layout (will be re-laid out by Dagre)
    const position = { x: (index % 3) * 200, y: Math.floor(index / 3) * 150 };

    const baseData: Record<string, unknown> = {};

    switch (node.type) {
      case 'agent':
        Object.assign(baseData, {
          agentId: node.agentId,
          input: node.input,
          timeout: node.timeout,
        });
        break;
      case 'condition':
        Object.assign(baseData, {
          expression: node.expression,
          trueBranch: node.trueBranch,
          falseBranch: node.falseBranch,
        });
        break;
      case 'parallel':
        Object.assign(baseData, {
          branches: node.branches,
          joinStrategy: node.joinStrategy,
        });
        break;
      case 'loop':
        Object.assign(baseData, {
          condition: node.condition,
          maxIterations: node.maxIterations,
          body: node.body,
        });
        break;
      case 'human-review':
        Object.assign(baseData, {
          prompt: node.prompt,
          timeout: node.timeout,
          options: node.options,
        });
        break;
    }

    return {
      id: node.id,
      type: node.type,
      position,
      data: baseData,
    };
  });

  const edges: WorkflowEdge[] = definition.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
  }));

  return { nodes, edges };
}

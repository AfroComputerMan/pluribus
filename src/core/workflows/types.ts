import type { z } from 'zod';
import type { workflowRunSchema, workflowSchema } from './schemas';

// Workflow types from schema
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export type CreateWorkflowInput = Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateWorkflowInput = Partial<CreateWorkflowInput>;

// Run status
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TriggerType = 'manual' | 'schedule' | 'webhook' | 'api';

// Node types
export type WorkflowNodeType = 'agent' | 'condition' | 'parallel' | 'loop' | 'human-review';

// Input mapping for nodes
export interface InputMapping {
  [key: string]: string | { fromNode: string; path: string };
}

// Node definitions
export interface AgentNode {
  id: string;
  type: 'agent';
  agentId: string;
  input: InputMapping;
  timeout?: number;
}

export interface ConditionNode {
  id: string;
  type: 'condition';
  expression: string;
  trueBranch: string;
  falseBranch: string;
}

export interface ParallelNode {
  id: string;
  type: 'parallel';
  branches: string[];
  joinStrategy: 'all' | 'any' | 'race';
}

export interface LoopNode {
  id: string;
  type: 'loop';
  condition: string;
  maxIterations: number;
  body: string;
}

export interface HumanReviewNode {
  id: string;
  type: 'human-review';
  prompt: string;
  timeout?: number;
  options?: string[];
}

export type WorkflowNode = AgentNode | ConditionNode | ParallelNode | LoopNode | HumanReviewNode;

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

// Trigger types
export type WorkflowTrigger =
  | { type: 'manual' }
  | { type: 'schedule'; cron: string }
  | { type: 'webhook'; secret: string }
  | { type: 'api' };

// Error strategy
export interface ErrorStrategy {
  retries: number;
  retryDelay: number;
  fallbackNodeId?: string;
  onFailure: 'stop' | 'continue' | 'human-review';
}

// Run execution context
export interface WorkflowExecutionContext {
  runId: string;
  workflowId: string;
  triggerType: TriggerType;
  input: Record<string, unknown>;
  nodeResults: Record<string, unknown>;
}

// Node execution result
export interface NodeExecutionResult {
  nodeId: string;
  status: 'completed' | 'failed' | 'skipped';
  output?: unknown;
  error?: string;
  startedAt: Date;
  completedAt: Date;
}

// Filter options
export interface WorkflowFilter {
  search?: string;
  hasTrigger?: TriggerType;
  limit?: number;
  offset?: number;
}

export interface WorkflowRunFilter {
  workflowId?: string;
  status?: RunStatus;
  triggerType?: TriggerType;
  limit?: number;
  offset?: number;
}

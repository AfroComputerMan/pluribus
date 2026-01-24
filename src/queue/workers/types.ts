import type { Job } from 'bullmq';
import type { WorkflowNode, WorkflowEdge } from '@/db/schema';
import type { NodeJobData, WorkflowJobData } from '../client';

// Worker status
export type WorkerStatus = 'idle' | 'running' | 'paused' | 'stopped';

// Processor result types
export interface WorkflowProcessorResult {
  runId: string;
  status: 'completed' | 'failed';
  nodesExecuted: number;
  error?: string;
  completedAt: Date;
}

export interface NodeProcessorResult {
  nodeId: string;
  status: 'completed' | 'failed' | 'skipped' | 'pending';
  output?: unknown;
  error?: string;
  startedAt: Date;
  completedAt: Date;
}

// DAG analysis types
export interface DAGNode {
  id: string;
  node: WorkflowNode;
  dependencies: string[];
  dependents: string[];
}

export interface DAGAnalysis {
  nodes: Map<string, DAGNode>;
  entryNodes: string[];
  exitNodes: string[];
  topologicalOrder: string[];
}

// Execution context passed between nodes
export interface ExecutionContext {
  runId: string;
  workflowId: string;
  triggerType: 'manual' | 'schedule' | 'webhook' | 'api';
  input: Record<string, unknown>;
  nodeResults: Map<string, NodeProcessorResult>;
  startedAt: Date;
}

// Node executor interface
export interface NodeExecutor<T extends WorkflowNode = WorkflowNode> {
  type: T['type'];
  execute(
    node: T,
    context: ExecutionContext,
    job: Job<NodeJobData>
  ): Promise<NodeProcessorResult>;
}

// Worker events for observability
export type WorkerEventType =
  | 'workflow:started'
  | 'workflow:completed'
  | 'workflow:failed'
  | 'node:started'
  | 'node:completed'
  | 'node:failed'
  | 'node:skipped';

export interface WorkerEvent {
  type: WorkerEventType;
  timestamp: Date;
  runId: string;
  workflowId: string;
  nodeId?: string;
  data?: Record<string, unknown>;
}

export type WorkerEventHandler = (event: WorkerEvent) => void | Promise<void>;

// Worker configuration
export interface WorkerConfig {
  concurrency: number;
  lockDuration: number;
  stalledInterval: number;
  maxStalledCount: number;
}

export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  concurrency: 5,
  lockDuration: 30000,
  stalledInterval: 30000,
  maxStalledCount: 3,
};

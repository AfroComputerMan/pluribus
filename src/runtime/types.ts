import type { AgentAdapter, AdapterConnection, AgentTask, ExecutionEvent } from '@/integrations';

// Isolation levels
export type IsolationLevel = 'shared' | 'process' | 'container';

// Resource limits
export interface ResourceLimits {
  maxMemoryMB?: number;
  maxCpuPercent?: number;
  maxDurationMs?: number;
}

// Runtime task
export interface RuntimeTask {
  id: string;
  adapter: AgentAdapter;
  connection: AdapterConnection;
  task: AgentTask;
  timeout: number;
  resourceLimits?: ResourceLimits;
}

// Runtime result
export interface RuntimeResult {
  success: boolean;
  output?: unknown;
  error?: string;
  events: ExecutionEvent[];
  startedAt: Date;
  completedAt: Date;
  resourceUsage?: ResourceUsage;
}

export interface ResourceUsage {
  memoryPeakMB: number;
  cpuTimeMs: number;
  wallTimeMs: number;
}

// Execution runtime interface
export interface ExecutionRuntime {
  execute(
    task: RuntimeTask,
    isolation: IsolationLevel
  ): Promise<RuntimeResult>;

  cleanup(executionId: string): Promise<void>;
}

// Isolation strategy interface
export interface IsolationStrategy {
  readonly level: IsolationLevel;

  prepare(task: RuntimeTask): Promise<void>;
  execute(task: RuntimeTask): AsyncGenerator<ExecutionEvent>;
  cleanup(executionId: string): Promise<void>;

  isAvailable(): Promise<boolean>;
}

// Container runtime options
export interface ContainerOptions {
  image: string;
  command: string[];
  env?: Record<string, string>;
  volumes?: Array<{
    host: string;
    container: string;
    readonly?: boolean;
  }>;
  networkMode?: 'none' | 'bridge' | 'host';
  resourceLimits?: ResourceLimits;
}

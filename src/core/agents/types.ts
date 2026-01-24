import type { z } from 'zod';
import type { agentSchema } from './schemas';

// Infer types from Zod schemas
export type Agent = z.infer<typeof agentSchema>;
export type CreateAgentInput = Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateAgentInput = Partial<CreateAgentInput>;

// Agent model configuration
export interface ModelConfig {
  provider: 'anthropic' | 'openai' | 'custom';
  model: string;
  parameters?: Record<string, unknown>;
}

// Memory modes
export type MemoryMode = 'stateless' | 'session' | 'persistent';

// Isolation levels
export type IsolationLevel = 'shared' | 'process' | 'container';

// Integration binding
export interface AgentIntegration {
  type: 'claude-code' | 'codex' | 'opencode' | 'local-bridge';
  connectionId: string;
}

// Agent with runtime status
export interface AgentWithStatus extends Agent {
  status: 'idle' | 'running' | 'error';
  lastRunAt?: Date;
  activeRunCount: number;
}

// Agent filter options
export interface AgentFilter {
  tags?: string[] | undefined;
  integration?: string | undefined;
  memoryMode?: MemoryMode | undefined;
  isolationLevel?: IsolationLevel | undefined;
  search?: string | undefined;
}

// Agent execution context
export interface AgentExecutionContext {
  agentId: string;
  workflowRunId?: string;
  nodeId?: string;
  parentAgentId?: string;
  depth: number;
}

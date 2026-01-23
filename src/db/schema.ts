import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ===================
// Agents
// ===================
export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    tags: text('tags').array().default([]),

    // Model configuration
    modelConfig: jsonb('model_config')
      .notNull()
      .$type<{
        provider: 'anthropic' | 'openai' | 'custom';
        model: string;
        parameters?: Record<string, unknown>;
      }>(),

    // Behavior settings
    memoryMode: varchar('memory_mode', { length: 20 }).default('stateless').notNull(),
    isolationLevel: varchar('isolation_level', { length: 20 }).default('shared').notNull(),
    canSpawnSubAgents: boolean('can_spawn_sub_agents').default(false).notNull(),
    maxSubAgents: integer('max_sub_agents'),

    // Assigned capabilities
    skills: text('skills').array().default([]),
    allowedMcpTools: text('allowed_mcp_tools').array().default([]),

    // Integration binding
    integration: jsonb('integration').$type<{
      type: 'claude-code' | 'codex' | 'opencode' | 'local-bridge';
      connectionId: string;
    } | null>(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_agents_tags').using('gin', table.tags)]
);

// ===================
// Workflows
// ===================
export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),

  // DAG structure
  nodes: jsonb('nodes').notNull().$type<WorkflowNode[]>(),
  edges: jsonb('edges').notNull().$type<WorkflowEdge[]>(),

  // Triggers
  triggers: jsonb('triggers').default([]).$type<WorkflowTrigger[]>(),

  // Error handling
  errorStrategy: jsonb('error_strategy')
    .notNull()
    .$type<{
      retries: number;
      retryDelay: number;
      fallbackNodeId?: string;
      onFailure: 'stop' | 'continue' | 'human-review';
    }>(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ===================
// Workflow Runs
// ===================
export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 20 }).notNull(), // pending, running, completed, failed, cancelled
    triggerType: varchar('trigger_type', { length: 20 }).notNull(),
    input: jsonb('input'),
    output: jsonb('output'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_workflow_runs_workflow').on(table.workflowId),
    index('idx_workflow_runs_status').on(table.status),
  ]
);

// ===================
// Node Executions
// ===================
export const nodeExecutions = pgTable(
  'node_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowRunId: uuid('workflow_run_id')
      .references(() => workflowRuns.id, { onDelete: 'cascade' })
      .notNull(),
    nodeId: varchar('node_id', { length: 100 }).notNull(),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 20 }).notNull(),
    input: jsonb('input'),
    output: jsonb('output'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_node_executions_run').on(table.workflowRunId)]
);

// ===================
// MCP Servers
// ===================
export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  transport: varchar('transport', { length: 20 }).notNull(), // stdio, http, websocket

  // Transport-specific config
  config: jsonb('config')
    .notNull()
    .$type<{
      stdio?: { command: string; args: string[] };
      http?: { url: string; headers?: Record<string, string> };
      websocket?: { url: string };
    }>(),

  enabled: boolean('enabled').default(true).notNull(),
  lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ===================
// MCP Tools
// ===================
export const mcpTools = pgTable(
  'mcp_tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .references(() => mcpServers.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    inputSchema: jsonb('input_schema'),
    enabled: boolean('enabled').default(true).notNull(),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_mcp_tools_server').on(table.serverId)]
);

// ===================
// Skills
// ===================
export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    type: varchar('type', { length: 20 }).notNull(), // prompt, behavior, workflow-template
    content: text('content').notNull(),
    tags: text('tags').array().default([]),
    source: varchar('source', { length: 20 }).default('user').notNull(), // user, imported, builtin

    // Parameters for templated skills
    parameters: jsonb('parameters').$type<SkillParameter[] | null>(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_skills_tags').using('gin', table.tags)]
);

// ===================
// Credentials (Encrypted)
// ===================
export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(), // oauth, api-key
  integration: varchar('integration', { length: 50 }).notNull(), // claude-code, codex, etc.

  // Encrypted data (AES-256-GCM)
  encryptedData: text('encrypted_data').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),

  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ===================
// Logs
// ===================
export const logs = pgTable(
  'logs',
  {
    id: serial('id').primaryKey(),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
    level: varchar('level', { length: 10 }).notNull(), // debug, info, warn, error
    source: varchar('source', { length: 100 }).notNull(),
    message: text('message').notNull(),
    metadata: jsonb('metadata'),

    // Correlation
    workflowRunId: uuid('workflow_run_id'),
    agentId: uuid('agent_id'),
    nodeExecutionId: uuid('node_execution_id'),
  },
  (table) => [
    index('idx_logs_timestamp').on(table.timestamp),
    index('idx_logs_workflow_run').on(table.workflowRunId),
    index('idx_logs_level').on(table.level),
  ]
);

// ===================
// Usage Records (Cost Tracking)
// ===================
export const usageRecords = pgTable(
  'usage_records',
  {
    id: serial('id').primaryKey(),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    provider: varchar('provider', { length: 50 }).notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    estimatedCostUsd: decimal('estimated_cost_usd', { precision: 10, scale: 6 }).notNull(),
  },
  (table) => [
    index('idx_usage_timestamp').on(table.timestamp),
    index('idx_usage_agent').on(table.agentId),
    index('idx_usage_workflow').on(table.workflowRunId),
  ]
);

// ===================
// Type definitions for JSONB columns
// ===================
export type WorkflowNode =
  | AgentNode
  | ConditionNode
  | ParallelNode
  | LoopNode
  | HumanReviewNode;

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

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export type WorkflowTrigger =
  | { type: 'manual' }
  | { type: 'schedule'; cron: string }
  | { type: 'webhook'; secret: string }
  | { type: 'api' };

export interface InputMapping {
  [key: string]: string | { fromNode: string; path: string };
}

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  description: string;
  required: boolean;
  default?: unknown;
  options?: string[];
}

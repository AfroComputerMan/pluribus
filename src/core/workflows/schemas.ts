import { z } from 'zod';

// Node schemas
const inputMappingSchema = z.record(
  z.union([
    z.string(),
    z.object({
      fromNode: z.string(),
      path: z.string(),
    }),
  ])
);

const agentNodeSchema = z.object({
  id: z.string(),
  type: z.literal('agent'),
  agentId: z.string().uuid(),
  input: inputMappingSchema,
  timeout: z.number().positive().optional(),
});

const conditionNodeSchema = z.object({
  id: z.string(),
  type: z.literal('condition'),
  expression: z.string(),
  trueBranch: z.string(),
  falseBranch: z.string(),
});

const parallelNodeSchema = z.object({
  id: z.string(),
  type: z.literal('parallel'),
  branches: z.array(z.string()),
  joinStrategy: z.enum(['all', 'any', 'race']),
});

const loopNodeSchema = z.object({
  id: z.string(),
  type: z.literal('loop'),
  condition: z.string(),
  maxIterations: z.number().int().positive(),
  body: z.string(),
});

const humanReviewNodeSchema = z.object({
  id: z.string(),
  type: z.literal('human-review'),
  prompt: z.string(),
  timeout: z.number().positive().optional(),
  options: z.array(z.string()).optional(),
});

const workflowNodeSchema = z.discriminatedUnion('type', [
  agentNodeSchema,
  conditionNodeSchema,
  parallelNodeSchema,
  loopNodeSchema,
  humanReviewNodeSchema,
]);

const workflowEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
});

// Trigger schemas
const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }),
  z.object({ type: z.literal('schedule'), cron: z.string() }),
  z.object({ type: z.literal('webhook'), secret: z.string() }),
  z.object({ type: z.literal('api') }),
]);

// Error strategy schema
const errorStrategySchema = z.object({
  retries: z.number().int().min(0).default(0),
  retryDelay: z.number().int().min(0).default(5000),
  fallbackNodeId: z.string().optional(),
  onFailure: z.enum(['stop', 'continue', 'human-review']).default('stop'),
});

// Workflow schema
export const workflowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().nullable(),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  triggers: z.array(triggerSchema).default([{ type: 'manual' }]),
  errorStrategy: errorStrategySchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// Create workflow input
export const createWorkflowSchema = workflowSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Update workflow input
export const updateWorkflowSchema = createWorkflowSchema.partial();

// Workflow run schema
export const workflowRunSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid().nullable(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  triggerType: z.enum(['manual', 'schedule', 'webhook', 'api']),
  input: z.record(z.unknown()).nullable(),
  output: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

// Trigger run input
export const triggerRunSchema = z.object({
  input: z.record(z.unknown()).optional(),
});

// Filter schemas
export const workflowFilterSchema = z.object({
  search: z.string().optional(),
  hasTrigger: z.enum(['manual', 'schedule', 'webhook', 'api']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const workflowRunFilterSchema = z.object({
  workflowId: z.string().uuid().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
  triggerType: z.enum(['manual', 'schedule', 'webhook', 'api']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

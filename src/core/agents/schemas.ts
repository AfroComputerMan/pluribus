import { z } from 'zod';

// Model configuration schema
export const modelConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'custom']),
  model: z.string().min(1),
  parameters: z.record(z.unknown()).optional(),
});

// Integration schema
export const integrationSchema = z
  .object({
    type: z.enum(['claude-code', 'codex', 'opencode', 'local-bridge']),
    connectionId: z.string().uuid(),
  })
  .nullable();

// Agent schema
export const agentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  modelConfig: modelConfigSchema,
  memoryMode: z.enum(['stateless', 'session', 'persistent']).default('stateless'),
  isolationLevel: z.enum(['shared', 'process', 'container']).default('shared'),
  canSpawnSubAgents: z.boolean().default(false),
  maxSubAgents: z.number().int().positive().nullable(),
  skills: z.array(z.string()).default([]),
  allowedMcpTools: z.array(z.string()).default([]),
  integration: integrationSchema.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// Create agent input schema
export const createAgentSchema = agentSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Update agent input schema
export const updateAgentSchema = createAgentSchema.partial();

// Agent filter schema
export const agentFilterSchema = z.object({
  tags: z.array(z.string()).optional(),
  integration: z.string().optional(),
  memoryMode: z.enum(['stateless', 'session', 'persistent']).optional(),
  isolationLevel: z.enum(['shared', 'process', 'container']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

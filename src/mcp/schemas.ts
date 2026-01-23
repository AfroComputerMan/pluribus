import { z } from 'zod';

// Transport config schemas
const stdioConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
});

const httpConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

const websocketConfigSchema = z.object({
  url: z.string().url(),
});

// Server config schema
const serverConfigSchema = z.object({
  stdio: stdioConfigSchema.optional(),
  http: httpConfigSchema.optional(),
  websocket: websocketConfigSchema.optional(),
});

// MCP Server schema
export const mcpServerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  transport: z.enum(['stdio', 'http', 'websocket']),
  config: serverConfigSchema,
  enabled: z.boolean().default(true),
  lastConnectedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// Create server input
export const createMCPServerSchema = mcpServerSchema
  .omit({
    id: true,
    lastConnectedAt: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine(
    (data) => {
      // Ensure the config matches the transport type
      switch (data.transport) {
        case 'stdio':
          return !!data.config.stdio;
        case 'http':
          return !!data.config.http;
        case 'websocket':
          return !!data.config.websocket;
        default:
          return false;
      }
    },
    {
      message: 'Config must match the specified transport type',
    }
  );

// Update server input
export const updateMCPServerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  enabled: z.boolean().optional(),
  config: serverConfigSchema.optional(),
});

// Tool input schema (JSON Schema)
const toolPropertySchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
    description: z.string().optional(),
    enum: z.array(z.string()).optional(),
    items: toolPropertySchema.optional(),
    properties: z.record(toolPropertySchema).optional(),
  })
);

const toolInputSchema = z.object({
  type: z.literal('object'),
  properties: z.record(toolPropertySchema).optional(),
  required: z.array(z.string()).optional(),
});

// MCP Tool schema
export const mcpToolSchema = z.object({
  id: z.string().uuid(),
  serverId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().nullable(),
  inputSchema: toolInputSchema.nullable(),
  enabled: z.boolean().default(true),
  discoveredAt: z.coerce.date(),
});

// Tool execution schema
export const executeToolSchema = z.object({
  toolId: z.string().uuid(),
  args: z.record(z.unknown()).default({}),
  context: z
    .object({
      agentId: z.string().uuid(),
      workflowRunId: z.string().uuid().optional(),
    })
    .optional(),
});

// Filter schemas
export const mcpServerFilterSchema = z.object({
  enabled: z.coerce.boolean().optional(),
  transport: z.enum(['stdio', 'http', 'websocket']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const mcpToolFilterSchema = z.object({
  serverId: z.string().uuid().optional(),
  enabled: z.coerce.boolean().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

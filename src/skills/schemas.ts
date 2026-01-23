import { z } from 'zod';

// Skill parameter schema
export const skillParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'select']),
  description: z.string(),
  required: z.boolean().default(true),
  default: z.unknown().optional(),
  options: z.array(z.string()).optional(),
});

// Skill schema
export const skillSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().nullable(),
  type: z.enum(['prompt', 'behavior', 'workflow-template']),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  source: z.enum(['user', 'imported', 'builtin']).default('user'),
  parameters: z.array(skillParameterSchema).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// Create skill input
export const createSkillSchema = skillSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Update skill input
export const updateSkillSchema = createSkillSchema.partial();

// Filter schema
export const skillFilterSchema = z.object({
  tags: z.array(z.string()).optional(),
  type: z.enum(['prompt', 'behavior', 'workflow-template']).optional(),
  source: z.enum(['user', 'imported', 'builtin']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Import schema
export const skillImportSchema = z.object({
  version: z.literal('1.0'),
  skill: z.object({
    name: z.string().min(1).max(255),
    description: z.string().nullable(),
    type: z.enum(['prompt', 'behavior', 'workflow-template']),
    content: z.string().min(1),
    tags: z.array(z.string()).default([]),
    parameters: z.array(skillParameterSchema).optional(),
  }),
});

import { z } from 'zod';

// Cron expression validation regex
// Supports: minute hour day-of-month month day-of-week
const cronRegex = /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|[0-6]|\*\/[0-6])$/;

// ==================
// Schedule Schemas
// ==================

export const scheduledTriggerSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  cron: z.string().regex(cronRegex, 'Invalid cron expression'),
  timezone: z.string().default('UTC'),
  enabled: z.boolean().default(true),
  lastRunAt: z.coerce.date().nullable(),
  nextRunAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createScheduleSchema = z.object({
  workflowId: z.string().uuid(),
  cron: z.string().regex(cronRegex, 'Invalid cron expression'),
  timezone: z.string().default('UTC'),
  enabled: z.boolean().default(true),
});

export const updateScheduleSchema = z.object({
  cron: z.string().regex(cronRegex, 'Invalid cron expression').optional(),
  timezone: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const scheduleFilterSchema = z.object({
  workflowId: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ==================
// Webhook Schemas
// ==================

export const webhookTriggerSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  name: z.string().min(1).max(255),
  secret: z.string().min(32),
  enabled: z.boolean().default(true),
  lastTriggeredAt: z.coerce.date().nullable(),
  triggerCount: z.number().int().min(0),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createWebhookSchema = z.object({
  workflowId: z.string().uuid(),
  name: z.string().min(1).max(255),
  secret: z.string().min(32).optional(),
  enabled: z.boolean().default(true),
});

export const updateWebhookSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  enabled: z.boolean().optional(),
  regenerateSecret: z.boolean().optional(),
});

export const webhookFilterSchema = z.object({
  workflowId: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const webhookPayloadSchema = z.object({
  headers: z.record(z.string()),
  body: z.record(z.unknown()),
  signature: z.string().optional(),
});

// ==================
// Event Schemas
// ==================

export const eventTypeSchema = z.enum([
  'workflow:triggered',
  'workflow:started',
  'workflow:completed',
  'workflow:failed',
  'workflow:cancelled',
  'node:started',
  'node:completed',
  'node:failed',
  'schedule:fired',
  'webhook:received',
]);

export const orchestratorEventSchema = z.object({
  id: z.string().uuid(),
  type: eventTypeSchema,
  timestamp: z.coerce.date(),
  workflowId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  nodeId: z.string().optional(),
  triggerId: z.string().uuid().optional(),
  data: z.record(z.unknown()),
});

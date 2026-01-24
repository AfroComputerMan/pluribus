import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '@/db';
import { agents, logs, usageRecords, workflowRuns } from '@/db/schema';
import { getValidatedQuery, validateQuery } from '../middleware';

const observability = new Hono();

// Log filter schema
const logFilterSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  source: z.string().optional(),
  workflowRunId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// Cost filter schema
const costFilterSchema = z.object({
  agentId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// GET /api/logs - Query logs
observability.get('/logs', validateQuery(logFilterSchema), async (c) => {
  const filter = getValidatedQuery<z.infer<typeof logFilterSchema>>(c);

  const conditions = [];
  if (filter.level) {
    conditions.push(eq(logs.level, filter.level));
  }
  if (filter.source) {
    conditions.push(eq(logs.source, filter.source));
  }
  if (filter.workflowRunId) {
    conditions.push(eq(logs.workflowRunId, filter.workflowRunId));
  }
  if (filter.agentId) {
    conditions.push(eq(logs.agentId, filter.agentId));
  }
  if (filter.from) {
    conditions.push(gte(logs.timestamp, filter.from));
  }
  if (filter.to) {
    conditions.push(lte(logs.timestamp, filter.to));
  }

  const items = await db
    .select()
    .from(logs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(filter.limit)
    .offset(filter.offset)
    .orderBy(desc(logs.timestamp));

  return c.json({
    data: items,
    meta: {
      limit: filter.limit,
      offset: filter.offset,
    },
  });
});

// GET /api/costs - Get cost summary
observability.get('/costs', validateQuery(costFilterSchema), async (c) => {
  const filter = getValidatedQuery<z.infer<typeof costFilterSchema>>(c);

  const conditions = [];
  if (filter.agentId) {
    conditions.push(eq(usageRecords.agentId, filter.agentId));
  }
  if (filter.from) {
    conditions.push(gte(usageRecords.timestamp, filter.from));
  }
  if (filter.to) {
    conditions.push(lte(usageRecords.timestamp, filter.to));
  }

  // Total cost
  const totalResult = await db
    .select({
      total: sql<string>`COALESCE(SUM(${usageRecords.estimatedCostUsd}), 0)`,
    })
    .from(usageRecords)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const totalCostUsd = Number.parseFloat(totalResult[0]?.total || '0');

  // Cost by agent
  const byAgentResult = await db
    .select({
      agentId: usageRecords.agentId,
      cost: sql<string>`SUM(${usageRecords.estimatedCostUsd})`,
    })
    .from(usageRecords)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(usageRecords.agentId);

  const byAgent: Record<string, number> = {};
  for (const row of byAgentResult) {
    if (row.agentId) {
      byAgent[row.agentId] = Number.parseFloat(row.cost);
    }
  }

  // Cost by model
  const byModelResult = await db
    .select({
      model: usageRecords.model,
      cost: sql<string>`SUM(${usageRecords.estimatedCostUsd})`,
    })
    .from(usageRecords)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(usageRecords.model);

  const byModel: Record<string, number> = {};
  for (const row of byModelResult) {
    byModel[row.model] = Number.parseFloat(row.cost);
  }

  // Cost by day
  const byDayResult = await db
    .select({
      day: sql<string>`DATE(${usageRecords.timestamp})`,
      cost: sql<string>`SUM(${usageRecords.estimatedCostUsd})`,
    })
    .from(usageRecords)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(sql`DATE(${usageRecords.timestamp})`)
    .orderBy(sql`DATE(${usageRecords.timestamp})`);

  const byDay: Record<string, number> = {};
  for (const row of byDayResult) {
    byDay[row.day] = Number.parseFloat(row.cost);
  }

  return c.json({
    data: {
      totalCostUsd,
      byAgent,
      byWorkflow: {}, // TODO: Implement workflow cost aggregation
      byModel,
      byDay,
    },
  });
});

// GET /api/costs/breakdown - Detailed cost breakdown
observability.get('/costs/breakdown', validateQuery(costFilterSchema), async (c) => {
  const filter = getValidatedQuery<z.infer<typeof costFilterSchema>>(c);

  const conditions = [];
  if (filter.agentId) {
    conditions.push(eq(usageRecords.agentId, filter.agentId));
  }
  if (filter.from) {
    conditions.push(gte(usageRecords.timestamp, filter.from));
  }
  if (filter.to) {
    conditions.push(lte(usageRecords.timestamp, filter.to));
  }

  const items = await db
    .select({
      timestamp: usageRecords.timestamp,
      agentId: usageRecords.agentId,
      workflowRunId: usageRecords.workflowRunId,
      provider: usageRecords.provider,
      model: usageRecords.model,
      inputTokens: usageRecords.inputTokens,
      outputTokens: usageRecords.outputTokens,
      estimatedCostUsd: usageRecords.estimatedCostUsd,
    })
    .from(usageRecords)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(usageRecords.timestamp))
    .limit(1000);

  return c.json({ data: items });
});

// GET /api/metrics - Get dashboard metrics
observability.get('/metrics', async (c) => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Total counts
  const [agentCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(agents);
  const [workflowCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(workflowRuns);

  // Active runs
  const [activeCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(workflowRuns)
    .where(eq(workflowRuns.status, 'running'));

  // Completed runs 24h
  const [completedCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.status, 'completed'), gte(workflowRuns.completedAt, yesterday)));

  // Failed runs 24h
  const [failedCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.status, 'failed'), gte(workflowRuns.completedAt, yesterday)));

  // Cost 24h
  const [cost24h] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${usageRecords.estimatedCostUsd}), 0)`,
    })
    .from(usageRecords)
    .where(gte(usageRecords.timestamp, yesterday));

  return c.json({
    data: {
      totalAgents: Number(agentCount?.count || 0),
      totalWorkflows: Number(workflowCount?.count || 0),
      activeRuns: Number(activeCount?.count || 0),
      completedRuns24h: Number(completedCount?.count || 0),
      failedRuns24h: Number(failedCount?.count || 0),
      totalCost24h: Number.parseFloat(cost24h?.total || '0'),
    },
  });
});

export { observability };

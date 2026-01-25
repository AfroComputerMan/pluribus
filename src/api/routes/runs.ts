import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import { workflowRunFilterSchema } from '@/core/workflows';
import { db } from '@/db';
import { nodeExecutions, workflowRuns } from '@/db/schema';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { logger } from '@/observability/logger';
import { getRedis } from '@/queue/client';
import { getValidatedQuery, validateQuery } from '../middleware';

const log = logger.child('api:runs:sse');

const SSE_KEEP_ALIVE_INTERVAL_MS = 30000;

const runs = new Hono();

// GET /api/runs - List all runs
runs.get('/', validateQuery(workflowRunFilterSchema), async (c) => {
  const filter = getValidatedQuery<z.infer<typeof workflowRunFilterSchema>>(c);

  const conditions = [];
  if (filter.workflowId) {
    conditions.push(eq(workflowRuns.workflowId, filter.workflowId));
  }
  if (filter.status) {
    conditions.push(eq(workflowRuns.status, filter.status));
  }
  if (filter.triggerType) {
    conditions.push(eq(workflowRuns.triggerType, filter.triggerType));
  }

  const items = await db
    .select()
    .from(workflowRuns)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(filter.limit)
    .offset(filter.offset)
    .orderBy(desc(workflowRuns.createdAt));

  return c.json({
    data: items,
    meta: {
      limit: filter.limit,
      offset: filter.offset,
    },
  });
});

// GET /api/runs/:id - Get run by ID
runs.get('/:id', async (c) => {
  const id = c.req.param('id');

  const run = await db.query.workflowRuns.findFirst({
    where: eq(workflowRuns.id, id),
  });

  if (!run) {
    throw new NotFoundError('WorkflowRun', id);
  }

  return c.json({ data: run });
});

// GET /api/runs/:id/nodes - Get node executions for a run
runs.get('/:id/nodes', async (c) => {
  const id = c.req.param('id');

  const nodes = await db.query.nodeExecutions.findMany({
    where: eq(nodeExecutions.workflowRunId, id),
    orderBy: [desc(nodeExecutions.createdAt)],
  });

  return c.json({ data: nodes });
});

// GET /api/runs/:id/events - Server-Sent Events stream for real-time updates
runs.get('/:id/events', async (c) => {
  const runId = c.req.param('id');

  // Verify run exists
  const run = await db.query.workflowRuns.findFirst({
    where: eq(workflowRuns.id, runId),
  });

  if (!run) {
    throw new NotFoundError('WorkflowRun', runId);
  }

  log.info('SSE client connected', { runId });

  return streamSSE(c, async (stream) => {
    // Create a new Redis client for pub/sub (cannot reuse existing client)
    const subscriber = getRedis().duplicate();
    await subscriber.connect();

    const channel = `run:${runId}`;
    let isActive = true;

    // Subscribe to the run-specific channel
    await subscriber.subscribe(channel, (message) => {
      if (!isActive || !message) return;

      const messageStr = typeof message === 'string' ? message : message.toString();

      try {
        const event = JSON.parse(messageStr);
        stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
          id: Date.now().toString(),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('Failed to parse or send SSE message', {
          error: errorMessage,
          message: messageStr,
        });
      }
    });

    log.debug('Subscribed to Redis channel', { runId, channel });

    // Send initial connection confirmation
    await stream.writeSSE({
      data: JSON.stringify({
        type: 'connected',
        runId,
        timestamp: new Date().toISOString(),
      }),
      event: 'connected',
      id: Date.now().toString(),
    });

    // Keep connection alive with periodic pings
    const keepAliveInterval = setInterval(async () => {
      if (!isActive) {
        clearInterval(keepAliveInterval);
        return;
      }

      try {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'ping' }),
          event: 'ping',
          id: Date.now().toString(),
        });
      } catch {
        log.debug('Keep-alive failed, client likely disconnected', { runId });
        isActive = false;
        clearInterval(keepAliveInterval);
      }
    }, SSE_KEEP_ALIVE_INTERVAL_MS);

    // Cleanup on disconnect
    c.req.raw.signal.addEventListener('abort', async () => {
      log.info('SSE client disconnected', { runId });
      isActive = false;
      clearInterval(keepAliveInterval);

      try {
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
      } catch (error) {
        log.error('Error cleaning up Redis subscription', { error, runId });
      }
    });

    // Keep stream open
    await stream.sleep(Number.MAX_SAFE_INTEGER);
  });
});

// POST /api/runs/:id/cancel - Cancel a running workflow
runs.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');

  const [run] = await db
    .update(workflowRuns)
    .set({
      status: 'cancelled',
      completedAt: new Date(),
    })
    .where(and(eq(workflowRuns.id, id), eq(workflowRuns.status, 'running')))
    .returning();

  if (!run) {
    // Check if run exists
    const exists = await db.query.workflowRuns.findFirst({
      where: eq(workflowRuns.id, id),
    });

    if (!exists) {
      throw new NotFoundError('WorkflowRun', id);
    }

    throw new ValidationError('Run cannot be cancelled', {
      currentStatus: exists.status,
    });
  }

  return c.json({ data: run });
});

// POST /api/runs/:id/retry - Retry a failed workflow
runs.post('/:id/retry', async (c) => {
  const id = c.req.param('id');

  const originalRun = await db.query.workflowRuns.findFirst({
    where: eq(workflowRuns.id, id),
  });

  if (!originalRun) {
    throw new NotFoundError('WorkflowRun', id);
  }

  if (originalRun.status !== 'failed') {
    throw new ValidationError('Only failed runs can be retried', {
      currentStatus: originalRun.status,
    });
  }

  // Create new run with same input
  const [newRun] = await db
    .insert(workflowRuns)
    .values({
      workflowId: originalRun.workflowId,
      status: 'pending',
      triggerType: 'api',
      input: originalRun.input,
    })
    .returning();

  // TODO: Enqueue new run for execution

  return c.json({ data: newRun }, 202);
});

// Human review decision schema
const reviewDecisionSchema = z.object({
  decision: z.string(),
  comment: z.string().optional(),
});

// POST /api/runs/:id/review - Submit human review decision
runs.post('/:id/review', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { decision, comment } = reviewDecisionSchema.parse(body);

  // Find pending human review node
  const [node] = await db
    .update(nodeExecutions)
    .set({
      status: 'completed',
      output: { decision, comment },
      completedAt: new Date(),
    })
    .where(and(eq(nodeExecutions.workflowRunId, id), eq(nodeExecutions.status, 'running')))
    .returning();

  if (!node) {
    throw new ValidationError('No pending human review found for this run');
  }

  // TODO: Resume workflow execution

  return c.json({ data: node });
});

export { runs };

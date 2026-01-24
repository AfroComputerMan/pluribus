import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { workflowRunFilterSchema } from '@/core/workflows';
import { db } from '@/db';
import { nodeExecutions, workflowRuns } from '@/db/schema';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { getValidatedQuery, validateQuery } from '../middleware';

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

import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { workflowRunFilterSchema } from '@/core/workflows';
import { db } from '@/db';
import { nodeExecutions, workflowRuns } from '@/db/schema';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { logger } from '@/observability/logger';
import { enqueueWorkflow } from '@/queue/client';
import { getValidatedQuery, validateQuery } from '../middleware';

const log = logger.child('api:runs');

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

  // Verify workflow still exists
  if (!originalRun.workflowId) {
    throw new ValidationError('Cannot retry run: original workflow has been deleted');
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

  if (!newRun) {
    throw new Error('Failed to create new run');
  }

  log.info('Retrying workflow run', {
    originalRunId: id,
    newRunId: newRun.id,
    workflowId: originalRun.workflowId,
  });

  // Enqueue new run for execution
  await enqueueWorkflow({
    runId: newRun.id,
    workflowId: originalRun.workflowId,
    triggerType: 'api',
    input: (originalRun.input as Record<string, unknown>) || {},
  });

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
  const normalizedDecision = decision.trim().toLowerCase();
  const approved = normalizedDecision === 'approve' || normalizedDecision === 'approved';
  const rejected = normalizedDecision === 'reject' || normalizedDecision === 'rejected';

  if (!approved && !rejected) {
    throw new ValidationError('Decision must be approve/approved or reject/rejected');
  }

  // Get the workflow run to verify it exists and get workflow info
  const run = await db.query.workflowRuns.findFirst({
    where: eq(workflowRuns.id, id),
  });

  if (!run) {
    throw new NotFoundError('WorkflowRun', id);
  }

  if (!run.workflowId) {
    throw new ValidationError('Cannot resume run: workflow has been deleted');
  }

  // Find pending human review node
  const [node] = await db
    .update(nodeExecutions)
    .set({
      status: approved ? 'completed' : 'failed',
      output: {
        decision: approved ? 'approved' : 'rejected',
        comment,
        reviewedAt: new Date().toISOString(),
      },
      completedAt: new Date(),
    })
    .where(and(eq(nodeExecutions.workflowRunId, id), eq(nodeExecutions.status, 'pending')))
    .returning();

  if (!node) {
    throw new ValidationError('No pending human review found for this run');
  }

  log.info('Human review submitted', {
    runId: id,
    nodeId: node.nodeId,
    decision: approved ? 'approved' : 'rejected',
  });

  if (approved) {
    // Update run status back to running and resume workflow execution
    await db.update(workflowRuns).set({ status: 'running' }).where(eq(workflowRuns.id, id));

    // Re-enqueue the workflow to continue execution
    // The workflow processor will pick up from where it left off
    await enqueueWorkflow({
      runId: id,
      workflowId: run.workflowId,
      triggerType: run.triggerType as 'manual' | 'schedule' | 'webhook' | 'api',
      input: (run.input as Record<string, unknown>) || {},
    });
  } else {
    await db
      .update(workflowRuns)
      .set({
        status: 'failed',
        error: `Human review rejected: ${comment ?? 'No reason provided'}`,
        completedAt: new Date(),
      })
      .where(eq(workflowRuns.id, id));
  }

  return c.json({ data: node });
});

export { runs };

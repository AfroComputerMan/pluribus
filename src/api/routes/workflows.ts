import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';

import { db } from '@/db';
import { workflows, workflowRuns } from '@/db/schema';
import { NotFoundError } from '@/lib/errors';
import {
  createWorkflowSchema,
  updateWorkflowSchema,
  workflowFilterSchema,
  workflowRunFilterSchema,
  triggerRunSchema,
} from '@/core/workflows';
import { enqueueWorkflow } from '@/queue';
import {
  validateBody,
  validateQuery,
  getValidatedBody,
  getValidatedQuery,
} from '../middleware';

const workflowRoutes = new Hono();

// GET /api/workflows - List workflows
workflowRoutes.get('/', validateQuery(workflowFilterSchema), async (c) => {
  const filter = getValidatedQuery<z.infer<typeof workflowFilterSchema>>(c);

  const items = await db.query.workflows.findMany({
    limit: filter.limit,
    offset: filter.offset,
    orderBy: [desc(workflows.updatedAt)],
  });

  return c.json({
    data: items,
    meta: {
      limit: filter.limit,
      offset: filter.offset,
    },
  });
});

// GET /api/workflows/:id - Get workflow by ID
workflowRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, id),
  });

  if (!workflow) {
    throw new NotFoundError('Workflow', id);
  }

  return c.json({ data: workflow });
});

// POST /api/workflows - Create workflow
workflowRoutes.post('/', validateBody(createWorkflowSchema), async (c) => {
  const input = getValidatedBody<z.infer<typeof createWorkflowSchema>>(c);

  const [workflow] = await db.insert(workflows).values(input).returning();

  return c.json({ data: workflow }, 201);
});

// PUT /api/workflows/:id - Update workflow
workflowRoutes.put('/:id', validateBody(updateWorkflowSchema), async (c) => {
  const id = c.req.param('id');
  const input = getValidatedBody<z.infer<typeof updateWorkflowSchema>>(c);

  const [workflow] = await db
    .update(workflows)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(workflows.id, id))
    .returning();

  if (!workflow) {
    throw new NotFoundError('Workflow', id);
  }

  return c.json({ data: workflow });
});

// DELETE /api/workflows/:id - Delete workflow
workflowRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const result = await db.delete(workflows).where(eq(workflows.id, id)).returning();

  if (result.length === 0) {
    throw new NotFoundError('Workflow', id);
  }

  return c.json({ success: true });
});

// POST /api/workflows/:id/run - Trigger workflow run
workflowRoutes.post('/:id/run', validateBody(triggerRunSchema), async (c) => {
  const id = c.req.param('id');
  const { input } = getValidatedBody<z.infer<typeof triggerRunSchema>>(c);

  // Verify workflow exists
  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, id),
  });

  if (!workflow) {
    throw new NotFoundError('Workflow', id);
  }

  // Create run record
  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowId: id,
      status: 'pending',
      triggerType: 'api',
      input: input || {},
    })
    .returning();

  // Enqueue for execution
  await enqueueWorkflow({
    runId: run!.id,
    workflowId: id,
    triggerType: 'api',
    input: input || {},
  });

  return c.json({ data: run }, 202);
});

// GET /api/workflows/:id/runs - Get workflow runs
workflowRoutes.get('/:id/runs', validateQuery(workflowRunFilterSchema), async (c) => {
  const id = c.req.param('id');
  const filter = getValidatedQuery<z.infer<typeof workflowRunFilterSchema>>(c);

  const runs = await db.query.workflowRuns.findMany({
    where: eq(workflowRuns.workflowId, id),
    limit: filter.limit,
    offset: filter.offset,
    orderBy: [desc(workflowRuns.createdAt)],
  });

  return c.json({
    data: runs,
    meta: {
      limit: filter.limit,
      offset: filter.offset,
    },
  });
});

export { workflowRoutes };

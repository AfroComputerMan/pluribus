import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import * as schema from '@/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import { createTestWorkflowInput } from '../../setup/fixtures';
import { type TestContainers, startTestContainers } from '../../setup/testcontainers';

/**
 * API integration tests for /api/runs endpoints
 * Uses testcontainers for real database testing
 */
describe('Runs API Integration', () => {
  let containers: TestContainers;
  let app: Hono;

  // Mock queue for testing without Redis
  const enqueuedJobs: Array<{
    queue: string;
    data: {
      runId: string;
      workflowId: string;
      triggerType: string;
      input: Record<string, unknown>;
    };
  }> = [];

  // Create a test app that mirrors the real routes
  function createTestApp(db: ReturnType<typeof drizzle<typeof schema>>) {
    const app = new Hono();

    // GET /api/runs - List all runs
    app.get('/api/runs', async (c) => {
      const limit = Number.parseInt(c.req.query('limit') ?? '50');
      const offset = Number.parseInt(c.req.query('offset') ?? '0');
      const workflowId = c.req.query('workflowId');
      const status = c.req.query('status');

      const conditions = [];
      if (workflowId) {
        conditions.push(eq(schema.workflowRuns.workflowId, workflowId));
      }
      if (status) {
        conditions.push(eq(schema.workflowRuns.status, status as never));
      }

      const items = await db
        .select()
        .from(schema.workflowRuns)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(limit)
        .offset(offset)
        .orderBy(desc(schema.workflowRuns.createdAt));

      return c.json({ data: items, meta: { limit, offset } });
    });

    // GET /api/runs/:id - Get run by ID
    app.get('/api/runs/:id', async (c) => {
      const run = await db.query.workflowRuns.findFirst({
        where: eq(schema.workflowRuns.id, c.req.param('id')),
      });

      if (!run) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Run not found' } }, 404);
      }

      return c.json({ data: run });
    });

    // GET /api/runs/:id/nodes - Get node executions for a run
    app.get('/api/runs/:id/nodes', async (c) => {
      const nodes = await db.query.nodeExecutions.findMany({
        where: eq(schema.nodeExecutions.workflowRunId, c.req.param('id')),
        orderBy: [desc(schema.nodeExecutions.createdAt)],
      });

      return c.json({ data: nodes });
    });

    // POST /api/runs/:id/cancel - Cancel a running workflow
    app.post('/api/runs/:id/cancel', async (c) => {
      const id = c.req.param('id');

      const [run] = await db
        .update(schema.workflowRuns)
        .set({
          status: 'cancelled',
          completedAt: new Date(),
        })
        .where(and(eq(schema.workflowRuns.id, id), eq(schema.workflowRuns.status, 'running')))
        .returning();

      if (!run) {
        const exists = await db.query.workflowRuns.findFirst({
          where: eq(schema.workflowRuns.id, id),
        });

        if (!exists) {
          return c.json({ error: { code: 'NOT_FOUND', message: 'Run not found' } }, 404);
        }

        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Run cannot be cancelled' } },
          400
        );
      }

      return c.json({ data: run });
    });

    // POST /api/runs/:id/retry - Retry a failed workflow
    app.post('/api/runs/:id/retry', async (c) => {
      const id = c.req.param('id');

      const originalRun = await db.query.workflowRuns.findFirst({
        where: eq(schema.workflowRuns.id, id),
      });

      if (!originalRun) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Run not found' } }, 404);
      }

      if (originalRun.status !== 'failed') {
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Only failed runs can be retried' } },
          400
        );
      }

      // Verify workflow still exists
      if (!originalRun.workflowId) {
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Workflow has been deleted' } },
          400
        );
      }

      // Create new run with same input
      const [newRun] = await db
        .insert(schema.workflowRuns)
        .values({
          workflowId: originalRun.workflowId,
          status: 'pending',
          triggerType: 'api',
          input: originalRun.input,
        })
        .returning();

      if (!newRun) {
        return c.json({ error: { code: 'SERVER_ERROR', message: 'Failed to create run' } }, 500);
      }

      // Mock enqueue
      enqueuedJobs.push({
        queue: 'workflow',
        data: {
          runId: newRun.id,
          workflowId: originalRun.workflowId,
          triggerType: 'api',
          input: (originalRun.input as Record<string, unknown>) || {},
        },
      });

      return c.json({ data: newRun }, 202);
    });

    // POST /api/runs/:id/review - Submit human review decision
    app.post('/api/runs/:id/review', async (c) => {
      const id = c.req.param('id');
      const body = await c.req.json();

      const run = await db.query.workflowRuns.findFirst({
        where: eq(schema.workflowRuns.id, id),
      });

      if (!run) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Run not found' } }, 404);
      }

      if (!run.workflowId) {
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Workflow has been deleted' } },
          400
        );
      }

      // Find pending human review node
      const [node] = await db
        .update(schema.nodeExecutions)
        .set({
          status: 'completed',
          output: {
            decision: body.decision,
            comment: body.comment,
            reviewedAt: new Date().toISOString(),
          },
          completedAt: new Date(),
        })
        .where(
          and(
            eq(schema.nodeExecutions.workflowRunId, id),
            eq(schema.nodeExecutions.status, 'running')
          )
        )
        .returning();

      if (!node) {
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'No pending human review found' } },
          400
        );
      }

      // Update run status back to running
      await db
        .update(schema.workflowRuns)
        .set({ status: 'running' })
        .where(eq(schema.workflowRuns.id, id));

      // Mock enqueue
      enqueuedJobs.push({
        queue: 'workflow',
        data: {
          runId: id,
          workflowId: run.workflowId,
          triggerType: run.triggerType,
          input: (run.input as Record<string, unknown>) || {},
        },
      });

      return c.json({ data: node });
    });

    return app;
  }

  beforeAll(async () => {
    containers = await startTestContainers();
    app = createTestApp(containers.db);
  }, 90000);

  afterAll(async () => {
    await containers.cleanup();
  });

  beforeEach(async () => {
    // Clear queue mock
    enqueuedJobs.length = 0;

    // Clean up tables before each test
    await containers.db.delete(schema.nodeExecutions);
    await containers.db.delete(schema.workflowRuns);
    await containers.db.delete(schema.workflows);
  });

  describe('GET /api/runs', () => {
    test('returns empty array when no runs', async () => {
      const res = await app.request('/api/runs');
      const json = (await res.json()) as {
        data: unknown[];
        meta: { limit: number; offset: number };
      };

      expect(res.status).toBe(200);
      expect(json.data).toEqual([]);
      expect(json.meta).toEqual({ limit: 50, offset: 0 });
    });

    test('returns all runs', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      if (!workflow) throw new Error('Failed to create workflow');

      await containers.db.insert(schema.workflowRuns).values([
        {
          workflowId: workflow.id,
          status: 'completed',
          triggerType: 'manual',
          input: {},
        },
        {
          workflowId: workflow.id,
          status: 'failed',
          triggerType: 'api',
          input: {},
        },
      ]);

      const res = await app.request('/api/runs');
      const json = (await res.json()) as { data: unknown[] };

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
    });

    test('filters by workflowId', async () => {
      const [workflow1] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Workflow 1' }))
        .returning();

      const [workflow2] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Workflow 2' }))
        .returning();

      if (!workflow1 || !workflow2) throw new Error('Failed to create workflows');

      await containers.db.insert(schema.workflowRuns).values([
        { workflowId: workflow1.id, status: 'completed', triggerType: 'manual', input: {} },
        { workflowId: workflow2.id, status: 'completed', triggerType: 'manual', input: {} },
      ]);

      const res = await app.request(`/api/runs?workflowId=${workflow1.id}`);
      const json = (await res.json()) as { data: Array<{ workflowId: string }> };

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(1);
      expect(json.data[0]?.workflowId).toBe(workflow1.id);
    });

    test('filters by status', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      if (!workflow) throw new Error('Failed to create workflow');

      await containers.db.insert(schema.workflowRuns).values([
        { workflowId: workflow.id, status: 'completed', triggerType: 'manual', input: {} },
        { workflowId: workflow.id, status: 'failed', triggerType: 'manual', input: {} },
      ]);

      const res = await app.request('/api/runs?status=failed');
      const json = (await res.json()) as { data: Array<{ status: string }> };

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(1);
      expect(json.data[0]?.status).toBe('failed');
    });
  });

  describe('GET /api/runs/:id', () => {
    test('returns run by id', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      if (!workflow) throw new Error('Failed to create workflow');

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow.id,
          status: 'completed',
          triggerType: 'manual',
          input: { test: 'data' },
        })
        .returning();

      if (!run) throw new Error('Failed to create run');

      const res = await app.request(`/api/runs/${run.id}`);
      const json = (await res.json()) as { data: { id: string; input: unknown } };

      expect(res.status).toBe(200);
      expect(json.data.id).toBe(run.id);
      expect(json.data.input).toEqual({ test: 'data' });
    });

    test('returns 404 for non-existent run', async () => {
      const res = await app.request('/api/runs/550e8400-e29b-41d4-a716-446655440000');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/runs/:id/nodes', () => {
    test('returns node executions for a run', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      if (!workflow) throw new Error('Failed to create workflow');

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow.id,
          status: 'completed',
          triggerType: 'manual',
          input: {},
        })
        .returning();

      if (!run) throw new Error('Failed to create run');

      await containers.db.insert(schema.nodeExecutions).values([
        {
          workflowRunId: run.id,
          nodeId: 'node-1',
          status: 'completed',
          input: {},
          output: { result: 'success' },
        },
        {
          workflowRunId: run.id,
          nodeId: 'node-2',
          status: 'completed',
          input: {},
          output: { result: 'success' },
        },
      ]);

      const res = await app.request(`/api/runs/${run.id}/nodes`);
      const json = (await res.json()) as { data: unknown[] };

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
    });
  });

  describe('POST /api/runs/:id/cancel', () => {
    test('cancels a running workflow', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      if (!workflow) throw new Error('Failed to create workflow');

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow.id,
          status: 'running',
          triggerType: 'manual',
          input: {},
        })
        .returning();

      if (!run) throw new Error('Failed to create run');

      const res = await app.request(`/api/runs/${run.id}/cancel`, { method: 'POST' });
      const json = (await res.json()) as { data: { status: string; completedAt: string } };

      expect(res.status).toBe(200);
      expect(json.data.status).toBe('cancelled');
      expect(json.data.completedAt).toBeDefined();
    });

    test('returns error when cancelling non-running workflow', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      if (!workflow) throw new Error('Failed to create workflow');

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow.id,
          status: 'completed',
          triggerType: 'manual',
          input: {},
        })
        .returning();

      if (!run) throw new Error('Failed to create run');

      const res = await app.request(`/api/runs/${run.id}/cancel`, { method: 'POST' });
      expect(res.status).toBe(400);
    });

    test('returns 404 for non-existent run', async () => {
      const res = await app.request('/api/runs/550e8400-e29b-41d4-a716-446655440000/cancel', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/runs/:id/retry', () => {
    test('retries a failed workflow and enqueues it', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      if (!workflow) throw new Error('Failed to create workflow');

      const [originalRun] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow.id,
          status: 'failed',
          triggerType: 'manual',
          input: { test: 'data' },
          error: 'Something went wrong',
        })
        .returning();

      if (!originalRun) throw new Error('Failed to create run');

      const res = await app.request(`/api/runs/${originalRun.id}/retry`, { method: 'POST' });
      const json = (await res.json()) as {
        data: { id: string; status: string; input: unknown; workflowId: string };
      };

      expect(res.status).toBe(202);
      expect(json.data.id).not.toBe(originalRun.id);
      expect(json.data.status).toBe('pending');
      expect(json.data.input).toEqual({ test: 'data' });
      expect(json.data.workflowId).toBe(workflow.id);

      // Verify job was enqueued
      expect(enqueuedJobs.length).toBe(1);
      expect(enqueuedJobs[0]?.queue).toBe('workflow');
      expect(enqueuedJobs[0]?.data.runId).toBe(json.data.id);
      expect(enqueuedJobs[0]?.data.workflowId).toBe(workflow.id);
      expect(enqueuedJobs[0]?.data.input).toEqual({ test: 'data' });
    });

    test('returns error when retrying non-failed workflow', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      if (!workflow) throw new Error('Failed to create workflow');

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow.id,
          status: 'completed',
          triggerType: 'manual',
          input: {},
        })
        .returning();

      if (!run) throw new Error('Failed to create run');

      const res = await app.request(`/api/runs/${run.id}/retry`, { method: 'POST' });
      expect(res.status).toBe(400);
      expect(enqueuedJobs.length).toBe(0);
    });

    test('returns 404 for non-existent run', async () => {
      const res = await app.request('/api/runs/550e8400-e29b-41d4-a716-446655440000/retry', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/runs/:id/review', () => {
    test('submits human review decision and resumes workflow', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      if (!workflow) throw new Error('Failed to create workflow');

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow.id,
          status: 'pending',
          triggerType: 'manual',
          input: { test: 'data' },
        })
        .returning();

      if (!run) throw new Error('Failed to create run');

      const [node] = await containers.db
        .insert(schema.nodeExecutions)
        .values({
          workflowRunId: run.id,
          nodeId: 'review-node',
          status: 'pending',
          input: { question: 'Approve this?' },
        })
        .returning();

      if (!node) throw new Error('Failed to create node');

      const res = await app.request(`/api/runs/${run.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve', comment: 'Looks good' }),
      });

      const json = (await res.json()) as {
        data: {
          id: string;
          status: string;
          output: { decision: string; comment: string; reviewedAt: string };
        };
      };

      expect(res.status).toBe(200);
      expect(json.data.id).toBe(node.id);
      expect(json.data.status).toBe('completed');
      expect(json.data.output.decision).toBe('approved');
      expect(json.data.output.comment).toBe('Looks good');
      expect(json.data.output.reviewedAt).toBeDefined();

      // Verify run status was updated
      const updatedRun = await containers.db.query.workflowRuns.findFirst({
        where: eq(schema.workflowRuns.id, run.id),
      });
      expect(updatedRun?.status).toBe('running');

      // Verify job was enqueued to resume workflow
      expect(enqueuedJobs.length).toBe(1);
      expect(enqueuedJobs[0]?.queue).toBe('workflow');
      expect(enqueuedJobs[0]?.data.runId).toBe(run.id);
      expect(enqueuedJobs[0]?.data.workflowId).toBe(workflow.id);
    });

    test('rejects human review and marks run as failed', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      if (!workflow) throw new Error('Failed to create workflow');

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow.id,
          status: 'pending',
          triggerType: 'manual',
          input: { test: 'data' },
        })
        .returning();

      if (!run) throw new Error('Failed to create run');

      const [node] = await containers.db
        .insert(schema.nodeExecutions)
        .values({
          workflowRunId: run.id,
          nodeId: 'review-node',
          status: 'pending',
          input: { question: 'Approve this?' },
        })
        .returning();

      if (!node) throw new Error('Failed to create node');

      const res = await app.request(`/api/runs/${run.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reject', comment: 'Needs changes' }),
      });

      const json = (await res.json()) as {
        data: {
          id: string;
          status: string;
          output: { decision: string; comment: string; reviewedAt: string };
        };
      };

      expect(res.status).toBe(200);
      expect(json.data.id).toBe(node.id);
      expect(json.data.status).toBe('failed');
      expect(json.data.output.decision).toBe('rejected');
      expect(json.data.output.comment).toBe('Needs changes');
      expect(json.data.output.reviewedAt).toBeDefined();

      const updatedRun = await containers.db.query.workflowRuns.findFirst({
        where: eq(schema.workflowRuns.id, run.id),
      });
      expect(updatedRun?.status).toBe('failed');
      expect(updatedRun?.error).toBe('Human review rejected: Needs changes');

      expect(enqueuedJobs.length).toBe(0);
    });

    test('returns error when no pending review found', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      if (!workflow) throw new Error('Failed to create workflow');

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow.id,
          status: 'running',
          triggerType: 'manual',
          input: {},
        })
        .returning();

      if (!run) throw new Error('Failed to create run');

      const res = await app.request(`/api/runs/${run.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      });

      expect(res.status).toBe(400);
      expect(enqueuedJobs.length).toBe(0);
    });

    test('returns 404 for non-existent run', async () => {
      const res = await app.request('/api/runs/550e8400-e29b-41d4-a716-446655440000/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      });

      expect(res.status).toBe(404);
    });
  });
});

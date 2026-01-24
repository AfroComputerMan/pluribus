import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { startTestContainers, type TestContainers } from '../../setup/testcontainers';
import { createTestWorkflowInput, createTestAgentInput } from '../../setup/fixtures';
import * as schema from '@/db/schema';

/**
 * API integration tests for /api/workflows endpoints
 * Uses testcontainers for real database testing
 */
describe('Workflows API Integration', () => {
  let containers: TestContainers;
  let app: Hono;

  // Create a test app that mirrors the real routes
  function createTestApp(db: ReturnType<typeof drizzle>) {
    const app = new Hono();

    // Workflow service
    const workflowService = {
      async getWorkflow(id: string) {
        const result = await db.query.workflows.findFirst({
          where: eq(schema.workflows.id, id),
        });
        if (!result) {
          throw new Error(`Workflow not found: ${id}`);
        }
        return result;
      },

      async listWorkflows(filter?: { limit?: number; offset?: number }) {
        return db
          .select()
          .from(schema.workflows)
          .limit(filter?.limit ?? 50)
          .offset(filter?.offset ?? 0)
          .orderBy(desc(schema.workflows.updatedAt));
      },

      async createWorkflow(input: typeof schema.workflows.$inferInsert) {
        const [result] = await db.insert(schema.workflows).values(input).returning();
        return result!;
      },

      async updateWorkflow(id: string, input: Partial<typeof schema.workflows.$inferInsert>) {
        const [result] = await db
          .update(schema.workflows)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(schema.workflows.id, id))
          .returning();
        if (!result) {
          throw new Error(`Workflow not found: ${id}`);
        }
        return result;
      },

      async deleteWorkflow(id: string) {
        const result = await db
          .delete(schema.workflows)
          .where(eq(schema.workflows.id, id))
          .returning();
        if (result.length === 0) {
          throw new Error(`Workflow not found: ${id}`);
        }
        return true;
      },

      async triggerRun(workflowId: string, input?: Record<string, unknown>) {
        // Verify workflow exists
        const workflow = await db.query.workflows.findFirst({
          where: eq(schema.workflows.id, workflowId),
        });
        if (!workflow) {
          throw new Error(`Workflow not found: ${workflowId}`);
        }

        const [run] = await db
          .insert(schema.workflowRuns)
          .values({
            workflowId,
            status: 'pending',
            triggerType: 'api',
            input: input || {},
          })
          .returning();
        return run!;
      },

      async listRuns(workflowId: string, filter?: { limit?: number; offset?: number }) {
        return db
          .select()
          .from(schema.workflowRuns)
          .where(eq(schema.workflowRuns.workflowId, workflowId))
          .limit(filter?.limit ?? 50)
          .offset(filter?.offset ?? 0)
          .orderBy(desc(schema.workflowRuns.createdAt));
      },
    };

    // GET /api/workflows
    app.get('/api/workflows', async (c) => {
      const limit = parseInt(c.req.query('limit') ?? '50');
      const offset = parseInt(c.req.query('offset') ?? '0');
      const items = await workflowService.listWorkflows({ limit, offset });
      return c.json({ data: items, meta: { limit, offset } });
    });

    // GET /api/workflows/:id
    app.get('/api/workflows/:id', async (c) => {
      try {
        const workflow = await workflowService.getWorkflow(c.req.param('id'));
        return c.json({ data: workflow });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Workflow not found' } }, 404);
      }
    });

    // POST /api/workflows
    app.post('/api/workflows', async (c) => {
      const body = await c.req.json();
      const workflow = await workflowService.createWorkflow(body);
      return c.json({ data: workflow }, 201);
    });

    // PUT /api/workflows/:id
    app.put('/api/workflows/:id', async (c) => {
      try {
        const body = await c.req.json();
        const workflow = await workflowService.updateWorkflow(c.req.param('id'), body);
        return c.json({ data: workflow });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Workflow not found' } }, 404);
      }
    });

    // DELETE /api/workflows/:id
    app.delete('/api/workflows/:id', async (c) => {
      try {
        await workflowService.deleteWorkflow(c.req.param('id'));
        return c.json({ success: true });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Workflow not found' } }, 404);
      }
    });

    // POST /api/workflows/:id/run
    app.post('/api/workflows/:id/run', async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}));
        const run = await workflowService.triggerRun(c.req.param('id'), body.input);
        return c.json({ data: run }, 202);
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Workflow not found' } }, 404);
      }
    });

    // GET /api/workflows/:id/runs
    app.get('/api/workflows/:id/runs', async (c) => {
      const limit = parseInt(c.req.query('limit') ?? '50');
      const offset = parseInt(c.req.query('offset') ?? '0');
      const runs = await workflowService.listRuns(c.req.param('id'), { limit, offset });
      return c.json({ data: runs, meta: { limit, offset } });
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
    // Clean up tables before each test
    await containers.db.delete(schema.workflowRuns);
    await containers.db.delete(schema.workflows);
    await containers.db.delete(schema.agents);
  });

  describe('GET /api/workflows', () => {
    test('returns empty array when no workflows', async () => {
      const res = await app.request('/api/workflows');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toEqual([]);
      expect(json.meta).toEqual({ limit: 50, offset: 0 });
    });

    test('returns all workflows', async () => {
      await containers.db.insert(schema.workflows).values([
        createTestWorkflowInput({ name: 'Workflow 1' }),
        createTestWorkflowInput({ name: 'Workflow 2' }),
      ]);

      const res = await app.request('/api/workflows');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
    });

    test('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await containers.db.insert(schema.workflows).values(
          createTestWorkflowInput({ name: `Workflow ${i}` })
        );
      }

      const res = await app.request('/api/workflows?limit=2');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
      expect(json.meta.limit).toBe(2);
    });

    test('respects offset parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await containers.db.insert(schema.workflows).values(
          createTestWorkflowInput({ name: `Workflow ${i}` })
        );
      }

      const res = await app.request('/api/workflows?limit=2&offset=3');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
      expect(json.meta.offset).toBe(3);
    });
  });

  describe('GET /api/workflows/:id', () => {
    test('returns workflow by id', async () => {
      const [created] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Test Workflow' }))
        .returning();

      const res = await app.request(`/api/workflows/${created!.id}`);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.id).toBe(created!.id);
      expect(json.data.name).toBe('Test Workflow');
    });

    test('returns 404 for non-existent workflow', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/api/workflows/${fakeId}`);
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    test('returns workflow with nodes and edges', async () => {
      const workflow = createTestWorkflowInput({
        name: 'Complex Workflow',
        nodes: [
          {
            id: 'node-1',
            type: 'agent',
            agentId: '550e8400-e29b-41d4-a716-446655440000',
            input: { task: 'analyze' },
          },
          {
            id: 'node-2',
            type: 'agent',
            agentId: '550e8400-e29b-41d4-a716-446655440001',
            input: { data: { fromNode: 'node-1', path: 'output' } },
          },
        ],
        edges: [
          { id: 'e1', from: 'node-1', to: 'node-2' },
        ],
      });

      const [created] = await containers.db
        .insert(schema.workflows)
        .values(workflow)
        .returning();

      const res = await app.request(`/api/workflows/${created!.id}`);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.nodes.length).toBe(2);
      expect(json.data.edges.length).toBe(1);
    });
  });

  describe('POST /api/workflows', () => {
    test('creates workflow with valid input', async () => {
      const input = createTestWorkflowInput({ name: 'New Workflow' });

      const res = await app.request('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.id).toBeDefined();
      expect(json.data.name).toBe('New Workflow');
    });

    test('persists workflow in database', async () => {
      const input = createTestWorkflowInput({ name: 'Persisted Workflow' });

      const res = await app.request('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json();

      // Verify in database
      const dbWorkflow = await containers.db.query.workflows.findFirst({
        where: eq(schema.workflows.id, json.data.id),
      });

      expect(dbWorkflow).toBeDefined();
      expect(dbWorkflow!.name).toBe('Persisted Workflow');
    });

    test('creates workflow with complex nodes', async () => {
      const input = createTestWorkflowInput({
        name: 'Complex Workflow',
        nodes: [
          {
            id: 'parallel-1',
            type: 'parallel',
            branches: ['branch-a', 'branch-b'],
            joinStrategy: 'all',
          },
        ],
      });

      const res = await app.request('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.nodes[0].type).toBe('parallel');
      expect(json.data.nodes[0].joinStrategy).toBe('all');
    });

    test('creates workflow with multiple triggers', async () => {
      const input = createTestWorkflowInput({
        name: 'Multi-trigger Workflow',
        triggers: [
          { type: 'manual' },
          { type: 'schedule', cron: '0 0 * * *' },
          { type: 'api' },
        ],
      });

      const res = await app.request('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.triggers.length).toBe(3);
    });
  });

  describe('PUT /api/workflows/:id', () => {
    test('updates workflow name', async () => {
      const [created] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput({ name: 'Original Name' }))
        .returning();

      const res = await app.request(`/api/workflows/${created!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.name).toBe('Updated Name');
    });

    test('updates workflow nodes', async () => {
      const [created] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const newNodes = [
        {
          id: 'new-node',
          type: 'agent' as const,
          agentId: '550e8400-e29b-41d4-a716-446655440001',
          input: { newTask: 'updated' },
        },
      ];

      const res = await app.request(`/api/workflows/${created!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: newNodes }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.nodes[0].id).toBe('new-node');
    });

    test('updates error strategy', async () => {
      const [created] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const res = await app.request(`/api/workflows/${created!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorStrategy: {
            retries: 5,
            retryDelay: 10000,
            onFailure: 'human-review',
          },
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.errorStrategy.retries).toBe(5);
      expect(json.data.errorStrategy.onFailure).toBe('human-review');
    });

    test('returns 404 for non-existent workflow', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/api/workflows/${fakeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/workflows/:id', () => {
    test('deletes workflow', async () => {
      const [created] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const res = await app.request(`/api/workflows/${created!.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      // Verify deleted from database
      const dbWorkflow = await containers.db.query.workflows.findFirst({
        where: eq(schema.workflows.id, created!.id),
      });
      expect(dbWorkflow).toBeUndefined();
    });

    test('returns 404 for non-existent workflow', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/api/workflows/${fakeId}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/workflows/:id/run', () => {
    test('triggers workflow run', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const res = await app.request(`/api/workflows/${workflow!.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { key: 'value' } }),
      });
      const json = await res.json();

      expect(res.status).toBe(202);
      expect(json.data.id).toBeDefined();
      expect(json.data.workflowId).toBe(workflow!.id);
      expect(json.data.status).toBe('pending');
      expect(json.data.triggerType).toBe('api');
    });

    test('creates run record in database', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const res = await app.request(`/api/workflows/${workflow!.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { task: 'test' } }),
      });
      const json = await res.json();

      // Verify run record in database
      const dbRun = await containers.db.query.workflowRuns.findFirst({
        where: eq(schema.workflowRuns.id, json.data.id),
      });

      expect(dbRun).toBeDefined();
      expect(dbRun!.input).toEqual({ task: 'test' });
    });

    test('accepts empty input', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const res = await app.request(`/api/workflows/${workflow!.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(res.status).toBe(202);
      expect(json.data.input).toEqual({});
    });

    test('returns 404 for non-existent workflow', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/api/workflows/${fakeId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/workflows/:id/runs', () => {
    test('returns empty array when no runs', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const res = await app.request(`/api/workflows/${workflow!.id}/runs`);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toEqual([]);
    });

    test('returns workflow runs', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      // Create some runs
      await containers.db.insert(schema.workflowRuns).values([
        { workflowId: workflow!.id, status: 'completed', triggerType: 'api' },
        { workflowId: workflow!.id, status: 'running', triggerType: 'manual' },
        { workflowId: workflow!.id, status: 'pending', triggerType: 'schedule' },
      ]);

      const res = await app.request(`/api/workflows/${workflow!.id}/runs`);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(3);
    });

    test('respects pagination', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      // Create 5 runs
      for (let i = 0; i < 5; i++) {
        await containers.db.insert(schema.workflowRuns).values({
          workflowId: workflow!.id,
          status: 'completed',
          triggerType: 'api',
        });
      }

      const res = await app.request(`/api/workflows/${workflow!.id}/runs?limit=2&offset=2`);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
      expect(json.meta.limit).toBe(2);
      expect(json.meta.offset).toBe(2);
    });
  });
});

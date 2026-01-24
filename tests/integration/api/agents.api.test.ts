import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import { createTestAgentInput } from '../../setup/fixtures';
import { type TestContainers, startTestContainers } from '../../setup/testcontainers';

/**
 * API integration tests for /api/agents endpoints
 * Uses testcontainers for real database testing
 */
describe('Agents API Integration', () => {
  let containers: TestContainers;
  let app: Hono;

  // Create a minimal test app that mirrors the real routes
  function createTestApp(db: ReturnType<typeof drizzle<typeof schema>>) {
    const app = new Hono();

    // Simple agent service for testing
    const agentService = {
      async getAgent(id: string) {
        const result = await db.query.agents.findFirst({
          where: eq(schema.agents.id, id),
        });
        if (!result) {
          throw new Error(`Agent not found: ${id}`);
        }
        return result;
      },

      async listAgents(filter?: { limit?: number; offset?: number }) {
        return db
          .select()
          .from(schema.agents)
          .limit(filter?.limit ?? 50)
          .offset(filter?.offset ?? 0);
      },

      async createAgent(input: typeof schema.agents.$inferInsert) {
        const [result] = await db.insert(schema.agents).values(input).returning();
        if (!result) throw new Error('Insert failed');
        return result;
      },

      async updateAgent(id: string, input: Partial<typeof schema.agents.$inferInsert>) {
        const [result] = await db
          .update(schema.agents)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(schema.agents.id, id))
          .returning();
        if (!result) {
          throw new Error(`Agent not found: ${id}`);
        }
        return result;
      },

      async deleteAgent(id: string) {
        const result = await db.delete(schema.agents).where(eq(schema.agents.id, id)).returning();
        if (result.length === 0) {
          throw new Error(`Agent not found: ${id}`);
        }
        return true;
      },
    };

    // GET /api/agents
    app.get('/api/agents', async (c) => {
      const limit = Number.parseInt(c.req.query('limit') ?? '50');
      const offset = Number.parseInt(c.req.query('offset') ?? '0');
      const items = await agentService.listAgents({ limit, offset });
      return c.json({ data: items, meta: { limit, offset } });
    });

    // GET /api/agents/:id
    app.get('/api/agents/:id', async (c) => {
      try {
        const agent = await agentService.getAgent(c.req.param('id'));
        return c.json({ data: agent });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
      }
    });

    // POST /api/agents
    app.post('/api/agents', async (c) => {
      const body = await c.req.json();
      const agent = await agentService.createAgent(body);
      return c.json({ data: agent }, 201);
    });

    // PUT /api/agents/:id
    app.put('/api/agents/:id', async (c) => {
      try {
        const body = await c.req.json();
        const agent = await agentService.updateAgent(c.req.param('id'), body);
        return c.json({ data: agent });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
      }
    });

    // DELETE /api/agents/:id
    app.delete('/api/agents/:id', async (c) => {
      try {
        await agentService.deleteAgent(c.req.param('id'));
        return c.json({ success: true });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
      }
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
    // Clean up agents table before each test
    await containers.db.delete(schema.agents);
  });

  describe('GET /api/agents', () => {
    test('returns empty array when no agents', async () => {
      const res = await app.request('/api/agents');
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data).toEqual([]);
      expect(json.meta).toEqual({ limit: 50, offset: 0 });
    });

    test('returns all agents', async () => {
      // Create test agents directly in DB
      await containers.db
        .insert(schema.agents)
        .values([
          createTestAgentInput({ name: 'Agent 1' }),
          createTestAgentInput({ name: 'Agent 2' }),
        ]);

      const res = await app.request('/api/agents');
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
    });

    test('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await containers.db
          .insert(schema.agents)
          .values(createTestAgentInput({ name: `Agent ${i}` }));
      }

      const res = await app.request('/api/agents?limit=2');
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
      expect(json.meta.limit).toBe(2);
    });

    test('respects offset parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await containers.db
          .insert(schema.agents)
          .values(createTestAgentInput({ name: `Agent ${i}` }));
      }

      const res = await app.request('/api/agents?limit=2&offset=3');
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
      expect(json.meta.offset).toBe(3);
    });
  });

  describe('GET /api/agents/:id', () => {
    test('returns agent by id', async () => {
      const [created] = await containers.db
        .insert(schema.agents)
        .values(createTestAgentInput({ name: 'Test Agent' }))
        .returning();

      const res = await app.request(`/api/agents/${created!.id}`);
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.id).toBe(created!.id);
      expect(json.data.name).toBe('Test Agent');
    });

    test('returns 404 for non-existent agent', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/api/agents/${fakeId}`);
      const json = (await res.json()) as any;

      expect(res.status).toBe(404);
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/agents', () => {
    test('creates agent with valid input', async () => {
      const input = createTestAgentInput({ name: 'New Agent' });

      const res = await app.request('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(201);
      expect(json.data.id).toBeDefined();
      expect(json.data.name).toBe('New Agent');
    });

    test('persists agent in database', async () => {
      const input = createTestAgentInput({ name: 'Persisted Agent' });

      const res = await app.request('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as any;

      // Verify in database
      const dbAgent = await containers.db.query.agents.findFirst({
        where: eq(schema.agents.id, json.data.id),
      });

      expect(dbAgent).toBeDefined();
      expect(dbAgent?.name).toBe('Persisted Agent');
    });
  });

  describe('PUT /api/agents/:id', () => {
    test('updates agent', async () => {
      const [created] = await containers.db
        .insert(schema.agents)
        .values(createTestAgentInput({ name: 'Original Name' }))
        .returning();

      const res = await app.request(`/api/agents/${created!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.name).toBe('Updated Name');
    });

    test('returns 404 for non-existent agent', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/api/agents/${fakeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/agents/:id', () => {
    test('deletes agent', async () => {
      const [created] = await containers.db
        .insert(schema.agents)
        .values(createTestAgentInput())
        .returning();

      const res = await app.request(`/api/agents/${created!.id}`, {
        method: 'DELETE',
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      // Verify deleted from database
      const dbAgent = await containers.db.query.agents.findFirst({
        where: eq(schema.agents.id, created!.id),
      });
      expect(dbAgent).toBeUndefined();
    });

    test('returns 404 for non-existent agent', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/api/agents/${fakeId}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });
});

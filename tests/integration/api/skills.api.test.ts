import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import * as schema from '@/db/schema';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import { createTestSkillInput, testSkillBehavior } from '../../setup/fixtures';
import { type TestContainers, startTestContainers } from '../../setup/testcontainers';

/**
 * API integration tests for /api/skills endpoints
 * Uses testcontainers for real database testing
 */
describe('Skills API Integration', () => {
  let containers: TestContainers;
  let app: Hono;

  // Create a test app that mirrors the real routes
  function createTestApp(db: ReturnType<typeof drizzle<typeof schema>>) {
    const app = new Hono();

    // Skill service
    const skillService = {
      async getSkill(id: string) {
        const result = await db.query.skills.findFirst({
          where: eq(schema.skills.id, id),
        });
        if (!result) {
          throw new Error(`Skill not found: ${id}`);
        }
        return result;
      },

      async listSkills(filter?: {
        tags?: string[];
        type?: string;
        source?: string;
        search?: string;
        limit?: number;
        offset?: number;
      }) {
        const conditions = [];
        if (filter?.tags?.length) {
          conditions.push(sql`${schema.skills.tags} @> ${filter.tags}`);
        }
        if (filter?.type) {
          conditions.push(eq(schema.skills.type, filter.type));
        }
        if (filter?.source) {
          conditions.push(eq(schema.skills.source, filter.source));
        }
        if (filter?.search) {
          conditions.push(
            sql`(${ilike(schema.skills.name, `%${filter.search}%`)} OR ${ilike(schema.skills.description, `%${filter.search}%`)})`
          );
        }

        return db
          .select()
          .from(schema.skills)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .limit(filter?.limit ?? 50)
          .offset(filter?.offset ?? 0)
          .orderBy(desc(schema.skills.updatedAt));
      },

      async createSkill(input: typeof schema.skills.$inferInsert) {
        const [result] = await db.insert(schema.skills).values(input).returning();
        if (!result) throw new Error('Insert failed');
        return result;
      },

      async updateSkill(id: string, input: Partial<typeof schema.skills.$inferInsert>) {
        const [result] = await db
          .update(schema.skills)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(schema.skills.id, id))
          .returning();
        if (!result) {
          throw new Error(`Skill not found: ${id}`);
        }
        return result;
      },

      async deleteSkill(id: string) {
        const result = await db.delete(schema.skills).where(eq(schema.skills.id, id)).returning();
        if (result.length === 0) {
          throw new Error(`Skill not found: ${id}`);
        }
        return true;
      },
    };

    // GET /api/skills
    app.get('/api/skills', async (c) => {
      const limit = Number.parseInt(c.req.query('limit') ?? '50');
      const offset = Number.parseInt(c.req.query('offset') ?? '0');
      const type = c.req.query('type');
      const source = c.req.query('source');
      const search = c.req.query('search');
      const tagsParam = c.req.query('tags');
      const tags = tagsParam ? tagsParam.split(',') : undefined;

      const items = await skillService.listSkills({
        tags,
        type,
        source,
        search,
        limit,
        offset,
      });
      return c.json({ data: items, meta: { limit, offset } });
    });

    // GET /api/skills/:id
    app.get('/api/skills/:id', async (c) => {
      try {
        const skill = await skillService.getSkill(c.req.param('id'));
        return c.json({ data: skill });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404);
      }
    });

    // POST /api/skills
    app.post('/api/skills', async (c) => {
      const body = await c.req.json();
      const skill = await skillService.createSkill(body);
      return c.json({ data: skill }, 201);
    });

    // PUT /api/skills/:id
    app.put('/api/skills/:id', async (c) => {
      try {
        const body = await c.req.json();
        const skill = await skillService.updateSkill(c.req.param('id'), body);
        return c.json({ data: skill });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404);
      }
    });

    // DELETE /api/skills/:id
    app.delete('/api/skills/:id', async (c) => {
      try {
        await skillService.deleteSkill(c.req.param('id'));
        return c.json({ success: true });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404);
      }
    });

    // POST /api/skills/import
    app.post('/api/skills/import', async (c) => {
      const body = await c.req.json();
      const skill = await skillService.createSkill({
        ...body.skill,
        source: 'imported',
      });
      return c.json({ data: skill }, 201);
    });

    // GET /api/skills/:id/export
    app.get('/api/skills/:id/export', async (c) => {
      try {
        const skill = await skillService.getSkill(c.req.param('id'));
        const exportData = {
          version: '1.0',
          skill: {
            name: skill.name,
            description: skill.description,
            type: skill.type,
            content: skill.content,
            tags: skill.tags,
            parameters: skill.parameters,
          },
        };
        return c.json(exportData);
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404);
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
    // Clean up skills table before each test
    await containers.db.delete(schema.skills);
  });

  describe('GET /api/skills', () => {
    test('returns empty array when no skills', async () => {
      const res = await app.request('/api/skills');
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data).toEqual([]);
      expect(json.meta).toEqual({ limit: 50, offset: 0 });
    });

    test('returns all skills', async () => {
      await containers.db
        .insert(schema.skills)
        .values([
          createTestSkillInput({ name: 'Skill 1' }),
          createTestSkillInput({ name: 'Skill 2' }),
        ]);

      const res = await app.request('/api/skills');
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
    });

    test('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await containers.db
          .insert(schema.skills)
          .values(createTestSkillInput({ name: `Skill ${i}` }));
      }

      const res = await app.request('/api/skills?limit=2');
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
      expect(json.meta.limit).toBe(2);
    });

    test('filters by type', async () => {
      await containers.db
        .insert(schema.skills)
        .values([
          createTestSkillInput({ name: 'Prompt Skill', type: 'prompt' }),
          createTestSkillInput({ name: 'Behavior Skill', type: 'behavior' }),
          createTestSkillInput({ name: 'Template Skill', type: 'workflow-template' }),
        ]);

      const res = await app.request('/api/skills?type=prompt');
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(1);
      expect(json.data[0].type).toBe('prompt');
    });

    test('filters by source', async () => {
      await containers.db
        .insert(schema.skills)
        .values([
          createTestSkillInput({ name: 'User Skill', source: 'user' }),
          createTestSkillInput({ name: 'Builtin Skill', source: 'builtin' }),
          createTestSkillInput({ name: 'Imported Skill', source: 'imported' }),
        ]);

      const res = await app.request('/api/skills?source=builtin');
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(1);
      expect(json.data[0].source).toBe('builtin');
    });

    test('filters by search term', async () => {
      await containers.db
        .insert(schema.skills)
        .values([
          createTestSkillInput({ name: 'Code Review Helper', description: 'Reviews code' }),
          createTestSkillInput({ name: 'Writing Assistant', description: 'Helps with writing' }),
          createTestSkillInput({ name: 'Test Skill', description: 'Code analysis tool' }),
        ]);

      const res = await app.request('/api/skills?search=code');
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2); // Matches name or description containing 'code'
    });
  });

  describe('GET /api/skills/:id', () => {
    test('returns skill by id', async () => {
      const [created] = await containers.db
        .insert(schema.skills)
        .values(createTestSkillInput({ name: 'Test Skill' }))
        .returning();

      const res = await app.request(`/api/skills/${created!.id}`);
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.id).toBe(created!.id);
      expect(json.data.name).toBe('Test Skill');
    });

    test('returns 404 for non-existent skill', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/api/skills/${fakeId}`);
      const json = (await res.json()) as any;

      expect(res.status).toBe(404);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    test('returns skill with parameters', async () => {
      const [created] = await containers.db
        .insert(schema.skills)
        .values(
          createTestSkillInput({
            name: 'Parameterized Skill',
            parameters: [
              { name: 'input', type: 'string', description: 'Input text', required: true },
              {
                name: 'verbose',
                type: 'boolean',
                description: 'Verbose output',
                required: false,
                default: false,
              },
            ],
          })
        )
        .returning();

      const res = await app.request(`/api/skills/${created!.id}`);
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.parameters.length).toBe(2);
      expect(json.data.parameters[0].name).toBe('input');
    });
  });

  describe('POST /api/skills', () => {
    test('creates skill with valid input', async () => {
      const input = createTestSkillInput({ name: 'New Skill' });

      const res = await app.request('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(201);
      expect(json.data.id).toBeDefined();
      expect(json.data.name).toBe('New Skill');
    });

    test('persists skill in database', async () => {
      const input = createTestSkillInput({ name: 'Persisted Skill' });

      const res = await app.request('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as any;

      // Verify in database
      const dbSkill = await containers.db.query.skills.findFirst({
        where: eq(schema.skills.id, json.data.id),
      });

      expect(dbSkill).toBeDefined();
      expect(dbSkill?.name).toBe('Persisted Skill');
    });

    test('creates skill with all fields', async () => {
      const input = {
        name: 'Full Skill',
        description: 'A complete skill with all fields',
        type: 'prompt',
        content: 'You are a {{role}} that {{task}}',
        tags: ['ai', 'assistant', 'helper'],
        source: 'user',
        parameters: [
          { name: 'role', type: 'string', description: 'Role name', required: true },
          { name: 'task', type: 'string', description: 'Task description', required: true },
        ],
      };

      const res = await app.request('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(201);
      expect(json.data.tags).toContain('ai');
      expect(json.data.parameters.length).toBe(2);
    });

    test('creates behavior skill', async () => {
      const input = testSkillBehavior;

      const res = await app.request('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(201);
      expect(json.data.type).toBe('behavior');
    });
  });

  describe('PUT /api/skills/:id', () => {
    test('updates skill name', async () => {
      const [created] = await containers.db
        .insert(schema.skills)
        .values(createTestSkillInput({ name: 'Original Name' }))
        .returning();

      const res = await app.request(`/api/skills/${created!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.name).toBe('Updated Name');
    });

    test('updates skill content', async () => {
      const [created] = await containers.db
        .insert(schema.skills)
        .values(createTestSkillInput({ content: 'Original content' }))
        .returning();

      const res = await app.request(`/api/skills/${created!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated content with {{variable}}' }),
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.content).toBe('Updated content with {{variable}}');
    });

    test('updates skill tags', async () => {
      const [created] = await containers.db
        .insert(schema.skills)
        .values(createTestSkillInput({ tags: ['old-tag'] }))
        .returning();

      const res = await app.request(`/api/skills/${created!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['new-tag-1', 'new-tag-2'] }),
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.data.tags).toContain('new-tag-1');
      expect(json.data.tags).not.toContain('old-tag');
    });

    test('returns 404 for non-existent skill', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/api/skills/${fakeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/skills/:id', () => {
    test('deletes skill', async () => {
      const [created] = await containers.db
        .insert(schema.skills)
        .values(createTestSkillInput())
        .returning();

      const res = await app.request(`/api/skills/${created!.id}`, {
        method: 'DELETE',
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      // Verify deleted from database
      const dbSkill = await containers.db.query.skills.findFirst({
        where: eq(schema.skills.id, created!.id),
      });
      expect(dbSkill).toBeUndefined();
    });

    test('returns 404 for non-existent skill', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/api/skills/${fakeId}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/skills/import', () => {
    test('imports skill', async () => {
      const importData = {
        version: '1.0',
        skill: {
          name: 'Imported Skill',
          description: 'An imported skill',
          type: 'prompt',
          content: 'You are a helpful assistant',
          tags: ['imported'],
          parameters: null,
        },
      };

      const res = await app.request('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importData),
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(201);
      expect(json.data.name).toBe('Imported Skill');
      expect(json.data.source).toBe('imported');
    });

    test('imports skill with parameters', async () => {
      const importData = {
        version: '1.0',
        skill: {
          name: 'Parameterized Import',
          description: 'A skill with parameters',
          type: 'prompt',
          content: 'You are a {{role}}',
          tags: [],
          parameters: [{ name: 'role', type: 'string', description: 'Role', required: true }],
        },
      };

      const res = await app.request('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importData),
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(201);
      expect(json.data.parameters.length).toBe(1);
    });
  });

  describe('GET /api/skills/:id/export', () => {
    test('exports skill', async () => {
      const [created] = await containers.db
        .insert(schema.skills)
        .values(
          createTestSkillInput({
            name: 'Export Test Skill',
            description: 'A skill to export',
          })
        )
        .returning();

      const res = await app.request(`/api/skills/${created!.id}/export`);
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.version).toBe('1.0');
      expect(json.skill.name).toBe('Export Test Skill');
      expect(json.skill.description).toBe('A skill to export');
    });

    test('export does not include id or timestamps', async () => {
      const [created] = await containers.db
        .insert(schema.skills)
        .values(createTestSkillInput())
        .returning();

      const res = await app.request(`/api/skills/${created!.id}/export`);
      const json = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(json.skill.id).toBeUndefined();
      expect(json.skill.createdAt).toBeUndefined();
      expect(json.skill.updatedAt).toBeUndefined();
    });

    test('returns 404 for non-existent skill', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/api/skills/${fakeId}/export`);

      expect(res.status).toBe(404);
    });
  });

  describe('Import/Export roundtrip', () => {
    test('exported skill can be re-imported', async () => {
      // Create original skill
      const [original] = await containers.db
        .insert(schema.skills)
        .values(
          createTestSkillInput({
            name: 'Roundtrip Skill',
            content: 'Test content {{param}}',
            parameters: [{ name: 'param', type: 'string', description: 'A param', required: true }],
          })
        )
        .returning();

      // Export
      const exportRes = await app.request(`/api/skills/${original?.id}/export`);
      const exportData = await exportRes.json();

      // Import
      const importRes = await app.request('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportData),
      });
      const importedJson = (await importRes.json()) as any;

      expect(importRes.status).toBe(201);
      expect(importedJson.data.name).toBe(original?.name);
      expect(importedJson.data.content).toBe(original?.content);
      expect(importedJson.data.source).toBe('imported'); // Source changed
    });
  });
});

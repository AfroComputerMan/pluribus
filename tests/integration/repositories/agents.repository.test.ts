import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import * as schema from '@/db/schema';
import { NotFoundError } from '@/lib/errors';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createTestAgentInput } from '../../setup/fixtures';
import { startPostgresContainer } from '../../setup/testcontainers';

/**
 * Integration tests for AgentRepository using testcontainers
 */
describe('AgentRepository Integration', () => {
  let container: Awaited<ReturnType<typeof startPostgresContainer>>;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  // Create repository instance with test db
  class TestAgentRepository {
    async findById(id: string) {
      const result = await db.query.agents.findFirst({
        where: eq(schema.agents.id, id),
      });

      if (!result) {
        throw new NotFoundError('Agent', id);
      }

      return result;
    }

    async findAll(filter?: { tags?: string[]; search?: string; limit?: number; offset?: number }) {
      const conditions = [];

      if (filter?.tags?.length) {
        conditions.push(sql`${schema.agents.tags} @> ${filter.tags}`);
      }

      if (filter?.search) {
        conditions.push(
          sql`(${schema.agents.name} ILIKE ${`%${filter.search}%`} OR ${schema.agents.description} ILIKE ${`%${filter.search}%`})`
        );
      }

      let query = db.select().from(schema.agents).orderBy(sql`${schema.agents.updatedAt} DESC`);

      if (conditions.length > 0) {
        query = query.where(sql`${conditions.join(' AND ')}`);
      }

      if (filter?.limit) {
        query = query.limit(filter.limit);
      }

      if (filter?.offset) {
        query = query.offset(filter.offset);
      }

      return query;
    }

    async create(
      input: Parameters<typeof db.insert>[0] extends { values: (infer V)[] } ? V : never
    ) {
      const [result] = await db.insert(schema.agents).values(input).returning();
      if (!result) throw new Error('Insert failed');
      return result;
    }

    async update(id: string, input: Partial<typeof schema.agents.$inferInsert>) {
      const [result] = await db
        .update(schema.agents)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(schema.agents.id, id))
        .returning();

      if (!result) {
        throw new NotFoundError('Agent', id);
      }

      return result;
    }

    async delete(id: string) {
      const result = await db.delete(schema.agents).where(eq(schema.agents.id, id)).returning();

      if (result.length === 0) {
        throw new NotFoundError('Agent', id);
      }

      return true;
    }

    async countByTags(): Promise<Record<string, number>> {
      const result = await db.execute<{ tag: string; count: string }>(sql`
        SELECT unnest(tags) as tag, COUNT(*) as count
        FROM ${schema.agents}
        GROUP BY tag
        ORDER BY count DESC
      `);

      return Object.fromEntries(
        result.rows.map((row) => [row.tag, Number.parseInt(row.count, 10)])
      );
    }

    async getAllTags(): Promise<string[]> {
      const result = await db.execute<{ tag: string }>(sql`
        SELECT DISTINCT unnest(tags) as tag
        FROM ${schema.agents}
        ORDER BY tag
      `);

      return result.rows.map((row) => row.tag);
    }
  }

  let repository: TestAgentRepository;

  beforeAll(async () => {
    container = await startPostgresContainer();
    client = postgres(container.connectionString, { max: 5 });
    db = drizzle(client, { schema });

    // Run migrations
    await migrate(db, { migrationsFolder: './drizzle/migrations' });

    repository = new TestAgentRepository();
  }, 60000);

  afterAll(async () => {
    await client.end();
    await container.cleanup();
  });

  beforeEach(async () => {
    // Clean up agents table before each test
    await db.delete(schema.agents);
  });

  describe('create', () => {
    test('creates agent with all fields', async () => {
      const input = createTestAgentInput();
      const agent = await repository.create(input);

      expect(agent.id).toBeDefined();
      expect(agent.name).toBe(input.name);
      expect(agent.description).toBe(input.description);
      expect(agent.tags).toEqual(input.tags);
      expect(agent.modelConfig).toEqual(input.modelConfig);
      expect(agent.createdAt).toBeInstanceOf(Date);
      expect(agent.updatedAt).toBeInstanceOf(Date);
    });

    test('generates UUID for id', async () => {
      const agent = await repository.create(createTestAgentInput());

      expect(agent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('creates agent with minimal fields', async () => {
      const input = createTestAgentInput({
        description: null,
        tags: [],
        skills: [],
        allowedMcpTools: [],
      });

      const agent = await repository.create(input);

      expect(agent.description).toBeNull();
      expect(agent.tags).toEqual([]);
    });
  });

  describe('findById', () => {
    test('returns agent by id', async () => {
      const created = await repository.create(createTestAgentInput());
      const found = await repository.findById(created.id);

      expect(found.id).toBe(created.id);
      expect(found.name).toBe(created.name);
    });

    test('throws NotFoundError for non-existent id', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await expect(repository.findById(fakeId)).rejects.toThrow(NotFoundError);
      await expect(repository.findById(fakeId)).rejects.toThrow(
        `Agent with id '${fakeId}' not found`
      );
    });
  });

  describe('findAll', () => {
    test('returns all agents', async () => {
      await repository.create(createTestAgentInput({ name: 'Agent 1' }));
      await repository.create(createTestAgentInput({ name: 'Agent 2' }));
      await repository.create(createTestAgentInput({ name: 'Agent 3' }));

      const agents = await repository.findAll();

      expect(agents.length).toBe(3);
    });

    test('returns empty array when no agents exist', async () => {
      const agents = await repository.findAll();

      expect(agents).toEqual([]);
    });

    test('applies limit', async () => {
      for (let i = 0; i < 5; i++) {
        await repository.create(createTestAgentInput({ name: `Agent ${i}` }));
      }

      const agents = await repository.findAll({ limit: 2 });

      expect(agents.length).toBe(2);
    });

    test('applies offset', async () => {
      const created = [];
      for (let i = 0; i < 5; i++) {
        created.push(await repository.create(createTestAgentInput({ name: `Agent ${i}` })));
      }

      const agents = await repository.findAll({ limit: 2, offset: 2 });

      expect(agents.length).toBe(2);
    });
  });

  describe('update', () => {
    test('updates agent fields', async () => {
      const created = await repository.create(createTestAgentInput());
      const updated = await repository.update(created.id, {
        name: 'Updated Name',
        description: 'Updated description',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('Updated description');
      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    });

    test('throws NotFoundError for non-existent id', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await expect(repository.update(fakeId, { name: 'Test' })).rejects.toThrow(NotFoundError);
    });

    test('preserves unchanged fields', async () => {
      const created = await repository.create(
        createTestAgentInput({
          name: 'Original Name',
          description: 'Original description',
        })
      );

      const updated = await repository.update(created.id, {
        name: 'Updated Name',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('Original description');
    });
  });

  describe('delete', () => {
    test('deletes agent', async () => {
      const created = await repository.create(createTestAgentInput());
      await repository.delete(created.id);

      await expect(repository.findById(created.id)).rejects.toThrow(NotFoundError);
    });

    test('throws NotFoundError for non-existent id', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await expect(repository.delete(fakeId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('countByTags', () => {
    test('returns tag counts', async () => {
      await repository.create(createTestAgentInput({ tags: ['coding', 'analysis'] }));
      await repository.create(createTestAgentInput({ tags: ['coding', 'research'] }));
      await repository.create(createTestAgentInput({ tags: ['analysis'] }));

      const counts = await repository.countByTags();

      expect(counts.coding).toBe(2);
      expect(counts.analysis).toBe(2);
      expect(counts.research).toBe(1);
    });

    test('returns empty object when no agents', async () => {
      const counts = await repository.countByTags();

      expect(counts).toEqual({});
    });
  });

  describe('getAllTags', () => {
    test('returns unique tags sorted', async () => {
      await repository.create(createTestAgentInput({ tags: ['zebra', 'apple'] }));
      await repository.create(createTestAgentInput({ tags: ['banana', 'apple'] }));

      const tags = await repository.getAllTags();

      expect(tags).toEqual(['apple', 'banana', 'zebra']);
    });

    test('returns empty array when no tags', async () => {
      await repository.create(createTestAgentInput({ tags: [] }));

      const tags = await repository.getAllTags();

      expect(tags).toEqual([]);
    });
  });
});

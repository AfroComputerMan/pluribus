import { and, desc, eq, ilike, sql } from 'drizzle-orm';

import { db } from '@/db';
import { agents } from '@/db/schema';
import { NotFoundError } from '@/lib/errors';
import type { AgentFilter, CreateAgentInput, UpdateAgentInput } from './types';

export class AgentRepository {
  async findById(id: string) {
    const result = await db.query.agents.findFirst({
      where: eq(agents.id, id),
    });

    if (!result) {
      throw new NotFoundError('Agent', id);
    }

    return result;
  }

  async findAll(filter?: AgentFilter & { limit?: number; offset?: number }) {
    const conditions = [];

    if (filter?.tags?.length) {
      // Match agents that have ALL specified tags
      conditions.push(sql`${agents.tags} @> ${filter.tags}`);
    }

    if (filter?.integration) {
      conditions.push(sql`${agents.integration}->>'type' = ${filter.integration}`);
    }

    if (filter?.memoryMode) {
      conditions.push(eq(agents.memoryMode, filter.memoryMode));
    }

    if (filter?.isolationLevel) {
      conditions.push(eq(agents.isolationLevel, filter.isolationLevel));
    }

    if (filter?.search) {
      conditions.push(
        sql`(${ilike(agents.name, `%${filter.search}%`)} OR ${ilike(agents.description, `%${filter.search}%`)})`
      );
    }

    const query = db
      .select()
      .from(agents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(agents.updatedAt));

    if (filter?.limit) {
      query.limit(filter.limit);
    }

    if (filter?.offset) {
      query.offset(filter.offset);
    }

    return query;
  }

  async create(input: CreateAgentInput) {
    const [result] = await db.insert(agents).values(input).returning();
    if (!result) {
      throw new Error('Insert failed to return created agent');
    }
    return result;
  }

  async update(id: string, input: UpdateAgentInput) {
    const [result] = await db
      .update(agents)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, id))
      .returning();

    if (!result) {
      throw new NotFoundError('Agent', id);
    }

    return result;
  }

  async delete(id: string) {
    const result = await db.delete(agents).where(eq(agents.id, id)).returning();

    if (result.length === 0) {
      throw new NotFoundError('Agent', id);
    }

    return true;
  }

  async countByTags(): Promise<Record<string, number>> {
    const result = await db.execute<{ tag: string; count: string }>(sql`
      SELECT unnest(tags) as tag, COUNT(*) as count
      FROM ${agents}
      GROUP BY tag
      ORDER BY count DESC
    `);

    return Object.fromEntries(result.rows.map((row) => [row.tag, Number.parseInt(row.count, 10)]));
  }

  async getAllTags(): Promise<string[]> {
    const result = await db.execute<{ tag: string }>(sql`
      SELECT DISTINCT unnest(tags) as tag
      FROM ${agents}
      ORDER BY tag
    `);

    return result.rows.map((row) => row.tag);
  }
}

export const agentRepository = new AgentRepository();

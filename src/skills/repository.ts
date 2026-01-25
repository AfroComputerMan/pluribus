import { and, desc, eq, ilike, sql } from 'drizzle-orm';

import { db } from '@/db';
import { skills } from '@/db/schema';
import { NotFoundError } from '@/lib/errors';
import type {
  CreateSkillInput,
  Skill,
  SkillFilter,
  UpdateSkillInput,
} from './types';

export class SkillRepository {
  async findById(id: string): Promise<Skill | null> {
    const result = await db.query.skills.findFirst({
      where: eq(skills.id, id),
    });

    return result as Skill | null;
  }

  async findAll(filter?: SkillFilter): Promise<Skill[]> {
    const conditions = [];

    if (filter?.tags?.length) {
      // Match skills that have ALL specified tags
      conditions.push(sql`${skills.tags} @> ${filter.tags}`);
    }

    if (filter?.type) {
      conditions.push(eq(skills.type, filter.type));
    }

    if (filter?.source) {
      conditions.push(eq(skills.source, filter.source));
    }

    if (filter?.search) {
      conditions.push(
        sql`(${ilike(skills.name, `%${filter.search}%`)} OR ${ilike(skills.description, `%${filter.search}%`)})`
      );
    }

    const query = db
      .select()
      .from(skills)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(skills.updatedAt));

    if (filter?.limit) {
      query.limit(filter.limit);
    }

    if (filter?.offset) {
      query.offset(filter.offset);
    }

    return query as Promise<Skill[]>;
  }

  async findByTags(tags: string[]): Promise<Skill[]> {
    if (tags.length === 0) {
      return [];
    }

    // Find skills that have ANY of the specified tags
    const results = await db
      .select()
      .from(skills)
      .where(sql`${skills.tags} && ${tags}`)
      .orderBy(desc(skills.updatedAt));

    return results as Skill[];
  }

  async create(input: CreateSkillInput): Promise<Skill> {
    const [result] = await db.insert(skills).values(input).returning();
    if (!result) {
      throw new Error('Insert failed to return created skill');
    }
    return result as Skill;
  }

  async update(id: string, input: UpdateSkillInput): Promise<Skill> {
    const [result] = await db
      .update(skills)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(skills.id, id))
      .returning();

    if (!result) {
      throw new NotFoundError('Skill', id);
    }

    return result as Skill;
  }

  async delete(id: string): Promise<void> {
    const result = await db.delete(skills).where(eq(skills.id, id)).returning();

    if (result.length === 0) {
      throw new NotFoundError('Skill', id);
    }
  }

  async getAllTags(): Promise<string[]> {
    const result = await db.execute<{ tag: string }>(sql`
      SELECT DISTINCT unnest(tags) as tag
      FROM ${skills}
      ORDER BY tag
    `);

    return result.map((row) => row.tag);
  }

  async countByTags(): Promise<Record<string, number>> {
    const result = await db.execute<{ tag: string; count: string }>(sql`
      SELECT unnest(tags) as tag, COUNT(*) as count
      FROM ${skills}
      GROUP BY tag
      ORDER BY count DESC
    `);

    return Object.fromEntries(result.map((row) => [row.tag, Number.parseInt(row.count, 10)]));
  }

  async findByName(name: string): Promise<Skill | null> {
    const result = await db.query.skills.findFirst({
      where: eq(skills.name, name),
    });

    return result as Skill | null;
  }
}

export const skillRepository = new SkillRepository();

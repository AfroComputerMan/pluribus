import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import { db } from '@/db';
import { skills } from '@/db/schema';
import { NotFoundError } from '@/lib/errors';
import {
  createSkillSchema,
  skillFilterSchema,
  skillImportSchema,
  updateSkillSchema,
} from '@/skills';
import { getValidatedBody, getValidatedQuery, validateBody, validateQuery } from '../middleware';

const skillRoutes = new Hono();

// GET /api/skills - List skills
skillRoutes.get('/', validateQuery(skillFilterSchema), async (c) => {
  const filter = getValidatedQuery<z.infer<typeof skillFilterSchema>>(c);

  const conditions = [];
  if (filter.tags?.length) {
    conditions.push(sql`${skills.tags} @> ${filter.tags}`);
  }
  if (filter.type) {
    conditions.push(eq(skills.type, filter.type));
  }
  if (filter.source) {
    conditions.push(eq(skills.source, filter.source));
  }
  if (filter.search) {
    conditions.push(
      sql`(${ilike(skills.name, `%${filter.search}%`)} OR ${ilike(skills.description, `%${filter.search}%`)})`
    );
  }

  const items = await db
    .select()
    .from(skills)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(filter.limit)
    .offset(filter.offset)
    .orderBy(desc(skills.updatedAt));

  return c.json({
    data: items,
    meta: {
      limit: filter.limit,
      offset: filter.offset,
    },
  });
});

// GET /api/skills/:id - Get skill by ID
skillRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');

  const skill = await db.query.skills.findFirst({
    where: eq(skills.id, id),
  });

  if (!skill) {
    throw new NotFoundError('Skill', id);
  }

  return c.json({ data: skill });
});

// POST /api/skills - Create skill
skillRoutes.post('/', validateBody(createSkillSchema), async (c) => {
  const input = getValidatedBody<z.infer<typeof createSkillSchema>>(c);

  const [skill] = await db.insert(skills).values(input).returning();

  return c.json({ data: skill }, 201);
});

// PUT /api/skills/:id - Update skill
skillRoutes.put('/:id', validateBody(updateSkillSchema), async (c) => {
  const id = c.req.param('id');
  const input = getValidatedBody<z.infer<typeof updateSkillSchema>>(c);

  const [skill] = await db
    .update(skills)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(skills.id, id))
    .returning();

  if (!skill) {
    throw new NotFoundError('Skill', id);
  }

  return c.json({ data: skill });
});

// DELETE /api/skills/:id - Delete skill
skillRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const result = await db.delete(skills).where(eq(skills.id, id)).returning();

  if (result.length === 0) {
    throw new NotFoundError('Skill', id);
  }

  return c.json({ success: true });
});

// POST /api/skills/import - Import skill from file
skillRoutes.post('/import', validateBody(skillImportSchema), async (c) => {
  const { skill: skillData } = getValidatedBody<z.infer<typeof skillImportSchema>>(c);

  const [skill] = await db
    .insert(skills)
    .values({
      ...skillData,
      source: 'imported',
    })
    .returning();

  return c.json({ data: skill }, 201);
});

// GET /api/skills/:id/export - Export skill
skillRoutes.get('/:id/export', async (c) => {
  const id = c.req.param('id');

  const skill = await db.query.skills.findFirst({
    where: eq(skills.id, id),
  });

  if (!skill) {
    throw new NotFoundError('Skill', id);
  }

  const exportData = {
    version: '1.0' as const,
    skill: {
      name: skill.name,
      description: skill.description,
      type: skill.type,
      content: skill.content,
      tags: skill.tags,
      parameters: skill.parameters,
    },
  };

  c.header('Content-Disposition', `attachment; filename="${skill.name}.json"`);
  return c.json(exportData);
});

export { skillRoutes };

import { describe, expect, test } from 'bun:test';
import {
  skillParameterSchema,
  skillSchema,
  createSkillSchema,
  updateSkillSchema,
  skillFilterSchema,
  skillImportSchema,
} from '@/skills/schemas';

describe('skillParameterSchema', () => {
  test('accepts valid string parameter', () => {
    const result = skillParameterSchema.safeParse({
      name: 'task',
      type: 'string',
      description: 'The task to perform',
      required: true,
    });
    expect(result.success).toBe(true);
  });

  test('accepts valid number parameter', () => {
    const result = skillParameterSchema.safeParse({
      name: 'count',
      type: 'number',
      description: 'Number of items',
      required: false,
      default: 10,
    });
    expect(result.success).toBe(true);
  });

  test('accepts valid boolean parameter', () => {
    const result = skillParameterSchema.safeParse({
      name: 'verbose',
      type: 'boolean',
      description: 'Enable verbose output',
      required: false,
      default: false,
    });
    expect(result.success).toBe(true);
  });

  test('accepts valid select parameter with options', () => {
    const result = skillParameterSchema.safeParse({
      name: 'format',
      type: 'select',
      description: 'Output format',
      required: true,
      options: ['json', 'xml', 'csv'],
    });
    expect(result.success).toBe(true);
  });

  test('defaults required to true', () => {
    const result = skillParameterSchema.safeParse({
      name: 'task',
      type: 'string',
      description: 'The task',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.required).toBe(true);
    }
  });

  test('rejects empty name', () => {
    const result = skillParameterSchema.safeParse({
      name: '',
      type: 'string',
      description: 'The task',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid type', () => {
    const result = skillParameterSchema.safeParse({
      name: 'task',
      type: 'invalid',
      description: 'The task',
    });
    expect(result.success).toBe(false);
  });
});

describe('skillSchema', () => {
  const validSkill = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Code Review',
    description: 'Reviews code for quality and best practices',
    type: 'prompt' as const,
    content: 'You are a code reviewer. Please review the following code:\n\n{{code}}',
    tags: ['code', 'review'],
    source: 'user' as const,
    parameters: [
      {
        name: 'code',
        type: 'string' as const,
        description: 'The code to review',
        required: true,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  test('accepts valid skill', () => {
    const result = skillSchema.safeParse(validSkill);
    expect(result.success).toBe(true);
  });

  test('accepts all skill types', () => {
    const types = ['prompt', 'behavior', 'workflow-template'] as const;
    for (const type of types) {
      const result = skillSchema.safeParse({ ...validSkill, type });
      expect(result.success).toBe(true);
    }
  });

  test('accepts all source types', () => {
    const sources = ['user', 'imported', 'builtin'] as const;
    for (const source of sources) {
      const result = skillSchema.safeParse({ ...validSkill, source });
      expect(result.success).toBe(true);
    }
  });

  test('accepts null description', () => {
    const result = skillSchema.safeParse({
      ...validSkill,
      description: null,
    });
    expect(result.success).toBe(true);
  });

  test('accepts null parameters', () => {
    const result = skillSchema.safeParse({
      ...validSkill,
      parameters: null,
    });
    expect(result.success).toBe(true);
  });

  test('accepts empty tags', () => {
    const result = skillSchema.safeParse({
      ...validSkill,
      tags: [],
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty name', () => {
    const result = skillSchema.safeParse({
      ...validSkill,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects name over 255 chars', () => {
    const result = skillSchema.safeParse({
      ...validSkill,
      name: 'x'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty content', () => {
    const result = skillSchema.safeParse({
      ...validSkill,
      content: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid skill type', () => {
    const result = skillSchema.safeParse({
      ...validSkill,
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid source', () => {
    const result = skillSchema.safeParse({
      ...validSkill,
      source: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('createSkillSchema', () => {
  const validCreate = {
    name: 'New Skill',
    description: 'A new skill template',
    type: 'prompt' as const,
    content: 'You are a helpful assistant that {{task}}',
    tags: ['helper'],
    source: 'user' as const,
    parameters: [
      {
        name: 'task',
        type: 'string' as const,
        description: 'The task to perform',
        required: true,
      },
    ],
  };

  test('accepts valid create input', () => {
    const result = createSkillSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  test('does not require id', () => {
    const result = createSkillSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('id' in result.data).toBe(false);
    }
  });

  test('does not require timestamps', () => {
    const result = createSkillSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('createdAt' in result.data).toBe(false);
      expect('updatedAt' in result.data).toBe(false);
    }
  });

  test('defaults tags to empty array', () => {
    const { tags: _, ...withoutTags } = validCreate;
    const result = createSkillSchema.safeParse(withoutTags);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
    }
  });

  test('defaults source to user', () => {
    const { source: _, ...withoutSource } = validCreate;
    const result = createSkillSchema.safeParse(withoutSource);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('user');
    }
  });

  test('rejects missing required fields', () => {
    const result = createSkillSchema.safeParse({
      name: 'Test',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateSkillSchema', () => {
  test('all fields are optional', () => {
    const result = updateSkillSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('accepts partial update', () => {
    const result = updateSkillSchema.safeParse({
      name: 'Updated Skill',
      description: 'Updated description',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Skill');
      expect(result.data.content).toBeUndefined();
    }
  });

  test('accepts content update', () => {
    const result = updateSkillSchema.safeParse({
      content: 'New content template {{param}}',
    });
    expect(result.success).toBe(true);
  });

  test('accepts tags update', () => {
    const result = updateSkillSchema.safeParse({
      tags: ['new-tag', 'updated'],
    });
    expect(result.success).toBe(true);
  });

  test('validates fields when provided', () => {
    const result = updateSkillSchema.safeParse({
      name: '', // Empty name should fail
    });
    expect(result.success).toBe(false);
  });

  test('validates type when provided', () => {
    const result = updateSkillSchema.safeParse({
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('skillFilterSchema', () => {
  test('applies defaults', () => {
    const result = skillFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  test('coerces string numbers', () => {
    const result = skillFilterSchema.safeParse({
      limit: '25',
      offset: '10',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.offset).toBe(10);
    }
  });

  test('accepts tags filter', () => {
    const result = skillFilterSchema.safeParse({
      tags: ['code', 'review'],
    });
    expect(result.success).toBe(true);
  });

  test('accepts type filter', () => {
    const result = skillFilterSchema.safeParse({
      type: 'prompt',
    });
    expect(result.success).toBe(true);
  });

  test('accepts source filter', () => {
    const result = skillFilterSchema.safeParse({
      source: 'builtin',
    });
    expect(result.success).toBe(true);
  });

  test('accepts search filter', () => {
    const result = skillFilterSchema.safeParse({
      search: 'code review',
    });
    expect(result.success).toBe(true);
  });

  test('accepts combined filters', () => {
    const result = skillFilterSchema.safeParse({
      tags: ['code'],
      type: 'prompt',
      source: 'user',
      search: 'review',
      limit: 10,
      offset: 0,
    });
    expect(result.success).toBe(true);
  });

  test('enforces limit bounds', () => {
    const tooHigh = skillFilterSchema.safeParse({ limit: 101 });
    const tooLow = skillFilterSchema.safeParse({ limit: 0 });
    expect(tooHigh.success).toBe(false);
    expect(tooLow.success).toBe(false);
  });

  test('rejects negative offset', () => {
    const result = skillFilterSchema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });

  test('rejects invalid type filter', () => {
    const result = skillFilterSchema.safeParse({
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid source filter', () => {
    const result = skillFilterSchema.safeParse({
      source: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('skillImportSchema', () => {
  const validImport = {
    version: '1.0' as const,
    skill: {
      name: 'Imported Skill',
      description: 'An imported skill template',
      type: 'prompt' as const,
      content: 'You are a helpful assistant that {{task}}',
      tags: ['imported'],
      parameters: [
        {
          name: 'task',
          type: 'string' as const,
          description: 'The task to perform',
          required: true,
        },
      ],
    },
  };

  test('accepts valid import', () => {
    const result = skillImportSchema.safeParse(validImport);
    expect(result.success).toBe(true);
  });

  test('requires version 1.0', () => {
    const result = skillImportSchema.safeParse({
      ...validImport,
      version: '2.0',
    });
    expect(result.success).toBe(false);
  });

  test('requires skill object', () => {
    const result = skillImportSchema.safeParse({
      version: '1.0',
    });
    expect(result.success).toBe(false);
  });

  test('validates skill content', () => {
    const result = skillImportSchema.safeParse({
      version: '1.0',
      skill: {
        name: 'Test',
        description: null,
        type: 'prompt',
        content: '', // Empty content should fail
        tags: [],
      },
    });
    expect(result.success).toBe(false);
  });

  test('accepts skill without parameters', () => {
    const { parameters: _, ...skillWithoutParams } = validImport.skill;
    const result = skillImportSchema.safeParse({
      version: '1.0',
      skill: skillWithoutParams,
    });
    expect(result.success).toBe(true);
  });

  test('defaults tags to empty array', () => {
    const { tags: _, ...skillWithoutTags } = validImport.skill;
    const result = skillImportSchema.safeParse({
      version: '1.0',
      skill: skillWithoutTags,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skill.tags).toEqual([]);
    }
  });
});

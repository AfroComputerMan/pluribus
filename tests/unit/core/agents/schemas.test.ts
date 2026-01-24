import { describe, expect, test } from 'bun:test';
import {
  modelConfigSchema,
  integrationSchema,
  agentSchema,
  createAgentSchema,
  updateAgentSchema,
  agentFilterSchema,
} from '@/core/agents/schemas';

describe('modelConfigSchema', () => {
  test('accepts valid anthropic config', () => {
    const result = modelConfigSchema.safeParse({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      parameters: { temperature: 0.7 },
    });

    expect(result.success).toBe(true);
  });

  test('accepts valid openai config', () => {
    const result = modelConfigSchema.safeParse({
      provider: 'openai',
      model: 'gpt-4',
    });

    expect(result.success).toBe(true);
  });

  test('accepts custom provider', () => {
    const result = modelConfigSchema.safeParse({
      provider: 'custom',
      model: 'my-custom-model',
    });

    expect(result.success).toBe(true);
  });

  test('rejects invalid provider', () => {
    const result = modelConfigSchema.safeParse({
      provider: 'invalid',
      model: 'test',
    });

    expect(result.success).toBe(false);
  });

  test('rejects empty model', () => {
    const result = modelConfigSchema.safeParse({
      provider: 'anthropic',
      model: '',
    });

    expect(result.success).toBe(false);
  });
});

describe('integrationSchema', () => {
  test('accepts valid integration', () => {
    const result = integrationSchema.safeParse({
      type: 'claude-code',
      connectionId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(result.success).toBe(true);
  });

  test('accepts null', () => {
    const result = integrationSchema.safeParse(null);

    expect(result.success).toBe(true);
  });

  test('rejects invalid UUID', () => {
    const result = integrationSchema.safeParse({
      type: 'claude-code',
      connectionId: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
  });

  test('rejects invalid integration type', () => {
    const result = integrationSchema.safeParse({
      type: 'invalid-type',
      connectionId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(result.success).toBe(false);
  });
});

describe('createAgentSchema', () => {
  const validAgent = {
    name: 'Test Agent',
    description: 'A test agent',
    tags: ['test'],
    modelConfig: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
    },
    memoryMode: 'stateless',
    isolationLevel: 'shared',
    canSpawnSubAgents: false,
    maxSubAgents: null,
    skills: [],
    allowedMcpTools: [],
    integration: null,
  };

  test('accepts valid agent input', () => {
    const result = createAgentSchema.safeParse(validAgent);

    expect(result.success).toBe(true);
  });

  test('applies defaults for optional fields', () => {
    const minimal = {
      name: 'Minimal Agent',
      description: null,
      modelConfig: {
        provider: 'openai',
        model: 'gpt-4',
      },
      maxSubAgents: null,
      integration: null,
    };

    const result = createAgentSchema.safeParse(minimal);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
      expect(result.data.memoryMode).toBe('stateless');
      expect(result.data.isolationLevel).toBe('shared');
      expect(result.data.canSpawnSubAgents).toBe(false);
      expect(result.data.skills).toEqual([]);
      expect(result.data.allowedMcpTools).toEqual([]);
    }
  });

  test('rejects empty name', () => {
    const result = createAgentSchema.safeParse({
      ...validAgent,
      name: '',
    });

    expect(result.success).toBe(false);
  });

  test('rejects name over 255 chars', () => {
    const result = createAgentSchema.safeParse({
      ...validAgent,
      name: 'x'.repeat(256),
    });

    expect(result.success).toBe(false);
  });

  test('rejects invalid memory mode', () => {
    const result = createAgentSchema.safeParse({
      ...validAgent,
      memoryMode: 'invalid',
    });

    expect(result.success).toBe(false);
  });

  test('rejects invalid isolation level', () => {
    const result = createAgentSchema.safeParse({
      ...validAgent,
      isolationLevel: 'invalid',
    });

    expect(result.success).toBe(false);
  });
});

describe('updateAgentSchema', () => {
  test('all fields are optional', () => {
    const result = updateAgentSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  test('accepts partial updates', () => {
    const result = updateAgentSchema.safeParse({
      name: 'Updated Name',
      tags: ['new-tag'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Name');
      expect(result.data.tags).toEqual(['new-tag']);
      expect(result.data.description).toBeUndefined();
    }
  });

  test('validates fields when provided', () => {
    const result = updateAgentSchema.safeParse({
      memoryMode: 'invalid',
    });

    expect(result.success).toBe(false);
  });
});

describe('agentFilterSchema', () => {
  test('applies defaults', () => {
    const result = agentFilterSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  test('coerces string numbers', () => {
    const result = agentFilterSchema.safeParse({
      limit: '25',
      offset: '10',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.offset).toBe(10);
    }
  });

  test('enforces limit bounds', () => {
    const tooHigh = agentFilterSchema.safeParse({ limit: 101 });
    const tooLow = agentFilterSchema.safeParse({ limit: 0 });

    expect(tooHigh.success).toBe(false);
    expect(tooLow.success).toBe(false);
  });

  test('rejects negative offset', () => {
    const result = agentFilterSchema.safeParse({ offset: -1 });

    expect(result.success).toBe(false);
  });

  test('accepts valid filters', () => {
    const result = agentFilterSchema.safeParse({
      tags: ['test', 'dev'],
      integration: 'claude-code',
      memoryMode: 'session',
      isolationLevel: 'container',
      search: 'assistant',
      limit: 10,
      offset: 20,
    });

    expect(result.success).toBe(true);
  });
});

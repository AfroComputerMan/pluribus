/**
 * Node Configuration Schema Tests
 * TDD: Tests written before implementation
 */

import { describe, it, expect } from 'vitest';
import {
  agentNodeConfigSchema,
  conditionNodeConfigSchema,
  parallelNodeConfigSchema,
  loopNodeConfigSchema,
  humanReviewNodeConfigSchema,
  inputMappingSchema,
  resourceLimitsSchema,
  validateNodeConfig,
  type AgentNodeConfig,
  type ConditionNodeConfig,
  type ParallelNodeConfig,
  type LoopNodeConfig,
  type HumanReviewNodeConfig,
} from './nodeSchemas';

describe('inputMappingSchema', () => {
  it('accepts empty mapping', () => {
    const result = inputMappingSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts static string values', () => {
    const result = inputMappingSchema.safeParse({
      prompt: 'Hello world',
      context: 'Some context',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      prompt: 'Hello world',
      context: 'Some context',
    });
  });

  it('accepts node references with fromNode and path', () => {
    const result = inputMappingSchema.safeParse({
      input: { fromNode: 'node_1', path: 'output.result' },
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      input: { fromNode: 'node_1', path: 'output.result' },
    });
  });

  it('accepts mixed static and reference values', () => {
    const result = inputMappingSchema.safeParse({
      prompt: 'Analyze this:',
      data: { fromNode: 'agent_1', path: 'output' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects node reference missing fromNode', () => {
    const result = inputMappingSchema.safeParse({
      input: { path: 'output.result' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects node reference missing path', () => {
    const result = inputMappingSchema.safeParse({
      input: { fromNode: 'node_1' },
    });
    expect(result.success).toBe(false);
  });
});

describe('resourceLimitsSchema', () => {
  it('accepts valid resource limits', () => {
    const result = resourceLimitsSchema.safeParse({
      memoryMB: 512,
      cpuShares: 1024,
      timeoutSeconds: 300,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      memoryMB: 512,
      cpuShares: 1024,
      timeoutSeconds: 300,
    });
  });

  it('accepts partial resource limits', () => {
    const result = resourceLimitsSchema.safeParse({
      timeoutSeconds: 60,
    });
    expect(result.success).toBe(true);
    expect(result.data?.timeoutSeconds).toBe(60);
  });

  it('accepts empty resource limits (all optional)', () => {
    const result = resourceLimitsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects negative memory', () => {
    const result = resourceLimitsSchema.safeParse({
      memoryMB: -100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero timeout', () => {
    const result = resourceLimitsSchema.safeParse({
      timeoutSeconds: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects memory exceeding max (8GB)', () => {
    const result = resourceLimitsSchema.safeParse({
      memoryMB: 10000,
    });
    expect(result.success).toBe(false);
  });
});

describe('agentNodeConfigSchema', () => {
  it('accepts valid agent node config', () => {
    const config: AgentNodeConfig = {
      label: 'Code Writer',
      agentId: '123e4567-e89b-12d3-a456-426614174000',
      input: { prompt: 'Write code' },
      timeout: 300,
    };
    const result = agentNodeConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts minimal agent config (just agentId)', () => {
    const result = agentNodeConfigSchema.safeParse({
      agentId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing agentId', () => {
    const result = agentNodeConfigSchema.safeParse({
      label: 'Test Agent',
      input: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid agentId (not UUID)', () => {
    const result = agentNodeConfigSchema.safeParse({
      agentId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative timeout', () => {
    const result = agentNodeConfigSchema.safeParse({
      agentId: '123e4567-e89b-12d3-a456-426614174000',
      timeout: -1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts agent config with resource limits', () => {
    const result = agentNodeConfigSchema.safeParse({
      agentId: '123e4567-e89b-12d3-a456-426614174000',
      resourceLimits: {
        memoryMB: 1024,
        timeoutSeconds: 600,
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('conditionNodeConfigSchema', () => {
  it('accepts valid condition node config', () => {
    const config: ConditionNodeConfig = {
      label: 'Check Result',
      expression: 'output.success === true',
      trueBranch: 'node_success',
      falseBranch: 'node_failure',
    };
    const result = conditionNodeConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects missing expression', () => {
    const result = conditionNodeConfigSchema.safeParse({
      label: 'Check',
      trueBranch: 'node_1',
      falseBranch: 'node_2',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty expression', () => {
    const result = conditionNodeConfigSchema.safeParse({
      expression: '',
      trueBranch: 'node_1',
      falseBranch: 'node_2',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing trueBranch', () => {
    const result = conditionNodeConfigSchema.safeParse({
      expression: 'x > 0',
      falseBranch: 'node_2',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing falseBranch', () => {
    const result = conditionNodeConfigSchema.safeParse({
      expression: 'x > 0',
      trueBranch: 'node_1',
    });
    expect(result.success).toBe(false);
  });
});

describe('parallelNodeConfigSchema', () => {
  it('accepts valid parallel node config', () => {
    const config: ParallelNodeConfig = {
      label: 'Run in Parallel',
      branches: ['task_1', 'task_2', 'task_3'],
      joinStrategy: 'all',
    };
    const result = parallelNodeConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts joinStrategy "any"', () => {
    const result = parallelNodeConfigSchema.safeParse({
      branches: ['a', 'b'],
      joinStrategy: 'any',
    });
    expect(result.success).toBe(true);
  });

  it('accepts joinStrategy "race"', () => {
    const result = parallelNodeConfigSchema.safeParse({
      branches: ['a', 'b'],
      joinStrategy: 'race',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty branches array', () => {
    const result = parallelNodeConfigSchema.safeParse({
      branches: [],
      joinStrategy: 'all',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid joinStrategy', () => {
    const result = parallelNodeConfigSchema.safeParse({
      branches: ['a', 'b'],
      joinStrategy: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing joinStrategy', () => {
    const result = parallelNodeConfigSchema.safeParse({
      branches: ['a', 'b'],
    });
    expect(result.success).toBe(false);
  });
});

describe('loopNodeConfigSchema', () => {
  it('accepts valid loop node config', () => {
    const config: LoopNodeConfig = {
      label: 'Repeat Task',
      condition: 'count < 10',
      maxIterations: 100,
      body: 'task_node',
    };
    const result = loopNodeConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects missing condition', () => {
    const result = loopNodeConfigSchema.safeParse({
      maxIterations: 10,
      body: 'task',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing maxIterations', () => {
    const result = loopNodeConfigSchema.safeParse({
      condition: 'true',
      body: 'task',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing body', () => {
    const result = loopNodeConfigSchema.safeParse({
      condition: 'true',
      maxIterations: 10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero maxIterations', () => {
    const result = loopNodeConfigSchema.safeParse({
      condition: 'true',
      maxIterations: 0,
      body: 'task',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative maxIterations', () => {
    const result = loopNodeConfigSchema.safeParse({
      condition: 'true',
      maxIterations: -5,
      body: 'task',
    });
    expect(result.success).toBe(false);
  });

  it('rejects maxIterations exceeding limit (1000)', () => {
    const result = loopNodeConfigSchema.safeParse({
      condition: 'true',
      maxIterations: 5000,
      body: 'task',
    });
    expect(result.success).toBe(false);
  });
});

describe('humanReviewNodeConfigSchema', () => {
  it('accepts valid human review node config', () => {
    const config: HumanReviewNodeConfig = {
      label: 'Approve Release',
      prompt: 'Do you approve this deployment?',
      timeout: 3600,
      options: ['Approve', 'Reject', 'Request Changes'],
    };
    const result = humanReviewNodeConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts minimal config (just prompt)', () => {
    const result = humanReviewNodeConfigSchema.safeParse({
      prompt: 'Please review',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing prompt', () => {
    const result = humanReviewNodeConfigSchema.safeParse({
      timeout: 3600,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty prompt', () => {
    const result = humanReviewNodeConfigSchema.safeParse({
      prompt: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative timeout', () => {
    const result = humanReviewNodeConfigSchema.safeParse({
      prompt: 'Review',
      timeout: -100,
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty options array', () => {
    const result = humanReviewNodeConfigSchema.safeParse({
      prompt: 'Review',
      options: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('validateNodeConfig', () => {
  it('validates agent node correctly', () => {
    const result = validateNodeConfig('agent', {
      agentId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('validates condition node correctly', () => {
    const result = validateNodeConfig('condition', {
      expression: 'x > 0',
      trueBranch: 'a',
      falseBranch: 'b',
    });
    expect(result.success).toBe(true);
  });

  it('validates parallel node correctly', () => {
    const result = validateNodeConfig('parallel', {
      branches: ['a', 'b'],
      joinStrategy: 'all',
    });
    expect(result.success).toBe(true);
  });

  it('validates loop node correctly', () => {
    const result = validateNodeConfig('loop', {
      condition: 'true',
      maxIterations: 10,
      body: 'task',
    });
    expect(result.success).toBe(true);
  });

  it('validates human-review node correctly', () => {
    const result = validateNodeConfig('human-review', {
      prompt: 'Review this',
    });
    expect(result.success).toBe(true);
  });

  it('returns error for unknown node type', () => {
    // @ts-expect-error Testing invalid node type
    const result = validateNodeConfig('unknown', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it('returns validation errors with field paths', () => {
    const result = validateNodeConfig('agent', {
      agentId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toBeDefined();
      expect(result.errors.some((e) => e.path.includes('agentId'))).toBe(true);
    }
  });
});

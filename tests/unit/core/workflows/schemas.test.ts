import { describe, expect, test } from 'bun:test';
import {
  createWorkflowSchema,
  triggerRunSchema,
  updateWorkflowSchema,
  workflowFilterSchema,
  workflowRunFilterSchema,
  workflowRunSchema,
  workflowSchema,
} from '@/core/workflows/schemas';

describe('workflowSchema', () => {
  const validWorkflow = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Workflow',
    description: 'A test workflow',
    nodes: [
      {
        id: 'node-1',
        type: 'agent' as const,
        agentId: '550e8400-e29b-41d4-a716-446655440001',
        input: { task: 'analyze' },
      },
    ],
    edges: [],
    triggers: [{ type: 'manual' as const }],
    errorStrategy: {
      retries: 3,
      retryDelay: 5000,
      onFailure: 'stop' as const,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  test('accepts valid workflow', () => {
    const result = workflowSchema.safeParse(validWorkflow);
    expect(result.success).toBe(true);
  });

  test('rejects workflow without id', () => {
    const { id: _, ...withoutId } = validWorkflow;
    const result = workflowSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  test('rejects workflow with invalid uuid', () => {
    const result = workflowSchema.safeParse({
      ...validWorkflow,
      id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty name', () => {
    const result = workflowSchema.safeParse({
      ...validWorkflow,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects name over 255 chars', () => {
    const result = workflowSchema.safeParse({
      ...validWorkflow,
      name: 'x'.repeat(256),
    });
    expect(result.success).toBe(false);
  });
});

describe('workflow node schemas', () => {
  const baseInput = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Workflow',
    description: null,
    edges: [],
    triggers: [{ type: 'manual' as const }],
    errorStrategy: { retries: 0, retryDelay: 5000, onFailure: 'stop' as const },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  test('accepts agent node', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      nodes: [
        {
          id: 'node-1',
          type: 'agent',
          agentId: '550e8400-e29b-41d4-a716-446655440001',
          input: { task: 'analyze' },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('accepts agent node with timeout', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      nodes: [
        {
          id: 'node-1',
          type: 'agent',
          agentId: '550e8400-e29b-41d4-a716-446655440001',
          input: {},
          timeout: 30000,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('accepts condition node', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      nodes: [
        {
          id: 'cond-1',
          type: 'condition',
          expression: 'output.success === true',
          trueBranch: 'node-2',
          falseBranch: 'node-3',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('accepts parallel node', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      nodes: [
        {
          id: 'parallel-1',
          type: 'parallel',
          branches: ['branch-1', 'branch-2'],
          joinStrategy: 'all',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('accepts loop node', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      nodes: [
        {
          id: 'loop-1',
          type: 'loop',
          condition: 'iterations < 5',
          maxIterations: 10,
          body: 'loop-body',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('accepts human-review node', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      nodes: [
        {
          id: 'review-1',
          type: 'human-review',
          prompt: 'Please review this output',
          timeout: 86400000,
          options: ['approve', 'reject', 'modify'],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid node type', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      nodes: [
        {
          id: 'invalid-1',
          type: 'invalid',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test('accepts input mapping from other nodes', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      nodes: [
        {
          id: 'node-1',
          type: 'agent',
          agentId: '550e8400-e29b-41d4-a716-446655440001',
          input: {
            simpleValue: 'static string',
            fromOtherNode: { fromNode: 'previous-node', path: 'output.result' },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('workflow trigger schemas', () => {
  const baseInput = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Workflow',
    description: null,
    nodes: [],
    edges: [],
    errorStrategy: { retries: 0, retryDelay: 5000, onFailure: 'stop' as const },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  test('accepts manual trigger', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      triggers: [{ type: 'manual' }],
    });
    expect(result.success).toBe(true);
  });

  test('accepts schedule trigger', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      triggers: [{ type: 'schedule', cron: '0 0 * * *' }],
    });
    expect(result.success).toBe(true);
  });

  test('accepts webhook trigger', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      triggers: [{ type: 'webhook', secret: 'my-secret-token' }],
    });
    expect(result.success).toBe(true);
  });

  test('accepts api trigger', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      triggers: [{ type: 'api' }],
    });
    expect(result.success).toBe(true);
  });

  test('accepts multiple triggers', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      triggers: [{ type: 'manual' }, { type: 'schedule', cron: '0 0 * * *' }, { type: 'api' }],
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid trigger type', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      triggers: [{ type: 'invalid' }],
    });
    expect(result.success).toBe(false);
  });

  test('rejects schedule trigger without cron', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      triggers: [{ type: 'schedule' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('errorStrategySchema', () => {
  const baseInput = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Workflow',
    description: null,
    nodes: [],
    edges: [],
    triggers: [{ type: 'manual' as const }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  test('accepts valid error strategy', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      errorStrategy: {
        retries: 5,
        retryDelay: 10000,
        onFailure: 'continue',
      },
    });
    expect(result.success).toBe(true);
  });

  test('accepts error strategy with fallback node', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      errorStrategy: {
        retries: 3,
        retryDelay: 5000,
        fallbackNodeId: 'fallback-node',
        onFailure: 'stop',
      },
    });
    expect(result.success).toBe(true);
  });

  test('accepts human-review on failure', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      errorStrategy: {
        retries: 0,
        retryDelay: 0,
        onFailure: 'human-review',
      },
    });
    expect(result.success).toBe(true);
  });

  test('rejects negative retries', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      errorStrategy: {
        retries: -1,
        retryDelay: 5000,
        onFailure: 'stop',
      },
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid onFailure value', () => {
    const result = workflowSchema.safeParse({
      ...baseInput,
      errorStrategy: {
        retries: 0,
        retryDelay: 5000,
        onFailure: 'invalid',
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('createWorkflowSchema', () => {
  const validCreate = {
    name: 'New Workflow',
    description: 'A new workflow',
    nodes: [
      {
        id: 'node-1',
        type: 'agent' as const,
        agentId: '550e8400-e29b-41d4-a716-446655440001',
        input: {},
      },
    ],
    edges: [],
    triggers: [{ type: 'manual' as const }],
    errorStrategy: {
      retries: 3,
      retryDelay: 5000,
      onFailure: 'stop' as const,
    },
  };

  test('accepts valid create input', () => {
    const result = createWorkflowSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  test('does not require id', () => {
    const result = createWorkflowSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  test('does not require timestamps', () => {
    const result = createWorkflowSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  test('applies default triggers', () => {
    const { triggers: _, ...withoutTriggers } = validCreate;
    const result = createWorkflowSchema.safeParse(withoutTriggers);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.triggers).toEqual([{ type: 'manual' }]);
    }
  });

  test('rejects missing required fields', () => {
    const result = createWorkflowSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('updateWorkflowSchema', () => {
  test('all fields are optional', () => {
    const result = updateWorkflowSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('accepts partial update', () => {
    const result = updateWorkflowSchema.safeParse({
      name: 'Updated Workflow',
      description: 'Updated description',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Workflow');
      expect(result.data.nodes).toBeUndefined();
    }
  });

  test('validates fields when provided', () => {
    const result = updateWorkflowSchema.safeParse({
      name: '', // Empty name should fail
    });
    expect(result.success).toBe(false);
  });

  test('accepts node updates', () => {
    const result = updateWorkflowSchema.safeParse({
      nodes: [
        {
          id: 'new-node',
          type: 'agent',
          agentId: '550e8400-e29b-41d4-a716-446655440001',
          input: {},
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('workflowRunSchema', () => {
  const validRun = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    workflowId: '550e8400-e29b-41d4-a716-446655440001',
    status: 'running' as const,
    triggerType: 'manual' as const,
    input: { key: 'value' },
    output: null,
    error: null,
    startedAt: new Date(),
    completedAt: null,
    createdAt: new Date(),
  };

  test('accepts valid run', () => {
    const result = workflowRunSchema.safeParse(validRun);
    expect(result.success).toBe(true);
  });

  test('accepts all status values', () => {
    const statuses = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;
    for (const status of statuses) {
      const result = workflowRunSchema.safeParse({ ...validRun, status });
      expect(result.success).toBe(true);
    }
  });

  test('accepts all trigger types', () => {
    const triggers = ['manual', 'schedule', 'webhook', 'api'] as const;
    for (const triggerType of triggers) {
      const result = workflowRunSchema.safeParse({ ...validRun, triggerType });
      expect(result.success).toBe(true);
    }
  });

  test('accepts null workflowId (for deleted workflows)', () => {
    const result = workflowRunSchema.safeParse({
      ...validRun,
      workflowId: null,
    });
    expect(result.success).toBe(true);
  });

  test('accepts completed run with output', () => {
    const result = workflowRunSchema.safeParse({
      ...validRun,
      status: 'completed',
      output: { result: 'success' },
      completedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  test('accepts failed run with error', () => {
    const result = workflowRunSchema.safeParse({
      ...validRun,
      status: 'failed',
      error: 'Node execution failed',
      completedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });
});

describe('triggerRunSchema', () => {
  test('accepts empty input', () => {
    const result = triggerRunSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('accepts input object', () => {
    const result = triggerRunSchema.safeParse({
      input: { key: 'value', nested: { a: 1 } },
    });
    expect(result.success).toBe(true);
  });
});

describe('workflowFilterSchema', () => {
  test('applies defaults', () => {
    const result = workflowFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  test('coerces string numbers', () => {
    const result = workflowFilterSchema.safeParse({
      limit: '25',
      offset: '10',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.offset).toBe(10);
    }
  });

  test('accepts search filter', () => {
    const result = workflowFilterSchema.safeParse({
      search: 'test workflow',
    });
    expect(result.success).toBe(true);
  });

  test('accepts trigger filter', () => {
    const result = workflowFilterSchema.safeParse({
      hasTrigger: 'schedule',
    });
    expect(result.success).toBe(true);
  });

  test('enforces limit bounds', () => {
    const tooHigh = workflowFilterSchema.safeParse({ limit: 101 });
    const tooLow = workflowFilterSchema.safeParse({ limit: 0 });
    expect(tooHigh.success).toBe(false);
    expect(tooLow.success).toBe(false);
  });

  test('rejects negative offset', () => {
    const result = workflowFilterSchema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });
});

describe('workflowRunFilterSchema', () => {
  test('applies defaults', () => {
    const result = workflowRunFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  test('accepts workflowId filter', () => {
    const result = workflowRunFilterSchema.safeParse({
      workflowId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  test('accepts status filter', () => {
    const result = workflowRunFilterSchema.safeParse({
      status: 'running',
    });
    expect(result.success).toBe(true);
  });

  test('accepts triggerType filter', () => {
    const result = workflowRunFilterSchema.safeParse({
      triggerType: 'webhook',
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid status', () => {
    const result = workflowRunFilterSchema.safeParse({
      status: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid workflowId', () => {
    const result = workflowRunFilterSchema.safeParse({
      workflowId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

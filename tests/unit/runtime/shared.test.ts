import { describe, expect, it, beforeEach, mock } from 'bun:test';
import type {
  IsolationStrategy,
  RuntimeTask,
} from '@/runtime/types';
import type {
  AgentAdapter,
  AdapterConnection,
  AgentTask,
  ExecutionEvent,
} from '@/integrations/types';

// Mock helpers
const createMockAdapter = (): AgentAdapter => ({
  id: 'adapter-123',
  name: 'Test Adapter',
  type: 'custom',
  connect: mock(() => Promise.resolve({} as AdapterConnection)),
  disconnect: mock(() => Promise.resolve()),
  validateCredentials: mock(() => Promise.resolve(true)),
  execute: mock(async function* (): AsyncGenerator<ExecutionEvent> {
    yield { type: 'started', timestamp: new Date() };
    yield { type: 'thinking', content: 'Processing task...' };
    yield {
      type: 'completed',
      result: { success: true, output: 'Task completed' },
    };
  }),
  getCapabilities: mock(() => ({
    supportsStreaming: true,
    supportsTools: true,
    supportsImages: false,
    maxContextTokens: 100000,
    supportedModels: ['test-model'],
  })),
  estimateCost: mock(() => ({
    estimatedInputTokens: 100,
    estimatedOutputTokens: 50,
    estimatedCostUsd: 0.01,
    model: 'test-model',
  })),
});

const createMockConnection = (): AdapterConnection => ({
  id: 'conn-123',
  adapterId: 'adapter-123',
  status: 'connected',
  credentials: { type: 'api-key', data: { key: 'test-key' } },
  connectedAt: new Date(),
  lastUsedAt: new Date(),
  metadata: {},
});

const createMockTask = (): AgentTask => ({
  prompt: 'Test prompt',
  context: 'Test context',
  tools: [],
  skills: [],
  constraints: {
    maxTokens: 1000,
    maxDuration: 60000,
  },
});

const createRuntimeTask = (
  overrides: Partial<RuntimeTask> = {}
): RuntimeTask => ({
  id: 'task-123',
  adapter: createMockAdapter(),
  connection: createMockConnection(),
  task: createMockTask(),
  timeout: 60000,
  resourceLimits: {
    maxMemoryMB: 512,
    maxCpuPercent: 50,
    maxDurationMs: 60000,
  },
  ...overrides,
});

// Mock SharedProcessStrategy implementation
class SharedProcessStrategy implements IsolationStrategy {
  readonly level = 'shared' as const;

  async prepare(_task: RuntimeTask): Promise<void> {
    // No preparation needed for shared process
  }

  async *execute(task: RuntimeTask): AsyncGenerator<ExecutionEvent> {
    const startTime = Date.now();

    // Check memory before execution
    if (task.resourceLimits?.maxMemoryMB) {
      const memUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;
      if (memUsageMB > task.resourceLimits.maxMemoryMB) {
        throw new Error(
          `Memory limit exceeded: ${memUsageMB}MB > ${task.resourceLimits.maxMemoryMB}MB`
        );
      }
    }

    // Execute with timeout
    const timeoutMs = task.timeout;
    const generator = task.adapter.execute(task.connection, task.task, {
      timeout: timeoutMs,
    });

    for await (const event of generator) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Execution timeout after ${timeoutMs}ms`);
      }

      yield event;
    }
  }

  async cleanup(_executionId: string): Promise<void> {
    // No cleanup needed for shared process
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

describe('SharedProcessStrategy', () => {
  let strategy: SharedProcessStrategy;
  let mockAdapter: AgentAdapter;
  let mockConnection: AdapterConnection;
  let runtimeTask: RuntimeTask;

  beforeEach(() => {
    strategy = new SharedProcessStrategy();
    mockAdapter = createMockAdapter();
    mockConnection = createMockConnection();
    runtimeTask = createRuntimeTask({
      adapter: mockAdapter,
      connection: mockConnection,
    });
  });

  describe('level', () => {
    it('should be shared', () => {
      expect(strategy.level).toBe('shared');
    });
  });

  describe('prepare', () => {
    it('should complete without error', async () => {
      await expect(strategy.prepare(runtimeTask)).resolves.toBeUndefined();
    });
  });

  describe('execute', () => {
    it('should yield events from adapter', async () => {
      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(runtimeTask)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.type).toBe('started');
      expect(events[events.length - 1]?.type).toBe('completed');
    });

    it('should enforce timeout', async () => {
      // Create adapter that yields events slowly
      const slowAdapter = createMockAdapter();
      (slowAdapter.execute as ReturnType<typeof mock>) = mock(
        async function* (): AsyncGenerator<ExecutionEvent> {
          yield { type: 'started', timestamp: new Date() };
          await new Promise((resolve) => setTimeout(resolve, 200));
          yield { type: 'thinking', content: 'Still processing...' };
        }
      );

      const taskWithTimeout = createRuntimeTask({
        adapter: slowAdapter,
        timeout: 50, // 50ms timeout
      });

      const events: ExecutionEvent[] = [];

      await expect(async () => {
        for await (const event of strategy.execute(taskWithTimeout)) {
          events.push(event);
        }
      }).toThrow('timeout');
    });

    it('should check memory limit', async () => {
      const taskWithMemLimit = createRuntimeTask({
        resourceLimits: {
          maxMemoryMB: 1, // Very low limit to trigger check
          maxDurationMs: 60000,
        },
      });

      await expect(async () => {
        for await (const _event of strategy.execute(taskWithMemLimit)) {
          // Should throw before yielding
        }
      }).toThrow('Memory limit exceeded');
    });

    it('should execute successfully without resource limits', async () => {
      const taskNoLimits = createRuntimeTask({
        resourceLimits: undefined,
      });

      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(taskNoLimits)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
    });

    it('should pass through all event types', async () => {
      const multiEventAdapter = createMockAdapter();
      (multiEventAdapter.execute as ReturnType<typeof mock>) = mock(
        async function* (): AsyncGenerator<ExecutionEvent> {
          yield { type: 'started', timestamp: new Date() };
          yield { type: 'thinking', content: 'Analyzing...' };
          yield { type: 'tool-call', tool: 'search', args: { query: 'test' } };
          yield { type: 'tool-result', tool: 'search', result: { data: [] } };
          yield { type: 'output', content: 'Result: test' };
          yield {
            type: 'cost',
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          };
          yield {
            type: 'completed',
            result: { success: true, output: 'Done' },
          };
        }
      );

      const task = createRuntimeTask({ adapter: multiEventAdapter });
      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(task)) {
        events.push(event);
      }

      expect(events).toHaveLength(7);
      expect(events.map((e) => e.type)).toEqual([
        'started',
        'thinking',
        'tool-call',
        'tool-result',
        'output',
        'cost',
        'completed',
      ]);
    });
  });

  describe('cleanup', () => {
    it('should complete without error', async () => {
      await expect(strategy.cleanup('task-123')).resolves.toBeUndefined();
    });

    it('should handle cleanup of non-existent execution', async () => {
      await expect(
        strategy.cleanup('non-existent-id')
      ).resolves.toBeUndefined();
    });
  });

  describe('isAvailable', () => {
    it('should return true', async () => {
      const available = await strategy.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('resource limits', () => {
    it('should respect maxDurationMs limit', async () => {
      const slowAdapter = createMockAdapter();
      (slowAdapter.execute as ReturnType<typeof mock>) = mock(
        async function* (): AsyncGenerator<ExecutionEvent> {
          yield { type: 'started', timestamp: new Date() };
          await new Promise((resolve) => setTimeout(resolve, 150));
          yield {
            type: 'completed',
            result: { success: true, output: 'Done' },
          };
        }
      );

      const task = createRuntimeTask({
        adapter: slowAdapter,
        timeout: 100,
        resourceLimits: { maxDurationMs: 100 },
      });

      await expect(async () => {
        for await (const _event of strategy.execute(task)) {
          // Should timeout
        }
      }).toThrow();
    });

    it('should handle tasks without constraints', async () => {
      const taskNoConstraints = createRuntimeTask({
        task: {
          prompt: 'Test',
          constraints: undefined,
        },
      });

      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(taskNoConstraints)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
    });
  });
});

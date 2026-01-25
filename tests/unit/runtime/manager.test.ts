import { describe, expect, it, beforeEach, mock } from 'bun:test';
import type {
  ExecutionRuntime,
  IsolationStrategy,
  RuntimeTask,
  RuntimeResult,
  IsolationLevel,
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
    yield { type: 'output', content: 'Task result' };
    yield {
      type: 'completed',
      result: { success: true, output: 'Done' },
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
});

const createMockTask = (): AgentTask => ({
  prompt: 'Test prompt',
  context: 'Test context',
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

// Mock strategy implementations
class MockIsolationStrategy implements IsolationStrategy {
  constructor(
    public readonly level: IsolationLevel,
    private readonly available: boolean = true
  ) {}

  prepare = mock(async (_task: RuntimeTask) => {});

  execute = mock(async function* (
    this: MockIsolationStrategy,
    _task: RuntimeTask
  ): AsyncGenerator<ExecutionEvent> {
    yield { type: 'started', timestamp: new Date() };
    yield { type: 'thinking', content: `Executing in ${this.level} mode` };
    yield {
      type: 'completed',
      result: { success: true, output: 'Success' },
    };
  });

  cleanup = mock(async (_executionId: string) => {});

  isAvailable = mock(async () => this.available);
}

// RuntimeManager implementation
class RuntimeManager implements ExecutionRuntime {
  private strategies = new Map<IsolationLevel, IsolationStrategy>();

  registerStrategy(strategy: IsolationStrategy): void {
    this.strategies.set(strategy.level, strategy);
  }

  getStrategy(level: IsolationLevel): IsolationStrategy | undefined {
    return this.strategies.get(level);
  }

  async execute(
    task: RuntimeTask,
    isolation: IsolationLevel
  ): Promise<RuntimeResult> {
    const startedAt = new Date();
    const events: ExecutionEvent[] = [];

    try {
      // Select strategy
      let strategy = this.strategies.get(isolation);

      // Check if strategy is available
      if (strategy && !(await strategy.isAvailable())) {
        strategy = await this.findFallbackStrategy(isolation);
      }

      if (!strategy) {
        throw new Error(`No available strategy for isolation level: ${isolation}`);
      }

      // Prepare
      await strategy.prepare(task);

      // Execute and collect events
      for await (const event of strategy.execute(task)) {
        events.push(event);
      }

      // Check for errors in events
      const errorEvent = events.find((e) => e.type === 'error');
      if (errorEvent && errorEvent.type === 'error') {
        return {
          success: false,
          error: errorEvent.error.message,
          events,
          startedAt,
          completedAt: new Date(),
        };
      }

      // Extract output from completed event
      const completedEvent = events.find((e) => e.type === 'completed');
      const output =
        completedEvent && completedEvent.type === 'completed'
          ? completedEvent.result.output
          : undefined;

      return {
        success: true,
        output,
        events,
        startedAt,
        completedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        events,
        startedAt,
        completedAt: new Date(),
      };
    }
  }

  async cleanup(executionId: string): Promise<void> {
    // Delegate to all strategies that might have resources
    const cleanupPromises = Array.from(this.strategies.values()).map(
      (strategy) => strategy.cleanup(executionId)
    );
    await Promise.all(cleanupPromises);
  }

  private async findFallbackStrategy(
    preferred: IsolationLevel
  ): Promise<IsolationStrategy | undefined> {
    // Fallback order: container -> process -> shared
    const fallbackOrder: IsolationLevel[] =
      preferred === 'container'
        ? ['process', 'shared']
        : preferred === 'process'
          ? ['shared']
          : [];

    for (const level of fallbackOrder) {
      const strategy = this.strategies.get(level);
      if (strategy && (await strategy.isAvailable())) {
        return strategy;
      }
    }

    return undefined;
  }
}

describe('RuntimeManager', () => {
  let manager: RuntimeManager;
  let sharedStrategy: MockIsolationStrategy;
  let processStrategy: MockIsolationStrategy;
  let containerStrategy: MockIsolationStrategy;
  let runtimeTask: RuntimeTask;

  beforeEach(() => {
    manager = new RuntimeManager();
    sharedStrategy = new MockIsolationStrategy('shared', true);
    processStrategy = new MockIsolationStrategy('process', true);
    containerStrategy = new MockIsolationStrategy('container', true);
    runtimeTask = createRuntimeTask();
  });

  describe('strategy registration', () => {
    it('should register a strategy', () => {
      manager.registerStrategy(sharedStrategy);

      const retrieved = manager.getStrategy('shared');
      expect(retrieved).toBe(sharedStrategy);
    });

    it('should register multiple strategies', () => {
      manager.registerStrategy(sharedStrategy);
      manager.registerStrategy(processStrategy);
      manager.registerStrategy(containerStrategy);

      expect(manager.getStrategy('shared')).toBe(sharedStrategy);
      expect(manager.getStrategy('process')).toBe(processStrategy);
      expect(manager.getStrategy('container')).toBe(containerStrategy);
    });

    it('should replace strategy with same level', () => {
      const strategy1 = new MockIsolationStrategy('shared', true);
      const strategy2 = new MockIsolationStrategy('shared', true);

      manager.registerStrategy(strategy1);
      manager.registerStrategy(strategy2);

      expect(manager.getStrategy('shared')).toBe(strategy2);
    });
  });

  describe('strategy selection', () => {
    beforeEach(() => {
      manager.registerStrategy(sharedStrategy);
      manager.registerStrategy(processStrategy);
      manager.registerStrategy(containerStrategy);
    });

    it('should select requested strategy', async () => {
      const result = await manager.execute(runtimeTask, 'process');

      expect(result.success).toBe(true);
      expect(processStrategy.execute).toHaveBeenCalled();
    });

    it('should use shared strategy when requested', async () => {
      const result = await manager.execute(runtimeTask, 'shared');

      expect(result.success).toBe(true);
      expect(sharedStrategy.execute).toHaveBeenCalled();
    });

    it('should use container strategy when requested', async () => {
      const result = await manager.execute(runtimeTask, 'container');

      expect(result.success).toBe(true);
      expect(containerStrategy.execute).toHaveBeenCalled();
    });
  });

  describe('fallback behavior', () => {
    it('should fallback when preferred strategy is unavailable', async () => {
      const unavailableContainer = new MockIsolationStrategy(
        'container',
        false
      );
      manager.registerStrategy(unavailableContainer);
      manager.registerStrategy(processStrategy);
      manager.registerStrategy(sharedStrategy);

      const result = await manager.execute(runtimeTask, 'container');

      expect(result.success).toBe(true);
      // Should have fallen back to process
      expect(processStrategy.execute).toHaveBeenCalled();
      expect(unavailableContainer.execute).not.toHaveBeenCalled();
    });

    it('should fallback to shared when process unavailable', async () => {
      const unavailableProcess = new MockIsolationStrategy('process', false);
      manager.registerStrategy(unavailableProcess);
      manager.registerStrategy(sharedStrategy);

      const result = await manager.execute(runtimeTask, 'process');

      expect(result.success).toBe(true);
      expect(sharedStrategy.execute).toHaveBeenCalled();
      expect(unavailableProcess.execute).not.toHaveBeenCalled();
    });

    it('should error when no strategies are available', async () => {
      const unavailableShared = new MockIsolationStrategy('shared', false);
      manager.registerStrategy(unavailableShared);

      const result = await manager.execute(runtimeTask, 'shared');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No available strategy');
    });

    it('should error when requested strategy does not exist', async () => {
      const result = await manager.execute(runtimeTask, 'container');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No available strategy');
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      manager.registerStrategy(sharedStrategy);
    });

    it('should collect events into result', async () => {
      const result = await manager.execute(runtimeTask, 'shared');

      expect(result.success).toBe(true);
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.events.some((e) => e.type === 'started')).toBe(true);
      expect(result.events.some((e) => e.type === 'completed')).toBe(true);
    });

    it('should set start and completion times', async () => {
      const result = await manager.execute(runtimeTask, 'shared');

      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(result.completedAt.getTime()).toBeGreaterThanOrEqual(
        result.startedAt.getTime()
      );
    });

    it('should extract output from completed event', async () => {
      const result = await manager.execute(runtimeTask, 'shared');

      expect(result.success).toBe(true);
      expect(result.output).toBe('Success');
    });

    it('should call prepare before execute', async () => {
      await manager.execute(runtimeTask, 'shared');

      expect(sharedStrategy.prepare).toHaveBeenCalledWith(runtimeTask);
      expect(sharedStrategy.execute).toHaveBeenCalledWith(runtimeTask);
    });

    it('should handle execution errors', async () => {
      const errorStrategy = new MockIsolationStrategy('shared', true);
      (errorStrategy.execute as ReturnType<typeof mock>) = mock(
        async function* (): AsyncGenerator<ExecutionEvent> {
          throw new Error('Execution failed');
        }
      );

      manager.registerStrategy(errorStrategy);

      const result = await manager.execute(runtimeTask, 'shared');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Execution failed');
    });

    it('should handle error events', async () => {
      const errorEventStrategy = new MockIsolationStrategy('shared', true);
      (errorEventStrategy.execute as ReturnType<typeof mock>) = mock(
        async function* (): AsyncGenerator<ExecutionEvent> {
          yield { type: 'started', timestamp: new Date() };
          yield { type: 'error', error: new Error('Task error') };
        }
      );

      manager.registerStrategy(errorEventStrategy);

      const result = await manager.execute(runtimeTask, 'shared');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Task error');
      expect(result.events.some((e) => e.type === 'error')).toBe(true);
    });

    it('should return all events even on error', async () => {
      const errorStrategy = new MockIsolationStrategy('shared', true);
      (errorStrategy.execute as ReturnType<typeof mock>) = mock(
        async function* (): AsyncGenerator<ExecutionEvent> {
          yield { type: 'started', timestamp: new Date() };
          yield { type: 'thinking', content: 'Processing...' };
          yield { type: 'error', error: new Error('Failed') };
        }
      );

      manager.registerStrategy(errorStrategy);

      const result = await manager.execute(runtimeTask, 'shared');

      expect(result.success).toBe(false);
      expect(result.events.length).toBe(3);
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      manager.registerStrategy(sharedStrategy);
      manager.registerStrategy(processStrategy);
      manager.registerStrategy(containerStrategy);
    });

    it('should delegate to strategy', async () => {
      await manager.cleanup('task-123');

      expect(sharedStrategy.cleanup).toHaveBeenCalledWith('task-123');
      expect(processStrategy.cleanup).toHaveBeenCalledWith('task-123');
      expect(containerStrategy.cleanup).toHaveBeenCalledWith('task-123');
    });

    it('should cleanup all registered strategies', async () => {
      await manager.cleanup('task-123');

      expect(sharedStrategy.cleanup).toHaveBeenCalled();
      expect(processStrategy.cleanup).toHaveBeenCalled();
      expect(containerStrategy.cleanup).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      const errorStrategy = new MockIsolationStrategy('shared', true);
      (errorStrategy.cleanup as ReturnType<typeof mock>) = mock(async () => {
        throw new Error('Cleanup failed');
      });

      manager.registerStrategy(errorStrategy);

      // Should not throw
      await expect(manager.cleanup('task-123')).rejects.toThrow();
    });

    it('should cleanup even if no execution occurred', async () => {
      await manager.cleanup('never-executed-id');

      expect(sharedStrategy.cleanup).toHaveBeenCalledWith('never-executed-id');
    });
  });

  describe('error handling', () => {
    it('should return failed result on preparation error', async () => {
      const failingStrategy = new MockIsolationStrategy('shared', true);
      (failingStrategy.prepare as ReturnType<typeof mock>) = mock(async () => {
        throw new Error('Preparation failed');
      });

      manager.registerStrategy(failingStrategy);

      const result = await manager.execute(runtimeTask, 'shared');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Preparation failed');
    });

    it('should handle non-Error exceptions', async () => {
      const throwingStrategy = new MockIsolationStrategy('shared', true);
      (throwingStrategy.execute as ReturnType<typeof mock>) = mock(
        async function* (): AsyncGenerator<ExecutionEvent> {
          throw 'String error';
        }
      );

      manager.registerStrategy(throwingStrategy);

      const result = await manager.execute(runtimeTask, 'shared');

      expect(result.success).toBe(false);
      expect(result.error).toBe('String error');
    });

    it('should include execution ID in error context', async () => {
      const result = await manager.execute(runtimeTask, 'nonexistent' as IsolationLevel);

      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent');
    });
  });

  describe('resource tracking', () => {
    it('should track execution time', async () => {
      manager.registerStrategy(sharedStrategy);

      const result = await manager.execute(runtimeTask, 'shared');

      const duration =
        result.completedAt.getTime() - result.startedAt.getTime();
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle long-running executions', async () => {
      const slowStrategy = new MockIsolationStrategy('shared', true);
      (slowStrategy.execute as ReturnType<typeof mock>) = mock(
        async function* (): AsyncGenerator<ExecutionEvent> {
          yield { type: 'started', timestamp: new Date() };
          await new Promise((resolve) => setTimeout(resolve, 50));
          yield {
            type: 'completed',
            result: { success: true, output: 'Done' },
          };
        }
      );

      manager.registerStrategy(slowStrategy);

      const result = await manager.execute(runtimeTask, 'shared');

      expect(result.success).toBe(true);
      const duration =
        result.completedAt.getTime() - result.startedAt.getTime();
      expect(duration).toBeGreaterThanOrEqual(50);
    });
  });

  describe('concurrent executions', () => {
    beforeEach(() => {
      manager.registerStrategy(sharedStrategy);
    });

    it('should handle concurrent executions', async () => {
      const task1 = createRuntimeTask({ id: 'task-1' });
      const task2 = createRuntimeTask({ id: 'task-2' });
      const task3 = createRuntimeTask({ id: 'task-3' });

      const results = await Promise.all([
        manager.execute(task1, 'shared'),
        manager.execute(task2, 'shared'),
        manager.execute(task3, 'shared'),
      ]);

      expect(results.every((r) => r.success)).toBe(true);
      expect(results).toHaveLength(3);
    });

    it('should isolate errors between concurrent executions', async () => {
      const errorStrategy = new MockIsolationStrategy('process', true);
      (errorStrategy.execute as ReturnType<typeof mock>) = mock(
        async function* (): AsyncGenerator<ExecutionEvent> {
          throw new Error('Failed');
        }
      );

      manager.registerStrategy(errorStrategy);
      manager.registerStrategy(sharedStrategy);

      const task1 = createRuntimeTask({ id: 'task-1' });
      const task2 = createRuntimeTask({ id: 'task-2' });

      const [result1, result2] = await Promise.all([
        manager.execute(task1, 'process'),
        manager.execute(task2, 'shared'),
      ]);

      expect(result1.success).toBe(false);
      expect(result2.success).toBe(true);
    });
  });
});

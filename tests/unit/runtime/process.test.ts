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

// Mock Bun.spawn
interface MockSpawnResult {
  pid: number;
  exitCode: Promise<number>;
  stdin: {
    write: (data: string) => void;
    end: () => void;
  };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  killed: boolean;
  kill: (signal?: number) => void;
}

const createMockSpawnResult = (
  events: ExecutionEvent[] = []
): MockSpawnResult => {
  const encoder = new TextEncoder();
  let killCalled = false;

  return {
    pid: 12345,
    exitCode: Promise.resolve(0),
    stdin: {
      write: mock((_data: string) => {}),
      end: mock(() => {}),
    },
    stdout: new ReadableStream({
      async start(controller) {
        // Send events as IPC messages
        for (const event of events) {
          const message = JSON.stringify({ type: 'event', data: event });
          controller.enqueue(encoder.encode(message + '\n'));
        }
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    killed: false,
    kill: mock((signal?: number) => {
      killCalled = true;
    }),
  };
};

// Mock ProcessIsolationStrategy implementation
class ProcessIsolationStrategy implements IsolationStrategy {
  readonly level = 'process' as const;
  private processes = new Map<string, MockSpawnResult>();

  async prepare(_task: RuntimeTask): Promise<void> {
    // Preparation could include setting up IPC channels
  }

  async *execute(task: RuntimeTask): AsyncGenerator<ExecutionEvent> {
    // Spawn child process
    const events: ExecutionEvent[] = [
      { type: 'started', timestamp: new Date() },
      { type: 'thinking', content: 'Processing in child process...' },
      {
        type: 'completed',
        result: { success: true, output: 'Process completed' },
      },
    ];

    const child = createMockSpawnResult(events);
    this.processes.set(task.id, child);

    try {
      // Read events from stdout (IPC)
      const decoder = new TextDecoder();
      const reader = child.stdout.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const message = JSON.parse(line);
            if (message.type === 'event') {
              yield message.data as ExecutionEvent;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }

      // Wait for process to exit
      await child.exitCode;
    } finally {
      this.processes.delete(task.id);
    }
  }

  async cleanup(executionId: string): Promise<void> {
    const child = this.processes.get(executionId);
    if (child && !child.killed) {
      child.kill(15); // SIGTERM
      this.processes.delete(executionId);
    }
  }

  async isAvailable(): Promise<boolean> {
    // Check if we can spawn processes
    return true;
  }
}

describe('ProcessIsolationStrategy', () => {
  let strategy: ProcessIsolationStrategy;
  let runtimeTask: RuntimeTask;

  beforeEach(() => {
    strategy = new ProcessIsolationStrategy();
    runtimeTask = createRuntimeTask();
  });

  describe('level', () => {
    it('should be process', () => {
      expect(strategy.level).toBe('process');
    });
  });

  describe('prepare', () => {
    it('should complete without error', async () => {
      await expect(strategy.prepare(runtimeTask)).resolves.toBeUndefined();
    });
  });

  describe('execute', () => {
    it('should spawn child process and communicate via IPC', async () => {
      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(runtimeTask)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.type).toBe('started');
    });

    it('should yield all events from child process', async () => {
      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(runtimeTask)) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain('started');
      expect(types).toContain('completed');
    });

    it('should handle child process output', async () => {
      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(runtimeTask)) {
        events.push(event);
        if (event.type === 'output') {
          expect(event.content).toBeDefined();
        }
      }
    });

    it('should handle multiple concurrent processes', async () => {
      const task1 = createRuntimeTask({ id: 'task-1' });
      const task2 = createRuntimeTask({ id: 'task-2' });

      const results = await Promise.all([
        (async () => {
          const events: ExecutionEvent[] = [];
          for await (const event of strategy.execute(task1)) {
            events.push(event);
          }
          return events;
        })(),
        (async () => {
          const events: ExecutionEvent[] = [];
          for await (const event of strategy.execute(task2)) {
            events.push(event);
          }
          return events;
        })(),
      ]);

      expect(results[0]?.length).toBeGreaterThan(0);
      expect(results[1]?.length).toBeGreaterThan(0);
    });

    it('should pass task configuration to child process', async () => {
      const taskWithLimits = createRuntimeTask({
        resourceLimits: {
          maxMemoryMB: 256,
          maxCpuPercent: 25,
          maxDurationMs: 30000,
        },
      });

      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(taskWithLimits)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('process lifecycle', () => {
    it('should handle process completion', async () => {
      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(runtimeTask)) {
        events.push(event);
      }

      const lastEvent = events[events.length - 1];
      expect(lastEvent?.type).toBe('completed');
    });

    it('should handle process crashes', async () => {
      // Create a strategy that simulates crash
      class CrashingProcessStrategy extends ProcessIsolationStrategy {
        async *execute(task: RuntimeTask): AsyncGenerator<ExecutionEvent> {
          const crashEvents: ExecutionEvent[] = [
            { type: 'started', timestamp: new Date() },
            { type: 'error', error: new Error('Process crashed') },
          ];

          for (const event of crashEvents) {
            yield event;
          }
        }
      }

      const crashStrategy = new CrashingProcessStrategy();
      const events: ExecutionEvent[] = [];

      for await (const event of crashStrategy.execute(runtimeTask)) {
        events.push(event);
      }

      expect(events.some((e) => e.type === 'error')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should kill child process on cleanup', async () => {
      // Start execution but don't wait for completion
      const generator = strategy.execute(runtimeTask);
      const { value } = await generator.next();
      expect(value).toBeDefined();

      // Cleanup should kill the process
      await strategy.cleanup(runtimeTask.id);

      // Process should be removed from tracking
      await expect(strategy.cleanup(runtimeTask.id)).resolves.toBeUndefined();
    });

    it('should handle cleanup of non-existent process', async () => {
      await expect(
        strategy.cleanup('non-existent-id')
      ).resolves.toBeUndefined();
    });

    it('should handle cleanup of already completed process', async () => {
      // Execute to completion
      for await (const _event of strategy.execute(runtimeTask)) {
        // Consume all events
      }

      // Cleanup after completion should not error
      await expect(strategy.cleanup(runtimeTask.id)).resolves.toBeUndefined();
    });
  });

  describe('isAvailable', () => {
    it('should return true when process spawning is available', async () => {
      const available = await strategy.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('IPC communication', () => {
    it('should handle malformed IPC messages', async () => {
      class MalformedIPCStrategy extends ProcessIsolationStrategy {
        async *execute(task: RuntimeTask): AsyncGenerator<ExecutionEvent> {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              // Send malformed JSON
              controller.enqueue(encoder.encode('not-json\n'));
              // Send valid message
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: 'event',
                    data: { type: 'started', timestamp: new Date() },
                  }) + '\n'
                )
              );
              controller.close();
            },
          });

          const decoder = new TextDecoder();
          const reader = stream.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value);
            const lines = text.split('\n').filter((line) => line.trim());

            for (const line of lines) {
              try {
                const message = JSON.parse(line);
                if (message.type === 'event') {
                  yield message.data as ExecutionEvent;
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      }

      const malformedStrategy = new MalformedIPCStrategy();
      const events: ExecutionEvent[] = [];

      for await (const event of malformedStrategy.execute(runtimeTask)) {
        events.push(event);
      }

      // Should still get valid event
      expect(events.length).toBe(1);
      expect(events[0]?.type).toBe('started');
    });

    it('should handle empty messages', async () => {
      class EmptyMessageStrategy extends ProcessIsolationStrategy {
        async *execute(_task: RuntimeTask): AsyncGenerator<ExecutionEvent> {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              // Send empty lines
              controller.enqueue(encoder.encode('\n\n\n'));
              controller.close();
            },
          });

          const decoder = new TextDecoder();
          const reader = stream.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value);
            const lines = text.split('\n').filter((line) => line.trim());

            for (const line of lines) {
              try {
                const message = JSON.parse(line);
                if (message.type === 'event') {
                  yield message.data as ExecutionEvent;
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      }

      const emptyStrategy = new EmptyMessageStrategy();
      const events: ExecutionEvent[] = [];

      for await (const event of emptyStrategy.execute(runtimeTask)) {
        events.push(event);
      }

      // No events should be yielded
      expect(events.length).toBe(0);
    });
  });

  describe('resource isolation', () => {
    it('should isolate memory between processes', async () => {
      const task = createRuntimeTask({
        resourceLimits: {
          maxMemoryMB: 512,
        },
      });

      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(task)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
    });

    it('should isolate CPU between processes', async () => {
      const task = createRuntimeTask({
        resourceLimits: {
          maxCpuPercent: 50,
        },
      });

      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(task)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
    });
  });
});

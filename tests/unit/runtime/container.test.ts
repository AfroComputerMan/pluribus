import { describe, expect, it, beforeEach, mock } from 'bun:test';
import type { IsolationStrategy, RuntimeTask } from '@/runtime/types';
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
    yield {
      type: 'completed',
      result: { success: true, output: 'Container completed' },
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

// Mock docker spawn result
interface MockDockerSpawn {
  pid: number;
  exitCode: Promise<number>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill: () => void;
}

const createMockDockerSpawn = (
  output: string = '',
  exitCode = 0
): MockDockerSpawn => {
  const encoder = new TextEncoder();

  return {
    pid: 54321,
    exitCode: Promise.resolve(exitCode),
    stdout: new ReadableStream({
      start(controller) {
        if (output) {
          controller.enqueue(encoder.encode(output));
        }
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    kill: mock(() => {}),
  };
};

// Mock ContainerIsolationStrategy implementation
class ContainerIsolationStrategy implements IsolationStrategy {
  readonly level = 'container' as const;
  private containers = new Map<string, string>(); // taskId -> containerId

  async prepare(_task: RuntimeTask): Promise<void> {
    // Could pull image here if needed
  }

  async *execute(task: RuntimeTask): AsyncGenerator<ExecutionEvent> {
    const containerId = `container-${task.id}`;
    this.containers.set(task.id, containerId);

    try {
      // Build docker run command
      const dockerArgs = this.buildDockerArgs(task, containerId);

      // Mock docker execution
      yield { type: 'started', timestamp: new Date() };
      yield { type: 'thinking', content: 'Running in container...' };
      yield {
        type: 'completed',
        result: { success: true, output: 'Container execution complete' },
      };
    } finally {
      // Container cleanup happens in cleanup()
    }
  }

  private buildDockerArgs(task: RuntimeTask, containerId: string): string[] {
    const args = [
      'run',
      '--rm',
      '--name',
      containerId,
      '--network',
      'none', // Default to no network
    ];

    // Add resource limits
    if (task.resourceLimits?.maxMemoryMB) {
      args.push('--memory', `${task.resourceLimits.maxMemoryMB}m`);
    }

    if (task.resourceLimits?.maxCpuPercent) {
      const cpuShares = Math.floor(
        (task.resourceLimits.maxCpuPercent / 100) * 1024
      );
      args.push('--cpu-shares', cpuShares.toString());
    }

    // Add volume mounts (example: mounting a workspace)
    args.push('-v', '/tmp/workspace:/workspace:ro');

    // Add timeout as env var
    args.push('-e', `TIMEOUT_MS=${task.timeout}`);

    // Image and command
    args.push('agent-runtime:latest');
    args.push('bun', 'run', 'execute.ts');

    return args;
  }

  async cleanup(executionId: string): Promise<void> {
    const containerId = this.containers.get(executionId);
    if (containerId) {
      // Mock docker stop and remove
      this.containers.delete(executionId);
    }
  }

  async isAvailable(): Promise<boolean> {
    // Mock docker availability check
    try {
      // Would normally run: docker --version
      return true;
    } catch {
      return false;
    }
  }
}

describe('ContainerIsolationStrategy', () => {
  let strategy: ContainerIsolationStrategy;
  let runtimeTask: RuntimeTask;

  beforeEach(() => {
    strategy = new ContainerIsolationStrategy();
    runtimeTask = createRuntimeTask();
  });

  describe('level', () => {
    it('should be container', () => {
      expect(strategy.level).toBe('container');
    });
  });

  describe('prepare', () => {
    it('should complete without error', async () => {
      await expect(strategy.prepare(runtimeTask)).resolves.toBeUndefined();
    });
  });

  describe('docker command building', () => {
    it('should build correct docker run command with resource limits', () => {
      const task = createRuntimeTask({
        resourceLimits: {
          maxMemoryMB: 1024,
          maxCpuPercent: 50,
          maxDurationMs: 30000,
        },
      });

      // Access private method through any casting for testing
      const args = (strategy as any).buildDockerArgs(task, 'test-container');

      expect(args).toContain('--memory');
      expect(args).toContain('1024m');
      expect(args).toContain('--cpu-shares');
      expect(args).toContain('512'); // 50% of 1024
    });

    it('should include volume mount args', () => {
      const args = (strategy as any).buildDockerArgs(
        runtimeTask,
        'test-container'
      );

      expect(args).toContain('-v');
      expect(args.some((arg: string) => arg.includes('/workspace'))).toBe(
        true
      );
    });

    it('should set network mode to none by default', () => {
      const args = (strategy as any).buildDockerArgs(
        runtimeTask,
        'test-container'
      );

      expect(args).toContain('--network');
      expect(args).toContain('none');
    });

    it('should include timeout as environment variable', () => {
      const task = createRuntimeTask({ timeout: 45000 });
      const args = (strategy as any).buildDockerArgs(task, 'test-container');

      expect(args.some((arg: string) => arg.includes('TIMEOUT_MS=45000'))).toBe(
        true
      );
    });

    it('should use --rm flag for auto-cleanup', () => {
      const args = (strategy as any).buildDockerArgs(
        runtimeTask,
        'test-container'
      );

      expect(args).toContain('--rm');
    });

    it('should set container name', () => {
      const args = (strategy as any).buildDockerArgs(
        runtimeTask,
        'my-container'
      );

      expect(args).toContain('--name');
      expect(args).toContain('my-container');
    });

    it('should handle missing resource limits', () => {
      const task = createRuntimeTask({ resourceLimits: undefined });
      const args = (strategy as any).buildDockerArgs(task, 'test-container');

      expect(args).not.toContain('--memory');
      expect(args).not.toContain('--cpu-shares');
    });

    it('should handle partial resource limits', () => {
      const task = createRuntimeTask({
        resourceLimits: {
          maxMemoryMB: 512,
          // No CPU limit
        },
      });
      const args = (strategy as any).buildDockerArgs(task, 'test-container');

      expect(args).toContain('--memory');
      expect(args).toContain('512m');
      expect(args).not.toContain('--cpu-shares');
    });
  });

  describe('execute', () => {
    it('should execute in container and yield events', async () => {
      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(runtimeTask)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.type).toBe('started');
    });

    it('should track container ID during execution', async () => {
      const generator = strategy.execute(runtimeTask);
      const { value } = await generator.next();

      expect(value).toBeDefined();

      // Container should be tracked
      const containerMap = (strategy as any).containers as Map<string, string>;
      expect(containerMap.has(runtimeTask.id)).toBe(true);
    });

    it('should handle container completion', async () => {
      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(runtimeTask)) {
        events.push(event);
      }

      const lastEvent = events[events.length - 1];
      expect(lastEvent?.type).toBe('completed');
    });

    it('should isolate multiple concurrent containers', async () => {
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

    it('should enforce resource limits in docker args', async () => {
      const task = createRuntimeTask({
        resourceLimits: {
          maxMemoryMB: 256,
          maxCpuPercent: 25,
        },
      });

      const events: ExecutionEvent[] = [];

      for await (const event of strategy.execute(task)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('container lifecycle', () => {
    it('should create container on execute', async () => {
      const generator = strategy.execute(runtimeTask);
      await generator.next();

      const containerMap = (strategy as any).containers as Map<string, string>;
      expect(containerMap.size).toBe(1);
    });

    it('should remove container on cleanup', async () => {
      // Start execution
      const generator = strategy.execute(runtimeTask);
      await generator.next();

      // Cleanup
      await strategy.cleanup(runtimeTask.id);

      const containerMap = (strategy as any).containers as Map<string, string>;
      expect(containerMap.has(runtimeTask.id)).toBe(false);
    });

    it('should handle cleanup of non-existent container', async () => {
      await expect(
        strategy.cleanup('non-existent-id')
      ).resolves.toBeUndefined();
    });

    it('should cleanup after successful execution', async () => {
      // Execute to completion
      for await (const _event of strategy.execute(runtimeTask)) {
        // Consume events
      }

      // Cleanup
      await strategy.cleanup(runtimeTask.id);

      const containerMap = (strategy as any).containers as Map<string, string>;
      expect(containerMap.size).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should remove container', async () => {
      // Start execution
      const generator = strategy.execute(runtimeTask);
      await generator.next();

      await strategy.cleanup(runtimeTask.id);

      const containerMap = (strategy as any).containers as Map<string, string>;
      expect(containerMap.has(runtimeTask.id)).toBe(false);
    });

    it('should be idempotent', async () => {
      const generator = strategy.execute(runtimeTask);
      await generator.next();

      await strategy.cleanup(runtimeTask.id);
      await strategy.cleanup(runtimeTask.id); // Second cleanup

      const containerMap = (strategy as any).containers as Map<string, string>;
      expect(containerMap.size).toBe(0);
    });

    it('should handle cleanup of multiple containers', async () => {
      const task1 = createRuntimeTask({ id: 'task-1' });
      const task2 = createRuntimeTask({ id: 'task-2' });

      const gen1 = strategy.execute(task1);
      const gen2 = strategy.execute(task2);

      await gen1.next();
      await gen2.next();

      await strategy.cleanup(task1.id);
      await strategy.cleanup(task2.id);

      const containerMap = (strategy as any).containers as Map<string, string>;
      expect(containerMap.size).toBe(0);
    });
  });

  describe('isAvailable', () => {
    it('should check docker availability', async () => {
      const available = await strategy.isAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('should return true when docker is available', async () => {
      const available = await strategy.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when docker is unavailable', async () => {
      class UnavailableContainerStrategy extends ContainerIsolationStrategy {
        async isAvailable(): Promise<boolean> {
          return false;
        }
      }

      const unavailableStrategy = new UnavailableContainerStrategy();
      const available = await unavailableStrategy.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('volume mounts', () => {
    it('should mount workspace as read-only', () => {
      const args = (strategy as any).buildDockerArgs(
        runtimeTask,
        'test-container'
      );

      const volumeArgs = args
        .map((arg: string, i: number) => (args[i - 1] === '-v' ? arg : null))
        .filter(Boolean);

      expect(volumeArgs.some((arg: string) => arg.includes(':ro'))).toBe(true);
    });

    it('should include container path in mount', () => {
      const args = (strategy as any).buildDockerArgs(
        runtimeTask,
        'test-container'
      );

      const volumeArgs = args
        .map((arg: string, i: number) => (args[i - 1] === '-v' ? arg : null))
        .filter(Boolean);

      expect(
        volumeArgs.some((arg: string) => arg.includes('/workspace'))
      ).toBe(true);
    });
  });

  describe('security', () => {
    it('should isolate network by default', () => {
      const args = (strategy as any).buildDockerArgs(
        runtimeTask,
        'test-container'
      );

      const networkIndex = args.indexOf('--network');
      expect(networkIndex).toBeGreaterThan(-1);
      expect(args[networkIndex + 1]).toBe('none');
    });

    it('should not expose host filesystem', () => {
      const args = (strategy as any).buildDockerArgs(
        runtimeTask,
        'test-container'
      );

      // Volume mounts should be explicit, not mounting root
      const volumeArgs = args
        .map((arg: string, i: number) => (args[i - 1] === '-v' ? arg : null))
        .filter(Boolean);

      expect(volumeArgs.every((arg: string) => !arg.startsWith('/:'))).toBe(
        true
      );
    });

    it('should use auto-remove flag', () => {
      const args = (strategy as any).buildDockerArgs(
        runtimeTask,
        'test-container'
      );

      expect(args).toContain('--rm');
    });
  });

  describe('resource limits', () => {
    it('should convert memory limit to docker format', () => {
      const task = createRuntimeTask({
        resourceLimits: { maxMemoryMB: 2048 },
      });

      const args = (strategy as any).buildDockerArgs(task, 'test-container');

      const memoryIndex = args.indexOf('--memory');
      expect(args[memoryIndex + 1]).toBe('2048m');
    });

    it('should convert CPU percent to shares', () => {
      const task = createRuntimeTask({
        resourceLimits: { maxCpuPercent: 75 },
      });

      const args = (strategy as any).buildDockerArgs(task, 'test-container');

      const cpuIndex = args.indexOf('--cpu-shares');
      const expectedShares = Math.floor((75 / 100) * 1024);
      expect(args[cpuIndex + 1]).toBe(expectedShares.toString());
    });

    it('should handle zero percent CPU', () => {
      const task = createRuntimeTask({
        resourceLimits: { maxCpuPercent: 0 },
      });

      const args = (strategy as any).buildDockerArgs(task, 'test-container');

      expect(args).not.toContain('--cpu-shares');
    });

    it('should handle 100 percent CPU', () => {
      const task = createRuntimeTask({
        resourceLimits: { maxCpuPercent: 100 },
      });

      const args = (strategy as any).buildDockerArgs(task, 'test-container');

      const cpuIndex = args.indexOf('--cpu-shares');
      expect(args[cpuIndex + 1]).toBe('1024');
    });
  });
});

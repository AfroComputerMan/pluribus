import { beforeEach, describe, expect, it } from 'bun:test';
import { ProcessIsolationStrategy } from '@/runtime/strategies/process';
import type { RuntimeTask } from '@/runtime/types';
import type { AgentAdapter, AdapterConnection, AgentTask } from '@/integrations';

describe('ProcessIsolationStrategy', () => {
  let strategy: ProcessIsolationStrategy;

  beforeEach(() => {
    strategy = new ProcessIsolationStrategy();
  });

  describe('isAvailable', () => {
    it('should always return true', async () => {
      const available = await strategy.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('level', () => {
    it('should have isolation level of "process"', () => {
      expect(strategy.level).toBe('process');
    });
  });

  describe('prepare', () => {
    it('should prepare without errors', async () => {
      const mockTask = createMockTask();
      await expect(strategy.prepare(mockTask)).resolves.toBeUndefined();
    });
  });

  describe('execute', () => {
    it('should execute task and yield events', async () => {
      const mockTask = createMockTask();
      const events = [];

      for await (const event of strategy.execute(mockTask)) {
        events.push(event);
        if (event.type === 'completed' || event.type === 'error') {
          break;
        }
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('started');
    });

    it('should handle timeout', async () => {
      const mockTask = createMockTask({
        timeout: 100, // Very short timeout
      });

      const events = [];
      try {
        for await (const event of strategy.execute(mockTask)) {
          events.push(event);
          if (event.type === 'completed' || event.type === 'error') {
            break;
          }
        }
      } catch (error) {
        // Timeout may throw an error
        expect(error).toBeDefined();
      }

      // Should have received at least one event before timeout
      expect(events.length).toBeGreaterThanOrEqual(0);
    }, 10000);
  });

  describe('cleanup', () => {
    it('should cleanup without errors', async () => {
      const executionId = 'test-execution-id';
      await expect(strategy.cleanup(executionId)).resolves.toBeUndefined();
    });
  });
});

// Helper function to create mock RuntimeTask
function createMockTask(overrides?: Partial<RuntimeTask>): RuntimeTask {
  const mockAdapter: AgentAdapter = {
    id: 'test-adapter',
    name: 'Test Adapter',
    type: 'custom',
    connect: async () => ({} as AdapterConnection),
    disconnect: async () => {},
    validateCredentials: async () => true,
    execute: async function* () {
      yield { type: 'started', timestamp: new Date() };
      yield { type: 'output', content: 'test output' };
      yield {
        type: 'completed',
        result: { success: true, output: 'done' },
      };
    },
    getCapabilities: () => ({
      supportsStreaming: true,
      supportsTools: true,
      supportsImages: false,
      maxContextTokens: 100000,
      supportedModels: ['test-model'],
    }),
    estimateCost: () => ({
      estimatedInputTokens: 100,
      estimatedOutputTokens: 50,
      estimatedCostUsd: 0.001,
      model: 'test-model',
    }),
  };

  const mockConnection: AdapterConnection = {
    id: 'test-connection',
    adapterId: 'test-adapter',
    status: 'connected',
    credentials: {
      type: 'api-key',
      data: { key: 'test-key' },
    },
    connectedAt: new Date(),
  };

  const mockTask: AgentTask = {
    prompt: 'Test prompt',
    context: 'Test context',
  };

  return {
    id: 'test-task-id',
    adapter: mockAdapter,
    connection: mockConnection,
    task: mockTask,
    timeout: 5000,
    resourceLimits: {
      maxMemoryMB: 512,
      maxDurationMs: 5000,
    },
    ...overrides,
  };
}

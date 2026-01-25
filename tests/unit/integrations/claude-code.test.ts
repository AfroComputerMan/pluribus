import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { ClaudeCodeAdapter } from '@/integrations/adapters/claude-code';
import type { AgentTask, ExecutionEvent } from '@/integrations/types';

// Create mock process factory
function createMockProcess(): ChildProcess {
  const mockProcess = new EventEmitter() as ChildProcess;
  mockProcess.stdin = {
    write: mock(() => true),
    end: mock(() => {}),
  } as any;
  mockProcess.stdout = new Readable({ read: () => {} }) as any;
  mockProcess.stderr = new Readable({ read: () => {} }) as any;
  mockProcess.kill = mock(() => true);
  Object.defineProperty(mockProcess, 'killed', { value: false, writable: true });
  return mockProcess;
}

// Mock child_process spawn
const mockSpawn = mock(() => createMockProcess());

mock.module('node:child_process', () => ({
  spawn: mockSpawn,
}));

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    adapter = new ClaudeCodeAdapter();
    mockSpawn.mockClear();
  });

  describe('connect', () => {
    test('connects with valid API key credentials', async () => {
      const credentials = {
        type: 'api-key' as const,
        data: { key: 'sk-ant-test-key-123' },
      };

      // Setup mock for which and version commands
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        // Automatically emit success for check commands
        setTimeout(() => {
          proc.stdout!.emit('data', Buffer.from('1.0.0\n'));
          proc.emit('exit', 0);
        }, 1);
        return proc;
      });

      const connection = await adapter.connect(credentials);

      expect(connection.adapterId).toBe('claude-code');
      expect(connection.status).toBe('connected');
      expect(connection.credentials).toEqual(credentials);
      expect(connection.metadata?.cliVersion).toBeDefined();
    });

    test('throws error for invalid credential type', async () => {
      const credentials = {
        type: 'oauth' as const,
        data: {
          accessToken: 'test',
          refreshToken: 'test',
          tokenType: 'Bearer',
          scope: 'test',
          expiresAt: new Date(),
        },
      };

      await expect(adapter.connect(credentials)).rejects.toThrow(
        'Claude Code adapter requires API key credentials'
      );
    });

    test('throws error for invalid API key format', async () => {
      const credentials = {
        type: 'api-key' as const,
        data: { key: 'invalid-key' },
      };

      await expect(adapter.connect(credentials)).rejects.toThrow(
        'Invalid Anthropic API key format'
      );
    });

    test('throws error when CLI not available', async () => {
      const credentials = {
        type: 'api-key' as const,
        data: { key: 'sk-ant-test-key-123' },
      };

      // Mock which command to fail
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        setTimeout(() => proc.emit('exit', 1), 1);
        return proc;
      });

      await expect(adapter.connect(credentials)).rejects.toThrow('Claude CLI not found in PATH');
    });
  });

  describe('disconnect', () => {
    test('cleans up active sessions for connection', async () => {
      const credentials = {
        type: 'api-key' as const,
        data: { key: 'sk-ant-test-key-123' },
      };

      // Setup successful connection
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        setTimeout(() => {
          proc.stdout!.emit('data', Buffer.from('1.0.0\n'));
          proc.emit('exit', 0);
        }, 1);
        return proc;
      });

      const connection = await adapter.connect(credentials);

      // Disconnect should not throw
      await expect(adapter.disconnect(connection)).resolves.toBeUndefined();
    });
  });

  describe('validateCredentials', () => {
    test('returns true for valid API key credentials', async () => {
      const credentials = {
        type: 'api-key' as const,
        data: { key: 'sk-ant-test-key-123' },
      };

      const result = await adapter.validateCredentials(credentials);
      expect(result).toBe(true);
    });

    test('returns false for invalid credential type', async () => {
      const credentials = {
        type: 'oauth' as const,
        data: {
          accessToken: 'test',
          refreshToken: 'test',
          tokenType: 'Bearer',
          scope: 'test',
          expiresAt: new Date(),
        },
      };

      const result = await adapter.validateCredentials(credentials);
      expect(result).toBe(false);
    });

    test('returns false for invalid API key format', async () => {
      const credentials = {
        type: 'api-key' as const,
        data: { key: 'invalid-key' },
      };

      const result = await adapter.validateCredentials(credentials);
      expect(result).toBe(false);
    });
  });

  describe('execute', () => {
    test('yields started event first', async () => {
      const connection = {
        id: 'conn-1',
        adapterId: 'claude-code',
        status: 'connected' as const,
        credentials: { type: 'api-key' as const, data: { key: 'sk-ant-test-key-123' } },
        connectedAt: new Date(),
      };

      const task: AgentTask = {
        prompt: 'Test prompt',
      };

      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        setTimeout(() => {
          const stdout = proc.stdout as Readable;
          stdout.push(null); // End stream
          setTimeout(() => proc.emit('exit', 0), 1);
        }, 1);
        return proc;
      });

      const events: ExecutionEvent[] = [];
      for await (const event of adapter.execute(connection, task)) {
        events.push(event);
      }

      expect(events[0]?.type).toBe('started');
      expect(events[0]).toHaveProperty('timestamp');
    });

    test('parses stream-json output events', async () => {
      const connection = {
        id: 'conn-1',
        adapterId: 'claude-code',
        status: 'connected' as const,
        credentials: { type: 'api-key' as const, data: { key: 'sk-ant-test-key-123' } },
        connectedAt: new Date(),
      };

      const task: AgentTask = {
        prompt: 'Test prompt',
      };

      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        setTimeout(() => {
          const stdout = proc.stdout as Readable;
          stdout.push('{"type":"message_start"}\n');
          stdout.push(
            '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n',
          );
          stdout.push('{"type":"message_stop","usage":{"input_tokens":10,"output_tokens":5}}\n');
          stdout.push(null); // End stream
          setTimeout(() => proc.emit('exit', 0), 1);
        }, 1);
        return proc;
      });

      const events: ExecutionEvent[] = [];
      for await (const event of adapter.execute(connection, task)) {
        events.push(event);
      }

      // Should have: started, output, completed, cost
      expect(events.length).toBeGreaterThan(1);
      expect(events[0]?.type).toBe('started');
      expect(events.some((e) => e.type === 'output')).toBe(true);
    });

    test('handles tool use events', async () => {
      const connection = {
        id: 'conn-1',
        adapterId: 'claude-code',
        status: 'connected' as const,
        credentials: { type: 'api-key' as const, data: { key: 'sk-ant-test-key-123' } },
        connectedAt: new Date(),
      };

      const task: AgentTask = {
        prompt: 'Test prompt',
      };

      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        setTimeout(() => {
          const stdout = proc.stdout as Readable;
          stdout.push('{"type":"tool_use","name":"Read","input":{"path":"/test"}}\n');
          stdout.push('{"type":"tool_result","tool_use_id":"tool_1","content":"file content"}\n');
          stdout.push(null);
          setTimeout(() => proc.emit('exit', 0), 1);
        }, 1);
        return proc;
      });

      const events: ExecutionEvent[] = [];
      for await (const event of adapter.execute(connection, task)) {
        events.push(event);
      }

      const toolCallEvent = events.find((e) => e.type === 'tool-call');
      const toolResultEvent = events.find((e) => e.type === 'tool-result');

      expect(toolCallEvent).toBeDefined();
      expect(toolResultEvent).toBeDefined();
    });

    test('respects timeout option', async () => {
      const connection = {
        id: 'conn-1',
        adapterId: 'claude-code',
        status: 'connected' as const,
        credentials: { type: 'api-key' as const, data: { key: 'sk-ant-test-key-123' } },
        connectedAt: new Date(),
      };

      const task: AgentTask = {
        prompt: 'Test prompt',
      };

      let mockProc: ChildProcess;
      mockSpawn.mockImplementation(() => {
        mockProc = createMockProcess();
        // Don't emit exit immediately, let timeout trigger
        setTimeout(() => {
          const stdout = mockProc.stdout as Readable;
          stdout.push(null);
          setTimeout(() => mockProc.emit('exit', null), 1);
        }, 200);
        return mockProc;
      });

      const events: ExecutionEvent[] = [];
      for await (const event of adapter.execute(connection, task, { timeout: 50 })) {
        events.push(event);
      }

      expect(mockProc!.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('handles process errors', async () => {
      const connection = {
        id: 'conn-1',
        adapterId: 'claude-code',
        status: 'connected' as const,
        credentials: { type: 'api-key' as const, data: { key: 'sk-ant-test-key-123' } },
        connectedAt: new Date(),
      };

      const task: AgentTask = {
        prompt: 'Test prompt',
      };

      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        setTimeout(() => {
          const stdout = proc.stdout as Readable;
          stdout.push('{"type":"error","error":{"message":"API error"}}\n');
          stdout.push(null);
          setTimeout(() => proc.emit('exit', 1), 1);
        }, 1);
        return proc;
      });

      const events: ExecutionEvent[] = [];
      for await (const event of adapter.execute(connection, task)) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });
  });

  describe('getCapabilities', () => {
    test('returns correct capabilities', () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.supportsTools).toBe(true);
      expect(capabilities.supportsImages).toBe(true);
      expect(capabilities.maxContextTokens).toBe(200_000);
      expect(capabilities.supportedModels.length).toBeGreaterThan(0);
    });
  });

  describe('estimateCost', () => {
    test('estimates cost based on token count', () => {
      const task: AgentTask = {
        prompt: 'Test prompt that is about 20 characters long',
        context: 'Some context',
      };

      const estimate = adapter.estimateCost(task);

      expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
      expect(estimate.estimatedOutputTokens).toBeGreaterThan(0);
      expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
      expect(estimate.model).toBe('claude-sonnet-4-5-20250929');
    });

    test('uses maxTokens constraint for output estimation', () => {
      const task: AgentTask = {
        prompt: 'Test prompt',
        constraints: {
          maxTokens: 1000,
        },
      };

      const estimate = adapter.estimateCost(task);

      expect(estimate.estimatedOutputTokens).toBe(1000);
    });
  });
});

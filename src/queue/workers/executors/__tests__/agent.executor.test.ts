import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Job } from 'bullmq';

import type { AgentNode } from '@/db/schema';
import type { AgentAdapter, ExecutionEvent } from '@/integrations/types';
import type { ExecutionContext, NodeJobData } from '../../types';
import { AgentExecutor } from '../agent.executor';

// Mock dependencies
const mockDb = {
  query: {
    agents: {
      findFirst: mock(() => Promise.resolve(null)),
    },
  },
  insert: mock(() => ({
    values: mock(() => Promise.resolve()),
  })),
};

const mockVaultService = {
  retrieveCredential: mock(() =>
    Promise.resolve({
      id: 'cred-1',
      name: 'Test Credential',
      type: 'api-key' as const,
      integration: 'claude-code',
      data: { key: 'sk-ant-test-key' },
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  ),
};

const mockAdapter: AgentAdapter = {
  id: 'claude-code',
  name: 'Claude Code',
  type: 'claude-code',
  connect: mock(() =>
    Promise.resolve({
      id: 'conn-1',
      adapterId: 'claude-code',
      status: 'connected',
      credentials: { type: 'api-key', data: { key: 'sk-ant-test-key' } },
      connectedAt: new Date(),
    })
  ),
  disconnect: mock(() => Promise.resolve()),
  validateCredentials: mock(() => Promise.resolve(true)),
  execute: mock(async function* () {
    const events: ExecutionEvent[] = [
      { type: 'started', timestamp: new Date() },
      { type: 'output', content: 'Test response' },
      {
        type: 'completed',
        result: { success: true, output: 'Test response', metadata: {} },
      },
      {
        type: 'cost',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      },
    ];
    for (const event of events) {
      yield event;
    }
  }),
  getCapabilities: mock(() => ({
    supportsStreaming: true,
    supportsTools: true,
    supportsImages: true,
    maxContextTokens: 200000,
    supportedModels: ['claude-sonnet-4-5-20250929'],
  })),
  estimateCost: mock(() => ({
    estimatedInputTokens: 100,
    estimatedOutputTokens: 50,
    estimatedCostUsd: 0.001,
    model: 'claude-sonnet-4-5-20250929',
  })),
};

const mockGetAdapter = mock(() => mockAdapter);

// Mock modules
mock.module('@/db/client', () => ({ db: mockDb }));
mock.module('@/vault/service', () => ({ vaultService: mockVaultService }));
mock.module('@/integrations/registry', () => ({ getAdapter: mockGetAdapter }));

describe('AgentExecutor', () => {
  let executor: AgentExecutor;
  let mockJob: Job<NodeJobData>;
  let context: ExecutionContext;
  let node: AgentNode;

  beforeEach(() => {
    executor = new AgentExecutor();

    // Reset ALL mocks including execute
    mockDb.query.agents.findFirst.mockClear();
    mockDb.insert.mockClear();
    mockVaultService.retrieveCredential.mockClear();
    mockGetAdapter.mockClear();
    (mockAdapter.connect as ReturnType<typeof mock>).mockClear();
    (mockAdapter.disconnect as ReturnType<typeof mock>).mockClear();
    (mockAdapter.execute as ReturnType<typeof mock>).mockClear();

    // Re-setup default execute mock
    (mockAdapter.execute as ReturnType<typeof mock>).mockImplementation(async function* () {
      const events: ExecutionEvent[] = [
        { type: 'started', timestamp: new Date() },
        { type: 'output', content: 'Test response' },
        {
          type: 'completed',
          result: { success: true, output: 'Test response', metadata: {} },
        },
        {
          type: 'cost',
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      ];
      for (const event of events) {
        yield event;
      }
    });

    // Setup test data
    mockJob = { id: 'job-1' } as Job<NodeJobData>;

    context = {
      runId: 'run-1',
      workflowId: 'workflow-1',
      triggerType: 'manual',
      input: { test: 'value' },
      nodeResults: new Map(),
      startedAt: new Date(),
    };

    node = {
      id: 'node-1',
      type: 'agent',
      agentId: 'agent-1',
      input: {
        prompt: 'Test prompt',
      },
      timeout: 30000,
    };

    // Setup default mock responses
    mockDb.query.agents.findFirst.mockResolvedValue({
      id: 'agent-1',
      name: 'Test Agent',
      description: 'A test agent',
      tags: [],
      modelConfig: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
        parameters: { maxTokens: 4096 },
      },
      memoryMode: 'stateless',
      isolationLevel: 'shared',
      canSpawnSubAgents: false,
      maxSubAgents: null,
      skills: ['skill-1'],
      allowedMcpTools: ['tool-1', 'tool-2'],
      integration: {
        type: 'claude-code',
        connectionId: 'cred-1',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  describe('execute', () => {
    it('should successfully execute an agent node', async () => {
      const result = await executor.execute(node, context, mockJob);

      expect(result.status).toBe('completed');
      expect(result.nodeId).toBe('node-1');
      expect(result.output).toBeDefined();
      expect((result.output as { response: string }).response).toContain('Test response');
      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('should fetch agent configuration from database', async () => {
      await executor.execute(node, context, mockJob);

      expect(mockDb.query.agents.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should retrieve credentials from vault', async () => {
      await executor.execute(node, context, mockJob);

      expect(mockVaultService.retrieveCredential).toHaveBeenCalledWith('cred-1');
    });

    it('should get adapter from registry', async () => {
      await executor.execute(node, context, mockJob);

      expect(mockGetAdapter).toHaveBeenCalledWith('claude-code');
    });

    it('should connect to adapter', async () => {
      await executor.execute(node, context, mockJob);

      expect(mockAdapter.connect).toHaveBeenCalledWith({
        type: 'api-key',
        data: { key: 'sk-ant-test-key' },
      });
    });

    it('should disconnect from adapter after execution', async () => {
      await executor.execute(node, context, mockJob);

      expect(mockAdapter.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should record token usage in database', async () => {
      await executor.execute(node, context, mockJob);

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('should include token usage in output', async () => {
      const result = await executor.execute(node, context, mockJob);

      expect(result.output).toBeDefined();
      const output = result.output as {
        tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
      };
      expect(output.tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    });

    it('should include agent information in output', async () => {
      const result = await executor.execute(node, context, mockJob);

      expect(result.output).toBeDefined();
      const output = result.output as {
        agent: { id: string; name: string; model: string };
      };
      expect(output.agent).toEqual({
        id: 'agent-1',
        name: 'Test Agent',
        model: 'claude-sonnet-4-5-20250929',
      });
    });

    it('should handle agent not found error', async () => {
      mockDb.query.agents.findFirst.mockResolvedValueOnce(null);

      const result = await executor.execute(node, context, mockJob);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Agent not found');
    });

    it('should handle agent without integration', async () => {
      mockDb.query.agents.findFirst.mockResolvedValueOnce({
        id: 'agent-1',
        name: 'Test Agent',
        description: 'A test agent',
        tags: [],
        modelConfig: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
        },
        memoryMode: 'stateless',
        isolationLevel: 'shared',
        canSpawnSubAgents: false,
        maxSubAgents: null,
        skills: [],
        allowedMcpTools: [],
        integration: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await executor.execute(node, context, mockJob);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('no integration configured');
    });

    it('should handle adapter connection failure', async () => {
      (mockAdapter.connect as ReturnType<typeof mock>).mockRejectedValueOnce(
        new Error('Connection failed')
      );

      const result = await executor.execute(node, context, mockJob);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Failed to connect adapter');
    });

    it('should handle execution error', async () => {
      (mockAdapter.execute as ReturnType<typeof mock>).mockImplementationOnce(async function* () {
        yield { type: 'started', timestamp: new Date() } as ExecutionEvent;
        yield { type: 'error', error: new Error('Execution failed') } as ExecutionEvent;
      });

      const result = await executor.execute(node, context, mockJob);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Execution failed');
    });

    it('should disconnect adapter even if execution fails', async () => {
      (mockAdapter.execute as ReturnType<typeof mock>).mockImplementationOnce(async function* () {
        yield { type: 'started', timestamp: new Date() } as ExecutionEvent;
        throw new Error('Unexpected error');
      });

      await executor.execute(node, context, mockJob);

      expect(mockAdapter.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should apply task constraints from agent config', async () => {
      await executor.execute(node, context, mockJob);

      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
      const [, task] = (mockAdapter.execute as ReturnType<typeof mock>).mock.calls[0];

      expect(task.constraints).toBeDefined();
      expect(task.constraints.maxTokens).toBe(4096);
      expect(task.constraints.maxDuration).toBe(30000);
      expect(task.constraints.allowedTools).toEqual(['tool-1', 'tool-2']);
    });

    it('should resolve input from previous node results', async () => {
      // Add a previous node result
      context.nodeResults.set('prev-node', {
        nodeId: 'prev-node',
        status: 'completed',
        output: { data: { value: 'from-previous-node' } },
        startedAt: new Date(),
        completedAt: new Date(),
      });

      // Update node to reference previous node
      node.input = {
        prompt: { fromNode: 'prev-node', path: 'data.value' },
      };

      await executor.execute(node, context, mockJob);

      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
      const [, task] = (mockAdapter.execute as ReturnType<typeof mock>).mock.calls[0];

      expect(task.prompt).toContain('from-previous-node');
    });

    it('should build context with agent description and skills', async () => {
      await executor.execute(node, context, mockJob);

      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
      const [, task] = (mockAdapter.execute as ReturnType<typeof mock>).mock.calls[0];

      expect(task.context).toContain('Test Agent');
      expect(task.context).toContain('A test agent');
      expect(task.context).toContain('skill-1');
      expect(task.context).toContain(context.runId);
    });

    it('should only record usage if tokens were consumed', async () => {
      (mockAdapter.execute as ReturnType<typeof mock>).mockImplementationOnce(async function* () {
        yield { type: 'started', timestamp: new Date() } as ExecutionEvent;
        yield { type: 'output', content: 'Test' } as ExecutionEvent;
        yield {
          type: 'completed',
          result: { success: true, output: 'Test' },
        } as ExecutionEvent;
        // No cost event
      });

      await executor.execute(node, context, mockJob);

      // Should not insert usage record
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('type property', () => {
    it('should have type "agent"', () => {
      expect(executor.type).toBe('agent');
    });
  });
});

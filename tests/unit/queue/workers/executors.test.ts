import { describe, expect, it } from 'bun:test';
import type { AgentNode, ConditionNode } from '@/db/schema';
import type { NodeJobData } from '@/queue/client';
import { AgentExecutor } from '@/queue/workers/executors/agent.executor';
import { ConditionExecutor } from '@/queue/workers/executors/condition.executor';
import type { ExecutionContext } from '@/queue/workers/types';
import type { Job } from 'bullmq';

describe('Node Executors', () => {
  // Mock job
  const createMockJob = (): Job<NodeJobData> =>
    ({
      data: {
        runId: 'run-123',
        workflowId: 'workflow-123',
        nodeId: 'node-1',
        input: {},
        context: {},
      },
    }) as Job<NodeJobData>;

  // Mock execution context
  const createContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
    runId: 'run-123',
    workflowId: 'workflow-123',
    triggerType: 'manual',
    input: {},
    nodeResults: new Map(),
    startedAt: new Date(),
    ...overrides,
  });

  describe('ConditionExecutor', () => {
    const executor = new ConditionExecutor();

    it('should have correct type', () => {
      expect(executor.type).toBe('condition');
    });

    describe('simple comparisons', () => {
      it('should evaluate equality to true', async () => {
        const node: ConditionNode = {
          id: 'cond-1',
          type: 'condition',
          expression: 'input.status == "approved"',
          trueBranch: 'approve-node',
          falseBranch: 'reject-node',
        };

        const context = createContext({
          input: { status: 'approved' },
        });

        const result = await executor.execute(node, context, createMockJob());

        expect(result.status).toBe('completed');
        expect(result.output).toEqual({
          result: true,
          branch: 'approve-node',
          expression: node.expression,
        });
      });

      it('should evaluate equality to false', async () => {
        const node: ConditionNode = {
          id: 'cond-1',
          type: 'condition',
          expression: 'input.status == "approved"',
          trueBranch: 'approve-node',
          falseBranch: 'reject-node',
        };

        const context = createContext({
          input: { status: 'pending' },
        });

        const result = await executor.execute(node, context, createMockJob());

        expect(result.status).toBe('completed');
        expect(result.output).toEqual({
          result: false,
          branch: 'reject-node',
          expression: node.expression,
        });
      });

      it('should evaluate numeric comparison', async () => {
        const node: ConditionNode = {
          id: 'cond-1',
          type: 'condition',
          expression: 'input.amount > 100',
          trueBranch: 'high-value',
          falseBranch: 'low-value',
        };

        const context = createContext({
          input: { amount: 150 },
        });

        const result = await executor.execute(node, context, createMockJob());

        expect(result.status).toBe('completed');
        expect((result.output as { result: boolean }).result).toBe(true);
        expect((result.output as { branch: string }).branch).toBe('high-value');
      });

      it('should handle inequality', async () => {
        const node: ConditionNode = {
          id: 'cond-1',
          type: 'condition',
          expression: 'input.type != "skip"',
          trueBranch: 'process',
          falseBranch: 'skip',
        };

        const context = createContext({
          input: { type: 'normal' },
        });

        const result = await executor.execute(node, context, createMockJob());

        expect((result.output as { result: boolean }).result).toBe(true);
      });
    });

    describe('logical operators', () => {
      it('should evaluate AND expression', async () => {
        const node: ConditionNode = {
          id: 'cond-1',
          type: 'condition',
          expression: 'input.status == "approved" && input.amount > 50',
          trueBranch: 'process',
          falseBranch: 'reject',
        };

        const context = createContext({
          input: { status: 'approved', amount: 100 },
        });

        const result = await executor.execute(node, context, createMockJob());

        expect((result.output as { result: boolean }).result).toBe(true);
      });

      it('should evaluate AND with one false', async () => {
        const node: ConditionNode = {
          id: 'cond-1',
          type: 'condition',
          expression: 'input.status == "approved" && input.amount > 50',
          trueBranch: 'process',
          falseBranch: 'reject',
        };

        const context = createContext({
          input: { status: 'approved', amount: 30 },
        });

        const result = await executor.execute(node, context, createMockJob());

        expect((result.output as { result: boolean }).result).toBe(false);
      });

      it('should evaluate OR expression', async () => {
        const node: ConditionNode = {
          id: 'cond-1',
          type: 'condition',
          expression: 'input.priority == "high" || input.amount > 1000',
          trueBranch: 'urgent',
          falseBranch: 'normal',
        };

        const context = createContext({
          input: { priority: 'low', amount: 1500 },
        });

        const result = await executor.execute(node, context, createMockJob());

        expect((result.output as { result: boolean }).result).toBe(true);
      });
    });

    describe('boolean literals', () => {
      it('should handle true literal', async () => {
        const node: ConditionNode = {
          id: 'cond-1',
          type: 'condition',
          expression: 'true',
          trueBranch: 'always',
          falseBranch: 'never',
        };

        const result = await executor.execute(node, createContext(), createMockJob());

        expect((result.output as { result: boolean }).result).toBe(true);
      });

      it('should handle false literal', async () => {
        const node: ConditionNode = {
          id: 'cond-1',
          type: 'condition',
          expression: 'false',
          trueBranch: 'never',
          falseBranch: 'always',
        };

        const result = await executor.execute(node, createContext(), createMockJob());

        expect((result.output as { result: boolean }).result).toBe(false);
      });
    });

    describe('error handling', () => {
      it('should return false for invalid expressions', async () => {
        const node: ConditionNode = {
          id: 'cond-1',
          type: 'condition',
          expression: 'this is not valid syntax @@##',
          trueBranch: 'true-branch',
          falseBranch: 'false-branch',
        };

        const result = await executor.execute(node, createContext(), createMockJob());

        // Should complete but evaluate to false
        expect(result.status).toBe('completed');
        expect((result.output as { result: boolean }).result).toBe(false);
      });

      it('should return false for missing input fields', async () => {
        const node: ConditionNode = {
          id: 'cond-1',
          type: 'condition',
          expression: 'input.nonexistent == "value"',
          trueBranch: 'true-branch',
          falseBranch: 'false-branch',
        };

        const result = await executor.execute(node, createContext(), createMockJob());

        expect((result.output as { result: boolean }).result).toBe(false);
      });
    });
  });

  describe('AgentExecutor', () => {
    const executor = new AgentExecutor();

    it('should have correct type', () => {
      expect(executor.type).toBe('agent');
    });

    it('should execute and return completed status', async () => {
      const node: AgentNode = {
        id: 'agent-1',
        type: 'agent',
        agentId: 'test-agent',
        input: { prompt: 'Hello world' },
      };

      const result = await executor.execute(node, createContext(), createMockJob());

      expect(result.status).toBe('completed');
      expect(result.nodeId).toBe('agent-1');
      expect(result.output).toBeDefined();
      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('should include timing information', async () => {
      const node: AgentNode = {
        id: 'agent-1',
        type: 'agent',
        agentId: 'test-agent',
        input: {},
      };

      const result = await executor.execute(node, createContext(), createMockJob());

      expect(result.startedAt.getTime()).toBeLessThanOrEqual(result.completedAt.getTime());
    });

    it('should include agent info in output', async () => {
      const node: AgentNode = {
        id: 'agent-1',
        type: 'agent',
        agentId: 'my-agent-id',
        input: { key: 'value' },
      };

      const result = await executor.execute(node, createContext(), createMockJob());

      const output = result.output as { message: string; input: unknown };
      expect(output.message).toContain('my-agent-id');
      expect(output.input).toEqual({ key: 'value' });
    });
  });
});

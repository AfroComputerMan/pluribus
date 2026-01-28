import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { agents, usageRecords } from '@/db/schema';
import type { AgentNode } from '@/db/schema';
import { getAdapter } from '@/integrations/registry';
import type {
  AdapterConnection,
  AdapterCredentials,
  AgentTask,
  ExecutionEvent,
} from '@/integrations/types';
import { IntegrationError } from '@/lib/errors';
import { logger } from '@/observability/logger';
import { vaultService } from '@/vault/service';
import type { NodeJobData } from '../../client';
import type { ExecutionContext, NodeExecutor, NodeProcessorResult } from '../types';

const log = logger.child('executor:agent');

/**
 * AgentExecutor handles execution of agent nodes.
 * Connects to integration adapters (Claude Code, Codex, etc.) to execute agent tasks.
 */
export class AgentExecutor implements NodeExecutor<AgentNode> {
  readonly type = 'agent' as const;

  async execute(
    node: AgentNode,
    context: ExecutionContext,
    _job: Job<NodeJobData>
  ): Promise<NodeProcessorResult> {
    const startedAt = new Date();

    log.info('Executing agent node', {
      nodeId: node.id,
      agentId: node.agentId,
      runId: context.runId,
    });

    try {
      // 1. Fetch agent configuration from database
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, node.agentId),
      });

      if (!agent) {
        throw new IntegrationError('agent', `Agent not found: ${node.agentId}`);
      }

      // 2. Validate agent has integration configured
      if (!agent.integration) {
        throw new IntegrationError('agent', `Agent ${agent.name} has no integration configured`);
      }

      // 3. Get the appropriate adapter from the registry
      const adapter = getAdapter(agent.integration.type);

      // 4. Fetch credentials for the integration
      const credential = await vaultService.retrieveCredential(agent.integration.connectionId);

      // 5. Connect to the adapter
      let connection: AdapterConnection;
      try {
        // Build properly typed credentials
        const adapterCredentials: AdapterCredentials =
          credential.type === 'oauth'
            ? {
                type: 'oauth',
                data: credential.data as {
                  accessToken: string;
                  refreshToken: string;
                  tokenType: string;
                  scope: string;
                  expiresAt: Date;
                },
              }
            : {
                type: 'api-key',
                data: credential.data as { key: string },
              };

        connection = await adapter.connect(adapterCredentials);
      } catch (error) {
        throw new IntegrationError(
          adapter.id,
          `Failed to connect adapter: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }

      // 6. Prepare the task
      const task: AgentTask = {
        prompt: this.buildPrompt(node, context),
        context: this.buildContext(agent, context),
        constraints: {
          maxTokens: agent.modelConfig.parameters?.maxTokens as number | undefined,
          maxDuration: node.timeout,
          allowedTools:
            agent.allowedMcpTools && agent.allowedMcpTools.length > 0
              ? agent.allowedMcpTools
              : undefined,
        },
      };

      // 7. Execute the agent task and stream results
      const outputBuffer: string[] = [];
      let tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      let executionError: Error | undefined;

      try {
        for await (const event of adapter.execute(connection, task)) {
          await this.handleEvent(event, outputBuffer);

          // Capture token usage
          if (event.type === 'cost') {
            tokenUsage = event.usage;
          }

          // Capture errors
          if (event.type === 'error') {
            executionError = event.error;
          }
        }
      } finally {
        // Always disconnect after execution
        await adapter.disconnect(connection);
      }

      // If execution resulted in an error, throw it
      if (executionError) {
        throw executionError;
      }

      // 8. Track token usage in database
      if (tokenUsage.totalTokens > 0) {
        await this.recordUsage(
          agent.id,
          context.runId,
          agent.modelConfig.provider,
          agent.modelConfig.model,
          tokenUsage
        );
      }

      const completedAt = new Date();

      log.info('Agent node completed', {
        nodeId: node.id,
        agentId: node.agentId,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        tokens: tokenUsage.totalTokens,
      });

      return {
        nodeId: node.id,
        status: 'completed',
        output: {
          response: outputBuffer.join(''),
          tokenUsage,
          agent: {
            id: agent.id,
            name: agent.name,
            model: agent.modelConfig.model,
          },
        },
        startedAt,
        completedAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      log.error('Agent node failed', {
        nodeId: node.id,
        agentId: node.agentId,
        error: errorMessage,
      });

      return {
        nodeId: node.id,
        status: 'failed',
        error: errorMessage,
        startedAt,
        completedAt: new Date(),
      };
    }
  }

  /**
   * Build the prompt for the agent task.
   */
  private buildPrompt(node: AgentNode, context: ExecutionContext): string {
    // Resolve input mapping to actual values
    const resolvedInput: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(node.input)) {
      if (typeof value === 'string') {
        // Static value
        resolvedInput[key] = value;
      } else if (typeof value === 'object' && value !== null && 'fromNode' in value) {
        // Reference to another node's output
        const sourceNode = context.nodeResults.get(value.fromNode as string);
        if (sourceNode?.output) {
          // Extract value from output using path
          const path = (value as { path: string }).path;
          resolvedInput[key] = this.getValueAtPath(sourceNode.output, path);
        }
      }
    }

    // Format the prompt with input values
    return JSON.stringify(resolvedInput, null, 2);
  }

  /**
   * Build context information for the agent.
   */
  private buildContext(
    agent: { name: string; description: string | null; skills: string[] | null },
    context: ExecutionContext
  ): string {
    const parts: string[] = [];

    if (agent.description) {
      parts.push(`Agent: ${agent.name}`);
      parts.push(`Description: ${agent.description}`);
    }

    if (agent.skills && agent.skills.length > 0) {
      parts.push(`Available skills: ${agent.skills.join(', ')}`);
    }

    parts.push(`Workflow Run ID: ${context.runId}`);
    parts.push(`Trigger Type: ${context.triggerType}`);

    return parts.join('\n');
  }

  /**
   * Handle execution events from the adapter.
   */
  private async handleEvent(event: ExecutionEvent, outputBuffer: string[]): Promise<void> {
    switch (event.type) {
      case 'started':
        log.debug('Agent execution started');
        break;

      case 'thinking':
        log.debug('Agent thinking', { content: event.content.slice(0, 100) });
        break;

      case 'tool-call':
        log.debug('Agent tool call', { tool: event.tool });
        break;

      case 'tool-result':
        log.debug('Agent tool result', { tool: event.tool });
        break;

      case 'output':
        outputBuffer.push(event.content);
        break;

      case 'completed':
        log.debug('Agent execution completed', { success: event.result.success });
        break;

      case 'error':
        log.error('Agent execution error', { error: event.error.message });
        break;

      case 'cost':
        log.debug('Agent cost', { tokens: event.usage.totalTokens });
        break;
    }
  }

  /**
   * Record token usage in the database.
   */
  private async recordUsage(
    agentId: string,
    workflowRunId: string,
    provider: string,
    model: string,
    usage: { inputTokens: number; outputTokens: number }
  ): Promise<void> {
    // Calculate estimated cost based on model
    const estimatedCostUsd = this.calculateCost(provider, model, usage);

    await db.insert(usageRecords).values({
      agentId,
      workflowRunId,
      provider,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: estimatedCostUsd.toString(),
    });

    log.debug('Usage recorded', {
      agentId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: estimatedCostUsd,
    });
  }

  /**
   * Calculate estimated cost based on provider and model.
   */
  private calculateCost(
    _provider: string,
    model: string,
    usage: { inputTokens: number; outputTokens: number }
  ): number {
    // Pricing per 1M tokens (USD)
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
      'claude-opus-4-5-20251101': { input: 15.0, output: 75.0 },
      'claude-sonnet-3-5-20241022': { input: 3.0, output: 15.0 },
      'claude-haiku-3-5-20241022': { input: 0.8, output: 4.0 },
    };

    const modelPricing = pricing[model] || { input: 0, output: 0 };
    const inputCost = (usage.inputTokens / 1_000_000) * modelPricing.input;
    const outputCost = (usage.outputTokens / 1_000_000) * modelPricing.output;

    return inputCost + outputCost;
  }

  /**
   * Extract value from object using dot-notation path.
   */
  private getValueAtPath(obj: unknown, path: string): unknown {
    if (!path) return obj;

    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }
}

// Default singleton instance
export const agentExecutor = new AgentExecutor();

import type { Job } from 'bullmq';
import { eq, and } from 'drizzle-orm';

import { db } from '@/db/client';
import { nodeExecutions } from '@/db/schema';
import type { LoopNode } from '@/db/schema';
import { logger } from '@/observability/logger';
import type { NodeJobData } from '../../client';
import { enqueueNode } from '../../client';
import type { ExecutionContext, NodeExecutor, NodeProcessorResult } from '../types';

const log = logger.child('executor:loop');

/**
 * LoopExecutor handles iterative loop node execution.
 * It repeatedly executes the body node until the condition is false or max iterations reached.
 */
export class LoopExecutor implements NodeExecutor<LoopNode> {
  readonly type = 'loop' as const;

  async execute(
    node: LoopNode,
    context: ExecutionContext,
    job: Job<NodeJobData>
  ): Promise<NodeProcessorResult> {
    const startedAt = new Date();

    log.info(
      {
        nodeId: node.id,
        maxIterations: node.maxIterations,
        bodyNode: node.body,
        runId: context.runId,
      },
      'Executing loop node'
    );

    try {
      const iterations: Array<{ iteration: number; output: unknown }> = [];
      let currentIteration = 0;

      // Create a mutable context for loop iterations
      let loopContext = { ...context.input };

      while (currentIteration < node.maxIterations) {
        // Evaluate the loop condition
        const shouldContinue = this.evaluateCondition(node.condition, {
          input: loopContext,
          iteration: currentIteration,
          results: Object.fromEntries(context.nodeResults),
        });

        if (!shouldContinue) {
          log.debug(
            { nodeId: node.id, iteration: currentIteration },
            'Loop condition evaluated to false, exiting'
          );
          break;
        }

        currentIteration++;

        log.debug(
          { nodeId: node.id, iteration: currentIteration },
          'Starting loop iteration'
        );

        // Enqueue the body node
        const iterationNodeId = `${node.body}:iteration:${currentIteration}`;

        await enqueueNode({
          runId: context.runId,
          workflowId: context.workflowId,
          nodeId: node.body,
          input: {
            ...loopContext,
            _loopIteration: currentIteration,
            _loopParentId: node.id,
          },
          context: {
            triggerType: context.triggerType,
            workflowInput: context.input,
            nodeResults: Object.fromEntries(context.nodeResults),
            loopIteration: currentIteration,
            loopParentId: node.id,
          },
        });

        // Wait for iteration to complete
        const iterationResult = await this.waitForIteration(
          context.runId,
          node.body,
          currentIteration
        );

        if (!iterationResult.success) {
          return {
            nodeId: node.id,
            status: 'failed',
            error: `Loop iteration ${currentIteration} failed: ${iterationResult.error}`,
            output: {
              completedIterations: iterations,
              failedAtIteration: currentIteration,
            },
            startedAt,
            completedAt: new Date(),
          };
        }

        iterations.push({
          iteration: currentIteration,
          output: iterationResult.output,
        });

        // Update loop context with iteration output for next iteration
        if (iterationResult.output && typeof iterationResult.output === 'object') {
          loopContext = { ...loopContext, ...(iterationResult.output as object) };
        }
      }

      const completedAt = new Date();

      log.info(
        {
          nodeId: node.id,
          totalIterations: currentIteration,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        'Loop node completed'
      );

      return {
        nodeId: node.id,
        status: 'completed',
        output: {
          totalIterations: currentIteration,
          maxIterations: node.maxIterations,
          iterations,
          finalContext: loopContext,
        },
        startedAt,
        completedAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      log.error(
        {
          nodeId: node.id,
          error: errorMessage,
        },
        'Loop node failed'
      );

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
   * Evaluate the loop condition.
   */
  private evaluateCondition(
    condition: string,
    context: {
      input: Record<string, unknown>;
      iteration: number;
      results: Record<string, unknown>;
    }
  ): boolean {
    try {
      // Replace context references
      let evaluable = condition;

      // Handle input.* references
      evaluable = evaluable.replace(/input\.(\w+)/g, (_, key) => {
        const value = context.input[key];
        return JSON.stringify(value);
      });

      // Handle iteration reference
      evaluable = evaluable.replace(/iteration/g, String(context.iteration));

      // Handle results.nodeId.* references
      evaluable = evaluable.replace(/results\.(\w+)\.(\w+)/g, (_, nodeId, key) => {
        const nodeResult = context.results[nodeId] as Record<string, unknown> | undefined;
        const value = nodeResult?.[key];
        return JSON.stringify(value);
      });

      // Simple boolean evaluation
      return this.safeEvaluate(evaluable);
    } catch (error) {
      log.warn({ condition, error }, 'Loop condition evaluation failed, defaulting to false');
      return false;
    }
  }

  /**
   * Safe boolean expression evaluator.
   */
  private safeEvaluate(expression: string): boolean {
    // Handle comparison operators
    const comparisonMatch = expression.match(
      /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/
    );

    if (comparisonMatch) {
      const [, leftStr, operator, rightStr] = comparisonMatch;
      const left = this.parseValue(leftStr.trim());
      const right = this.parseValue(rightStr.trim());

      switch (operator) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '>':
          return Number(left) > Number(right);
        case '<':
          return Number(left) < Number(right);
        case '>=':
          return Number(left) >= Number(right);
        case '<=':
          return Number(left) <= Number(right);
        default:
          return false;
      }
    }

    // Boolean literals
    if (expression.trim() === 'true') return true;
    if (expression.trim() === 'false') return false;

    try {
      return Boolean(JSON.parse(expression));
    } catch {
      return false;
    }
  }

  private parseValue(str: string): unknown {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  /**
   * Wait for a loop iteration to complete.
   */
  private async waitForIteration(
    runId: string,
    bodyNodeId: string,
    iteration: number
  ): Promise<{
    success: boolean;
    output?: unknown;
    error?: string;
  }> {
    const maxWaitTime = 300000; // 5 minutes
    const pollInterval = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      // Find the most recent execution of the body node
      const executions = await db
        .select()
        .from(nodeExecutions)
        .where(
          and(
            eq(nodeExecutions.workflowRunId, runId),
            eq(nodeExecutions.nodeId, bodyNodeId)
          )
        )
        .orderBy(nodeExecutions.createdAt);

      // Get the execution for this iteration (most recent)
      const execution = executions[executions.length - 1];

      if (execution) {
        if (execution.status === 'completed') {
          return { success: true, output: execution.output };
        }
        if (execution.status === 'failed') {
          return { success: false, error: execution.error ?? 'Unknown error' };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return { success: false, error: 'Iteration timeout' };
  }
}

// Default singleton instance
export const loopExecutor = new LoopExecutor();

import type { Job } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { nodeExecutions } from '@/db/schema';
import type { ParallelNode } from '@/db/schema';
import { logger } from '@/observability/logger';
import type { NodeJobData } from '../../client';
import { enqueueNode } from '../../client';
import type { ExecutionContext, NodeExecutor, NodeProcessorResult } from '../types';

const log = logger.child('executor:parallel');

/**
 * ParallelExecutor handles parallel branch execution.
 * It enqueues all branch nodes and waits for them according to the join strategy.
 */
export class ParallelExecutor implements NodeExecutor<ParallelNode> {
  readonly type = 'parallel' as const;

  async execute(
    node: ParallelNode,
    context: ExecutionContext,
    _job: Job<NodeJobData>
  ): Promise<NodeProcessorResult> {
    const startedAt = new Date();

    log.info(
      {
        nodeId: node.id,
        branches: node.branches,
        joinStrategy: node.joinStrategy,
        runId: context.runId,
      },
      'Executing parallel node'
    );

    try {
      // 1. Enqueue all branch nodes for parallel execution
      for (const branchNodeId of node.branches) {
        await enqueueNode({
          runId: context.runId,
          workflowId: context.workflowId,
          nodeId: branchNodeId,
          input: {},
          context: {
            triggerType: context.triggerType,
            workflowInput: context.input,
            nodeResults: Object.fromEntries(context.nodeResults),
            parallelParentId: node.id,
          },
        });

        log.debug(
          { runId: context.runId, branchNodeId, parentId: node.id },
          'Enqueued parallel branch'
        );
      }

      // 2. Wait for branches based on join strategy
      const result = await this.waitForBranches(context.runId, node.branches, node.joinStrategy);

      const completedAt = new Date();

      log.info(
        {
          nodeId: node.id,
          joinStrategy: node.joinStrategy,
          branchResults: result.completedBranches,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        'Parallel node completed'
      );

      return {
        nodeId: node.id,
        status: result.success ? 'completed' : 'failed',
        output: {
          joinStrategy: node.joinStrategy,
          branches: node.branches,
          completedBranches: result.completedBranches,
          failedBranches: result.failedBranches,
          branchOutputs: result.branchOutputs,
        },
        error: result.error,
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
        'Parallel node failed'
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
   * Wait for branch nodes based on join strategy.
   */
  private async waitForBranches(
    runId: string,
    branchNodeIds: string[],
    joinStrategy: 'all' | 'any' | 'race'
  ): Promise<{
    success: boolean;
    completedBranches: string[];
    failedBranches: string[];
    branchOutputs: Record<string, unknown>;
    error?: string;
  }> {
    const maxWaitTime = 300000; // 5 minutes max
    const pollInterval = 1000; // 1 second
    const startTime = Date.now();

    const completedBranches: string[] = [];
    const failedBranches: string[] = [];
    const branchOutputs: Record<string, unknown> = {};

    while (Date.now() - startTime < maxWaitTime) {
      // Check status of all branch nodes
      const executions = await db
        .select()
        .from(nodeExecutions)
        .where(
          and(
            eq(nodeExecutions.workflowRunId, runId),
            inArray(nodeExecutions.nodeId, branchNodeIds)
          )
        );

      // Update tracking
      for (const exec of executions) {
        if (exec.status === 'completed' && !completedBranches.includes(exec.nodeId)) {
          completedBranches.push(exec.nodeId);
          branchOutputs[exec.nodeId] = exec.output;
        } else if (exec.status === 'failed' && !failedBranches.includes(exec.nodeId)) {
          failedBranches.push(exec.nodeId);
        }
      }

      // Check join strategy conditions
      switch (joinStrategy) {
        case 'all':
          // All branches must complete successfully
          if (failedBranches.length > 0) {
            return {
              success: false,
              completedBranches,
              failedBranches,
              branchOutputs,
              error: `Branch(es) failed: ${failedBranches.join(', ')}`,
            };
          }
          if (completedBranches.length === branchNodeIds.length) {
            return {
              success: true,
              completedBranches,
              failedBranches,
              branchOutputs,
            };
          }
          break;

        case 'any':
          // At least one branch must complete successfully
          if (completedBranches.length > 0) {
            return {
              success: true,
              completedBranches,
              failedBranches,
              branchOutputs,
            };
          }
          // If all failed, return failure
          if (failedBranches.length === branchNodeIds.length) {
            return {
              success: false,
              completedBranches,
              failedBranches,
              branchOutputs,
              error: 'All branches failed',
            };
          }
          break;

        case 'race':
          // First branch to complete (success or failure) determines outcome
          if (completedBranches.length > 0) {
            return {
              success: true,
              completedBranches: [completedBranches[0]],
              failedBranches,
              branchOutputs: { [completedBranches[0]]: branchOutputs[completedBranches[0]] },
            };
          }
          if (failedBranches.length > 0) {
            return {
              success: false,
              completedBranches,
              failedBranches: [failedBranches[0]],
              branchOutputs,
              error: `First branch failed: ${failedBranches[0]}`,
            };
          }
          break;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // Timeout
    return {
      success: false,
      completedBranches,
      failedBranches,
      branchOutputs,
      error: 'Parallel execution timeout',
    };
  }
}

// Default singleton instance
export const parallelExecutor = new ParallelExecutor();

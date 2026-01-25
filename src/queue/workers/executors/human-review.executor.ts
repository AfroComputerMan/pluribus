import type { Job } from 'bullmq';

import type { HumanReviewNode } from '@/db/schema';
import { logger } from '@/observability/logger';
import type { NodeJobData } from '../../client';
import type { ExecutionContext, NodeExecutor, NodeProcessorResult } from '../types';

const log = logger.child('executor:human-review');

/**
 * HumanReviewExecutor handles human intervention nodes.
 * It pauses the workflow and waits for a human to approve/reject or select an option.
 */
export class HumanReviewExecutor implements NodeExecutor<HumanReviewNode> {
  readonly type = 'human-review' as const;

  async execute(
    node: HumanReviewNode,
    context: ExecutionContext,
    _job: Job<NodeJobData>
  ): Promise<NodeProcessorResult> {
    const startedAt = new Date();

    log.info('Human review node started - waiting for input', {
      nodeId: node.id,
      prompt: node.prompt,
      options: node.options,
      runId: context.runId,
    });

    // Human review nodes don't complete immediately.
    // They return a "pending" status that pauses the workflow.
    // The workflow service's submitReview method will complete them.

    return {
      nodeId: node.id,
      status: 'pending',
      output: {
        waitingForReview: true,
        prompt: node.prompt,
        options: node.options,
        timeout: node.timeout,
        requestedAt: startedAt.toISOString(),
        // These will be filled in by submitReview:
        // decision: 'approved' | 'rejected',
        // selectedOption: string,
        // comment: string,
        // reviewedAt: string,
        // reviewedBy: string,
      },
      startedAt,
      completedAt: new Date(),
    };
  }
}

// Default singleton instance
export const humanReviewExecutor = new HumanReviewExecutor();

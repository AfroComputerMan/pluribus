import { type Job, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { workflowRuns, workflows } from '@/db/schema';
import { logger } from '@/observability/logger';
import { QUEUE_NAMES, type WorkflowJobData, enqueueNode } from '../client';
import { analyzeDAG } from './dag';
import type {
  ExecutionContext,
  WorkerConfig,
  WorkerEventHandler,
  WorkflowProcessorResult,
} from './types';
import { DEFAULT_WORKER_CONFIG } from './types';

const log = logger.child('queue:workflow-processor');

/**
 * WorkflowProcessor handles workflow queue jobs.
 * It initializes the workflow run, analyzes the DAG, and enqueues entry nodes.
 */
export class WorkflowProcessor {
  private worker: Worker<WorkflowJobData, WorkflowProcessorResult> | null = null;
  private eventHandlers: Set<WorkerEventHandler> = new Set();
  private config: WorkerConfig;

  constructor(config: Partial<WorkerConfig> = {}) {
    this.config = { ...DEFAULT_WORKER_CONFIG, ...config };
  }

  /**
   * Start the workflow processor worker.
   */
  async start(redisConnection: { host: string; port: number }): Promise<void> {
    if (this.worker) {
      log.warn('Workflow processor already running');
      return;
    }

    this.worker = new Worker<WorkflowJobData, WorkflowProcessorResult>(
      QUEUE_NAMES.WORKFLOW,
      this.process.bind(this),
      {
        connection: redisConnection,
        concurrency: this.config.concurrency,
        lockDuration: this.config.lockDuration,
        stalledInterval: this.config.stalledInterval,
        maxStalledCount: this.config.maxStalledCount,
      }
    );

    this.worker.on('completed', (job, result) => {
      log.info('Workflow job completed', { runId: job.data.runId, result });
    });

    this.worker.on('failed', (job, error) => {
      log.error('Workflow job failed', { runId: job?.data.runId, error: error.message });
    });

    log.info('Workflow processor started');
  }

  /**
   * Stop the workflow processor worker.
   */
  async stop(): Promise<void> {
    if (!this.worker) return;

    await this.worker.close();
    this.worker = null;
    log.info('Workflow processor stopped');
  }

  /**
   * Register an event handler for workflow events.
   */
  onEvent(handler: WorkerEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all registered handlers.
   */
  private async emitEvent(
    type: 'workflow:started' | 'workflow:completed' | 'workflow:failed',
    runId: string,
    workflowId: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const event = {
      type,
      timestamp: new Date(),
      runId,
      workflowId,
      data,
    };

    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        log.error('Event handler error', { error });
      }
    }
  }

  /**
   * Main processor function for workflow jobs.
   */
  private async process(job: Job<WorkflowJobData>): Promise<WorkflowProcessorResult> {
    const { runId, workflowId, triggerType, input } = job.data;
    const startedAt = new Date();

    log.info('Processing workflow', { runId, workflowId, triggerType });

    try {
      // 1. Update run status to 'running'
      await db
        .update(workflowRuns)
        .set({ status: 'running', startedAt })
        .where(eq(workflowRuns.id, runId));

      await this.emitEvent('workflow:started', runId, workflowId, { triggerType });

      // 2. Fetch workflow definition
      const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId));

      if (!workflow) {
        throw new Error(`Workflow not found: ${workflowId}`);
      }

      // 3. Analyze DAG structure
      const dag = analyzeDAG(workflow.nodes, workflow.edges);
      log.debug('DAG analyzed', {
        runId,
        entryNodes: dag.entryNodes,
        totalNodes: dag.nodes.size,
      });

      // 4. Create execution context
      const context: ExecutionContext = {
        runId,
        workflowId,
        triggerType,
        input,
        nodeResults: new Map(),
        startedAt,
      };

      // 5. Get entry nodes and enqueue them
      const entryNodes = dag.entryNodes;

      if (entryNodes.length === 0) {
        throw new Error('Workflow has no entry nodes');
      }

      // Enqueue all entry nodes
      for (const nodeId of entryNodes) {
        const node = dag.nodes.get(nodeId);
        if (!node) continue;

        await enqueueNode({
          runId,
          workflowId,
          nodeId,
          input: this.resolveInputMapping(
            node.node as { input?: Record<string, unknown> },
            input,
            context
          ),
          context: {
            triggerType,
            workflowInput: input,
            nodeResults: {},
          },
        });

        log.debug('Enqueued entry node', { runId, nodeId });
      }

      // Note: The workflow will be marked as completed by the last node processor
      // when all nodes have been executed. For now, we return early.
      return {
        runId,
        status: 'completed',
        nodesExecuted: entryNodes.length,
        completedAt: new Date(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      log.error('Workflow processing failed', { runId, error: errorMessage });

      // Update run status to 'failed'
      await db
        .update(workflowRuns)
        .set({
          status: 'failed',
          error: errorMessage,
          completedAt: new Date(),
        })
        .where(eq(workflowRuns.id, runId));

      await this.emitEvent('workflow:failed', runId, workflowId, { error: errorMessage });

      return {
        runId,
        status: 'failed',
        nodesExecuted: 0,
        error: errorMessage,
        completedAt: new Date(),
      };
    }
  }

  /**
   * Resolve input mappings for a node.
   * For entry nodes, this maps workflow input to node input.
   */
  private resolveInputMapping(
    node: { input?: Record<string, unknown> },
    workflowInput: Record<string, unknown>,
    _context: ExecutionContext
  ): Record<string, unknown> {
    const nodeInput = node.input ?? {};
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(nodeInput)) {
      if (typeof value === 'string') {
        // Direct string value - check if it's a reference to workflow input
        if (value.startsWith('$input.')) {
          const inputKey = value.slice(7); // Remove '$input.'
          resolved[key] = workflowInput[inputKey];
        } else {
          resolved[key] = value;
        }
      } else if (typeof value === 'object' && value !== null && 'fromNode' in value) {
        // Reference to another node's output - will be resolved by node processor
        resolved[key] = value;
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }
}

// Default singleton instance
let defaultProcessor: WorkflowProcessor | null = null;

export function getWorkflowProcessor(): WorkflowProcessor {
  if (!defaultProcessor) {
    defaultProcessor = new WorkflowProcessor();
  }
  return defaultProcessor;
}

// Re-export for convenience
export { DEFAULT_WORKER_CONFIG } from './types';

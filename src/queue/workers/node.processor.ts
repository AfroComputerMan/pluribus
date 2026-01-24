import { type Job, Worker } from 'bullmq';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { nodeExecutions, workflowRuns, workflows } from '@/db/schema';
import type { WorkflowNode } from '@/db/schema';
import { logger } from '@/observability/logger';
import { type NodeJobData, enqueueNode, QUEUE_NAMES } from '../client';
import { analyzeDAG, getReadyNodes } from './dag';
import type {
  ExecutionContext,
  NodeExecutor,
  NodeProcessorResult,
  WorkerConfig,
  WorkerEventHandler,
  DEFAULT_WORKER_CONFIG,
} from './types';

const log = logger.child('queue:node-processor');

/**
 * NodeProcessor handles individual node execution jobs.
 * It executes the node, updates the database, and enqueues dependent nodes.
 */
export class NodeProcessor {
  private worker: Worker<NodeJobData, NodeProcessorResult> | null = null;
  private eventHandlers: Set<WorkerEventHandler> = new Set();
  private executors: Map<string, NodeExecutor> = new Map();
  private config: WorkerConfig;

  constructor(config: Partial<WorkerConfig> = {}) {
    this.config = { ...DEFAULT_WORKER_CONFIG, ...config };
  }

  /**
   * Register a node executor for a specific node type.
   */
  registerExecutor<T extends WorkflowNode>(executor: NodeExecutor<T>): void {
    this.executors.set(executor.type, executor as NodeExecutor);
    log.debug({ type: executor.type }, 'Registered node executor');
  }

  /**
   * Start the node processor worker.
   */
  async start(redisConnection: { host: string; port: number }): Promise<void> {
    if (this.worker) {
      log.warn('Node processor already running');
      return;
    }

    this.worker = new Worker<NodeJobData, NodeProcessorResult>(
      QUEUE_NAMES.NODE,
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
      log.info({ nodeId: job.data.nodeId, result }, 'Node job completed');
    });

    this.worker.on('failed', (job, error) => {
      log.error({ nodeId: job?.data.nodeId, error: error.message }, 'Node job failed');
    });

    log.info('Node processor started');
  }

  /**
   * Stop the node processor worker.
   */
  async stop(): Promise<void> {
    if (!this.worker) return;

    await this.worker.close();
    this.worker = null;
    log.info('Node processor stopped');
  }

  /**
   * Register an event handler for node events.
   */
  onEvent(handler: WorkerEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all registered handlers.
   */
  private async emitEvent(
    type: 'node:started' | 'node:completed' | 'node:failed' | 'node:skipped',
    runId: string,
    workflowId: string,
    nodeId: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const event = {
      type,
      timestamp: new Date(),
      runId,
      workflowId,
      nodeId,
      data,
    };

    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        log.error({ error }, 'Event handler error');
      }
    }
  }

  /**
   * Main processor function for node jobs.
   */
  private async process(job: Job<NodeJobData>): Promise<NodeProcessorResult> {
    const { runId, workflowId, nodeId, input, context } = job.data;
    const startedAt = new Date();

    log.info({ runId, nodeId }, 'Processing node');

    try {
      // 1. Create node execution record
      await db.insert(nodeExecutions).values({
        workflowRunId: runId,
        nodeId,
        status: 'running',
        input,
        startedAt,
      });

      await this.emitEvent('node:started', runId, workflowId, nodeId);

      // 2. Fetch workflow to get node definition
      const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId));

      if (!workflow) {
        throw new Error(`Workflow not found: ${workflowId}`);
      }

      const node = workflow.nodes.find((n) => n.id === nodeId);
      if (!node) {
        throw new Error(`Node not found in workflow: ${nodeId}`);
      }

      // 3. Resolve input from previous node results
      const resolvedInput = await this.resolveNodeInput(runId, node, input, context);

      // 4. Execute the node
      const executor = this.executors.get(node.type);
      if (!executor) {
        throw new Error(`No executor registered for node type: ${node.type}`);
      }

      // Convert nodeResults from Record to Map, preserving previous results
      const nodeResultsMap = new Map<string, NodeProcessorResult>();
      if (context.nodeResults && typeof context.nodeResults === 'object') {
        for (const [nodeId, result] of Object.entries(context.nodeResults)) {
          nodeResultsMap.set(nodeId, result as NodeProcessorResult);
        }
      }

      const executionContext: ExecutionContext = {
        runId,
        workflowId,
        triggerType: context.triggerType as 'manual' | 'schedule' | 'webhook' | 'api',
        input: context.workflowInput as Record<string, unknown>,
        nodeResults: nodeResultsMap,
        startedAt: new Date(context.startedAt as string),
      };

      // Execute with resolved input
      const updatedNode = { ...node, input: resolvedInput };
      const result = await executor.execute(updatedNode, executionContext, job);

      // 5. Update node execution record
      await db
        .update(nodeExecutions)
        .set({
          status: result.status,
          output: result.output as Record<string, unknown>,
          error: result.error,
          completedAt: result.completedAt,
        })
        .where(
          and(eq(nodeExecutions.workflowRunId, runId), eq(nodeExecutions.nodeId, nodeId))
        );

      await this.emitEvent('node:completed', runId, workflowId, nodeId, {
        output: result.output,
      });

      // 6. Check for and enqueue next nodes
      await this.enqueueNextNodes(runId, workflowId, nodeId, result, context);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const completedAt = new Date();

      log.error({ runId, nodeId, error: errorMessage }, 'Node processing failed');

      // Update node execution record with error
      await db
        .update(nodeExecutions)
        .set({
          status: 'failed',
          error: errorMessage,
          completedAt,
        })
        .where(
          and(eq(nodeExecutions.workflowRunId, runId), eq(nodeExecutions.nodeId, nodeId))
        );

      await this.emitEvent('node:failed', runId, workflowId, nodeId, { error: errorMessage });

      // Check if we should fail the entire workflow
      await this.handleNodeFailure(runId, workflowId, nodeId, errorMessage);

      return {
        nodeId,
        status: 'failed',
        error: errorMessage,
        startedAt,
        completedAt,
      };
    }
  }

  /**
   * Resolve input mappings from previous node outputs.
   */
  private async resolveNodeInput(
    runId: string,
    node: WorkflowNode,
    rawInput: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<Record<string, unknown> | undefined> {
    if (!('input' in node)) {
      return rawInput;
    }

    const resolved: Record<string, unknown> = {};
    const nodeInput = node.input as Record<string, unknown>;

    for (const [key, value] of Object.entries(rawInput)) {
      if (typeof value === 'object' && value !== null && 'fromNode' in value) {
        // Resolve reference to previous node's output
        const ref = value as { fromNode: string; path: string };

        const [nodeExec] = await db
          .select()
          .from(nodeExecutions)
          .where(
            and(
              eq(nodeExecutions.workflowRunId, runId),
              eq(nodeExecutions.nodeId, ref.fromNode)
            )
          );

        if (nodeExec?.output) {
          // Navigate the path in the output
          resolved[key] = this.getNestedValue(
            nodeExec.output as Record<string, unknown>,
            ref.path
          );
        } else {
          log.warn({ runId, fromNode: ref.fromNode, path: ref.path }, 'Referenced node output not found');
          resolved[key] = null;
        }
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Get a nested value from an object using dot notation path.
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Find and enqueue the next nodes after successful execution.
   */
  private async enqueueNextNodes(
    runId: string,
    workflowId: string,
    completedNodeId: string,
    result: NodeProcessorResult,
    context: Record<string, unknown>
  ): Promise<void> {
    // Fetch workflow
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
    if (!workflow) return;

    // Analyze DAG
    const dag = analyzeDAG(workflow.nodes, workflow.edges);

    // Get all completed nodes
    const completedExecutions = await db
      .select({ nodeId: nodeExecutions.nodeId })
      .from(nodeExecutions)
      .where(
        and(
          eq(nodeExecutions.workflowRunId, runId),
          eq(nodeExecutions.status, 'completed')
        )
      );

    const completedNodes = new Set(completedExecutions.map((e) => e.nodeId));
    completedNodes.add(completedNodeId); // Include the one we just completed

    // Get ready nodes
    const readyNodes = getReadyNodes(dag, completedNodes);

    // Enqueue each ready node
    for (const nodeId of readyNodes) {
      const node = dag.nodes.get(nodeId);
      if (!node) continue;

      await enqueueNode({
        runId,
        workflowId,
        nodeId,
        input: {},
        context: {
          ...context,
          nodeResults: {
            ...(context.nodeResults as Record<string, unknown>),
            [completedNodeId]: result.output,
          },
        },
      });

      log.debug({ runId, nodeId }, 'Enqueued next node');
    }

    // Check if workflow is complete (no more ready nodes and all nodes done)
    if (readyNodes.length === 0) {
      const allNodesExecuted = completedNodes.size === dag.nodes.size;

      if (allNodesExecuted) {
        // All nodes completed - mark workflow as complete
        await db
          .update(workflowRuns)
          .set({
            status: 'completed',
            completedAt: new Date(),
          })
          .where(eq(workflowRuns.id, runId));

        log.info({ runId, workflowId }, 'Workflow completed');
      }
    }
  }

  /**
   * Handle node failure based on workflow error strategy.
   */
  private async handleNodeFailure(
    runId: string,
    workflowId: string,
    nodeId: string,
    error: string
  ): Promise<void> {
    // Fetch workflow to get error strategy
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
    if (!workflow) return;

    const strategy = workflow.errorStrategy;

    if (strategy.onFailure === 'stop') {
      // Mark workflow as failed
      await db
        .update(workflowRuns)
        .set({
          status: 'failed',
          error: `Node ${nodeId} failed: ${error}`,
          completedAt: new Date(),
        })
        .where(eq(workflowRuns.id, runId));

      log.info({ runId, nodeId }, 'Workflow stopped due to node failure');
    } else if (strategy.onFailure === 'continue') {
      // Continue with other nodes - don't mark workflow as failed yet
      log.info({ runId, nodeId }, 'Continuing workflow despite node failure');
    } else if (strategy.onFailure === 'human-review') {
      // Mark workflow as waiting for review
      await db
        .update(workflowRuns)
        .set({ status: 'pending' })
        .where(eq(workflowRuns.id, runId));

      log.info({ runId, nodeId }, 'Workflow waiting for human review');
    }
  }
}

// Default singleton instance
let defaultProcessor: NodeProcessor | null = null;

export function getNodeProcessor(): NodeProcessor {
  if (!defaultProcessor) {
    defaultProcessor = new NodeProcessor();
  }
  return defaultProcessor;
}

// Re-export for convenience
export { DEFAULT_WORKER_CONFIG } from './types';

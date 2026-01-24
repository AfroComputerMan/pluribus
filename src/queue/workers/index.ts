import { logger } from '@/observability/logger';
import { WorkflowProcessor, getWorkflowProcessor } from './workflow.processor';
import { NodeProcessor, getNodeProcessor } from './node.processor';
import {
  agentExecutor,
  conditionExecutor,
  parallelExecutor,
  loopExecutor,
  humanReviewExecutor,
} from './executors';
import type { WorkerConfig } from './types';

const log = logger.child('queue:workers');

export interface WorkersConfig {
  redis: {
    host: string;
    port: number;
  };
  workflow?: Partial<WorkerConfig>;
  node?: Partial<WorkerConfig>;
}

/**
 * WorkerManager handles lifecycle of all queue workers.
 */
export class WorkerManager {
  private workflowProcessor: WorkflowProcessor;
  private nodeProcessor: NodeProcessor;
  private config: WorkersConfig;
  private running = false;

  constructor(config: WorkersConfig) {
    this.config = config;
    this.workflowProcessor = new WorkflowProcessor(config.workflow);
    this.nodeProcessor = new NodeProcessor(config.node);

    // Register all node executors
    this.nodeProcessor.registerExecutor(agentExecutor);
    this.nodeProcessor.registerExecutor(conditionExecutor);
    this.nodeProcessor.registerExecutor(parallelExecutor);
    this.nodeProcessor.registerExecutor(loopExecutor);
    this.nodeProcessor.registerExecutor(humanReviewExecutor);
  }

  /**
   * Start all workers.
   */
  async start(): Promise<void> {
    if (this.running) {
      log.warn('Workers already running');
      return;
    }

    log.info('Starting queue workers...');

    await Promise.all([
      this.workflowProcessor.start(this.config.redis),
      this.nodeProcessor.start(this.config.redis),
    ]);

    this.running = true;
    log.info('Queue workers started');
  }

  /**
   * Stop all workers gracefully.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    log.info('Stopping queue workers...');

    await Promise.all([
      this.workflowProcessor.stop(),
      this.nodeProcessor.stop(),
    ]);

    this.running = false;
    log.info('Queue workers stopped');
  }

  /**
   * Check if workers are running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the workflow processor instance.
   */
  getWorkflowProcessor(): WorkflowProcessor {
    return this.workflowProcessor;
  }

  /**
   * Get the node processor instance.
   */
  getNodeProcessor(): NodeProcessor {
    return this.nodeProcessor;
  }
}

// Default singleton manager
let defaultManager: WorkerManager | null = null;

/**
 * Initialize the default worker manager with config.
 */
export function initializeWorkers(config: WorkersConfig): WorkerManager {
  if (defaultManager) {
    log.warn('Workers already initialized, returning existing manager');
    return defaultManager;
  }

  defaultManager = new WorkerManager(config);
  return defaultManager;
}

/**
 * Get the default worker manager.
 */
export function getWorkerManager(): WorkerManager | null {
  return defaultManager;
}

// Re-exports
export { WorkflowProcessor, getWorkflowProcessor } from './workflow.processor';
export { NodeProcessor, getNodeProcessor } from './node.processor';
export { analyzeDAG, getReadyNodes, validateDAG } from './dag';
export * from './types';
export * from './executors';

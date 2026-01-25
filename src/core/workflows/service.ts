import { logger } from '@/observability/logger';
import { enqueueWorkflow } from '@/queue/client';
import { analyzeDAG, validateDAG } from '@/queue/workers/dag';
import { ValidationError } from '@/lib/errors';
import { workflowRepository, WorkflowRepository } from './repository';
import type {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowFilter,
  WorkflowRunFilter,
  TriggerType,
  Workflow,
  WorkflowRun,
} from './types';

const log = logger.child('workflows:service');

export class WorkflowService {
  constructor(private readonly repository: WorkflowRepository = workflowRepository) {}

  // ==================
  // Workflow CRUD
  // ==================

  async getWorkflow(id: string): Promise<Workflow> {
    return this.repository.findById(id) as Promise<Workflow>;
  }

  async listWorkflows(filter?: WorkflowFilter): Promise<Workflow[]> {
    return this.repository.findAll(filter) as Promise<Workflow[]>;
  }

  async createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
    // Validate the DAG structure before saving
    const validation = validateDAG(input.nodes, input.edges);
    if (!validation.valid) {
      throw new ValidationError('Invalid workflow structure', {
        errors: validation.errors,
      });
    }

    log.info('Creating workflow', { name: input.name, nodeCount: input.nodes.length });

    return this.repository.create(input) as Promise<Workflow>;
  }

  async updateWorkflow(id: string, input: UpdateWorkflowInput): Promise<Workflow> {
    // If nodes or edges are being updated, validate the DAG
    if (input.nodes || input.edges) {
      const existing = await this.repository.findById(id);
      const nodes = input.nodes ?? existing.nodes;
      const edges = input.edges ?? existing.edges;

      const validation = validateDAG(nodes, edges);
      if (!validation.valid) {
        throw new ValidationError('Invalid workflow structure', {
          errors: validation.errors,
        });
      }
    }

    log.info('Updating workflow', { id });

    return this.repository.update(id, input) as Promise<Workflow>;
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    log.info('Deleting workflow', { id });
    return this.repository.delete(id);
  }

  // ==================
  // Workflow Execution
  // ==================

  /**
   * Trigger a workflow run.
   * Creates a run record and enqueues the workflow for processing.
   */
  async triggerRun(
    workflowId: string,
    triggerType: TriggerType = 'manual',
    input: Record<string, unknown> = {}
  ): Promise<WorkflowRun> {
    // Verify workflow exists
    const workflow = await this.repository.findById(workflowId);

    // Validate the workflow is executable
    const validation = validateDAG(workflow.nodes, workflow.edges);
    if (!validation.valid) {
      throw new ValidationError('Workflow cannot be executed', {
        errors: validation.errors,
      });
    }

    // Create the run record
    const run = await this.repository.createRun(workflowId, triggerType, input);

    log.info('Workflow run triggered', {
      workflowId,
      runId: run.id,
      triggerType,
    });

    // Enqueue for processing
    await enqueueWorkflow({
      runId: run.id,
      workflowId,
      triggerType,
      input,
    });

    return run as WorkflowRun;
  }

  /**
   * Cancel a running workflow.
   */
  async cancelRun(runId: string): Promise<WorkflowRun> {
    const run = await this.repository.findRunById(runId);

    if (run.status !== 'running' && run.status !== 'pending') {
      throw new ValidationError(`Cannot cancel run with status '${run.status}'`);
    }

    log.info('Cancelling workflow run', { runId });

    return this.repository.cancelRun(runId) as Promise<WorkflowRun>;
  }

  /**
   * Retry a failed workflow run.
   * Creates a new run with the same input.
   */
  async retryRun(runId: string): Promise<WorkflowRun> {
    const originalRun = await this.repository.findRunById(runId);

    if (originalRun.status !== 'failed' && originalRun.status !== 'cancelled') {
      throw new ValidationError(`Cannot retry run with status '${originalRun.status}'`);
    }

    if (!originalRun.workflowId) {
      throw new ValidationError('Cannot retry run: original workflow has been deleted');
    }

    log.info('Retrying workflow run', { originalRunId: runId, workflowId: originalRun.workflowId });

    return this.triggerRun(
      originalRun.workflowId,
      originalRun.triggerType as TriggerType,
      (originalRun.input as Record<string, unknown>) ?? {}
    );
  }

  // ==================
  // Run Queries
  // ==================

  async getRun(runId: string): Promise<WorkflowRun> {
    return this.repository.findRunById(runId) as Promise<WorkflowRun>;
  }

  async listRuns(filter?: WorkflowRunFilter): Promise<WorkflowRun[]> {
    return this.repository.findRuns(filter) as Promise<WorkflowRun[]>;
  }

  async getRunProgress(runId: string) {
    return this.repository.getRunProgress(runId);
  }

  async getNodeExecutions(runId: string) {
    return this.repository.findNodeExecutions(runId);
  }

  // ==================
  // Workflow Analysis
  // ==================

  /**
   * Analyze a workflow's DAG structure.
   * Useful for UI visualization and validation.
   */
  async analyzeWorkflow(workflowId: string) {
    const workflow = await this.repository.findById(workflowId);
    const dag = analyzeDAG(workflow.nodes, workflow.edges);

    return {
      nodeCount: dag.nodes.size,
      entryNodes: dag.entryNodes,
      exitNodes: dag.exitNodes,
      executionOrder: dag.topologicalOrder,
      nodes: Array.from(dag.nodes.entries()).map(([id, node]) => ({
        id,
        type: node.node.type,
        dependencies: node.dependencies,
        dependents: node.dependents,
      })),
    };
  }

  /**
   * Get workflow statistics.
   */
  async getWorkflowStats(workflowId: string) {
    return this.repository.getRunStats(workflowId);
  }

  // ==================
  // Human Review
  // ==================

  /**
   * Submit a human review decision for a paused workflow.
   */
  async submitReview(
    runId: string,
    nodeId: string,
    decision: {
      approved: boolean;
      comment?: string;
      selectedOption?: string;
    }
  ): Promise<void> {
    const run = await this.repository.findRunById(runId);

    // Verify the run is waiting for review (status should be 'pending')
    if (run.status !== 'pending') {
      throw new ValidationError(`Run is not waiting for review (status: ${run.status})`);
    }

    // Find the human-review node execution
    const nodeExecution = await this.repository.findNodeExecution(runId, nodeId);
    if (!nodeExecution) {
      throw new ValidationError(`Node execution not found: ${nodeId}`);
    }

    // Verify the node is in pending status
    if (nodeExecution.status !== 'pending') {
      throw new ValidationError(`Node is not waiting for review (status: ${nodeExecution.status})`);
    }

    log.info('Human review submitted', {
      runId,
      nodeId,
      approved: decision.approved,
    });

    // Update the node execution with the review decision
    await this.repository.updateNodeExecution(runId, nodeId, {
      status: decision.approved ? 'completed' : 'failed',
      output: {
        decision: decision.approved ? 'approved' : 'rejected',
        comment: decision.comment,
        selectedOption: decision.selectedOption,
        reviewedAt: new Date().toISOString(),
      },
      completedAt: new Date(),
    });

    // Update run status back to running if approved
    if (decision.approved) {
      await this.repository.updateRun(runId, { status: 'running' });

      // Re-enqueue the workflow to continue execution
      // The node processor will pick up from where it left off
      if (run.workflowId) {
        await enqueueWorkflow({
          runId,
          workflowId: run.workflowId,
          triggerType: run.triggerType as TriggerType,
          input: (run.input as Record<string, unknown>) ?? {},
        });
      }
    } else {
      // Mark run as failed if review rejected
      await this.repository.updateRun(runId, {
        status: 'failed',
        error: `Human review rejected: ${decision.comment ?? 'No reason provided'}`,
        completedAt: new Date(),
      });
    }
  }
}

export const workflowService = new WorkflowService();

/**
 * Get the workflow service singleton.
 */
export function getWorkflowService(): WorkflowService {
  return workflowService;
}

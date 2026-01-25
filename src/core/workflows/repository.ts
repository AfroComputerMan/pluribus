import { and, desc, eq, ilike, sql } from 'drizzle-orm';

import { db } from '@/db';
import { nodeExecutions, workflowRuns, workflows } from '@/db/schema';
import { NotFoundError } from '@/lib/errors';
import type {
  CreateWorkflowInput,
  TriggerType,
  UpdateWorkflowInput,
  WorkflowFilter,
  WorkflowRunFilter,
} from './types';

export class WorkflowRepository {
  // ==================
  // Workflow CRUD
  // ==================

  async findById(id: string) {
    const result = await db.query.workflows.findFirst({
      where: eq(workflows.id, id),
    });

    if (!result) {
      throw new NotFoundError('Workflow', id);
    }

    return result;
  }

  async findAll(filter?: WorkflowFilter) {
    const conditions = [];

    if (filter?.search) {
      conditions.push(
        sql`(${ilike(workflows.name, `%${filter.search}%`)} OR ${ilike(workflows.description, `%${filter.search}%`)})`
      );
    }

    if (filter?.hasTrigger) {
      // Check if any trigger matches the specified type
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements(${workflows.triggers}) AS t
          WHERE t->>'type' = ${filter.hasTrigger}
        )`
      );
    }

    const query = db
      .select()
      .from(workflows)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(workflows.updatedAt));

    if (filter?.limit) {
      query.limit(filter.limit);
    }

    if (filter?.offset) {
      query.offset(filter.offset);
    }

    return query;
  }

  async create(input: CreateWorkflowInput) {
    const [result] = await db.insert(workflows).values(input).returning();
    if (!result) {
      throw new Error('Insert failed to return created workflow');
    }
    return result;
  }

  async update(id: string, input: UpdateWorkflowInput) {
    const [result] = await db
      .update(workflows)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, id))
      .returning();

    if (!result) {
      throw new NotFoundError('Workflow', id);
    }

    return result;
  }

  async delete(id: string) {
    const result = await db.delete(workflows).where(eq(workflows.id, id)).returning();

    if (result.length === 0) {
      throw new NotFoundError('Workflow', id);
    }

    return true;
  }

  // ==================
  // Workflow Runs
  // ==================

  async findRunById(id: string) {
    const result = await db.query.workflowRuns.findFirst({
      where: eq(workflowRuns.id, id),
    });

    if (!result) {
      throw new NotFoundError('WorkflowRun', id);
    }

    return result;
  }

  async findRuns(filter?: WorkflowRunFilter) {
    const conditions = [];

    if (filter?.workflowId) {
      conditions.push(eq(workflowRuns.workflowId, filter.workflowId));
    }

    if (filter?.status) {
      conditions.push(eq(workflowRuns.status, filter.status));
    }

    if (filter?.triggerType) {
      conditions.push(eq(workflowRuns.triggerType, filter.triggerType));
    }

    const query = db
      .select()
      .from(workflowRuns)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(workflowRuns.createdAt));

    if (filter?.limit) {
      query.limit(filter.limit);
    }

    if (filter?.offset) {
      query.offset(filter.offset);
    }

    return query;
  }

  async createRun(workflowId: string, triggerType: TriggerType, input?: Record<string, unknown>) {
    const [result] = await db
      .insert(workflowRuns)
      .values({
        workflowId,
        status: 'pending',
        triggerType,
        input,
      })
      .returning();

    if (!result) {
      throw new Error('Insert failed to return created workflow run');
    }

    return result;
  }

  async updateRun(
    id: string,
    update: {
      status?: string;
      output?: Record<string, unknown>;
      error?: string;
      startedAt?: Date;
      completedAt?: Date;
    }
  ) {
    const [result] = await db
      .update(workflowRuns)
      .set(update)
      .where(eq(workflowRuns.id, id))
      .returning();

    if (!result) {
      throw new NotFoundError('WorkflowRun', id);
    }

    return result;
  }

  async cancelRun(id: string) {
    return this.updateRun(id, {
      status: 'cancelled',
      completedAt: new Date(),
    });
  }

  // ==================
  // Node Executions
  // ==================

  async findNodeExecutions(runId: string) {
    return db
      .select()
      .from(nodeExecutions)
      .where(eq(nodeExecutions.workflowRunId, runId))
      .orderBy(nodeExecutions.createdAt);
  }

  async findNodeExecution(runId: string, nodeId: string) {
    const result = await db.query.nodeExecutions.findFirst({
      where: and(eq(nodeExecutions.workflowRunId, runId), eq(nodeExecutions.nodeId, nodeId)),
    });

    return result;
  }

  async createNodeExecution(
    runId: string,
    nodeId: string,
    agentId?: string,
    input?: Record<string, unknown>
  ) {
    const [result] = await db
      .insert(nodeExecutions)
      .values({
        workflowRunId: runId,
        nodeId,
        agentId,
        status: 'pending',
        input,
      })
      .returning();

    if (!result) {
      throw new Error('Insert failed to return created node execution');
    }

    return result;
  }

  async updateNodeExecution(
    runId: string,
    nodeId: string,
    update: {
      status?: string;
      output?: Record<string, unknown>;
      error?: string;
      startedAt?: Date;
      completedAt?: Date;
    }
  ) {
    const [result] = await db
      .update(nodeExecutions)
      .set(update)
      .where(and(eq(nodeExecutions.workflowRunId, runId), eq(nodeExecutions.nodeId, nodeId)))
      .returning();

    return result;
  }

  async getRunProgress(runId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
  }> {
    const executions = await this.findNodeExecutions(runId);

    return {
      total: executions.length,
      completed: executions.filter((e) => e.status === 'completed').length,
      failed: executions.filter((e) => e.status === 'failed').length,
      running: executions.filter((e) => e.status === 'running').length,
      pending: executions.filter((e) => e.status === 'pending').length,
    };
  }

  // ==================
  // Aggregations
  // ==================

  async getRunStats(workflowId: string): Promise<{
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    avgDurationMs: number | null;
  }> {
    const result = await db.execute<{
      total_runs: string;
      successful_runs: string;
      failed_runs: string;
      avg_duration_ms: string | null;
    }>(sql`
      SELECT
        COUNT(*) as total_runs,
        COUNT(*) FILTER (WHERE status = 'completed') as successful_runs,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_runs,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)
          FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL) as avg_duration_ms
      FROM ${workflowRuns}
      WHERE workflow_id = ${workflowId}
    `);

    const row = result[0];
    return {
      totalRuns: Number.parseInt(row?.total_runs ?? '0', 10),
      successfulRuns: Number.parseInt(row?.successful_runs ?? '0', 10),
      failedRuns: Number.parseInt(row?.failed_runs ?? '0', 10),
      avgDurationMs: row?.avg_duration_ms ? Number.parseFloat(row.avg_duration_ms) : null,
    };
  }
}

export const workflowRepository = new WorkflowRepository();

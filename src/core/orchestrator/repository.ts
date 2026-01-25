import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { scheduledTriggers, webhookTriggers } from '@/db/schema';
import { NotFoundError } from '@/lib/errors';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getNextRunTime } from './cron';
import type {
  CreateScheduleInput,
  CreateWebhookInput,
  ScheduleFilter,
  ScheduledTrigger,
  UpdateScheduleInput,
  UpdateWebhookInput,
  WebhookFilter,
  WebhookTrigger,
} from './types';

/**
 * Repository for orchestrator data access.
 */
export class OrchestratorRepository {
  // ==================
  // Schedule Operations
  // ==================

  /**
   * Find a schedule by ID.
   */
  async findScheduleById(id: string): Promise<ScheduledTrigger | null> {
    const [schedule] = await db
      .select()
      .from(scheduledTriggers)
      .where(eq(scheduledTriggers.id, id))
      .limit(1);

    return schedule || null;
  }

  /**
   * Find all schedules matching filter criteria.
   */
  async findSchedules(filter: ScheduleFilter = {}): Promise<ScheduledTrigger[]> {
    const conditions = [];

    if (filter.workflowId) {
      conditions.push(eq(scheduledTriggers.workflowId, filter.workflowId));
    }

    if (filter.enabled !== undefined) {
      conditions.push(eq(scheduledTriggers.enabled, filter.enabled));
    }

    const query = db
      .select()
      .from(scheduledTriggers)
      .orderBy(desc(scheduledTriggers.createdAt))
      .limit(filter.limit || 50)
      .offset(filter.offset || 0);

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }

    return query;
  }

  /**
   * Find schedules that are due to run.
   */
  async findDueSchedules(before: Date = new Date()): Promise<ScheduledTrigger[]> {
    return db
      .select()
      .from(scheduledTriggers)
      .where(
        and(eq(scheduledTriggers.enabled, true), sql`${scheduledTriggers.nextRunAt} <= ${before}`)
      )
      .orderBy(scheduledTriggers.nextRunAt);
  }

  /**
   * Create a new schedule.
   */
  async createSchedule(input: CreateScheduleInput): Promise<ScheduledTrigger> {
    const id = randomUUID();
    const now = new Date();
    const nextRunAt = getNextRunTime(input.cron, now, input.timezone || 'UTC');

    const [schedule] = await db
      .insert(scheduledTriggers)
      .values({
        id,
        workflowId: input.workflowId,
        cron: input.cron,
        timezone: input.timezone || 'UTC',
        enabled: input.enabled ?? true,
        lastRunAt: null,
        nextRunAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!schedule) {
      throw new Error('Failed to create schedule');
    }

    return schedule;
  }

  /**
   * Update a schedule.
   */
  async updateSchedule(id: string, input: UpdateScheduleInput): Promise<ScheduledTrigger> {
    const existing = await this.findScheduleById(id);
    if (!existing) {
      throw new NotFoundError('Schedule', id);
    }

    const now = new Date();
    const updates: Partial<ScheduledTrigger> = {
      updatedAt: now,
    };

    if (input.cron !== undefined) {
      updates.cron = input.cron;
      // Recalculate next run time
      updates.nextRunAt = getNextRunTime(input.cron, now, input.timezone || existing.timezone);
    }

    if (input.timezone !== undefined) {
      updates.timezone = input.timezone;
      // Recalculate next run time with new timezone
      updates.nextRunAt = getNextRunTime(input.cron || existing.cron, now, input.timezone);
    }

    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }

    const [updated] = await db
      .update(scheduledTriggers)
      .set(updates)
      .where(eq(scheduledTriggers.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Schedule', id);
    }

    return updated;
  }

  /**
   * Mark a schedule as executed and calculate next run time.
   */
  async markScheduleExecuted(id: string): Promise<ScheduledTrigger> {
    const existing = await this.findScheduleById(id);
    if (!existing) {
      throw new NotFoundError('Schedule', id);
    }

    const now = new Date();
    const nextRunAt = getNextRunTime(existing.cron, now, existing.timezone);

    const [updated] = await db
      .update(scheduledTriggers)
      .set({
        lastRunAt: now,
        nextRunAt,
        updatedAt: now,
      })
      .where(eq(scheduledTriggers.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Schedule', id);
    }

    return updated;
  }

  /**
   * Delete a schedule.
   */
  async deleteSchedule(id: string): Promise<boolean> {
    const result = await db
      .delete(scheduledTriggers)
      .where(eq(scheduledTriggers.id, id))
      .returning();

    return result.length > 0;
  }

  // ==================
  // Webhook Operations
  // ==================

  /**
   * Find a webhook by ID.
   */
  async findWebhookById(id: string): Promise<WebhookTrigger | null> {
    const [webhook] = await db
      .select()
      .from(webhookTriggers)
      .where(eq(webhookTriggers.id, id))
      .limit(1);

    return webhook || null;
  }

  /**
   * Find a webhook by its secret (for validation).
   */
  async findWebhookBySecret(secret: string): Promise<WebhookTrigger | null> {
    const [webhook] = await db
      .select()
      .from(webhookTriggers)
      .where(eq(webhookTriggers.secret, secret))
      .limit(1);

    return webhook || null;
  }

  /**
   * Find all webhooks matching filter criteria.
   */
  async findWebhooks(filter: WebhookFilter = {}): Promise<WebhookTrigger[]> {
    const conditions = [];

    if (filter.workflowId) {
      conditions.push(eq(webhookTriggers.workflowId, filter.workflowId));
    }

    if (filter.enabled !== undefined) {
      conditions.push(eq(webhookTriggers.enabled, filter.enabled));
    }

    const query = db
      .select()
      .from(webhookTriggers)
      .orderBy(desc(webhookTriggers.createdAt))
      .limit(filter.limit || 50)
      .offset(filter.offset || 0);

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }

    return query;
  }

  /**
   * Create a new webhook.
   */
  async createWebhook(input: CreateWebhookInput): Promise<WebhookTrigger> {
    const id = randomUUID();
    const now = new Date();
    const secret = input.secret || this.generateSecret();

    const [webhook] = await db
      .insert(webhookTriggers)
      .values({
        id,
        workflowId: input.workflowId,
        name: input.name,
        secret,
        enabled: input.enabled ?? true,
        lastTriggeredAt: null,
        triggerCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!webhook) {
      throw new Error('Failed to create webhook');
    }

    return webhook;
  }

  /**
   * Update a webhook.
   */
  async updateWebhook(id: string, input: UpdateWebhookInput): Promise<WebhookTrigger> {
    const existing = await this.findWebhookById(id);
    if (!existing) {
      throw new NotFoundError('Webhook', id);
    }

    const now = new Date();
    const updates: Partial<WebhookTrigger> = {
      updatedAt: now,
    };

    if (input.name !== undefined) {
      updates.name = input.name;
    }

    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }

    if (input.regenerateSecret) {
      updates.secret = this.generateSecret();
    }

    const [updated] = await db
      .update(webhookTriggers)
      .set(updates)
      .where(eq(webhookTriggers.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Webhook', id);
    }

    return updated;
  }

  /**
   * Record a webhook trigger event.
   */
  async recordWebhookTrigger(id: string): Promise<WebhookTrigger> {
    const existing = await this.findWebhookById(id);
    if (!existing) {
      throw new NotFoundError('Webhook', id);
    }

    const now = new Date();

    const [updated] = await db
      .update(webhookTriggers)
      .set({
        lastTriggeredAt: now,
        triggerCount: existing.triggerCount + 1,
        updatedAt: now,
      })
      .where(eq(webhookTriggers.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Webhook', id);
    }

    return updated;
  }

  /**
   * Delete a webhook.
   */
  async deleteWebhook(id: string): Promise<boolean> {
    const result = await db.delete(webhookTriggers).where(eq(webhookTriggers.id, id)).returning();

    return result.length > 0;
  }

  /**
   * Generate a secure webhook secret.
   */
  private generateSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('hex');
  }
}

// Default singleton instance
let repository: OrchestratorRepository | null = null;

/**
 * Get or create the default repository.
 */
export function getOrchestratorRepository(): OrchestratorRepository {
  if (!repository) {
    repository = new OrchestratorRepository();
  }
  return repository;
}

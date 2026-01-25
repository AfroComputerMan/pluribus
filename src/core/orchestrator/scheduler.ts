import { WorkflowService } from '@/core/workflows/service';
import { logger } from '@/observability/logger';
import { type EventBus, getEventBus } from './event-bus';
import { type OrchestratorRepository, getOrchestratorRepository } from './repository';
import type {
  CreateScheduleInput,
  ScheduleFilter,
  ScheduledTrigger,
  TriggerResult,
  UpdateScheduleInput,
} from './types';

const log = logger.child('orchestrator:scheduler');

/**
 * Scheduler service manages cron-based workflow triggers.
 */
export class SchedulerService {
  private repository: OrchestratorRepository;
  private workflowService: WorkflowService;
  private eventBus: EventBus;
  private pollInterval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    repository?: OrchestratorRepository,
    workflowService?: WorkflowService,
    eventBus?: EventBus
  ) {
    this.repository = repository || getOrchestratorRepository();
    this.workflowService = workflowService || new WorkflowService();
    this.eventBus = eventBus || getEventBus();
  }

  // ==================
  // Schedule CRUD
  // ==================

  /**
   * Create a new scheduled trigger.
   */
  async createSchedule(input: CreateScheduleInput): Promise<ScheduledTrigger> {
    log.info('Creating schedule', { workflowId: input.workflowId, cron: input.cron });

    const schedule = await this.repository.createSchedule(input);

    log.info('Schedule created', {
      scheduleId: schedule.id,
      workflowId: schedule.workflowId,
      nextRunAt: schedule.nextRunAt,
    });

    return schedule;
  }

  /**
   * Get a schedule by ID.
   */
  async getSchedule(id: string): Promise<ScheduledTrigger | null> {
    return this.repository.findScheduleById(id);
  }

  /**
   * List schedules with optional filters.
   */
  async listSchedules(filter?: ScheduleFilter): Promise<ScheduledTrigger[]> {
    return this.repository.findSchedules(filter);
  }

  /**
   * Update a schedule.
   */
  async updateSchedule(id: string, input: UpdateScheduleInput): Promise<ScheduledTrigger> {
    log.info('Updating schedule', { scheduleId: id, ...input });

    const schedule = await this.repository.updateSchedule(id, input);

    log.info('Schedule updated', {
      scheduleId: schedule.id,
      nextRunAt: schedule.nextRunAt,
    });

    return schedule;
  }

  /**
   * Delete a schedule.
   */
  async deleteSchedule(id: string): Promise<boolean> {
    log.info('Deleting schedule', { scheduleId: id });

    const deleted = await this.repository.deleteSchedule(id);

    if (deleted) {
      log.info('Schedule deleted', { scheduleId: id });
    }

    return deleted;
  }

  /**
   * Enable a schedule.
   */
  async enableSchedule(id: string): Promise<ScheduledTrigger> {
    return this.updateSchedule(id, { enabled: true });
  }

  /**
   * Disable a schedule.
   */
  async disableSchedule(id: string): Promise<ScheduledTrigger> {
    return this.updateSchedule(id, { enabled: false });
  }

  // ==================
  // Schedule Execution
  // ==================

  /**
   * Start the scheduler polling loop.
   */
  start(intervalMs = 60000): void {
    if (this.running) {
      log.warn('Scheduler already running');
      return;
    }

    log.info('Starting scheduler', { intervalMs });

    this.running = true;

    // Run immediately
    this.processDueSchedules().catch((error) => {
      log.error('Error processing due schedules', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Then poll at interval
    this.pollInterval = setInterval(() => {
      this.processDueSchedules().catch((error) => {
        log.error('Error processing due schedules', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, intervalMs);

    log.info('Scheduler started');
  }

  /**
   * Stop the scheduler polling loop.
   */
  stop(): void {
    if (!this.running) return;

    log.info('Stopping scheduler');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.running = false;
    log.info('Scheduler stopped');
  }

  /**
   * Check if scheduler is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Process all schedules that are due.
   */
  async processDueSchedules(): Promise<TriggerResult[]> {
    const now = new Date();
    const dueSchedules = await this.repository.findDueSchedules(now);

    if (dueSchedules.length === 0) {
      return [];
    }

    log.info('Processing due schedules', { count: dueSchedules.length });

    const results: TriggerResult[] = [];

    for (const schedule of dueSchedules) {
      const result = await this.executeSchedule(schedule);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute a single scheduled trigger.
   */
  async executeSchedule(schedule: ScheduledTrigger): Promise<TriggerResult> {
    const triggeredAt = new Date();

    log.info('Executing schedule', {
      scheduleId: schedule.id,
      workflowId: schedule.workflowId,
    });

    try {
      // Trigger the workflow
      const run = await this.workflowService.triggerRun(schedule.workflowId, 'schedule', {
        scheduleId: schedule.id,
        scheduledAt: schedule.nextRunAt,
      });

      // Update schedule with new next run time
      await this.repository.markScheduleExecuted(schedule.id);

      // Publish event
      await this.eventBus.publish({
        type: 'schedule:fired',
        workflowId: schedule.workflowId,
        runId: run.id,
        triggerId: schedule.id,
        data: {
          cron: schedule.cron,
          timezone: schedule.timezone,
        },
      });

      log.info('Schedule executed successfully', {
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        runId: run.id,
      });

      return {
        success: true,
        runId: run.id,
        triggeredAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.error('Schedule execution failed', {
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        error: errorMessage,
      });

      // Still update the next run time to avoid repeated failures
      await this.repository.markScheduleExecuted(schedule.id);

      return {
        success: false,
        error: errorMessage,
        triggeredAt,
      };
    }
  }

  /**
   * Manually trigger a schedule (for testing or manual override).
   */
  async triggerScheduleNow(id: string): Promise<TriggerResult> {
    const schedule = await this.repository.findScheduleById(id);

    if (!schedule) {
      return {
        success: false,
        error: `Schedule ${id} not found`,
        triggeredAt: new Date(),
      };
    }

    return this.executeSchedule(schedule);
  }
}

// Default singleton instance
let scheduler: SchedulerService | null = null;

/**
 * Get or create the default scheduler service.
 */
export function getSchedulerService(): SchedulerService {
  if (!scheduler) {
    scheduler = new SchedulerService();
  }
  return scheduler;
}

/**
 * Reset the default scheduler (for testing).
 */
export function resetSchedulerService(): void {
  if (scheduler) {
    scheduler.stop();
  }
  scheduler = null;
}

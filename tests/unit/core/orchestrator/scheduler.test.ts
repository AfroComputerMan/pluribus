import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { EventBus } from '@/core/orchestrator/event-bus';
import type { OrchestratorRepository } from '@/core/orchestrator/repository';
import { SchedulerService } from '@/core/orchestrator/scheduler';
import type { ScheduledTrigger } from '@/core/orchestrator/types';
import type { WorkflowService } from '@/core/workflows/service';

describe('SchedulerService', () => {
  let scheduler: SchedulerService;
  let mockRepository: Partial<OrchestratorRepository>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockWorkflowService: any;
  let mockEventBus: Partial<EventBus>;

  const createMockSchedule = (overrides: Partial<ScheduledTrigger> = {}): ScheduledTrigger => ({
    id: 'schedule-123',
    workflowId: 'workflow-123',
    cron: '0 9 * * *',
    timezone: 'UTC',
    enabled: true,
    lastRunAt: null,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    mockRepository = {
      findScheduleById: mock(() => Promise.resolve(null)),
      findSchedules: mock(() => Promise.resolve([])),
      findDueSchedules: mock(() => Promise.resolve([])),
      createSchedule: mock(() => Promise.resolve(createMockSchedule())),
      updateSchedule: mock(() => Promise.resolve(createMockSchedule())),
      markScheduleExecuted: mock(() => Promise.resolve(createMockSchedule())),
      deleteSchedule: mock(() => Promise.resolve(true)),
    };

    mockWorkflowService = {
      triggerRun: mock(
        (_workflowId: string, _triggerType?: string, _input?: Record<string, unknown>) =>
          Promise.resolve({
            id: 'run-123',
            workflowId: 'workflow-123',
            status: 'pending' as const,
            triggerType: 'schedule' as const,
            input: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: null,
            error: null,
          })
      ),
    };

    mockEventBus = {
      publish: mock(() => Promise.resolve()),
    };

    scheduler = new SchedulerService(
      mockRepository as OrchestratorRepository,
      mockWorkflowService as unknown as WorkflowService,
      mockEventBus as EventBus
    );
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('CRUD operations', () => {
    it('should create a schedule', async () => {
      const input = {
        workflowId: 'workflow-123',
        cron: '0 9 * * *',
      };

      const result = await scheduler.createSchedule(input);

      expect(mockRepository.createSchedule).toHaveBeenCalledWith(input);
      expect(result.id).toBe('schedule-123');
    });

    it('should get schedule by ID', async () => {
      const schedule = createMockSchedule();
      (mockRepository.findScheduleById as ReturnType<typeof mock>).mockResolvedValue(schedule);

      const result = await scheduler.getSchedule('schedule-123');

      expect(result).toEqual(schedule);
      expect(mockRepository.findScheduleById).toHaveBeenCalledWith('schedule-123');
    });

    it('should list schedules with filter', async () => {
      const schedules = [createMockSchedule()];
      (mockRepository.findSchedules as ReturnType<typeof mock>).mockResolvedValue(schedules);

      const filter = { workflowId: 'workflow-123' };
      const result = await scheduler.listSchedules(filter);

      expect(result).toEqual(schedules);
      expect(mockRepository.findSchedules).toHaveBeenCalledWith(filter);
    });

    it('should update schedule', async () => {
      const updated = createMockSchedule({ cron: '0 18 * * *' });
      (mockRepository.updateSchedule as ReturnType<typeof mock>).mockResolvedValue(updated);

      const result = await scheduler.updateSchedule('schedule-123', { cron: '0 18 * * *' });

      expect(result.cron).toBe('0 18 * * *');
    });

    it('should delete schedule', async () => {
      const result = await scheduler.deleteSchedule('schedule-123');

      expect(result).toBe(true);
      expect(mockRepository.deleteSchedule).toHaveBeenCalledWith('schedule-123');
    });

    it('should enable schedule', async () => {
      await scheduler.enableSchedule('schedule-123');

      expect(mockRepository.updateSchedule).toHaveBeenCalledWith('schedule-123', { enabled: true });
    });

    it('should disable schedule', async () => {
      await scheduler.disableSchedule('schedule-123');

      expect(mockRepository.updateSchedule).toHaveBeenCalledWith('schedule-123', {
        enabled: false,
      });
    });
  });

  describe('executeSchedule', () => {
    it('should trigger workflow and update schedule', async () => {
      const schedule = createMockSchedule();

      const result = await scheduler.executeSchedule(schedule);

      expect(result.success).toBe(true);
      expect(result.runId).toBe('run-123');
      expect(mockWorkflowService.triggerRun).toHaveBeenCalledWith(
        'workflow-123',
        'schedule',
        expect.objectContaining({ scheduleId: 'schedule-123' })
      );
      expect(mockRepository.markScheduleExecuted).toHaveBeenCalledWith('schedule-123');
      expect(mockEventBus.publish).toHaveBeenCalled();
    });

    it('should handle workflow trigger errors', async () => {
      const schedule = createMockSchedule();
      (mockWorkflowService.triggerRun as ReturnType<typeof mock>).mockRejectedValue(
        new Error('Workflow not found')
      );

      const result = await scheduler.executeSchedule(schedule);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Workflow not found');
      // Should still update next run time even on failure
      expect(mockRepository.markScheduleExecuted).toHaveBeenCalledWith('schedule-123');
    });
  });

  describe('processDueSchedules', () => {
    it('should process all due schedules', async () => {
      const schedules = [
        createMockSchedule({ id: 'schedule-1', workflowId: 'workflow-1' }),
        createMockSchedule({ id: 'schedule-2', workflowId: 'workflow-2' }),
      ];
      (mockRepository.findDueSchedules as ReturnType<typeof mock>).mockResolvedValue(schedules);

      const results = await scheduler.processDueSchedules();

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('should return empty array when no schedules are due', async () => {
      (mockRepository.findDueSchedules as ReturnType<typeof mock>).mockResolvedValue([]);

      const results = await scheduler.processDueSchedules();

      expect(results).toHaveLength(0);
    });
  });

  describe('triggerScheduleNow', () => {
    it('should trigger schedule immediately when found', async () => {
      const schedule = createMockSchedule();
      (mockRepository.findScheduleById as ReturnType<typeof mock>).mockResolvedValue(schedule);

      const result = await scheduler.triggerScheduleNow('schedule-123');

      expect(result.success).toBe(true);
      expect(result.runId).toBe('run-123');
    });

    it('should return error when schedule not found', async () => {
      (mockRepository.findScheduleById as ReturnType<typeof mock>).mockResolvedValue(null);

      const result = await scheduler.triggerScheduleNow('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('start/stop', () => {
    it('should start and stop the scheduler', () => {
      expect(scheduler.isRunning()).toBe(false);

      scheduler.start(60000);

      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();

      expect(scheduler.isRunning()).toBe(false);
    });

    it('should not start twice', () => {
      scheduler.start(60000);
      scheduler.start(60000); // Should log warning but not error

      expect(scheduler.isRunning()).toBe(true);
    });

    it('should be safe to stop when not running', () => {
      scheduler.stop(); // Should not error
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should process due schedules on start', async () => {
      (mockRepository.findDueSchedules as ReturnType<typeof mock>).mockResolvedValue([]);

      scheduler.start(60000);

      // Give async processing a moment
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRepository.findDueSchedules).toHaveBeenCalled();
    });
  });
});

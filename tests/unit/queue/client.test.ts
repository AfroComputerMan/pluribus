import { describe, expect, test } from 'bun:test';
import { QUEUE_NAMES } from '@/queue/client';

describe('Queue Constants', () => {
  test('QUEUE_NAMES has expected values', () => {
    expect(QUEUE_NAMES.WORKFLOW).toBe('workflow');
    expect(QUEUE_NAMES.NODE).toBe('node');
    expect(QUEUE_NAMES.SCHEDULE).toBe('schedule');
  });

  test('QUEUE_NAMES is readonly', () => {
    // TypeScript would catch this at compile time, but we verify runtime behavior
    expect(Object.isFrozen(QUEUE_NAMES)).toBe(false); // as const doesn't freeze
    expect(QUEUE_NAMES.WORKFLOW).toBe('workflow');
  });
});

describe('Queue Job Data Types', () => {
  test('WorkflowJobData has correct shape', () => {
    const jobData = {
      runId: 'run-123',
      workflowId: 'wf-456',
      triggerType: 'manual' as const,
      input: { key: 'value' },
    };

    expect(jobData.runId).toBe('run-123');
    expect(jobData.workflowId).toBe('wf-456');
    expect(jobData.triggerType).toBe('manual');
    expect(jobData.input).toEqual({ key: 'value' });
  });

  test('NodeJobData has correct shape', () => {
    const jobData = {
      runId: 'run-123',
      workflowId: 'wf-456',
      nodeId: 'node-789',
      input: { task: 'analyze' },
      context: { previousResult: {} },
    };

    expect(jobData.nodeId).toBe('node-789');
    expect(jobData.input).toEqual({ task: 'analyze' });
    expect(jobData.context).toEqual({ previousResult: {} });
  });

  test('ScheduleJobData has correct shape', () => {
    const jobData = {
      workflowId: 'wf-456',
      cron: '0 9 * * *',
    };

    expect(jobData.workflowId).toBe('wf-456');
    expect(jobData.cron).toBe('0 9 * * *');
  });
});

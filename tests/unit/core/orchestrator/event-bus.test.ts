import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { EventBus } from '@/core/orchestrator/event-bus';
import type { OrchestratorEvent } from '@/core/orchestrator/types';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus(100);
  });

  describe('subscribe', () => {
    it('should create a subscription and return an ID', () => {
      const handler = mock(() => {});
      const id = eventBus.subscribe(['workflow:started'], handler);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(eventBus.getSubscriptionCount()).toBe(1);
    });

    it('should allow multiple subscriptions', () => {
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});

      eventBus.subscribe(['workflow:started'], handler1);
      eventBus.subscribe(['workflow:completed'], handler2);

      expect(eventBus.getSubscriptionCount()).toBe(2);
    });
  });

  describe('subscribeAll', () => {
    it('should subscribe to all event types', async () => {
      const handler = mock(() => {});
      eventBus.subscribeAll(handler);

      await eventBus.publish({
        type: 'workflow:started',
        workflowId: 'wf-1',
        data: {},
      });

      await eventBus.publish({
        type: 'node:completed',
        workflowId: 'wf-1',
        data: {},
      });

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('unsubscribe', () => {
    it('should remove a subscription', () => {
      const handler = mock(() => {});
      const id = eventBus.subscribe(['workflow:started'], handler);

      expect(eventBus.getSubscriptionCount()).toBe(1);

      const removed = eventBus.unsubscribe(id);

      expect(removed).toBe(true);
      expect(eventBus.getSubscriptionCount()).toBe(0);
    });

    it('should return false for non-existent subscription', () => {
      const removed = eventBus.unsubscribe('non-existent-id');
      expect(removed).toBe(false);
    });

    it('should not call handler after unsubscribe', async () => {
      const handler = mock(() => {});
      const id = eventBus.subscribe(['workflow:started'], handler);

      eventBus.unsubscribe(id);

      await eventBus.publish({
        type: 'workflow:started',
        workflowId: 'wf-1',
        data: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('should call matching handlers', async () => {
      const handler = mock(() => {});
      eventBus.subscribe(['workflow:started'], handler);

      await eventBus.publish({
        type: 'workflow:started',
        workflowId: 'wf-1',
        runId: 'run-1',
        data: { foo: 'bar' },
      });

      expect(handler).toHaveBeenCalledTimes(1);

      const calledWith = (handler.mock.calls[0] as unknown[])?.[0] as OrchestratorEvent;
      expect(calledWith.type).toBe('workflow:started');
      expect(calledWith.workflowId).toBe('wf-1');
      expect(calledWith.runId).toBe('run-1');
      expect(calledWith.data).toEqual({ foo: 'bar' });
      expect(calledWith.id).toBeDefined();
      expect(calledWith.timestamp).toBeInstanceOf(Date);
    });

    it('should not call non-matching handlers', async () => {
      const handler = mock(() => {});
      eventBus.subscribe(['workflow:completed'], handler);

      await eventBus.publish({
        type: 'workflow:started',
        workflowId: 'wf-1',
        data: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should call multiple matching handlers', async () => {
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});

      eventBus.subscribe(['workflow:started'], handler1);
      eventBus.subscribe(['workflow:started'], handler2);

      await eventBus.publish({
        type: 'workflow:started',
        workflowId: 'wf-1',
        data: {},
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should handle async handlers', async () => {
      const results: string[] = [];

      eventBus.subscribe(['workflow:started'], async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push('first');
      });

      eventBus.subscribe(['workflow:started'], async () => {
        results.push('second');
      });

      await eventBus.publish({
        type: 'workflow:started',
        workflowId: 'wf-1',
        data: {},
      });

      // Both handlers should have completed
      expect(results).toContain('first');
      expect(results).toContain('second');
    });

    it('should catch handler errors without affecting other handlers', async () => {
      const handler1 = mock(() => {
        throw new Error('Handler error');
      });
      const handler2 = mock(() => {});

      eventBus.subscribe(['workflow:started'], handler1);
      eventBus.subscribe(['workflow:started'], handler2);

      // Should not throw
      await eventBus.publish({
        type: 'workflow:started',
        workflowId: 'wf-1',
        data: {},
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should add events to history', async () => {
      await eventBus.publish({
        type: 'workflow:started',
        workflowId: 'wf-1',
        data: {},
      });

      const events = eventBus.getRecentEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('workflow:started');
    });

    it('should limit history size', async () => {
      // EventBus was created with maxHistorySize=100
      for (let i = 0; i < 150; i++) {
        await eventBus.publish({
          type: 'workflow:started',
          workflowId: `wf-${i}`,
          data: {},
        });
      }

      const events = eventBus.getRecentEvents(200);
      expect(events).toHaveLength(100);

      // First events should have been removed
      expect(events[0]?.workflowId).toBe('wf-50');
    });
  });

  describe('getRecentEvents', () => {
    it('should return events in order', async () => {
      await eventBus.publish({ type: 'workflow:started', workflowId: 'wf-1', data: {} });
      await eventBus.publish({ type: 'workflow:completed', workflowId: 'wf-1', data: {} });

      const events = eventBus.getRecentEvents();

      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe('workflow:started');
      expect(events[1]?.type).toBe('workflow:completed');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await eventBus.publish({ type: 'workflow:started', workflowId: `wf-${i}`, data: {} });
      }

      const events = eventBus.getRecentEvents(5);
      expect(events).toHaveLength(5);

      // Should return the last 5 events
      expect(events[0]?.workflowId).toBe('wf-5');
    });
  });

  describe('getWorkflowEvents', () => {
    it('should filter events by workflow ID', async () => {
      await eventBus.publish({ type: 'workflow:started', workflowId: 'wf-1', data: {} });
      await eventBus.publish({ type: 'workflow:started', workflowId: 'wf-2', data: {} });
      await eventBus.publish({ type: 'workflow:completed', workflowId: 'wf-1', data: {} });

      const events = eventBus.getWorkflowEvents('wf-1');

      expect(events).toHaveLength(2);
      expect(events.every((e) => e.workflowId === 'wf-1')).toBe(true);
    });
  });

  describe('getRunEvents', () => {
    it('should filter events by run ID', async () => {
      await eventBus.publish({
        type: 'workflow:started',
        workflowId: 'wf-1',
        runId: 'run-1',
        data: {},
      });
      await eventBus.publish({
        type: 'node:started',
        workflowId: 'wf-1',
        runId: 'run-1',
        nodeId: 'A',
        data: {},
      });
      await eventBus.publish({
        type: 'workflow:started',
        workflowId: 'wf-1',
        runId: 'run-2',
        data: {},
      });

      const events = eventBus.getRunEvents('run-1');

      expect(events).toHaveLength(2);
      expect(events.every((e) => e.runId === 'run-1')).toBe(true);
    });
  });

  describe('clearSubscriptions', () => {
    it('should remove all subscriptions', () => {
      eventBus.subscribe(['workflow:started'], () => {});
      eventBus.subscribe(['workflow:completed'], () => {});

      expect(eventBus.getSubscriptionCount()).toBe(2);

      eventBus.clearSubscriptions();

      expect(eventBus.getSubscriptionCount()).toBe(0);
    });
  });

  describe('clearHistory', () => {
    it('should remove all events from history', async () => {
      await eventBus.publish({ type: 'workflow:started', workflowId: 'wf-1', data: {} });
      await eventBus.publish({ type: 'workflow:completed', workflowId: 'wf-1', data: {} });

      expect(eventBus.getRecentEvents()).toHaveLength(2);

      eventBus.clearHistory();

      expect(eventBus.getRecentEvents()).toHaveLength(0);
    });
  });
});

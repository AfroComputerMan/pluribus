import { randomUUID } from 'crypto';
import { logger } from '@/observability/logger';
import type { EventType, EventHandler, EventSubscription, OrchestratorEvent } from './types';

const log = logger.child('orchestrator:event-bus');

/**
 * In-memory event bus for orchestrator events.
 * Provides pub/sub functionality for workflow lifecycle events.
 */
export class EventBus {
  private subscriptions: Map<string, EventSubscription> = new Map();
  private eventHistory: OrchestratorEvent[] = [];
  private maxHistorySize: number;

  constructor(maxHistorySize = 1000) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Subscribe to specific event types.
   */
  subscribe(eventTypes: EventType[], handler: EventHandler): string {
    const id = randomUUID();

    const subscription: EventSubscription = {
      id,
      eventTypes,
      handler,
    };

    this.subscriptions.set(id, subscription);
    log.debug('Subscription created', { subscriptionId: id, eventTypes });

    return id;
  }

  /**
   * Subscribe to all event types.
   */
  subscribeAll(handler: EventHandler): string {
    const allTypes: EventType[] = [
      'workflow:triggered',
      'workflow:started',
      'workflow:completed',
      'workflow:failed',
      'workflow:cancelled',
      'node:started',
      'node:completed',
      'node:failed',
      'schedule:fired',
      'webhook:received',
    ];

    return this.subscribe(allTypes, handler);
  }

  /**
   * Unsubscribe from events.
   */
  unsubscribe(subscriptionId: string): boolean {
    const removed = this.subscriptions.delete(subscriptionId);
    if (removed) {
      log.debug('Subscription removed', { subscriptionId });
    }
    return removed;
  }

  /**
   * Publish an event to all matching subscribers.
   */
  async publish(event: Omit<OrchestratorEvent, 'id' | 'timestamp'>): Promise<void> {
    const fullEvent: OrchestratorEvent = {
      ...event,
      id: randomUUID(),
      timestamp: new Date(),
    };

    // Add to history
    this.eventHistory.push(fullEvent);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    log.debug('Event published', {
      eventId: fullEvent.id,
      type: fullEvent.type,
      workflowId: fullEvent.workflowId,
      runId: fullEvent.runId,
    });

    // Notify all matching subscribers
    const promises: Promise<void>[] = [];

    for (const subscription of this.subscriptions.values()) {
      if (subscription.eventTypes.includes(fullEvent.type)) {
        promises.push(this.notifySubscriber(subscription, fullEvent));
      }
    }

    await Promise.allSettled(promises);
  }

  /**
   * Notify a single subscriber, catching any errors.
   */
  private async notifySubscriber(
    subscription: EventSubscription,
    event: OrchestratorEvent
  ): Promise<void> {
    try {
      await subscription.handler(event);
    } catch (error) {
      log.error('Subscriber handler error', {
        subscriptionId: subscription.id,
        eventId: event.id,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get recent events from history.
   */
  getRecentEvents(limit = 100): OrchestratorEvent[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Get events for a specific workflow.
   */
  getWorkflowEvents(workflowId: string, limit = 100): OrchestratorEvent[] {
    return this.eventHistory
      .filter((e) => e.workflowId === workflowId)
      .slice(-limit);
  }

  /**
   * Get events for a specific run.
   */
  getRunEvents(runId: string): OrchestratorEvent[] {
    return this.eventHistory.filter((e) => e.runId === runId);
  }

  /**
   * Clear all subscriptions.
   */
  clearSubscriptions(): void {
    this.subscriptions.clear();
    log.debug('All subscriptions cleared');
  }

  /**
   * Clear event history.
   */
  clearHistory(): void {
    this.eventHistory = [];
    log.debug('Event history cleared');
  }

  /**
   * Get subscription count.
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }
}

// Default singleton instance
let defaultEventBus: EventBus | null = null;

/**
 * Get or create the default event bus.
 */
export function getEventBus(): EventBus {
  if (!defaultEventBus) {
    defaultEventBus = new EventBus();
  }
  return defaultEventBus;
}

/**
 * Reset the default event bus (for testing).
 */
export function resetEventBus(): void {
  if (defaultEventBus) {
    defaultEventBus.clearSubscriptions();
    defaultEventBus.clearHistory();
  }
  defaultEventBus = null;
}

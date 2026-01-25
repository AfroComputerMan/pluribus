import { logger } from '@/observability/logger';
import { getRedis } from './client';
import type { WorkerEvent, WorkerEventHandler, WorkerEventType } from './workers/types';

const log = logger.child('queue:events');

/**
 * Publish a workflow or node event to Redis pub/sub for SSE clients.
 */
export async function publishRunEvent(
  type: WorkerEventType,
  runId: string,
  workflowId: string,
  nodeId?: string,
  data?: Record<string, unknown>
): Promise<void> {
  const timestamp = new Date();
  const channel = `run:${runId}`;

  const event = {
    type,
    timestamp: timestamp.toISOString(),
    runId,
    workflowId,
    ...(nodeId && { nodeId }),
    ...(data && { data }),
  };

  try {
    const redis = getRedis();
    await redis.publish(channel, JSON.stringify(event));
    log.debug('Published event to Redis', { type, runId, nodeId, channel });
  } catch (error) {
    log.error('Failed to publish event to Redis', { error, type, runId, nodeId });
  }
}

/**
 * Emit an event to registered handlers and publish to Redis.
 * Returns the WorkerEvent object for handler consumption.
 */
export async function emitRunEvent(
  type: WorkerEventType,
  runId: string,
  workflowId: string,
  handlers: Set<WorkerEventHandler>,
  nodeId?: string,
  data?: Record<string, unknown>
): Promise<void> {
  const timestamp = new Date();

  const event: WorkerEvent = {
    type,
    timestamp,
    runId,
    workflowId,
    ...(nodeId && { nodeId }),
    ...(data && { data }),
  };

  // Publish to Redis pub/sub for SSE clients
  await publishRunEvent(type, runId, workflowId, nodeId, data);

  // Emit to registered handlers
  for (const handler of handlers) {
    try {
      await handler(event);
    } catch (error) {
      log.error('Event handler error', { error });
    }
  }
}

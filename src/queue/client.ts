import { type ConnectionOptions, type Job, Queue } from 'bullmq';
import IORedis from 'ioredis';

// Queue names
export const QUEUE_NAMES = {
  WORKFLOW: 'workflow',
  NODE: 'node',
  SCHEDULE: 'schedule',
} as const;

// Lazy initialization to avoid connecting during module import (breaks unit tests)
let _redis: IORedis | null = null;
let _workflowQueue: Queue | null = null;
let _nodeQueue: Queue | null = null;
let _scheduleQueue: Queue | null = null;

function getConnection(): ConnectionOptions {
  return {
    host: new URL(process.env.REDIS_URL || 'redis://localhost:6379').hostname,
    port: Number.parseInt(
      new URL(process.env.REDIS_URL || 'redis://localhost:6379').port || '6379',
      10
    ),
  };
}

export function getRedis(): IORedis {
  if (!_redis) {
    _redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
  }
  return _redis;
}

export function getWorkflowQueue(): Queue {
  if (!_workflowQueue) {
    _workflowQueue = new Queue(QUEUE_NAMES.WORKFLOW, { connection: getConnection() });
  }
  return _workflowQueue;
}

export function getNodeQueue(): Queue {
  if (!_nodeQueue) {
    _nodeQueue = new Queue(QUEUE_NAMES.NODE, { connection: getConnection() });
  }
  return _nodeQueue;
}

export function getScheduleQueue(): Queue {
  if (!_scheduleQueue) {
    _scheduleQueue = new Queue(QUEUE_NAMES.SCHEDULE, { connection: getConnection() });
  }
  return _scheduleQueue;
}

// Job data types
export interface WorkflowJobData {
  runId: string;
  workflowId: string;
  triggerType: 'manual' | 'schedule' | 'webhook' | 'api';
  input: Record<string, unknown>;
}

export interface NodeJobData {
  runId: string;
  workflowId: string;
  nodeId: string;
  input: Record<string, unknown>;
  context: Record<string, unknown>;
}

export interface ScheduleJobData {
  workflowId: string;
  cron: string;
}

// Queue helper functions
export async function enqueueWorkflow(data: WorkflowJobData): Promise<Job<WorkflowJobData>> {
  return getWorkflowQueue().add('execute', data, {
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  });
}

export async function enqueueNode(
  data: NodeJobData,
  dependencies?: string[]
): Promise<Job<NodeJobData>> {
  return getNodeQueue().add('execute', data, {
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    ...(dependencies?.length && {
      parent: {
        queue: QUEUE_NAMES.WORKFLOW,
        id: data.runId,
      },
    }),
  });
}

// Graceful shutdown
export async function closeQueues(): Promise<void> {
  const closePromises = [];
  if (_workflowQueue) closePromises.push(_workflowQueue.close());
  if (_nodeQueue) closePromises.push(_nodeQueue.close());
  if (_scheduleQueue) closePromises.push(_scheduleQueue.close());
  if (_redis) closePromises.push(_redis.quit());
  await Promise.all(closePromises);
}

// Health check
export async function checkQueueHealth(): Promise<boolean> {
  try {
    await getRedis().ping();
    return true;
  } catch {
    return false;
  }
}

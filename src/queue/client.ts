import { type ConnectionOptions, type Job, Queue } from 'bullmq';
import IORedis from 'ioredis';

// Redis connection
const connection: ConnectionOptions = {
  host: new URL(process.env.REDIS_URL || 'redis://localhost:6379').hostname,
  port: Number.parseInt(
    new URL(process.env.REDIS_URL || 'redis://localhost:6379').port || '6379',
    10
  ),
};

// Create IORedis instance for pub/sub
export const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');

// Queue names
export const QUEUE_NAMES = {
  WORKFLOW: 'workflow',
  NODE: 'node',
  SCHEDULE: 'schedule',
} as const;

// Create queues
export const workflowQueue = new Queue(QUEUE_NAMES.WORKFLOW, { connection });
export const nodeQueue = new Queue(QUEUE_NAMES.NODE, { connection });
export const scheduleQueue = new Queue(QUEUE_NAMES.SCHEDULE, { connection });

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
  return workflowQueue.add('execute', data, {
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
  return nodeQueue.add('execute', data, {
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
  await Promise.all([
    workflowQueue.close(),
    nodeQueue.close(),
    scheduleQueue.close(),
    redis.quit(),
  ]);
}

// Health check
export async function checkQueueHealth(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

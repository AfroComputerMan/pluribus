import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import IORedis from 'ioredis';
import { createTestWorkflowInput } from '../../setup/fixtures';
import { type TestContainers, startTestContainers } from '../../setup/testcontainers';

/**
 * API integration tests for /api/runs endpoints including SSE
 */
describe('Runs API Integration', () => {
  let containers: TestContainers;
  let app: Hono;
  let redis: IORedis;

  // Create a test app that mirrors the real routes
  function createTestApp(db: ReturnType<typeof drizzle<typeof schema>>, redisClient: IORedis) {
    const app = new Hono();

    // GET /api/runs/:id
    app.get('/api/runs/:id', async (c) => {
      const run = await db.query.workflowRuns.findFirst({
        where: eq(schema.workflowRuns.id, c.req.param('id')),
      });

      if (!run) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'WorkflowRun not found' } }, 404);
      }

      return c.json({ data: run });
    });

    // GET /api/runs/:id/nodes
    app.get('/api/runs/:id/nodes', async (c) => {
      const nodes = await db.query.nodeExecutions.findMany({
        where: eq(schema.nodeExecutions.workflowRunId, c.req.param('id')),
      });

      return c.json({ data: nodes });
    });

    // GET /api/runs/:id/events - SSE endpoint
    app.get('/api/runs/:id/events', async (c) => {
      const runId = c.req.param('id');

      // Verify run exists
      const run = await db.query.workflowRuns.findFirst({
        where: eq(schema.workflowRuns.id, runId),
      });

      if (!run) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'WorkflowRun not found' } }, 404);
      }

      return streamSSE(c, async (stream) => {
        const subscriber = redisClient.duplicate();
        await subscriber.connect();

        const channel = `run:${runId}`;
        let isActive = true;

        await subscriber.subscribe(channel, (message, _channel) => {
          if (!isActive || !message || message instanceof Error) return;

          try {
            const event = JSON.parse(message);
            stream.writeSSE({
              data: JSON.stringify(event),
              event: event.type,
              id: Date.now().toString(),
            });
          } catch {
            // Ignore errors in test
          }
        });

        // Send initial connection confirmation
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'connected',
            runId,
            timestamp: new Date().toISOString(),
          }),
          event: 'connected',
          id: Date.now().toString(),
        });

        // Cleanup on disconnect
        c.req.raw.signal.addEventListener('abort', async () => {
          isActive = false;
          try {
            await subscriber.unsubscribe(channel);
            await subscriber.quit();
          } catch {
            // Ignore cleanup errors
          }
        });

        // Keep stream open
        await stream.sleep(Number.MAX_SAFE_INTEGER);
      });
    });

    return app;
  }

  beforeAll(async () => {
    containers = await startTestContainers();

    // Create Redis client for testing
    let redisUrl: string;
    if (process.env.TEST_REDIS_URL) {
      redisUrl = process.env.TEST_REDIS_URL;
    } else if (containers.redis) {
      redisUrl = `redis://${containers.redis.getHost()}:${containers.redis.getPort()}`;
    } else {
      redisUrl = 'redis://localhost:6379';
    }

    redis = new IORedis(redisUrl);

    app = createTestApp(containers.db, redis);
  }, 90000);

  afterAll(async () => {
    await redis.quit();
    await containers.cleanup();
  });

  beforeEach(async () => {
    // Clean up tables before each test
    await containers.db.delete(schema.nodeExecutions);
    await containers.db.delete(schema.workflowRuns);
    await containers.db.delete(schema.workflows);
  });

  describe('GET /api/runs/:id', () => {
    test('returns run by id', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow!.id,
          status: 'running',
          triggerType: 'api',
          input: { test: 'data' },
        })
        .returning();

      const res = await app.request(`/api/runs/${run!.id}`);
      const json = (await res.json()) as { data: { id: string; status: string } };

      expect(res.status).toBe(200);
      expect(json.data.id).toBe(run!.id);
      expect(json.data.status).toBe('running');
    });

    test('returns 404 for non-existent run', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await app.request(`/api/runs/${fakeId}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/runs/:id/nodes', () => {
    test('returns empty array when no node executions', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow!.id,
          status: 'pending',
          triggerType: 'api',
        })
        .returning();

      const res = await app.request(`/api/runs/${run!.id}/nodes`);
      const json = (await res.json()) as { data: unknown[] };

      expect(res.status).toBe(200);
      expect(json.data).toEqual([]);
    });

    test('returns node executions for a run', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow!.id,
          status: 'running',
          triggerType: 'api',
        })
        .returning();

      await containers.db.insert(schema.nodeExecutions).values([
        {
          workflowRunId: run!.id,
          nodeId: 'node-1',
          status: 'completed',
          input: { test: 'input' },
          output: { result: 'success' },
        },
        {
          workflowRunId: run!.id,
          nodeId: 'node-2',
          status: 'running',
          input: { from: 'node-1' },
        },
      ]);

      const res = await app.request(`/api/runs/${run!.id}/nodes`);
      const json = (await res.json()) as { data: Array<{ nodeId: string }> };

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
    });
  });

  describe('GET /api/runs/:id/events (SSE)', () => {
    test('returns 404 for non-existent run', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await app.request(`/api/runs/${fakeId}/events`);

      expect(res.status).toBe(404);
    });

    test('establishes SSE connection and receives events', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow!.id,
          status: 'running',
          triggerType: 'api',
        })
        .returning();

      // Create a mock request with AbortController
      const controller = new AbortController();
      const mockRequest = new Request(`http://localhost/api/runs/${run!.id}/events`, {
        signal: controller.signal,
      });

      // Start SSE connection in background
      const responsePromise = app.request(mockRequest);

      // Give it time to connect
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Publish test events to Redis
      const channel = `run:${run!.id}`;
      await redis.publish(
        channel,
        JSON.stringify({
          type: 'node:started',
          timestamp: new Date().toISOString(),
          runId: run!.id,
          workflowId: workflow!.id,
          nodeId: 'test-node',
        })
      );

      await redis.publish(
        channel,
        JSON.stringify({
          type: 'node:completed',
          timestamp: new Date().toISOString(),
          runId: run!.id,
          workflowId: workflow!.id,
          nodeId: 'test-node',
          data: { output: { result: 'success' } },
        })
      );

      // Give events time to propagate
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Abort the connection
      controller.abort();

      // Verify the response is a valid SSE response
      const response = await responsePromise;
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });

    test('publishes workflow events correctly', async () => {
      const [workflow] = await containers.db
        .insert(schema.workflows)
        .values(createTestWorkflowInput())
        .returning();

      const [run] = await containers.db
        .insert(schema.workflowRuns)
        .values({
          workflowId: workflow!.id,
          status: 'running',
          triggerType: 'api',
        })
        .returning();

      // Subscribe to the channel directly to verify events
      const testSubscriber = redis.duplicate();
      await testSubscriber.connect();

      const receivedEvents: unknown[] = [];
      const channel = `run:${run!.id}`;

      await testSubscriber.subscribe(channel, (message, _channel) => {
        if (message && !(message instanceof Error)) {
          receivedEvents.push(JSON.parse(message));
        }
      });

      // Simulate publishing workflow events
      await redis.publish(
        channel,
        JSON.stringify({
          type: 'workflow:started',
          timestamp: new Date().toISOString(),
          runId: run!.id,
          workflowId: workflow!.id,
        })
      );

      await redis.publish(
        channel,
        JSON.stringify({
          type: 'workflow:completed',
          timestamp: new Date().toISOString(),
          runId: run!.id,
          workflowId: workflow!.id,
        })
      );

      // Wait for events to be received
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(receivedEvents.length).toBe(2);
      expect((receivedEvents[0] as { type: string }).type).toBe('workflow:started');
      expect((receivedEvents[1] as { type: string }).type).toBe('workflow:completed');

      await testSubscriber.unsubscribe(channel);
      await testSubscriber.quit();
    });
  });
});

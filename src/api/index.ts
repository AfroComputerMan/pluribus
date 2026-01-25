import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';

import { checkDatabaseHealth } from '@/db';
import { checkQueueHealth } from '@/queue';
import { errorHandler } from './middleware';
import {
  agents,
  mcp,
  observability,
  orchestrator,
  runs,
  skillRoutes,
  vault,
  workflowRoutes,
} from './routes';

// Create Hono app
export const app = new Hono();

// Global middleware
app.use('*', secureHeaders());
app.use('*', cors());
app.use('*', timing());
app.use('*', honoLogger());
app.use('*', errorHandler);

// Health check endpoint
app.get('/health', async (c) => {
  const [dbHealth, queueHealth] = await Promise.all([checkDatabaseHealth(), checkQueueHealth()]);

  const status = dbHealth && queueHealth ? 'healthy' : 'unhealthy';
  const statusCode = status === 'healthy' ? 200 : 503;

  return c.json(
    {
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth ? 'up' : 'down',
        queue: queueHealth ? 'up' : 'down',
      },
    },
    statusCode
  );
});

// API routes
app.route('/api/agents', agents);
app.route('/api/workflows', workflowRoutes);
app.route('/api/runs', runs);
app.route('/api/mcp', mcp);
app.route('/api/skills', skillRoutes);
app.route('/api/orchestrator', orchestrator);
app.route('/api/credentials', vault);
app.route('/api/logs', observability);
app.route('/api/costs', observability);
app.route('/api/metrics', observability);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
    },
    404
  );
});

export type App = typeof app;

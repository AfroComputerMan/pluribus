import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

import { OrchestratorService } from '@/core/orchestrator/service';
import {
  createScheduleSchema,
  updateScheduleSchema,
  scheduleFilterSchema,
  createWebhookSchema,
  updateWebhookSchema,
  webhookFilterSchema,
  webhookPayloadSchema,
} from '@/core/orchestrator/schemas';
import { NotFoundError, ValidationError } from '@/lib/errors';

const orchestrator = new Hono();
const service = new OrchestratorService();

// ==================
// Schedule Triggers
// ==================

// POST /api/orchestrator/schedules - Create schedule trigger
orchestrator.post('/schedules', zValidator('json', createScheduleSchema), async (c) => {
  const input = c.req.valid('json');
  const schedule = await service.createSchedule(input);
  return c.json({ data: schedule }, 201);
});

// GET /api/orchestrator/schedules - List schedule triggers
orchestrator.get('/schedules', zValidator('query', scheduleFilterSchema), async (c) => {
  const filter = c.req.valid('query');
  const schedules = await service.listSchedules(filter);
  return c.json({ data: schedules });
});

// GET /api/orchestrator/schedules/:id - Get schedule trigger
orchestrator.get('/schedules/:id', async (c) => {
  const id = c.req.param('id');
  const schedule = await service.getSchedule(id);

  if (!schedule) {
    throw new NotFoundError('Schedule', id);
  }

  return c.json({ data: schedule });
});

// PATCH /api/orchestrator/schedules/:id - Update schedule trigger
orchestrator.patch(
  '/schedules/:id',
  zValidator('json', updateScheduleSchema),
  async (c) => {
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const schedule = await service.updateSchedule(id, input);

    if (!schedule) {
      throw new NotFoundError('Schedule', id);
    }

    return c.json({ data: schedule });
  }
);

// DELETE /api/orchestrator/schedules/:id - Delete schedule trigger
orchestrator.delete('/schedules/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await service.deleteSchedule(id);

  if (!deleted) {
    throw new NotFoundError('Schedule', id);
  }

  return c.json({ data: { deleted: true } });
});

// POST /api/orchestrator/schedules/:id/enable - Enable schedule
orchestrator.post('/schedules/:id/enable', async (c) => {
  const id = c.req.param('id');
  const schedule = await service.updateSchedule(id, { enabled: true });

  if (!schedule) {
    throw new NotFoundError('Schedule', id);
  }

  return c.json({ data: schedule });
});

// POST /api/orchestrator/schedules/:id/disable - Disable schedule
orchestrator.post('/schedules/:id/disable', async (c) => {
  const id = c.req.param('id');
  const schedule = await service.updateSchedule(id, { enabled: false });

  if (!schedule) {
    throw new NotFoundError('Schedule', id);
  }

  return c.json({ data: schedule });
});

// ==================
// Webhook Triggers
// ==================

// POST /api/orchestrator/webhooks - Create webhook trigger
orchestrator.post('/webhooks', zValidator('json', createWebhookSchema), async (c) => {
  const input = c.req.valid('json');
  const webhook = await service.createWebhook(input);
  return c.json({ data: webhook }, 201);
});

// GET /api/orchestrator/webhooks - List webhook triggers
orchestrator.get('/webhooks', zValidator('query', webhookFilterSchema), async (c) => {
  const filter = c.req.valid('query');
  const webhooks = await service.listWebhooks(filter);
  return c.json({ data: webhooks });
});

// GET /api/orchestrator/webhooks/:id - Get webhook trigger
orchestrator.get('/webhooks/:id', async (c) => {
  const id = c.req.param('id');
  const webhook = await service.getWebhook(id);

  if (!webhook) {
    throw new NotFoundError('Webhook', id);
  }

  return c.json({ data: webhook });
});

// PATCH /api/orchestrator/webhooks/:id - Update webhook trigger
orchestrator.patch(
  '/webhooks/:id',
  zValidator('json', updateWebhookSchema),
  async (c) => {
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const webhook = await service.updateWebhook(id, input);

    if (!webhook) {
      throw new NotFoundError('Webhook', id);
    }

    return c.json({ data: webhook });
  }
);

// DELETE /api/orchestrator/webhooks/:id - Delete webhook trigger
orchestrator.delete('/webhooks/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await service.deleteWebhook(id);

  if (!deleted) {
    throw new NotFoundError('Webhook', id);
  }

  return c.json({ data: { deleted: true } });
});

// POST /api/orchestrator/webhooks/:id/enable - Enable webhook
orchestrator.post('/webhooks/:id/enable', async (c) => {
  const id = c.req.param('id');
  const webhook = await service.updateWebhook(id, { enabled: true });

  if (!webhook) {
    throw new NotFoundError('Webhook', id);
  }

  return c.json({ data: webhook });
});

// POST /api/orchestrator/webhooks/:id/disable - Disable webhook
orchestrator.post('/webhooks/:id/disable', async (c) => {
  const id = c.req.param('id');
  const webhook = await service.updateWebhook(id, { enabled: false });

  if (!webhook) {
    throw new NotFoundError('Webhook', id);
  }

  return c.json({ data: webhook });
});

// POST /api/orchestrator/webhooks/:id/regenerate - Regenerate webhook secret
orchestrator.post('/webhooks/:id/regenerate', async (c) => {
  const id = c.req.param('id');
  const webhook = await service.updateWebhook(id, { regenerateSecret: true });

  if (!webhook) {
    throw new NotFoundError('Webhook', id);
  }

  return c.json({ data: webhook });
});

// ==================
// Webhook Execution
// ==================

// POST /api/webhooks/:id - Receive webhook and trigger workflow
orchestrator.post('/webhooks/:id/trigger', zValidator('json', webhookPayloadSchema), async (c) => {
  const id = c.req.param('id');
  const payload = c.req.valid('json');

  const result = await service.handleWebhook(id, payload);

  if (!result.success) {
    throw new ValidationError(result.error || 'Webhook trigger failed');
  }

  return c.json({
    data: {
      runId: result.runId,
      triggeredAt: result.triggeredAt
    }
  }, 202);
});

export { orchestrator };

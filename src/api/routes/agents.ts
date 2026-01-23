import { Hono } from 'hono';
import { z } from 'zod';

import { agentService, createAgentSchema, updateAgentSchema, agentFilterSchema } from '@/core/agents';
import {
  validateBody,
  validateQuery,
  getValidatedBody,
  getValidatedQuery,
} from '../middleware';

const agents = new Hono();

// GET /api/agents - List agents
agents.get('/', validateQuery(agentFilterSchema), async (c) => {
  const filter = getValidatedQuery<z.infer<typeof agentFilterSchema>>(c);
  const items = await agentService.listAgents(filter);

  return c.json({
    data: items,
    meta: {
      limit: filter.limit,
      offset: filter.offset,
    },
  });
});

// GET /api/agents/tags - Get all tags
agents.get('/tags', async (c) => {
  const tags = await agentService.getAllTags();
  return c.json({ data: tags });
});

// GET /api/agents/tags/stats - Get tag statistics
agents.get('/tags/stats', async (c) => {
  const stats = await agentService.getTagStats();
  return c.json({ data: stats });
});

// GET /api/agents/:id - Get agent by ID
agents.get('/:id', async (c) => {
  const id = c.req.param('id');
  const agent = await agentService.getAgent(id);
  return c.json({ data: agent });
});

// POST /api/agents - Create agent
agents.post('/', validateBody(createAgentSchema), async (c) => {
  const input = getValidatedBody<z.infer<typeof createAgentSchema>>(c);
  const agent = await agentService.createAgent(input);
  return c.json({ data: agent }, 201);
});

// PUT /api/agents/:id - Update agent
agents.put('/:id', validateBody(updateAgentSchema), async (c) => {
  const id = c.req.param('id');
  const input = getValidatedBody<z.infer<typeof updateAgentSchema>>(c);
  const agent = await agentService.updateAgent(id, input);
  return c.json({ data: agent });
});

// DELETE /api/agents/:id - Delete agent
agents.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await agentService.deleteAgent(id);
  return c.json({ success: true });
});

export { agents };

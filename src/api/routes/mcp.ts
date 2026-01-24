import { and, desc, eq, ilike } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '@/db';
import { mcpServers, mcpTools } from '@/db/schema';
import { NotFoundError } from '@/lib/errors';
import {
  createMCPServerSchema,
  mcpServerFilterSchema,
  mcpToolFilterSchema,
  updateMCPServerSchema,
} from '@/mcp';
import { getValidatedBody, getValidatedQuery, validateBody, validateQuery } from '../middleware';

const mcp = new Hono();

// ====================
// MCP Servers
// ====================

// GET /api/mcp/servers - List MCP servers
mcp.get('/servers', validateQuery(mcpServerFilterSchema), async (c) => {
  const filter = getValidatedQuery<z.infer<typeof mcpServerFilterSchema>>(c);

  const conditions = [];
  if (filter.enabled !== undefined) {
    conditions.push(eq(mcpServers.enabled, filter.enabled));
  }
  if (filter.transport) {
    conditions.push(eq(mcpServers.transport, filter.transport));
  }
  if (filter.search) {
    conditions.push(ilike(mcpServers.name, `%${filter.search}%`));
  }

  const items = await db
    .select()
    .from(mcpServers)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(filter.limit)
    .offset(filter.offset)
    .orderBy(desc(mcpServers.updatedAt));

  return c.json({
    data: items,
    meta: {
      limit: filter.limit,
      offset: filter.offset,
    },
  });
});

// GET /api/mcp/servers/:id - Get MCP server by ID
mcp.get('/servers/:id', async (c) => {
  const id = c.req.param('id');

  const server = await db.query.mcpServers.findFirst({
    where: eq(mcpServers.id, id),
  });

  if (!server) {
    throw new NotFoundError('MCPServer', id);
  }

  return c.json({ data: server });
});

// POST /api/mcp/servers - Add MCP server
mcp.post('/servers', validateBody(createMCPServerSchema), async (c) => {
  const input = getValidatedBody<z.infer<typeof createMCPServerSchema>>(c);

  const [server] = await db.insert(mcpServers).values(input).returning();

  return c.json({ data: server }, 201);
});

// PUT /api/mcp/servers/:id - Update MCP server
mcp.put('/servers/:id', validateBody(updateMCPServerSchema), async (c) => {
  const id = c.req.param('id');
  const input = getValidatedBody<z.infer<typeof updateMCPServerSchema>>(c);

  const [server] = await db
    .update(mcpServers)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(mcpServers.id, id))
    .returning();

  if (!server) {
    throw new NotFoundError('MCPServer', id);
  }

  return c.json({ data: server });
});

// DELETE /api/mcp/servers/:id - Remove MCP server
mcp.delete('/servers/:id', async (c) => {
  const id = c.req.param('id');

  const result = await db.delete(mcpServers).where(eq(mcpServers.id, id)).returning();

  if (result.length === 0) {
    throw new NotFoundError('MCPServer', id);
  }

  return c.json({ success: true });
});

// POST /api/mcp/servers/:id/discover - Trigger tool discovery
mcp.post('/servers/:id/discover', async (c) => {
  const id = c.req.param('id');

  const server = await db.query.mcpServers.findFirst({
    where: eq(mcpServers.id, id),
  });

  if (!server) {
    throw new NotFoundError('MCPServer', id);
  }

  // TODO: Implement actual MCP connection and tool discovery
  // For now, return a placeholder response

  return c.json(
    {
      data: {
        serverId: id,
        status: 'discovery_started',
        message: 'Tool discovery has been initiated',
      },
    },
    202
  );
});

// ====================
// MCP Tools
// ====================

// GET /api/mcp/tools - List all tools
mcp.get('/tools', validateQuery(mcpToolFilterSchema), async (c) => {
  const filter = getValidatedQuery<z.infer<typeof mcpToolFilterSchema>>(c);

  const conditions = [];
  if (filter.serverId) {
    conditions.push(eq(mcpTools.serverId, filter.serverId));
  }
  if (filter.enabled !== undefined) {
    conditions.push(eq(mcpTools.enabled, filter.enabled));
  }
  if (filter.search) {
    conditions.push(ilike(mcpTools.name, `%${filter.search}%`));
  }

  const items = await db
    .select()
    .from(mcpTools)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(filter.limit)
    .offset(filter.offset)
    .orderBy(mcpTools.name);

  return c.json({
    data: items,
    meta: {
      limit: filter.limit,
      offset: filter.offset,
    },
  });
});

// PUT /api/mcp/tools/:id - Enable/disable tool
mcp.put('/tools/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { enabled } = z.object({ enabled: z.boolean() }).parse(body);

  const [tool] = await db.update(mcpTools).set({ enabled }).where(eq(mcpTools.id, id)).returning();

  if (!tool) {
    throw new NotFoundError('MCPTool', id);
  }

  return c.json({ data: tool });
});

// POST /api/mcp/scan - Scan for MCP servers (auto-discovery)
mcp.post('/scan', async (c) => {
  // TODO: Implement network/system scanning for MCP servers

  return c.json(
    {
      data: {
        status: 'scan_started',
        message: 'MCP server discovery scan has been initiated',
      },
    },
    202
  );
});

export { mcp };

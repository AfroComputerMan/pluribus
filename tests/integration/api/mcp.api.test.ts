import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import * as schema from '@/db/schema';
import { and, desc, eq, ilike } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import {
  createTestMcpServerInput,
  createTestMcpToolInput,
  testMcpServerHttp,
} from '../../setup/fixtures';
import { type TestContainers, startTestContainers } from '../../setup/testcontainers';

/**
 * API integration tests for /api/mcp endpoints
 * Uses testcontainers for real database testing
 */
describe('MCP API Integration', () => {
  let containers: TestContainers;
  let app: Hono;

  // Create a test app that mirrors the real routes
  function createTestApp(db: ReturnType<typeof drizzle<typeof schema>>) {
    const app = new Hono();

    // MCP Server service
    const mcpServerService = {
      async getServer(id: string) {
        const result = await db.query.mcpServers.findFirst({
          where: eq(schema.mcpServers.id, id),
        });
        if (!result) {
          throw new Error(`MCP Server not found: ${id}`);
        }
        return result;
      },

      async listServers(filter?: {
        enabled?: boolean;
        transport?: string;
        search?: string;
        limit?: number;
        offset?: number;
      }) {
        const conditions = [];
        if (filter?.enabled !== undefined) {
          conditions.push(eq(schema.mcpServers.enabled, filter.enabled));
        }
        if (filter?.transport) {
          conditions.push(eq(schema.mcpServers.transport, filter.transport));
        }
        if (filter?.search) {
          conditions.push(ilike(schema.mcpServers.name, `%${filter.search}%`));
        }

        return db
          .select()
          .from(schema.mcpServers)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .limit(filter?.limit ?? 50)
          .offset(filter?.offset ?? 0)
          .orderBy(desc(schema.mcpServers.updatedAt));
      },

      async createServer(input: typeof schema.mcpServers.$inferInsert) {
        const [result] = await db.insert(schema.mcpServers).values(input).returning();
        if (!result) throw new Error('Insert failed');
        return result;
      },

      async updateServer(id: string, input: Partial<typeof schema.mcpServers.$inferInsert>) {
        const [result] = await db
          .update(schema.mcpServers)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(schema.mcpServers.id, id))
          .returning();
        if (!result) {
          throw new Error(`MCP Server not found: ${id}`);
        }
        return result;
      },

      async deleteServer(id: string) {
        const result = await db
          .delete(schema.mcpServers)
          .where(eq(schema.mcpServers.id, id))
          .returning();
        if (result.length === 0) {
          throw new Error(`MCP Server not found: ${id}`);
        }
        return true;
      },
    };

    // MCP Tool service
    const mcpToolService = {
      async listTools(filter?: {
        serverId?: string;
        enabled?: boolean;
        search?: string;
        limit?: number;
        offset?: number;
      }) {
        const conditions = [];
        if (filter?.serverId) {
          conditions.push(eq(schema.mcpTools.serverId, filter.serverId));
        }
        if (filter?.enabled !== undefined) {
          conditions.push(eq(schema.mcpTools.enabled, filter.enabled));
        }
        if (filter?.search) {
          conditions.push(ilike(schema.mcpTools.name, `%${filter.search}%`));
        }

        return db
          .select()
          .from(schema.mcpTools)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .limit(filter?.limit ?? 50)
          .offset(filter?.offset ?? 0)
          .orderBy(schema.mcpTools.name);
      },

      async updateTool(id: string, enabled: boolean) {
        const [result] = await db
          .update(schema.mcpTools)
          .set({ enabled })
          .where(eq(schema.mcpTools.id, id))
          .returning();
        if (!result) {
          throw new Error(`MCP Tool not found: ${id}`);
        }
        return result;
      },
    };

    // MCP Server routes
    app.get('/api/mcp/servers', async (c) => {
      const limit = Number.parseInt(c.req.query('limit') ?? '50');
      const offset = Number.parseInt(c.req.query('offset') ?? '0');
      const enabled = c.req.query('enabled');
      const transport = c.req.query('transport');
      const search = c.req.query('search');

      const items = await mcpServerService.listServers({
        enabled: enabled !== undefined ? enabled === 'true' : undefined,
        transport,
        search,
        limit,
        offset,
      });
      return c.json({ data: items, meta: { limit, offset } });
    });

    app.get('/api/mcp/servers/:id', async (c) => {
      try {
        const server = await mcpServerService.getServer(c.req.param('id'));
        return c.json({ data: server });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'MCP Server not found' } }, 404);
      }
    });

    app.post('/api/mcp/servers', async (c) => {
      const body = await c.req.json();
      const server = await mcpServerService.createServer(body);
      return c.json({ data: server }, 201);
    });

    app.put('/api/mcp/servers/:id', async (c) => {
      try {
        const body = await c.req.json();
        const server = await mcpServerService.updateServer(c.req.param('id'), body);
        return c.json({ data: server });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'MCP Server not found' } }, 404);
      }
    });

    app.delete('/api/mcp/servers/:id', async (c) => {
      try {
        await mcpServerService.deleteServer(c.req.param('id'));
        return c.json({ success: true });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'MCP Server not found' } }, 404);
      }
    });

    app.post('/api/mcp/servers/:id/discover', async (c) => {
      try {
        const server = await mcpServerService.getServer(c.req.param('id'));
        return c.json(
          {
            data: {
              serverId: server.id,
              status: 'discovery_started',
              message: 'Tool discovery has been initiated',
            },
          },
          202
        );
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'MCP Server not found' } }, 404);
      }
    });

    // MCP Tool routes
    app.get('/api/mcp/tools', async (c) => {
      const limit = Number.parseInt(c.req.query('limit') ?? '50');
      const offset = Number.parseInt(c.req.query('offset') ?? '0');
      const serverId = c.req.query('serverId');
      const enabled = c.req.query('enabled');
      const search = c.req.query('search');

      const items = await mcpToolService.listTools({
        serverId,
        enabled: enabled !== undefined ? enabled === 'true' : undefined,
        search,
        limit,
        offset,
      });
      return c.json({ data: items, meta: { limit, offset } });
    });

    app.put('/api/mcp/tools/:id', async (c) => {
      try {
        const body = await c.req.json();
        const tool = await mcpToolService.updateTool(c.req.param('id'), body.enabled);
        return c.json({ data: tool });
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'MCP Tool not found' } }, 404);
      }
    });

    app.post('/api/mcp/scan', async (_c) => {
      return _c.json(
        {
          data: {
            status: 'scan_started',
            message: 'MCP server discovery scan has been initiated',
          },
        },
        202
      );
    });

    return app;
  }

  beforeAll(async () => {
    containers = await startTestContainers();
    app = createTestApp(containers.db);
  }, 90000);

  afterAll(async () => {
    await containers.cleanup();
  });

  beforeEach(async () => {
    // Clean up tables before each test (tools first due to FK)
    await containers.db.delete(schema.mcpTools);
    await containers.db.delete(schema.mcpServers);
  });

  describe('MCP Servers', () => {
    describe('GET /api/mcp/servers', () => {
      test('returns empty array when no servers', async () => {
        const res = await app.request('/api/mcp/servers');
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data).toEqual([]);
        expect(json.meta).toEqual({ limit: 50, offset: 0 });
      });

      test('returns all servers', async () => {
        await containers.db
          .insert(schema.mcpServers)
          .values([
            createTestMcpServerInput({ name: 'Server 1' }),
            createTestMcpServerInput({ name: 'Server 2' }),
          ]);

        const res = await app.request('/api/mcp/servers');
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.length).toBe(2);
      });

      test('filters by enabled status', async () => {
        await containers.db
          .insert(schema.mcpServers)
          .values([
            createTestMcpServerInput({ name: 'Enabled Server', enabled: true }),
            createTestMcpServerInput({ name: 'Disabled Server', enabled: false }),
          ]);

        const res = await app.request('/api/mcp/servers?enabled=true');
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.length).toBe(1);
        expect(json.data[0].enabled).toBe(true);
      });

      test('filters by transport', async () => {
        await containers.db
          .insert(schema.mcpServers)
          .values([
            createTestMcpServerInput({ name: 'Stdio Server', transport: 'stdio' }),
            { ...testMcpServerHttp, name: `HTTP Server ${Date.now()}` },
          ]);

        const res = await app.request('/api/mcp/servers?transport=http');
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.length).toBe(1);
        expect(json.data[0].transport).toBe('http');
      });

      test('filters by search term', async () => {
        await containers.db
          .insert(schema.mcpServers)
          .values([
            createTestMcpServerInput({ name: 'Filesystem Server' }),
            createTestMcpServerInput({ name: 'Database Server' }),
            createTestMcpServerInput({ name: 'Git Server' }),
          ]);

        const res = await app.request('/api/mcp/servers?search=file');
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.length).toBe(1);
        expect(json.data[0].name).toContain('Filesystem');
      });

      test('respects pagination', async () => {
        for (let i = 0; i < 5; i++) {
          await containers.db
            .insert(schema.mcpServers)
            .values(createTestMcpServerInput({ name: `Server ${i}` }));
        }

        const res = await app.request('/api/mcp/servers?limit=2&offset=2');
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.length).toBe(2);
        expect(json.meta.limit).toBe(2);
        expect(json.meta.offset).toBe(2);
      });
    });

    describe('GET /api/mcp/servers/:id', () => {
      test('returns server by id', async () => {
        const [created] = await containers.db
          .insert(schema.mcpServers)
          .values(createTestMcpServerInput({ name: 'Test Server' }))
          .returning();

        const res = await app.request(`/api/mcp/servers/${created?.id}`);
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.id).toBe(created?.id);
        expect(json.data.name).toBe('Test Server');
      });

      test('returns 404 for non-existent server', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';

        const res = await app.request(`/api/mcp/servers/${fakeId}`);
        const json = (await res.json()) as any;

        expect(res.status).toBe(404);
        expect(json.error.code).toBe('NOT_FOUND');
      });

      test('returns server with config', async () => {
        const [created] = await containers.db
          .insert(schema.mcpServers)
          .values(
            createTestMcpServerInput({
              name: 'Configured Server',
              config: {
                stdio: {
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-fs'],
                },
              },
            })
          )
          .returning();

        const res = await app.request(`/api/mcp/servers/${created?.id}`);
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.config.stdio.command).toBe('npx');
        expect(json.data.config.stdio.args).toContain('-y');
      });
    });

    describe('POST /api/mcp/servers', () => {
      test('creates stdio server', async () => {
        const input = createTestMcpServerInput({ name: 'New Stdio Server' });

        const res = await app.request('/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const json = (await res.json()) as any;

        expect(res.status).toBe(201);
        expect(json.data.id).toBeDefined();
        expect(json.data.name).toBe('New Stdio Server');
        expect(json.data.transport).toBe('stdio');
      });

      test('creates http server', async () => {
        const input = {
          ...testMcpServerHttp,
          name: 'New HTTP Server',
        };

        const res = await app.request('/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const json = (await res.json()) as any;

        expect(res.status).toBe(201);
        expect(json.data.transport).toBe('http');
        expect(json.data.config.http.url).toBe(testMcpServerHttp.config.http?.url);
      });

      test('creates websocket server', async () => {
        const input = createTestMcpServerInput({
          name: 'New WS Server',
          transport: 'websocket',
          config: { websocket: { url: 'wss://ws.example.com/mcp' } },
          enabled: false,
        });

        const res = await app.request('/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const json = (await res.json()) as any;

        expect(res.status).toBe(201);
        expect(json.data.transport).toBe('websocket');
      });

      test('persists server in database', async () => {
        const input = createTestMcpServerInput({ name: 'Persisted Server' });

        const res = await app.request('/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const json = (await res.json()) as any;

        // Verify in database
        const dbServer = await containers.db.query.mcpServers.findFirst({
          where: eq(schema.mcpServers.id, json.data.id),
        });

        expect(dbServer).toBeDefined();
        expect(dbServer?.name).toBe('Persisted Server');
      });
    });

    describe('PUT /api/mcp/servers/:id', () => {
      test('updates server name', async () => {
        const [created] = await containers.db
          .insert(schema.mcpServers)
          .values(createTestMcpServerInput({ name: 'Original Name' }))
          .returning();

        const res = await app.request(`/api/mcp/servers/${created?.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated Name' }),
        });
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.name).toBe('Updated Name');
      });

      test('updates enabled status', async () => {
        const [created] = await containers.db
          .insert(schema.mcpServers)
          .values(createTestMcpServerInput({ enabled: true }))
          .returning();

        const res = await app.request(`/api/mcp/servers/${created?.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        });
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.enabled).toBe(false);
      });

      test('updates server config', async () => {
        const [created] = await containers.db
          .insert(schema.mcpServers)
          .values(createTestMcpServerInput())
          .returning();

        const res = await app.request(`/api/mcp/servers/${created?.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: {
              stdio: {
                command: 'updated-command',
                args: ['--new-arg'],
              },
            },
          }),
        });
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.config.stdio.command).toBe('updated-command');
      });

      test('returns 404 for non-existent server', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';

        const res = await app.request(`/api/mcp/servers/${fakeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test' }),
        });

        expect(res.status).toBe(404);
      });
    });

    describe('DELETE /api/mcp/servers/:id', () => {
      test('deletes server', async () => {
        const [created] = await containers.db
          .insert(schema.mcpServers)
          .values(createTestMcpServerInput())
          .returning();

        const res = await app.request(`/api/mcp/servers/${created?.id}`, {
          method: 'DELETE',
        });
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.success).toBe(true);

        // Verify deleted from database
        const dbServer = await containers.db.query.mcpServers.findFirst({
          where: eq(schema.mcpServers.id, created?.id),
        });
        expect(dbServer).toBeUndefined();
      });

      test('deletes server and cascades to tools', async () => {
        const [server] = await containers.db
          .insert(schema.mcpServers)
          .values(createTestMcpServerInput())
          .returning();

        // Add tools to the server
        await containers.db
          .insert(schema.mcpTools)
          .values([
            createTestMcpToolInput(server?.id, { name: 'tool_1' }),
            createTestMcpToolInput(server?.id, { name: 'tool_2' }),
          ]);

        const res = await app.request(`/api/mcp/servers/${server?.id}`, {
          method: 'DELETE',
        });

        expect(res.status).toBe(200);

        // Verify tools were also deleted
        const tools = await containers.db
          .select()
          .from(schema.mcpTools)
          .where(eq(schema.mcpTools.serverId, server?.id));
        expect(tools.length).toBe(0);
      });

      test('returns 404 for non-existent server', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';

        const res = await app.request(`/api/mcp/servers/${fakeId}`, {
          method: 'DELETE',
        });

        expect(res.status).toBe(404);
      });
    });

    describe('POST /api/mcp/servers/:id/discover', () => {
      test('starts tool discovery', async () => {
        const [server] = await containers.db
          .insert(schema.mcpServers)
          .values(createTestMcpServerInput())
          .returning();

        const res = await app.request(`/api/mcp/servers/${server?.id}/discover`, {
          method: 'POST',
        });
        const json = (await res.json()) as any;

        expect(res.status).toBe(202);
        expect(json.data.serverId).toBe(server?.id);
        expect(json.data.status).toBe('discovery_started');
      });

      test('returns 404 for non-existent server', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';

        const res = await app.request(`/api/mcp/servers/${fakeId}/discover`, {
          method: 'POST',
        });

        expect(res.status).toBe(404);
      });
    });
  });

  describe('MCP Tools', () => {
    let testServer: { id: string };

    beforeEach(async () => {
      // Create a server for tools
      const [server] = await containers.db
        .insert(schema.mcpServers)
        .values(createTestMcpServerInput({ name: 'Tool Test Server' }))
        .returning();
      if (!server) throw new Error('Insert failed');
      testServer = server;
    });

    describe('GET /api/mcp/tools', () => {
      test('returns empty array when no tools', async () => {
        const res = await app.request('/api/mcp/tools');
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data).toEqual([]);
      });

      test('returns all tools', async () => {
        await containers.db
          .insert(schema.mcpTools)
          .values([
            createTestMcpToolInput(testServer.id, { name: 'read_file' }),
            createTestMcpToolInput(testServer.id, { name: 'write_file' }),
          ]);

        const res = await app.request('/api/mcp/tools');
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.length).toBe(2);
      });

      test('filters by serverId', async () => {
        // Create another server
        const [otherServer] = await containers.db
          .insert(schema.mcpServers)
          .values(createTestMcpServerInput({ name: 'Other Server' }))
          .returning();

        await containers.db
          .insert(schema.mcpTools)
          .values([
            createTestMcpToolInput(testServer.id, { name: 'tool_server_1' }),
            createTestMcpToolInput(otherServer?.id, { name: 'tool_server_2' }),
          ]);

        const res = await app.request(`/api/mcp/tools?serverId=${testServer.id}`);
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.length).toBe(1);
        expect(json.data[0].serverId).toBe(testServer.id);
      });

      test('filters by enabled status', async () => {
        await containers.db
          .insert(schema.mcpTools)
          .values([
            createTestMcpToolInput(testServer.id, { name: 'enabled_tool', enabled: true }),
            createTestMcpToolInput(testServer.id, { name: 'disabled_tool', enabled: false }),
          ]);

        const res = await app.request('/api/mcp/tools?enabled=true');
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.length).toBe(1);
        expect(json.data[0].enabled).toBe(true);
      });

      test('filters by search term', async () => {
        await containers.db
          .insert(schema.mcpTools)
          .values([
            createTestMcpToolInput(testServer.id, { name: 'read_file' }),
            createTestMcpToolInput(testServer.id, { name: 'write_file' }),
            createTestMcpToolInput(testServer.id, { name: 'list_directory' }),
          ]);

        const res = await app.request('/api/mcp/tools?search=file');
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.length).toBe(2);
      });

      test('respects pagination', async () => {
        for (let i = 0; i < 5; i++) {
          await containers.db
            .insert(schema.mcpTools)
            .values(createTestMcpToolInput(testServer.id, { name: `tool_${i}` }));
        }

        const res = await app.request('/api/mcp/tools?limit=2&offset=2');
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.length).toBe(2);
        expect(json.meta.limit).toBe(2);
        expect(json.meta.offset).toBe(2);
      });
    });

    describe('PUT /api/mcp/tools/:id', () => {
      test('enables tool', async () => {
        const [tool] = await containers.db
          .insert(schema.mcpTools)
          .values(createTestMcpToolInput(testServer.id, { enabled: false }))
          .returning();

        const res = await app.request(`/api/mcp/tools/${tool?.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        });
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.enabled).toBe(true);
      });

      test('disables tool', async () => {
        const [tool] = await containers.db
          .insert(schema.mcpTools)
          .values(createTestMcpToolInput(testServer.id, { enabled: true }))
          .returning();

        const res = await app.request(`/api/mcp/tools/${tool?.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        });
        const json = (await res.json()) as any;

        expect(res.status).toBe(200);
        expect(json.data.enabled).toBe(false);
      });

      test('returns 404 for non-existent tool', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';

        const res = await app.request(`/api/mcp/tools/${fakeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        });

        expect(res.status).toBe(404);
      });
    });
  });

  describe('POST /api/mcp/scan', () => {
    test('starts MCP server scan', async () => {
      const res = await app.request('/api/mcp/scan', {
        method: 'POST',
      });
      const json = (await res.json()) as any;

      expect(res.status).toBe(202);
      expect(json.data.status).toBe('scan_started');
    });
  });
});

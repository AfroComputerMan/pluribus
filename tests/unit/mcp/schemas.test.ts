import { describe, expect, test } from 'bun:test';
import {
  mcpServerSchema,
  createMCPServerSchema,
  updateMCPServerSchema,
  mcpToolSchema,
  executeToolSchema,
  mcpServerFilterSchema,
  mcpToolFilterSchema,
} from '@/mcp/schemas';

describe('mcpServerSchema', () => {
  const validStdioServer = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Filesystem MCP',
    transport: 'stdio' as const,
    config: {
      stdio: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: { DEBUG: 'true' },
      },
    },
    enabled: true,
    lastConnectedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const validHttpServer = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Remote MCP',
    transport: 'http' as const,
    config: {
      http: {
        url: 'https://mcp.example.com/api',
        headers: { Authorization: 'Bearer token' },
      },
    },
    enabled: true,
    lastConnectedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const validWsServer = {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'WebSocket MCP',
    transport: 'websocket' as const,
    config: {
      websocket: {
        url: 'wss://mcp.example.com/ws',
      },
    },
    enabled: false,
    lastConnectedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  test('accepts valid stdio server', () => {
    const result = mcpServerSchema.safeParse(validStdioServer);
    expect(result.success).toBe(true);
  });

  test('accepts valid http server', () => {
    const result = mcpServerSchema.safeParse(validHttpServer);
    expect(result.success).toBe(true);
  });

  test('accepts valid websocket server', () => {
    const result = mcpServerSchema.safeParse(validWsServer);
    expect(result.success).toBe(true);
  });

  test('accepts null lastConnectedAt', () => {
    const result = mcpServerSchema.safeParse({
      ...validStdioServer,
      lastConnectedAt: null,
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty name', () => {
    const result = mcpServerSchema.safeParse({
      ...validStdioServer,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects name over 255 chars', () => {
    const result = mcpServerSchema.safeParse({
      ...validStdioServer,
      name: 'x'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid transport', () => {
    const result = mcpServerSchema.safeParse({
      ...validStdioServer,
      transport: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid uuid', () => {
    const result = mcpServerSchema.safeParse({
      ...validStdioServer,
      id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('createMCPServerSchema', () => {
  test('accepts valid stdio server create', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'New Stdio Server',
      transport: 'stdio',
      config: {
        stdio: {
          command: 'node',
          args: ['server.js'],
        },
      },
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  test('accepts valid http server create', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'New HTTP Server',
      transport: 'http',
      config: {
        http: {
          url: 'https://api.example.com/mcp',
        },
      },
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  test('accepts valid websocket server create', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'New WS Server',
      transport: 'websocket',
      config: {
        websocket: {
          url: 'wss://ws.example.com',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test('defaults enabled to true', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'Test Server',
      transport: 'stdio',
      config: {
        stdio: {
          command: 'node',
          args: [],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
    }
  });

  test('defaults stdio args to empty array', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'Test Server',
      transport: 'stdio',
      config: {
        stdio: {
          command: 'node',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config.stdio?.args).toEqual([]);
    }
  });

  test('rejects stdio transport without stdio config', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'Invalid Server',
      transport: 'stdio',
      config: {
        http: {
          url: 'https://example.com',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test('rejects http transport without http config', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'Invalid Server',
      transport: 'http',
      config: {
        stdio: {
          command: 'node',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test('rejects websocket transport without websocket config', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'Invalid Server',
      transport: 'websocket',
      config: {
        http: {
          url: 'https://example.com',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty command for stdio', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'Test Server',
      transport: 'stdio',
      config: {
        stdio: {
          command: '',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid url for http', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'Test Server',
      transport: 'http',
      config: {
        http: {
          url: 'not-a-url',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid url for websocket', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'Test Server',
      transport: 'websocket',
      config: {
        websocket: {
          url: 'not-a-url',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test('does not require id', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'Test Server',
      transport: 'stdio',
      config: {
        stdio: {
          command: 'node',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test('does not require timestamps', () => {
    const result = createMCPServerSchema.safeParse({
      name: 'Test Server',
      transport: 'stdio',
      config: {
        stdio: {
          command: 'node',
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('updateMCPServerSchema', () => {
  test('all fields are optional', () => {
    const result = updateMCPServerSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('accepts name update', () => {
    const result = updateMCPServerSchema.safeParse({
      name: 'Updated Server Name',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Server Name');
    }
  });

  test('accepts enabled update', () => {
    const result = updateMCPServerSchema.safeParse({
      enabled: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
    }
  });

  test('accepts config update', () => {
    const result = updateMCPServerSchema.safeParse({
      config: {
        stdio: {
          command: 'new-command',
          args: ['--new-arg'],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test('validates name when provided', () => {
    const result = updateMCPServerSchema.safeParse({
      name: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('mcpToolSchema', () => {
  const validTool = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    serverId: '550e8400-e29b-41d4-a716-446655440001',
    name: 'read_file',
    description: 'Read contents of a file',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string' as const,
          description: 'File path to read',
        },
      },
      required: ['path'],
    },
    enabled: true,
    discoveredAt: new Date(),
  };

  test('accepts valid tool', () => {
    const result = mcpToolSchema.safeParse(validTool);
    expect(result.success).toBe(true);
  });

  test('accepts null description', () => {
    const result = mcpToolSchema.safeParse({
      ...validTool,
      description: null,
    });
    expect(result.success).toBe(true);
  });

  test('accepts null inputSchema', () => {
    const result = mcpToolSchema.safeParse({
      ...validTool,
      inputSchema: null,
    });
    expect(result.success).toBe(true);
  });

  test('accepts complex input schema', () => {
    const result = mcpToolSchema.safeParse({
      ...validTool,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name field',
          },
          count: {
            type: 'number',
            description: 'Count field',
          },
          enabled: {
            type: 'boolean',
          },
          items: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          config: {
            type: 'object',
            properties: {
              nested: {
                type: 'string',
              },
            },
          },
        },
        required: ['name'],
      },
    });
    expect(result.success).toBe(true);
  });

  test('accepts input schema with enum', () => {
    const result = mcpToolSchema.safeParse({
      ...validTool,
      inputSchema: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['json', 'xml', 'yaml'],
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty name', () => {
    const result = mcpToolSchema.safeParse({
      ...validTool,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects name over 255 chars', () => {
    const result = mcpToolSchema.safeParse({
      ...validTool,
      name: 'x'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid uuid for id', () => {
    const result = mcpToolSchema.safeParse({
      ...validTool,
      id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid uuid for serverId', () => {
    const result = mcpToolSchema.safeParse({
      ...validTool,
      serverId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('executeToolSchema', () => {
  test('accepts valid execution request', () => {
    const result = executeToolSchema.safeParse({
      toolId: '550e8400-e29b-41d4-a716-446655440000',
      args: { path: '/home/user/file.txt' },
    });
    expect(result.success).toBe(true);
  });

  test('defaults args to empty object', () => {
    const result = executeToolSchema.safeParse({
      toolId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.args).toEqual({});
    }
  });

  test('accepts context', () => {
    const result = executeToolSchema.safeParse({
      toolId: '550e8400-e29b-41d4-a716-446655440000',
      args: {},
      context: {
        agentId: '550e8400-e29b-41d4-a716-446655440001',
        workflowRunId: '550e8400-e29b-41d4-a716-446655440002',
      },
    });
    expect(result.success).toBe(true);
  });

  test('accepts context without workflowRunId', () => {
    const result = executeToolSchema.safeParse({
      toolId: '550e8400-e29b-41d4-a716-446655440000',
      args: {},
      context: {
        agentId: '550e8400-e29b-41d4-a716-446655440001',
      },
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid toolId', () => {
    const result = executeToolSchema.safeParse({
      toolId: 'not-a-uuid',
      args: {},
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid agentId in context', () => {
    const result = executeToolSchema.safeParse({
      toolId: '550e8400-e29b-41d4-a716-446655440000',
      args: {},
      context: {
        agentId: 'not-a-uuid',
      },
    });
    expect(result.success).toBe(false);
  });

  test('accepts complex args', () => {
    const result = executeToolSchema.safeParse({
      toolId: '550e8400-e29b-41d4-a716-446655440000',
      args: {
        path: '/home/user',
        recursive: true,
        maxDepth: 3,
        patterns: ['*.ts', '*.js'],
        config: { include: ['src'], exclude: ['node_modules'] },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('mcpServerFilterSchema', () => {
  test('applies defaults', () => {
    const result = mcpServerFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  test('coerces string numbers', () => {
    const result = mcpServerFilterSchema.safeParse({
      limit: '25',
      offset: '10',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.offset).toBe(10);
    }
  });

  test('coerces enabled boolean', () => {
    const result = mcpServerFilterSchema.safeParse({
      enabled: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
    }
  });

  test('accepts transport filter', () => {
    const result = mcpServerFilterSchema.safeParse({
      transport: 'stdio',
    });
    expect(result.success).toBe(true);
  });

  test('accepts search filter', () => {
    const result = mcpServerFilterSchema.safeParse({
      search: 'filesystem',
    });
    expect(result.success).toBe(true);
  });

  test('accepts combined filters', () => {
    const result = mcpServerFilterSchema.safeParse({
      enabled: true,
      transport: 'http',
      search: 'api',
      limit: 10,
      offset: 5,
    });
    expect(result.success).toBe(true);
  });

  test('enforces limit bounds', () => {
    const tooHigh = mcpServerFilterSchema.safeParse({ limit: 101 });
    const tooLow = mcpServerFilterSchema.safeParse({ limit: 0 });
    expect(tooHigh.success).toBe(false);
    expect(tooLow.success).toBe(false);
  });

  test('rejects negative offset', () => {
    const result = mcpServerFilterSchema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });

  test('rejects invalid transport', () => {
    const result = mcpServerFilterSchema.safeParse({
      transport: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('mcpToolFilterSchema', () => {
  test('applies defaults', () => {
    const result = mcpToolFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  test('accepts serverId filter', () => {
    const result = mcpToolFilterSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  test('accepts enabled filter', () => {
    const result = mcpToolFilterSchema.safeParse({
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  test('accepts search filter', () => {
    const result = mcpToolFilterSchema.safeParse({
      search: 'read_file',
    });
    expect(result.success).toBe(true);
  });

  test('accepts combined filters', () => {
    const result = mcpToolFilterSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      enabled: true,
      search: 'write',
      limit: 20,
      offset: 0,
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid serverId', () => {
    const result = mcpToolFilterSchema.safeParse({
      serverId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  test('enforces limit bounds', () => {
    const tooHigh = mcpToolFilterSchema.safeParse({ limit: 101 });
    const tooLow = mcpToolFilterSchema.safeParse({ limit: 0 });
    expect(tooHigh.success).toBe(false);
    expect(tooLow.success).toBe(false);
  });
});

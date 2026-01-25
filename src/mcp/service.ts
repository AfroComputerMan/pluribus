import { db } from '@/db';
import { mcpServers, mcpTools } from '@/db/schema';
import { IntegrationError, NotFoundError } from '@/lib/errors';
import { createLogger } from '@/observability/logger';
import { and, eq } from 'drizzle-orm';
import { MCPClient } from './client';
import { HttpTransport, type IMCPTransport, StdioTransport, WebSocketTransport } from './transport';
import type {
  MCPConnectionStatus,
  MCPServer,
  MCPServerConfig,
  MCPTool,
  ToolExecutionResult,
} from './types';

const logger = createLogger('mcp:service');

export class MCPService {
  private clients = new Map<string, { client: MCPClient; transport: IMCPTransport }>();

  /**
   * Discover tools from an MCP server
   */
  async discoverTools(serverId: string): Promise<MCPTool[]> {
    logger.info('Discovering tools for MCP server', { serverId });

    // Load server from database
    const server = await db.query.mcpServers.findFirst({
      where: eq(mcpServers.id, serverId),
    });

    if (!server) {
      throw new NotFoundError('MCP Server', serverId);
    }

    try {
      // Get or create client connection
      const { client } = await this.getOrCreateClient(server as MCPServer);

      // Initialize connection if needed
      if (!client.getServerInfo()) {
        await client.initialize({
          name: 'pluribus',
          version: '1.0.0',
        });
      }

      // List tools from server
      const toolDefinitions = await client.listTools();

      logger.info('Discovered tools from MCP server', {
        serverId,
        toolCount: toolDefinitions.length,
      });

      // Store tools in database
      const tools: MCPTool[] = [];

      for (const toolDef of toolDefinitions) {
        // Delete existing tool with same name for this server
        await db
          .delete(mcpTools)
          .where(and(eq(mcpTools.serverId, serverId), eq(mcpTools.name, toolDef.name)));

        // Insert new tool
        const [tool] = await db
          .insert(mcpTools)
          .values({
            serverId,
            name: toolDef.name,
            description: toolDef.description,
            inputSchema: toolDef.inputSchema as {
              type: 'object';
              properties?: Record<string, unknown>;
              required?: string[];
            },
            enabled: true,
          })
          .returning();

        if (tool) {
          tools.push(tool as MCPTool);
        }
      }

      // Update lastConnectedAt
      await db
        .update(mcpServers)
        .set({ lastConnectedAt: new Date() })
        .where(eq(mcpServers.id, serverId));

      return tools;
    } catch (error) {
      logger.error('Failed to discover tools', {
        serverId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new IntegrationError(
        server.name,
        `Tool discovery failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute an MCP tool
   */
  async executeTool(toolId: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    logger.info('Executing MCP tool', { toolId, args });

    // Load tool and server from database
    const tool = await db.query.mcpTools.findFirst({
      where: eq(mcpTools.id, toolId),
      with: {
        server: true,
      },
    });

    if (!tool) {
      throw new NotFoundError('MCP Tool', toolId);
    }

    if (!tool.enabled) {
      throw new IntegrationError(tool.name, 'Tool is disabled');
    }

    const server = tool.server as unknown as MCPServer;
    if (!server) {
      throw new NotFoundError('MCP Server', tool.serverId);
    }

    if (!server.enabled) {
      throw new IntegrationError(server.name, 'Server is disabled');
    }

    try {
      // Validate args against input schema (basic validation)
      if (tool.inputSchema) {
        const schema = tool.inputSchema as { required?: string[] };
        if (schema.required) {
          for (const requiredParam of schema.required) {
            if (!(requiredParam in args)) {
              throw new Error(`Missing required parameter: ${requiredParam}`);
            }
          }
        }
      }

      // Get or create client connection
      const { client } = await this.getOrCreateClient(server as MCPServer);

      // Initialize if needed
      if (!client.getServerInfo()) {
        await client.initialize({
          name: 'pluribus',
          version: '1.0.0',
        });
      }

      // Call the tool
      const result = await client.callTool(tool.name, args);

      const duration = Date.now() - startTime;

      if (result.isError) {
        logger.error('Tool execution returned error', {
          toolId,
          tool: tool.name,
          duration,
        });

        return {
          success: false,
          error: JSON.stringify(result.content),
          duration,
        };
      }

      logger.info('Tool execution completed', {
        toolId,
        tool: tool.name,
        duration,
      });

      return {
        success: true,
        result: result.content,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Tool execution failed', {
        toolId,
        tool: tool.name,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
      };
    }
  }

  /**
   * Scan all enabled servers for tools
   */
  async scanServers(): Promise<void> {
    logger.info('Scanning all enabled MCP servers');

    const servers = await db.query.mcpServers.findMany({
      where: eq(mcpServers.enabled, true),
    });

    logger.info('Found enabled MCP servers', { count: servers.length });

    const results = await Promise.allSettled(
      servers.map((server) => this.discoverTools(server.id))
    );

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    logger.info('Server scan completed', { successful, failed, total: servers.length });
  }

  /**
   * Health check for an MCP server
   */
  async healthCheck(serverId: string): Promise<MCPConnectionStatus> {
    logger.debug('Checking MCP server health', { serverId });

    const server = await db.query.mcpServers.findFirst({
      where: eq(mcpServers.id, serverId),
    });

    if (!server) {
      throw new NotFoundError('MCP Server', serverId);
    }

    try {
      const { client, transport } = await this.getOrCreateClient(server as MCPServer);

      if (!transport.isConnected()) {
        await transport.connect();
      }

      // Try to initialize
      await client.initialize({
        name: 'pluribus',
        version: '1.0.0',
      });

      return {
        serverId,
        connected: true,
        lastConnectedAt: new Date(),
      };
    } catch (error) {
      logger.error('Health check failed', {
        serverId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        serverId,
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Disconnect a client
   */
  async disconnectClient(serverId: string): Promise<void> {
    const cached = this.clients.get(serverId);
    if (cached) {
      await cached.client.disconnect();
      this.clients.delete(serverId);
      logger.info('Disconnected MCP client', { serverId });
    }
  }

  /**
   * Disconnect all clients
   */
  async disconnectAll(): Promise<void> {
    logger.info('Disconnecting all MCP clients');

    await Promise.all(
      Array.from(this.clients.keys()).map((serverId) => this.disconnectClient(serverId))
    );
  }

  private async getOrCreateClient(
    server: MCPServer
  ): Promise<{ client: MCPClient; transport: IMCPTransport }> {
    // Check if we already have a connected client
    const cached = this.clients.get(server.id);
    if (cached?.transport.isConnected()) {
      return cached;
    }

    // Create new transport based on server config
    const config = server.config as MCPServerConfig;
    let transport: IMCPTransport;

    if (config.stdio) {
      transport = new StdioTransport(config.stdio.command, config.stdio.args);
    } else if (config.http) {
      transport = new HttpTransport(config.http.url);
    } else if (config.websocket) {
      transport = new WebSocketTransport(config.websocket.url);
    } else {
      throw new Error('Invalid MCP server config: no transport specified');
    }

    // Connect transport
    await transport.connect();

    // Create client
    const client = new MCPClient(transport);

    // Cache the client
    this.clients.set(server.id, { client, transport });

    return { client, transport };
  }
}

export const mcpService = new MCPService();

import { createLogger } from '@/observability/logger';
import type { JSONRPCRequest, JSONRPCResponse, IMCPTransport } from './transport';

const logger = createLogger('mcp:client');

export interface MCPClientInfo {
  name: string;
  version: string;
}

export interface MCPServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  capabilities: {
    tools?: boolean;
    prompts?: boolean;
    resources?: boolean;
  };
}

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: unknown;
  }>;
  isError?: boolean;
}

export enum MCPErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  ServerError = -32000,
}

export class MCPClient {
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  private serverInfo?: MCPServerInfo;

  constructor(
    private transport: IMCPTransport,
    private defaultTimeout = 30000
  ) {
    this.transport.on('message', (message: JSONRPCResponse) => {
      this.handleResponse(message);
    });

    this.transport.on('error', (error: Error) => {
      logger.error('Transport error', { error: error.message });
    });

    this.transport.on('disconnect', () => {
      logger.warn('Transport disconnected');
      this.rejectAllPending(new Error('Transport disconnected'));
    });
  }

  async connect(): Promise<void> {
    await this.transport.connect();
  }

  async disconnect(): Promise<void> {
    this.rejectAllPending(new Error('Client disconnecting'));
    await this.transport.disconnect();
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  async initialize(clientInfo: MCPClientInfo): Promise<MCPServerInfo> {
    logger.info('Initializing MCP connection', { clientInfo });

    const result = await this.request<{
      serverInfo: MCPServerInfo;
      capabilities: MCPServerInfo['capabilities'];
    }>('initialize', { clientInfo });

    this.serverInfo = {
      ...result.serverInfo,
      capabilities: result.capabilities,
    };

    logger.info('MCP connection initialized', { serverInfo: this.serverInfo });

    return this.serverInfo;
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    const result = await this.request<{ tools: MCPToolDefinition[] }>('tools/list');
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    logger.debug('Calling MCP tool', { name, args });

    const result = await this.request<MCPToolResult>('tools/call', {
      name,
      arguments: args,
    });

    logger.debug('Tool call completed', { name, isError: result.isError });

    return result;
  }

  async getPrompts(): Promise<Array<{ name: string; description?: string }>> {
    const result = await this.request<{ prompts: Array<{ name: string; description?: string }> }>(
      'prompts/list'
    );
    return result.prompts;
  }

  async getResources(): Promise<Array<{ uri: string; name: string; description?: string }>> {
    const result = await this.request<{
      resources: Array<{ uri: string; name: string; description?: string }>;
    }>('resources/list');
    return result.resources;
  }

  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = ++this.requestId;

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after ${this.defaultTimeout}ms`));
      }, this.defaultTimeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.transport.send(request).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      });
    });
  }

  private handleResponse(response: JSONRPCResponse): void {
    const pending = this.pendingRequests.get(Number(response.id));
    if (!pending) {
      logger.warn('Received response for unknown request', { id: response.id });
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(Number(response.id));

    if (response.error) {
      pending.reject(new Error(`JSON-RPC Error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [_id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  getServerInfo(): MCPServerInfo | undefined {
    return this.serverInfo;
  }
}

import type { z } from 'zod';
import type { mcpServerSchema, mcpToolSchema } from './schemas';

export type MCPServer = z.infer<typeof mcpServerSchema>;
export type MCPTool = z.infer<typeof mcpToolSchema>;

export type CreateMCPServerInput = Omit<
  MCPServer,
  'id' | 'lastConnectedAt' | 'createdAt' | 'updatedAt'
>;
export type UpdateMCPServerInput = Partial<CreateMCPServerInput>;

// Transport types
export type MCPTransport = 'stdio' | 'http' | 'websocket';

// Transport-specific configuration
export interface StdioConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface HttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface WebSocketConfig {
  url: string;
}

export interface MCPServerConfig {
  stdio?: StdioConfig;
  http?: HttpConfig;
  websocket?: WebSocketConfig;
}

// Tool input schema (JSON Schema subset)
export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface ToolPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: ToolPropertySchema;
  properties?: Record<string, ToolPropertySchema>;
}

// Tool execution
export interface ToolExecutionContext {
  agentId: string;
  workflowRunId?: string;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
}

// Connection status
export interface MCPConnectionStatus {
  serverId: string;
  connected: boolean;
  lastConnectedAt?: Date;
  error?: string;
}

// Filter options
export interface MCPServerFilter {
  enabled?: boolean;
  transport?: MCPTransport;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface MCPToolFilter {
  serverId?: string;
  enabled?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

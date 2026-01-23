// Integration adapter types

// Supported integration types
export type IntegrationType = 'claude-code' | 'codex' | 'opencode' | 'local-bridge' | 'custom';

// Credential types
export type CredentialType = 'oauth' | 'api-key';

export interface OAuthData {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string;
  expiresAt: Date;
}

export interface ApiKeyData {
  key: string;
}

export type AdapterCredentials =
  | { type: 'oauth'; data: OAuthData }
  | { type: 'api-key'; data: ApiKeyData };

// Adapter connection
export interface AdapterConnection {
  id: string;
  adapterId: string;
  status: 'connected' | 'disconnected' | 'error';
  credentials: AdapterCredentials;
  connectedAt: Date;
  lastUsedAt?: Date;
  metadata?: Record<string, unknown>;
}

// Task definition
export interface AgentTask {
  prompt: string;
  context?: string;
  tools?: ToolDefinition[];
  skills?: SkillDefinition[];
  constraints?: TaskConstraints;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SkillDefinition {
  name: string;
  content: string;
}

export interface TaskConstraints {
  maxTokens?: number;
  maxDuration?: number;
  allowedTools?: string[];
  blockedTools?: string[];
}

// Execution events
export type ExecutionEvent =
  | { type: 'started'; timestamp: Date }
  | { type: 'thinking'; content: string }
  | { type: 'tool-call'; tool: string; args: unknown }
  | { type: 'tool-result'; tool: string; result: unknown }
  | { type: 'output'; content: string }
  | { type: 'completed'; result: TaskResult }
  | { type: 'error'; error: Error }
  | { type: 'cost'; usage: TokenUsage };

export interface TaskResult {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Execution options
export interface ExecutionOptions {
  timeout?: number;
  onEvent?: (event: ExecutionEvent) => void;
}

// Adapter capabilities
export interface AdapterCapabilities {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsImages: boolean;
  maxContextTokens: number;
  supportedModels: string[];
}

// Cost estimation
export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  model: string;
}

// Base adapter interface
export interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: IntegrationType;

  // Connection lifecycle
  connect(credentials: AdapterCredentials): Promise<AdapterConnection>;
  disconnect(connection: AdapterConnection): Promise<void>;
  validateCredentials(credentials: AdapterCredentials): Promise<boolean>;

  // Execution
  execute(
    connection: AdapterConnection,
    task: AgentTask,
    options?: ExecutionOptions
  ): AsyncGenerator<ExecutionEvent>;

  // Capabilities
  getCapabilities(): AdapterCapabilities;

  // Cost estimation
  estimateCost(task: AgentTask): CostEstimate;
}

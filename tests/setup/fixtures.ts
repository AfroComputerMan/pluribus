import type { CreateAgentInput } from '@/core/agents/types';

/**
 * Test fixtures for consistent test data
 */

// ===================
// Agent Fixtures
// ===================

export const testAgent: CreateAgentInput = {
  name: 'Test Agent',
  description: 'A test agent for unit tests',
  tags: ['test', 'fixture'],
  modelConfig: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    parameters: { temperature: 0.7 },
  },
  memoryMode: 'stateless',
  isolationLevel: 'shared',
  canSpawnSubAgents: false,
  maxSubAgents: null,
  skills: ['coding', 'analysis'],
  allowedMcpTools: ['read_file', 'write_file'],
  integration: null,
};

export const testAgentWithIntegration: CreateAgentInput = {
  ...testAgent,
  name: 'Integrated Agent',
  integration: {
    type: 'claude-code',
    connectionId: '550e8400-e29b-41d4-a716-446655440000',
  },
};

export const testAgentMinimal: CreateAgentInput = {
  name: 'Minimal Agent',
  description: null,
  tags: [],
  modelConfig: {
    provider: 'openai',
    model: 'gpt-4',
  },
  memoryMode: 'stateless',
  isolationLevel: 'shared',
  canSpawnSubAgents: false,
  maxSubAgents: null,
  skills: [],
  allowedMcpTools: [],
  integration: null,
};

export function createTestAgentInput(overrides: Partial<CreateAgentInput> = {}): CreateAgentInput {
  return {
    ...testAgent,
    name: `Test Agent ${Date.now()}`,
    ...overrides,
  };
}

// ===================
// Workflow Fixtures
// ===================

export interface TestWorkflowInput {
  name: string;
  description: string | null;
  nodes: Array<{
    id: string;
    type: 'agent' | 'condition' | 'parallel' | 'loop' | 'human-review';
    [key: string]: unknown;
  }>;
  edges: Array<{ id: string; from: string; to: string; label?: string }>;
  triggers: Array<{ type: 'manual' } | { type: 'schedule'; cron: string } | { type: 'webhook'; secret: string } | { type: 'api' }>;
  errorStrategy: {
    retries: number;
    retryDelay: number;
    fallbackNodeId?: string;
    onFailure: 'stop' | 'continue' | 'human-review';
  };
}

export const testWorkflow: TestWorkflowInput = {
  name: 'Test Workflow',
  description: 'A test workflow',
  nodes: [
    {
      id: 'node-1',
      type: 'agent' as const,
      agentId: '550e8400-e29b-41d4-a716-446655440000',
      input: { task: 'analyze' },
    },
  ],
  edges: [],
  triggers: [{ type: 'manual' as const }],
  errorStrategy: {
    retries: 3,
    retryDelay: 1000,
    onFailure: 'stop' as const,
  },
};

export const testWorkflowWithMultipleNodes: TestWorkflowInput = {
  name: 'Multi-Node Workflow',
  description: 'A workflow with multiple nodes and edges',
  nodes: [
    {
      id: 'analyze',
      type: 'agent' as const,
      agentId: '550e8400-e29b-41d4-a716-446655440001',
      input: { task: 'analyze input' },
    },
    {
      id: 'check-result',
      type: 'condition' as const,
      expression: 'output.success === true',
      trueBranch: 'success-handler',
      falseBranch: 'error-handler',
    },
    {
      id: 'success-handler',
      type: 'agent' as const,
      agentId: '550e8400-e29b-41d4-a716-446655440002',
      input: { data: { fromNode: 'analyze', path: 'output.result' } },
    },
    {
      id: 'error-handler',
      type: 'human-review' as const,
      prompt: 'Analysis failed. Please review.',
      options: ['retry', 'skip', 'abort'],
    },
  ],
  edges: [
    { id: 'e1', from: 'analyze', to: 'check-result' },
    { id: 'e2', from: 'check-result', to: 'success-handler', label: 'success' },
    { id: 'e3', from: 'check-result', to: 'error-handler', label: 'failure' },
  ],
  triggers: [{ type: 'manual' }],
  errorStrategy: {
    retries: 2,
    retryDelay: 5000,
    onFailure: 'human-review',
  },
};

export const testWorkflowWithSchedule: TestWorkflowInput = {
  ...testWorkflow,
  name: 'Scheduled Workflow',
  triggers: [{ type: 'schedule', cron: '0 0 * * *' }],
};

export function createTestWorkflowInput(overrides: Partial<TestWorkflowInput> = {}): TestWorkflowInput {
  return {
    ...testWorkflow,
    name: `Test Workflow ${Date.now()}`,
    ...overrides,
  };
}

// ===================
// MCP Server Fixtures
// ===================

export interface TestMcpServerInput {
  name: string;
  transport: 'stdio' | 'http' | 'websocket';
  config: {
    stdio?: { command: string; args?: string[]; env?: Record<string, string> };
    http?: { url: string; headers?: Record<string, string> };
    websocket?: { url: string };
  };
  enabled: boolean;
}

export const testMcpServer: TestMcpServerInput = {
  name: 'Test MCP Server',
  transport: 'stdio',
  config: {
    stdio: {
      command: 'npx',
      args: ['-y', 'test-mcp-server'],
    },
  },
  enabled: true,
};

export const testMcpServerHttp: TestMcpServerInput = {
  name: 'HTTP MCP Server',
  transport: 'http',
  config: {
    http: {
      url: 'https://api.example.com/mcp',
      headers: { Authorization: 'Bearer test-token' },
    },
  },
  enabled: true,
};

export const testMcpServerWebsocket: TestMcpServerInput = {
  name: 'WebSocket MCP Server',
  transport: 'websocket',
  config: {
    websocket: {
      url: 'wss://ws.example.com/mcp',
    },
  },
  enabled: false,
};

export function createTestMcpServerInput(overrides: Partial<TestMcpServerInput> = {}): TestMcpServerInput {
  return {
    ...testMcpServer,
    name: `Test MCP Server ${Date.now()}`,
    ...overrides,
  };
}

// ===================
// MCP Tool Fixtures
// ===================

export interface TestMcpToolInput {
  serverId: string;
  name: string;
  description: string | null;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  } | null;
  enabled: boolean;
}

export const testMcpTool: TestMcpToolInput = {
  serverId: '550e8400-e29b-41d4-a716-446655440000',
  name: 'read_file',
  description: 'Read contents of a file',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read' },
    },
    required: ['path'],
  },
  enabled: true,
};

export function createTestMcpToolInput(serverId: string, overrides: Partial<Omit<TestMcpToolInput, 'serverId'>> = {}): TestMcpToolInput {
  return {
    ...testMcpTool,
    serverId,
    name: `test_tool_${Date.now()}`,
    ...overrides,
  };
}

// ===================
// Skill Fixtures
// ===================

export interface TestSkillInput {
  name: string;
  description: string | null;
  type: 'prompt' | 'behavior' | 'workflow-template';
  content: string;
  tags: string[];
  source: 'user' | 'imported' | 'builtin';
  parameters: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'select';
    description: string;
    required: boolean;
    default?: unknown;
    options?: string[];
  }> | null;
}

export const testSkill: TestSkillInput = {
  name: 'Test Skill',
  description: 'A test skill template',
  type: 'prompt',
  content: 'You are a helpful assistant that {{task}}',
  tags: ['test'],
  source: 'user',
  parameters: [
    {
      name: 'task',
      type: 'string' as const,
      description: 'The task to perform',
      required: true,
    },
  ],
};

export const testSkillBehavior: TestSkillInput = {
  name: 'Test Behavior Skill',
  description: 'A behavior skill for testing',
  type: 'behavior',
  content: 'Always respond in a friendly and professional manner.',
  tags: ['behavior', 'test'],
  source: 'builtin',
  parameters: null,
};

export const testSkillWorkflowTemplate: TestSkillInput = {
  name: 'Code Review Template',
  description: 'A workflow template for code review',
  type: 'workflow-template',
  content: JSON.stringify({
    nodes: [
      { id: 'analyze', type: 'agent', input: { code: '{{code}}' } },
      { id: 'review', type: 'human-review', prompt: 'Review analysis' },
    ],
    edges: [{ from: 'analyze', to: 'review' }],
  }),
  tags: ['code', 'review', 'template'],
  source: 'imported',
  parameters: [
    {
      name: 'code',
      type: 'string',
      description: 'The code to review',
      required: true,
    },
    {
      name: 'language',
      type: 'select',
      description: 'Programming language',
      required: false,
      options: ['typescript', 'javascript', 'python', 'go'],
      default: 'typescript',
    },
  ],
};

export function createTestSkillInput(overrides: Partial<TestSkillInput> = {}): TestSkillInput {
  return {
    ...testSkill,
    name: `Test Skill ${Date.now()}`,
    ...overrides,
  };
}

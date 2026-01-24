import type { CreateAgentInput } from '@/core/agents/types';
import type {
  ErrorStrategy,
  WorkflowEdge,
  WorkflowNode,
  WorkflowTrigger,
} from '@/core/workflows/types';
import type * as schema from '@/db/schema';

/**
 * Test fixtures for consistent test data
 */

// Type aliases for schema insert types
type McpServerInsert = typeof schema.mcpServers.$inferInsert;
type McpToolInsert = typeof schema.mcpTools.$inferInsert;

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

// Use createTestAgentInput() with overrides for integration/minimal variants

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
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggers: WorkflowTrigger[];
  errorStrategy: ErrorStrategy;
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

// Use createTestWorkflowInput() with overrides instead of predefined variants

export function createTestWorkflowInput(
  overrides: Partial<TestWorkflowInput> = {}
): TestWorkflowInput {
  return {
    ...testWorkflow,
    name: `Test Workflow ${Date.now()}`,
    ...overrides,
  };
}

// ===================
// MCP Server Fixtures
// ===================

export type TestMcpServerInput = Omit<
  McpServerInsert,
  'id' | 'createdAt' | 'updatedAt' | 'lastConnectedAt'
>;

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
    },
  },
  enabled: true,
};

// Use createTestMcpServerInput() with transport/config overrides for websocket

export function createTestMcpServerInput(
  overrides: Partial<TestMcpServerInput> = {}
): TestMcpServerInput {
  return {
    ...testMcpServer,
    name: `Test MCP Server ${Date.now()}`,
    ...overrides,
  };
}

// ===================
// MCP Tool Fixtures
// ===================

export type TestMcpToolInput = Omit<McpToolInsert, 'id' | 'discoveredAt'>;

const baseMcpTool = {
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

export function createTestMcpToolInput(
  serverId: string,
  overrides: Partial<Omit<TestMcpToolInput, 'serverId'>> = {}
): TestMcpToolInput {
  return {
    ...baseMcpTool,
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

// Use createTestSkillInput() with type override for workflow-template skills

export function createTestSkillInput(overrides: Partial<TestSkillInput> = {}): TestSkillInput {
  return {
    ...testSkill,
    name: `Test Skill ${Date.now()}`,
    ...overrides,
  };
}

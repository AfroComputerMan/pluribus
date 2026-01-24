# Agent Organization System - Architecture Design

**Version**: 1.1
**Created**: 2026-01-24
**Updated**: 2026-01-24
**Status**: Partially Implemented (see [ROADMAP.md](./ROADMAP.md))

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Next.js)                              │
│                         (Your existing UI design)                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ REST API + WebSocket
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            API GATEWAY LAYER                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │   REST API  │ │  WebSocket  │ │  Webhooks   │ │  Scheduled Triggers │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CORE SERVICES                                   │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │    Agent     │  │   Workflow   │  │ Orchestrator │  │    Skills    │    │
│  │   Registry   │  │    Engine    │  │   Service    │  │   Manager    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │     MCP      │  │ Credential   │  │Observability │  │   Execution  │    │
│  │   Manager    │  │    Vault     │  │   Service    │  │   Runtime    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          INTEGRATION LAYER                                   │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Claude Code  │  │    Codex     │  │   OpenCode   │  │ Local Bridge │    │
│  │   Adapter    │  │   Adapter    │  │   Adapter    │  │   Adapter    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                      MCP Server Connections                         │    │
│  │   [MCP Server 1]  [MCP Server 2]  [MCP Server 3]  [MCP Server N]   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA & QUEUE LAYER                                 │
│                                                                              │
│         ┌──────────────────┐              ┌──────────────────┐              │
│         │    PostgreSQL    │              │      Redis       │              │
│         │                  │              │                  │              │
│         │  • Agents        │              │  • BullMQ Jobs   │              │
│         │  • Workflows     │              │  • Pub/Sub       │              │
│         │  • Runs/Logs     │              │  • Session Cache │              │
│         │  • Credentials   │              │  • Real-time     │              │
│         │  • MCP Configs   │              │                  │              │
│         └──────────────────┘              └──────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Runtime | Bun | Fast startup, native TS, modern APIs |
| Language | TypeScript | Type safety, excellent DX |
| API Framework | Hono | Fast, lightweight, Bun-native |
| Database | PostgreSQL | Reliable, JSONB support, full-text search |
| Queue | Redis + BullMQ | Battle-tested, DAG support, pub/sub |
| ORM | Drizzle | Type-safe, performant, great DX |
| Validation | Zod | Runtime validation, TS integration |
| WebSocket | Bun native WebSocket | Built-in, performant |
| Container | Docker SDK | For isolated execution |

---

## 3. Core Services Architecture

### 3.1 Agent Registry

**Responsibility**: CRUD operations for agents, tag management, configuration storage.

```typescript
// src/core/agents/types.ts

interface Agent {
  id: string;
  name: string;
  description: string;
  tags: string[];

  // Model configuration
  modelConfig: {
    provider: 'anthropic' | 'openai' | 'custom';
    model: string;
    parameters?: Record<string, unknown>;
  };

  // Behavior settings
  memoryMode: 'stateless' | 'session' | 'persistent';
  isolationLevel: 'shared' | 'process' | 'container';
  canSpawnSubAgents: boolean;
  maxSubAgents?: number;

  // Assigned capabilities
  skills: string[];           // Skill IDs
  allowedMcpTools: string[];  // Tool IDs or '*' for all

  // Integration binding (optional)
  integration?: {
    type: 'claude-code' | 'codex' | 'opencode' | 'local-bridge';
    connectionId: string;
  };

  createdAt: Date;
  updatedAt: Date;
}
```

### 3.2 Workflow Engine

**Responsibility**: Define, store, and execute workflow DAGs.

```typescript
// src/core/workflows/types.ts

interface Workflow {
  id: string;
  name: string;
  description: string;

  // DAG structure
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];

  // Trigger configuration
  triggers: WorkflowTrigger[];

  // Error handling
  errorStrategy: {
    retries: number;
    retryDelay: number;
    fallbackNodeId?: string;
    onFailure: 'stop' | 'continue' | 'human-review';
  };

  createdAt: Date;
  updatedAt: Date;
}

type WorkflowNode =
  | AgentNode
  | ConditionNode
  | ParallelNode
  | LoopNode
  | HumanReviewNode;

interface AgentNode {
  id: string;
  type: 'agent';
  agentId: string;
  input: InputMapping;
  timeout?: number;
}

interface ConditionNode {
  id: string;
  type: 'condition';
  expression: string;  // JSONLogic or simple expression
  trueBranch: string;  // Node ID
  falseBranch: string; // Node ID
}

interface ParallelNode {
  id: string;
  type: 'parallel';
  branches: string[];  // Node IDs to run in parallel
  joinStrategy: 'all' | 'any' | 'race';
}

interface LoopNode {
  id: string;
  type: 'loop';
  condition: string;
  maxIterations: number;
  body: string;  // Entry node ID for loop body
}

interface HumanReviewNode {
  id: string;
  type: 'human-review';
  prompt: string;
  timeout?: number;
  options?: string[];
}

interface WorkflowEdge {
  id: string;
  from: string;  // Node ID
  to: string;    // Node ID
  label?: string;
}

type WorkflowTrigger =
  | { type: 'manual' }
  | { type: 'schedule'; cron: string }
  | { type: 'webhook'; secret: string }
  | { type: 'api' };
```

**Workflow Execution Flow:**

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Trigger   │────▶│  Workflow   │────▶│   BullMQ    │
│   Received  │     │   Loaded    │     │  Jobs Queue │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                    ┌──────────────────────────┘
                    ▼
┌─────────────────────────────────────────────────────────┐
│                    WORKFLOW RUN                          │
│                                                          │
│  ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐  │
│  │ Node 1 │───▶│ Node 2 │───▶│ Node 3 │───▶│ Node 4 │  │
│  │  Job   │    │  Job   │    │  Job   │    │  Job   │  │
│  └────────┘    └────────┘    └────────┘    └────────┘  │
│       │             │             │             │       │
│       ▼             ▼             ▼             ▼       │
│  [Results]     [Results]    [Results]     [Results]    │
│       │             │             │             │       │
│       └─────────────┴─────────────┴─────────────┘       │
│                          │                               │
│                          ▼                               │
│                   [Run Complete]                         │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Integration Layer

**Responsibility**: Unified interface for all CLI/agent integrations.

```typescript
// src/integrations/adapter.ts

interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: 'claude-code' | 'codex' | 'opencode' | 'local-bridge' | 'custom';

  // Connection lifecycle
  connect(credentials: AdapterCredentials): Promise<AdapterConnection>;
  disconnect(connection: AdapterConnection): Promise<void>;
  validateCredentials(credentials: AdapterCredentials): Promise<boolean>;

  // Execution
  execute(
    connection: AdapterConnection,
    task: AgentTask,
    options: ExecutionOptions
  ): AsyncGenerator<ExecutionEvent>;

  // Capabilities
  getCapabilities(): AdapterCapabilities;

  // Cost estimation
  estimateCost(task: AgentTask): CostEstimate;
}

interface AdapterCredentials {
  type: 'oauth' | 'api-key';
  oauth?: { accessToken: string; refreshToken: string; expiresAt: Date };
  apiKey?: string;
  metadata?: Record<string, unknown>;
}

interface AgentTask {
  prompt: string;
  context?: string;
  tools?: ToolDefinition[];
  skills?: SkillDefinition[];
  constraints?: TaskConstraints;
}

type ExecutionEvent =
  | { type: 'started'; timestamp: Date }
  | { type: 'thinking'; content: string }
  | { type: 'tool-call'; tool: string; args: unknown }
  | { type: 'tool-result'; tool: string; result: unknown }
  | { type: 'output'; content: string }
  | { type: 'completed'; result: TaskResult }
  | { type: 'error'; error: Error }
  | { type: 'cost'; usage: TokenUsage };
```

**Adapter Implementations:**

```
src/integrations/
  ├── adapter.ts           # Base interface
  ├── claude-code/
  │   ├── adapter.ts       # Anthropic SDK integration
  │   └── oauth.ts         # OAuth flow handler
  ├── codex/
  │   ├── adapter.ts       # OpenAI SDK integration
  │   └── oauth.ts
  ├── opencode/
  │   └── adapter.ts       # Direct API integration
  ├── local-bridge/
  │   ├── adapter.ts       # WebSocket client
  │   └── daemon.ts        # Local daemon (separate process)
  └── registry.ts          # Adapter registry
```

### 3.4 MCP Manager

**Responsibility**: Connect to MCP servers, discover tools, route tool calls.

```typescript
// src/mcp/manager.ts

interface MCPManager {
  // Server management
  addServer(config: MCPServerConfig): Promise<MCPServer>;
  removeServer(serverId: string): Promise<void>;
  listServers(): Promise<MCPServer[]>;

  // Tool discovery
  discoverTools(serverId: string): Promise<MCPTool[]>;
  getAllTools(): Promise<MCPTool[]>;

  // Tool execution
  executeTool(
    toolId: string,
    args: unknown,
    context: ExecutionContext
  ): Promise<ToolResult>;

  // Auto-discovery (optional)
  scanForServers(): Promise<MCPServerConfig[]>;
}

interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http' | 'websocket';

  // Transport-specific config
  stdio?: { command: string; args: string[] };
  http?: { url: string; headers?: Record<string, string> };
  websocket?: { url: string };

  enabled: boolean;
}

interface MCPTool {
  id: string;
  serverId: string;
  name: string;
  description: string;
  inputSchema: JSONSchema;
  enabled: boolean;
}
```

### 3.5 Skills Manager

**Responsibility**: Store, import, export, and assign skills to agents.

```typescript
// src/skills/types.ts

interface Skill {
  id: string;
  name: string;
  description: string;

  // Skill content
  type: 'prompt' | 'behavior' | 'workflow-template';
  content: string;  // Markdown/YAML content

  // Metadata
  tags: string[];
  source: 'user' | 'imported' | 'builtin';

  // Parameters (for templated skills)
  parameters?: SkillParameter[];

  createdAt: Date;
  updatedAt: Date;
}

interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  description: string;
  required: boolean;
  default?: unknown;
  options?: string[];  // For select type
}
```

### 3.6 Execution Runtime

**Responsibility**: Manage execution isolation levels.

```typescript
// src/runtime/types.ts

interface ExecutionRuntime {
  execute(
    task: RuntimeTask,
    isolation: IsolationLevel
  ): Promise<RuntimeResult>;

  cleanup(executionId: string): Promise<void>;
}

type IsolationLevel = 'shared' | 'process' | 'container';

interface RuntimeTask {
  id: string;
  adapter: AgentAdapter;
  connection: AdapterConnection;
  task: AgentTask;
  timeout: number;
  resourceLimits?: ResourceLimits;
}

interface ResourceLimits {
  maxMemoryMB?: number;
  maxCpuPercent?: number;
  maxDurationMs?: number;
}
```

**Isolation Strategies:**

| Level | Implementation | Use Case |
|-------|---------------|----------|
| `shared` | Direct execution in main process | Trusted agents, fast execution |
| `process` | Child process via Bun.spawn | Moderate isolation, good performance |
| `container` | Docker container | Full isolation, untrusted code |

### 3.7 Observability Service

**Responsibility**: Logs, traces, metrics, and cost tracking.

```typescript
// src/observability/types.ts

interface ObservabilityService {
  // Logging
  log(entry: LogEntry): void;
  queryLogs(filter: LogFilter): Promise<LogEntry[]>;

  // Tracing (OpenTelemetry-compatible)
  startTrace(name: string, attributes?: Record<string, unknown>): Trace;
  endTrace(trace: Trace, status: TraceStatus): void;

  // Metrics
  recordMetric(metric: Metric): void;
  queryMetrics(filter: MetricFilter): Promise<MetricSeries[]>;

  // Cost tracking
  recordUsage(usage: UsageRecord): void;
  getCostSummary(filter: CostFilter): Promise<CostSummary>;

  // Real-time streaming
  subscribe(channel: string): AsyncIterable<ObservabilityEvent>;
}

interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  metadata?: Record<string, unknown>;

  // Correlation
  workflowRunId?: string;
  agentId?: string;
  nodeExecutionId?: string;
}

interface UsageRecord {
  timestamp: Date;
  agentId: string;
  workflowRunId?: string;

  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;

  estimatedCostUsd: number;
}

interface CostSummary {
  totalCostUsd: number;
  byAgent: Record<string, number>;
  byWorkflow: Record<string, number>;
  byModel: Record<string, number>;
  byDay: Record<string, number>;
}
```

### 3.8 Credential Vault

**Responsibility**: Secure storage for OAuth tokens and API keys.

```typescript
// src/vault/types.ts

interface CredentialVault {
  // Storage
  store(credential: Credential): Promise<string>;  // Returns credential ID
  retrieve(credentialId: string): Promise<Credential>;
  delete(credentialId: string): Promise<void>;

  // OAuth helpers
  refreshOAuthToken(credentialId: string): Promise<Credential>;

  // Listing
  list(filter?: CredentialFilter): Promise<CredentialMetadata[]>;
}

interface Credential {
  id: string;
  name: string;
  type: 'oauth' | 'api-key';
  integration: string;  // claude-code, codex, etc.

  // Encrypted at rest
  data: OAuthData | ApiKeyData;

  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

interface OAuthData {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string;
  expiresAt: Date;
}

interface ApiKeyData {
  key: string;
}
```

**Security Implementation:**
- Encryption: AES-256-GCM
- Master key: Environment variable (`VAULT_MASTER_KEY`)
- Key derivation: HKDF for per-credential keys
- Refresh tokens: Automatically refreshed before expiration

---

## 4. Database Schema

```sql
-- Agents
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  model_config JSONB NOT NULL,
  memory_mode VARCHAR(20) DEFAULT 'stateless',
  isolation_level VARCHAR(20) DEFAULT 'shared',
  can_spawn_sub_agents BOOLEAN DEFAULT false,
  max_sub_agents INTEGER,
  skills TEXT[] DEFAULT '{}',
  allowed_mcp_tools TEXT[] DEFAULT '{}',
  integration JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_tags ON agents USING GIN (tags);

-- Workflows
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  nodes JSONB NOT NULL,
  edges JSONB NOT NULL,
  triggers JSONB DEFAULT '[]',
  error_strategy JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow Runs
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL,  -- pending, running, completed, failed, cancelled
  trigger_type VARCHAR(20) NOT NULL,
  input JSONB,
  output JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);

-- Node Executions
CREATE TABLE node_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(100) NOT NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL,
  input JSONB,
  output JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_node_executions_run ON node_executions(workflow_run_id);

-- MCP Servers
CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  transport VARCHAR(20) NOT NULL,
  config JSONB NOT NULL,
  enabled BOOLEAN DEFAULT true,
  last_connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- MCP Tools (cached from discovery)
CREATE TABLE mcp_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID REFERENCES mcp_servers(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  input_schema JSONB,
  enabled BOOLEAN DEFAULT true,
  discovered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mcp_tools_server ON mcp_tools(server_id);

-- Skills
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  source VARCHAR(20) DEFAULT 'user',
  parameters JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_skills_tags ON skills USING GIN (tags);

-- Credentials (encrypted)
CREATE TABLE credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL,
  integration VARCHAR(50) NOT NULL,
  encrypted_data BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Logs
CREATE TABLE logs (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level VARCHAR(10) NOT NULL,
  source VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  workflow_run_id UUID,
  agent_id UUID,
  node_execution_id UUID
);

CREATE INDEX idx_logs_timestamp ON logs(timestamp DESC);
CREATE INDEX idx_logs_workflow_run ON logs(workflow_run_id);
CREATE INDEX idx_logs_level ON logs(level);

-- Usage/Cost Records
CREATE TABLE usage_records (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  estimated_cost_usd DECIMAL(10, 6) NOT NULL
);

CREATE INDEX idx_usage_timestamp ON usage_records(timestamp DESC);
CREATE INDEX idx_usage_agent ON usage_records(agent_id);
CREATE INDEX idx_usage_workflow ON usage_records(workflow_run_id);
```

---

## 5. API Design

### 5.1 REST Endpoints

```yaml
# Agents
GET    /api/agents                 # List agents (with tag filtering)
POST   /api/agents                 # Create agent
GET    /api/agents/:id             # Get agent
PUT    /api/agents/:id             # Update agent
DELETE /api/agents/:id             # Delete agent
GET    /api/agents/:id/runs        # Get agent's execution history

# Workflows
GET    /api/workflows              # List workflows
POST   /api/workflows              # Create workflow
GET    /api/workflows/:id          # Get workflow
PUT    /api/workflows/:id          # Update workflow
DELETE /api/workflows/:id          # Delete workflow
POST   /api/workflows/:id/run      # Trigger workflow run

# Workflow Runs
GET    /api/runs                   # List runs (with filtering)
GET    /api/runs/:id               # Get run details
GET    /api/runs/:id/nodes         # Get node execution details
POST   /api/runs/:id/cancel        # Cancel running workflow
POST   /api/runs/:id/retry         # Retry failed workflow
POST   /api/runs/:id/review        # Submit human review decision

# MCP
GET    /api/mcp/servers            # List MCP servers
POST   /api/mcp/servers            # Add MCP server
DELETE /api/mcp/servers/:id        # Remove MCP server
POST   /api/mcp/servers/:id/discover  # Trigger tool discovery
GET    /api/mcp/tools              # List all tools (across servers)
PUT    /api/mcp/tools/:id          # Enable/disable tool
POST   /api/mcp/scan               # Scan for MCP servers

# Skills
GET    /api/skills                 # List skills
POST   /api/skills                 # Create skill
GET    /api/skills/:id             # Get skill
PUT    /api/skills/:id             # Update skill
DELETE /api/skills/:id             # Delete skill
POST   /api/skills/import          # Import from file
GET    /api/skills/:id/export      # Export skill

# Integrations
GET    /api/integrations           # List available integrations
GET    /api/integrations/:type/auth  # Get OAuth URL
POST   /api/integrations/:type/callback  # OAuth callback
GET    /api/integrations/connections    # List active connections
DELETE /api/integrations/connections/:id  # Disconnect

# Credentials
GET    /api/credentials            # List credentials (metadata only)
POST   /api/credentials            # Store credential
DELETE /api/credentials/:id        # Delete credential

# Observability
GET    /api/logs                   # Query logs
GET    /api/metrics                # Get metrics
GET    /api/costs                  # Get cost summary
GET    /api/costs/breakdown        # Detailed cost breakdown
```

### 5.2 WebSocket Events

```typescript
// Connection: ws://host/ws

// Client → Server
interface ClientMessage {
  type: 'subscribe' | 'unsubscribe';
  channel: string;
  // Channels: 'runs:{runId}', 'activity', 'agent:{agentId}'
}

// Server → Client
type ServerMessage =
  | { type: 'run:started'; runId: string; workflowId: string }
  | { type: 'run:node:started'; runId: string; nodeId: string }
  | { type: 'run:node:output'; runId: string; nodeId: string; content: string }
  | { type: 'run:node:completed'; runId: string; nodeId: string; result: unknown }
  | { type: 'run:node:failed'; runId: string; nodeId: string; error: string }
  | { type: 'run:completed'; runId: string; result: unknown }
  | { type: 'run:failed'; runId: string; error: string }
  | { type: 'run:human-review'; runId: string; nodeId: string; prompt: string }
  | { type: 'cost:update'; agentId: string; costUsd: number };
```

---

## 6. Directory Structure

```
pluribus/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   ├── agents.ts
│   │   │   ├── workflows.ts
│   │   │   ├── runs.ts
│   │   │   ├── mcp.ts
│   │   │   ├── skills.ts
│   │   │   ├── integrations.ts
│   │   │   ├── credentials.ts
│   │   │   └── observability.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── error.ts
│   │   │   └── validation.ts
│   │   ├── websocket.ts
│   │   └── index.ts
│   │
│   ├── core/
│   │   ├── agents/
│   │   │   ├── types.ts
│   │   │   ├── service.ts
│   │   │   └── repository.ts
│   │   ├── workflows/
│   │   │   ├── types.ts
│   │   │   ├── engine.ts
│   │   │   ├── executor.ts
│   │   │   └── repository.ts
│   │   └── orchestrator/
│   │       ├── scheduler.ts
│   │       ├── triggers.ts
│   │       └── queue.ts
│   │
│   ├── integrations/
│   │   ├── adapter.ts
│   │   ├── registry.ts
│   │   ├── claude-code/
│   │   │   ├── adapter.ts
│   │   │   └── oauth.ts
│   │   ├── codex/
│   │   │   ├── adapter.ts
│   │   │   └── oauth.ts
│   │   ├── opencode/
│   │   │   └── adapter.ts
│   │   └── local-bridge/
│   │       ├── adapter.ts
│   │       └── protocol.ts
│   │
│   ├── mcp/
│   │   ├── types.ts
│   │   ├── manager.ts
│   │   ├── client.ts
│   │   └── discovery.ts
│   │
│   ├── skills/
│   │   ├── types.ts
│   │   ├── service.ts
│   │   ├── parser.ts
│   │   └── repository.ts
│   │
│   ├── runtime/
│   │   ├── types.ts
│   │   ├── executor.ts
│   │   ├── strategies/
│   │   │   ├── shared.ts
│   │   │   ├── process.ts
│   │   │   └── container.ts
│   │   └── resource-manager.ts
│   │
│   ├── observability/
│   │   ├── types.ts
│   │   ├── logger.ts
│   │   ├── tracer.ts
│   │   ├── metrics.ts
│   │   └── cost-tracker.ts
│   │
│   ├── vault/
│   │   ├── types.ts
│   │   ├── vault.ts
│   │   └── crypto.ts
│   │
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema.ts
│   │   └── migrations/
│   │
│   ├── queue/
│   │   ├── client.ts
│   │   ├── workers/
│   │   │   ├── workflow.ts
│   │   │   └── node.ts
│   │   └── processors.ts
│   │
│   ├── lib/
│   │   ├── config.ts
│   │   ├── errors.ts
│   │   └── utils.ts
│   │
│   └── index.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── requirements.md
│   ├── architecture.md
│   └── api.md
│
├── drizzle/
│   └── migrations/
│
├── docker/
│   └── postgres/
│       └── init.sql
│
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── Dockerfile
├── Dockerfile.dev
├── docker-compose.yml
├── docker-compose.prod.yml
├── Makefile
├── .env.example
└── .dockerignore
```

---

## 7. Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Compose                            │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Pluribus   │  │  PostgreSQL  │  │        Redis         │  │
│  │   Backend    │  │              │  │                      │  │
│  │   (Bun)      │  │   Port 5432  │  │      Port 6379       │  │
│  │   Port 3000  │  │              │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                                                        │
│         │ (optional)                                             │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Docker-in-Docker                       │   │
│  │              (for container isolation)                    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 7.1 Dockerfile

```dockerfile
# Dockerfile
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# Build stage
FROM base AS builder
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Production image
FROM base AS runner
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 pluribus
USER pluribus

COPY --from=deps --chown=pluribus:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=pluribus:nodejs /app/dist ./dist
COPY --from=builder --chown=pluribus:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=pluribus:nodejs /app/package.json ./

EXPOSE 3000
CMD ["bun", "run", "dist/index.js"]
```

### 7.2 Docker Compose - Development

```yaml
# docker-compose.yml (Development)
version: "3.9"

services:
  # ===================
  # Main Application
  # ===================
  pluribus:
    build:
      context: .
      dockerfile: Dockerfile.dev
    container_name: pluribus-dev
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgres://pluribus:pluribus@postgres:5432/pluribus
      - REDIS_URL=redis://redis:6379
      - VAULT_MASTER_KEY=${VAULT_MASTER_KEY:-dev-master-key-change-in-production}
      - LOG_LEVEL=debug
    volumes:
      - ./src:/app/src:ro          # Hot reload source files
      - ./drizzle:/app/drizzle:ro  # Migrations
      - ./.env:/app/.env:ro        # Environment file
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - pluribus-network
    restart: unless-stopped

  # ===================
  # PostgreSQL Database
  # ===================
  postgres:
    image: postgres:16-alpine
    container_name: pluribus-postgres
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=pluribus
      - POSTGRES_PASSWORD=pluribus
      - POSTGRES_DB=pluribus
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pluribus -d pluribus"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - pluribus-network
    restart: unless-stopped

  # ===================
  # Redis (Queue + Cache)
  # ===================
  redis:
    image: redis:7-alpine
    container_name: pluribus-redis
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - pluribus-network
    restart: unless-stopped

  # ===================
  # Redis Commander (Dev UI)
  # ===================
  redis-commander:
    image: rediscommander/redis-commander:latest
    container_name: pluribus-redis-ui
    ports:
      - "8081:8081"
    environment:
      - REDIS_HOSTS=local:redis:6379
    depends_on:
      - redis
    networks:
      - pluribus-network
    profiles:
      - dev-tools

  # ===================
  # pgAdmin (Dev UI)
  # ===================
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: pluribus-pgadmin
    ports:
      - "8082:80"
    environment:
      - PGADMIN_DEFAULT_EMAIL=admin@pluribus.local
      - PGADMIN_DEFAULT_PASSWORD=admin
      - PGADMIN_CONFIG_SERVER_MODE=False
    volumes:
      - pgadmin_data:/var/lib/pgadmin
    depends_on:
      - postgres
    networks:
      - pluribus-network
    profiles:
      - dev-tools

volumes:
  postgres_data:
  redis_data:
  pgadmin_data:

networks:
  pluribus-network:
    driver: bridge
```

### 7.3 Docker Compose - Production

```yaml
# docker-compose.prod.yml (Production)
version: "3.9"

services:
  pluribus:
    image: ghcr.io/your-org/pluribus:${VERSION:-latest}
    container_name: pluribus
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - VAULT_MASTER_KEY=${VAULT_MASTER_KEY}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - pluribus-network
    restart: always
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M

  postgres:
    image: postgres:16-alpine
    container_name: pluribus-postgres
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - pluribus-network
    restart: always
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G

  redis:
    image: redis:7-alpine
    container_name: pluribus-redis
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - pluribus-network
    restart: always
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M

  # ===================
  # Traefik (Reverse Proxy)
  # ===================
  traefik:
    image: traefik:v3.0
    container_name: pluribus-traefik
    command:
      - "--api.dashboard=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_certs:/letsencrypt
    networks:
      - pluribus-network
    restart: always
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`traefik.${DOMAIN}`)"
      - "traefik.http.routers.api.service=api@internal"

volumes:
  postgres_data:
  redis_data:
  traefik_certs:

networks:
  pluribus-network:
    driver: bridge
```

### 7.4 Development Dockerfile

```dockerfile
# Dockerfile.dev (Development with hot reload)
FROM oven/bun:1.1-alpine
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
RUN bun install

# Copy source (will be overridden by volume mount)
COPY . .

# Expose port
EXPOSE 3000

# Run with hot reload
CMD ["bun", "run", "--hot", "src/index.ts"]
```

### 7.5 Docker Init Script

```sql
-- docker/postgres/init.sql
-- Initial database setup

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy text search

-- Create schema (migrations will handle tables)
-- This file is for any initial setup needed
```

### 7.6 Environment Files

```bash
# .env.example
# ====================
# Application
# ====================
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# ====================
# Database
# ====================
DATABASE_URL=postgres://pluribus:pluribus@localhost:5432/pluribus
POSTGRES_USER=pluribus
POSTGRES_PASSWORD=pluribus
POSTGRES_DB=pluribus

# ====================
# Redis
# ====================
REDIS_URL=redis://localhost:6379

# ====================
# Security
# ====================
# Generate with: openssl rand -hex 32
VAULT_MASTER_KEY=your-32-byte-hex-key-here

# ====================
# OAuth (Optional)
# ====================
# ANTHROPIC_CLIENT_ID=
# ANTHROPIC_CLIENT_SECRET=
# OPENAI_CLIENT_ID=
# OPENAI_CLIENT_SECRET=

# ====================
# Production Only
# ====================
# DOMAIN=pluribus.example.com
# ACME_EMAIL=admin@example.com
```

### 7.7 Makefile (Development Commands)

```makefile
# Makefile
.PHONY: dev prod build test clean logs shell db-migrate db-studio

# Development
dev:
	docker compose up -d
	docker compose logs -f pluribus

dev-all:
	docker compose --profile dev-tools up -d
	docker compose logs -f pluribus

# Production
prod:
	docker compose -f docker-compose.prod.yml up -d

# Build
build:
	docker compose build --no-cache

# Database
db-migrate:
	docker compose exec pluribus bun run db:migrate

db-generate:
	docker compose exec pluribus bun run db:generate

db-studio:
	docker compose exec pluribus bun run db:studio

db-seed:
	docker compose exec pluribus bun run db:seed

# Testing
test:
	docker compose exec pluribus bun test

test-watch:
	docker compose exec pluribus bun test --watch

# Utilities
logs:
	docker compose logs -f

logs-app:
	docker compose logs -f pluribus

shell:
	docker compose exec pluribus sh

psql:
	docker compose exec postgres psql -U pluribus -d pluribus

redis-cli:
	docker compose exec redis redis-cli

# Cleanup
clean:
	docker compose down -v --remove-orphans

clean-all:
	docker compose down -v --remove-orphans --rmi all

# Health check
health:
	@echo "Checking services..."
	@docker compose ps
	@echo "\nPostgres:"
	@docker compose exec postgres pg_isready -U pluribus
	@echo "\nRedis:"
	@docker compose exec redis redis-cli ping
```

### 7.8 Container Isolation (Optional DinD)

For agent container isolation feature, add Docker-in-Docker:

```yaml
# Add to docker-compose.yml for container isolation feature
services:
  # ... other services ...

  dind:
    image: docker:24-dind
    container_name: pluribus-dind
    privileged: true
    environment:
      - DOCKER_TLS_CERTDIR=/certs
    volumes:
      - dind_certs_ca:/certs/ca
      - dind_certs_client:/certs/client
      - dind_data:/var/lib/docker
    networks:
      - pluribus-network
    restart: unless-stopped

volumes:
  # ... other volumes ...
  dind_certs_ca:
  dind_certs_client:
  dind_data:
```

Then update pluribus service to use DinD:
```yaml
  pluribus:
    # ... other config ...
    environment:
      # ... other env vars ...
      - DOCKER_HOST=tcp://dind:2376
      - DOCKER_TLS_VERIFY=1
      - DOCKER_CERT_PATH=/certs/client
    volumes:
      # ... other volumes ...
      - dind_certs_client:/certs/client:ro
    depends_on:
      # ... other deps ...
      - dind
```

---

## 8. Security Considerations

| Concern | Mitigation |
|---------|------------|
| Credential storage | AES-256-GCM encryption at rest |
| API authentication | Session-based auth with secure cookies |
| OAuth tokens | Stored encrypted, auto-refresh before expiry |
| Container isolation | Resource limits, network isolation, read-only filesystems |
| Input validation | Zod schemas on all API inputs |
| SQL injection | Parameterized queries via Drizzle ORM |
| XSS | React escaping + CSP headers |

---

## 9. Open Design Decisions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Workflow persistence format | JSON, YAML, or both | JSON for storage, YAML for import/export |
| Agent templates | Built-in vs. skill-based | Skill-based (more flexible) |
| Version control | Git-like vs. simple snapshots | Simple snapshots initially |
| Rate limiting | Per-agent vs. global | Per-model rate limits |

---

## 10. UI Views & API Mapping

Based on the Pencil design (`code-agent-hub.pen`), the following views map to backend APIs:

### 10.1 Views Overview

| View | Route | Description | Primary API Endpoints |
|------|-------|-------------|----------------------|
| Dashboard | `/` | Command center overview | `GET /api/agents`, `GET /api/runs`, `GET /api/metrics` |
| Agent Detail | `/agents/:id` | Individual agent view + VM preview | `GET /api/agents/:id`, `WS /ws/agent/:id` |
| Agent Graph | `/graph` | Real-time multi-agent visualization | `GET /api/workflows/:id`, `WS /ws/runs/:id` |
| Agent Config | `/agents/new` | Create/edit agent | `POST /api/agents`, `GET /api/mcp/tools` |
| Skills Hub | `/skills` | Skills & MCP tools management | `GET /api/skills`, `GET /api/mcp/servers` |
| Repos View | `/repos` | Connected repositories | `GET /api/repos` |
| Tools View | `/tools` | Available tools browser | `GET /api/mcp/tools` |
| Modules Hub | `/modules` | Installed modules | `GET /api/modules` |
| Module Detail | `/modules/:id` | Module configuration | `GET /api/modules/:id` |

### 10.2 Onboarding Flow

| Step | Route | Purpose | API Endpoints |
|------|-------|---------|---------------|
| Welcome | `/onboarding` | Introduction | - |
| Providers | `/onboarding/providers` | Connect AI providers | `GET/POST /api/integrations/:type/auth` |
| MCP Tools | `/onboarding/mcp` | Configure MCP servers | `POST /api/mcp/servers` |
| Review | `/onboarding/review` | Finalize setup | `POST /api/onboarding/complete` |

### 10.3 UI Components → React Components

| Pencil Component | React Component | Props |
|------------------|-----------------|-------|
| Component/Sidebar | `<Sidebar />` | activeItem |
| Component/Button/Primary | `<Button variant="primary" />` | icon, children, onClick |
| Component/Button/Secondary | `<Button variant="secondary" />` | icon, children, onClick |
| Component/Metric Card/Primary | `<MetricCard variant="primary" />` | label, value, change, badge |
| Component/Metric Card/Secondary | `<MetricCard />` | label, value, change, badge |
| Component/Card | `<Card />` | title, action, children |
| Component/Module Card | `<ModuleCard />` | module |
| Component/Search Input | `<SearchInput />` | placeholder, value, onChange |
| Component/Input Field | `<InputField />` | label, placeholder, value, onChange |
| Component/Modal Overlay | `<Modal />` | title, children, onClose, onConfirm |
| Component/Type Selector | `<TypeSelector />` | label, options, value, onChange |

### 10.4 Real-Time Features

| Feature | View | WebSocket Channel | Events |
|---------|------|-------------------|--------|
| Agent output streaming | Agent Detail | `agent:{agentId}` | output, status |
| Graph node updates | Agent Graph | `runs:{runId}` | node:started, node:output, node:completed |
| Activity feed | Dashboard | `activity` | run:started, run:completed |
| Cost updates | Dashboard, Agent Detail | `costs` | cost:update |

### 10.5 Design Tokens

The UI uses these color tokens that should be defined in CSS/Tailwind:

```css
:root {
  --bg-page: #0f0f0f;
  --bg-card: #1a1a1a;
  --bg-surface: #242424;
  --white-primary: #ffffff;
  --gray-600: #6b6b6b;
  --gray-500: #8a8a8a;
  --orange-primary: #f97316;
  --teal-success: #14b8a6;
  --yellow-warning: #eab308;
  --blue-accent: #3b82f6;
  --purple-accent: #a855f7;
  --border: #2a2a2a;
}
```

### 10.6 Typography

| Style | CSS |
|-------|-----|
| Page Title | `font-family: 'Oswald'; font-size: 48px; font-weight: 700` |
| Section Title | `font-family: 'Oswald'; font-size: 32px; font-weight: 700` |
| Card Title | `font-family: 'Oswald'; font-size: 20px; font-weight: 600` |
| Body | `font-family: 'JetBrains Mono'; font-size: 12px` |
| Caption | `font-family: 'JetBrains Mono'; font-size: 10px` |

---

## 11. Implementation Status

See **[ROADMAP.md](./ROADMAP.md)** for detailed implementation tracking.

### Completed
- [x] Project scaffolding (Bun + TypeScript + Hono)
- [x] Database schema and migrations (11 tables)
- [x] Agent registry (full CRUD + filtering)
- [x] Workflow CRUD (types, schemas, API)
- [x] MCP server/tool CRUD
- [x] Skills CRUD
- [x] Vault encryption (AES-256-GCM)
- [x] Logger with structured output
- [x] BullMQ queue setup
- [x] Integration tests

### In Progress
- [ ] Queue workers (workflow/node processors)
- [ ] Workflow execution engine
- [ ] Orchestrator module (scheduling, triggers)

### Not Started
- [ ] Integration adapters (Claude Code, Codex, etc.)
- [ ] MCP client (tool discovery, execution)
- [ ] Runtime isolation strategies
- [ ] Frontend integration

---

**Note**: The architecture design above represents the target state. See ROADMAP.md for current implementation gaps.

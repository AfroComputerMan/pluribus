# Pluribus Implementation Workflow

**Generated**: 2026-01-28
**Status**: Implementation Plan
**Project**: Pluribus - Agent Organization System
**Current Phase**: 95% to MVP

---

## Executive Summary

This workflow provides a structured implementation plan for completing the Pluribus Agent Organization System MVP and beyond. The project is **95% complete** for MVP with the backend architecture largely implemented. The critical path focuses on:

1. **Agent Executor Wiring** (~2 hours) - Connect executor to adapter registry
2. **MVP UI** (~1-2 days) - Basic frontend for visualization and control
3. **SSE Endpoint** (~1 hour) - Real-time updates
4. **End-to-End Testing** (~2 hours) - Verify complete flow

---

## Table of Contents

1. [Project Context](#1-project-context)
2. [Implementation Phases](#2-implementation-phases)
3. [Phase 0: MVP Critical Path](#phase-0-mvp-critical-path-p0)
4. [Phase 1: Production Readiness](#phase-1-production-readiness-p1)
5. [Phase 2: Feature Expansion](#phase-2-feature-expansion-p2)
6. [Phase 3: Enterprise Features](#phase-3-enterprise-features-p3)
7. [Testing Strategy](#7-testing-strategy)
8. [Deployment & DevOps](#8-deployment--devops)
9. [Quality Gates](#9-quality-gates)
10. [Risk Mitigation](#10-risk-mitigation)

---

## 1. Project Context

### 1.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        PLURIBUS SYSTEM                           │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (React 19 + Vite + TailwindCSS v4)                   │
│  └─→ REST API + Server-Sent Events                             │
├─────────────────────────────────────────────────────────────────┤
│  Backend (Bun + TypeScript + Hono)                             │
│  ├─→ Core Services                                             │
│  │   ├─→ Agents (✅ Complete)                                  │
│  │   ├─→ Workflows (✅ 90% - missing wiring)                   │
│  │   ├─→ Orchestrator (✅ Complete)                            │
│  │   ├─→ MCP Manager (⚠️ 60% - discovery pending)             │
│  │   ├─→ Skills (⚠️ 60% - rendering pending)                  │
│  │   └─→ Observability (⚠️ 70% - DB logs pending)             │
│  ├─→ Integration Layer                                         │
│  │   └─→ Claude Code Adapter (✅ Ready, needs wiring)         │
│  └─→ Queue Workers (BullMQ)                                    │
│      ├─→ Workflow Processor (✅ Complete)                      │
│      ├─→ Node Processor (✅ Complete)                          │
│      └─→ Node Executors (⚠️ Agent executor stubbed)            │
├─────────────────────────────────────────────────────────────────┤
│  Data Layer                                                     │
│  ├─→ PostgreSQL 16 (11 tables, ✅ Complete)                    │
│  └─→ Redis 7 + BullMQ (✅ Complete)                            │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Technology Stack

| Layer | Technology | Status |
|-------|------------|--------|
| Runtime | Bun 1.1+ | ✅ Production |
| Backend Framework | Hono | ✅ Production |
| Database | PostgreSQL 16 | ✅ Production |
| ORM | Drizzle | ✅ Production |
| Queue | Redis 7 + BullMQ | ✅ Production |
| Validation | Zod | ✅ Production |
| Frontend | React 19 + Vite | 🔨 Setup needed |
| Styling | TailwindCSS v4 | 🔨 Setup needed |
| State | React Query | 🔨 Setup needed |

### 1.3 Current State Analysis

**Completed Modules** (95%):
- ✅ Database schema (11 tables with migrations)
- ✅ Agent CRUD with full REST API
- ✅ Workflow engine with DAG execution
- ✅ Queue workers (workflow + node processors)
- ✅ All node executors (framework complete)
- ✅ Orchestrator (scheduler, webhooks, events)
- ✅ Claude Code adapter (process spawning, session management)
- ✅ Docker-based development environment

**Critical Missing Pieces** (5%):
- ❌ Agent executor → adapter wiring (single file change)
- ❌ MVP UI (3 pages needed)
- ❌ SSE endpoint for real-time updates

---

## 2. Implementation Phases

### Phase Overview

| Phase | Priority | Timeline | Completion Criteria |
|-------|----------|----------|---------------------|
| **Phase 0: MVP Critical Path** | P0 | 2-3 days | Can trigger workflows, watch execution, see results visually |
| **Phase 1: Production Readiness** | P1 | 1 week | Reliable error handling, observability, runtime execution |
| **Phase 2: Feature Expansion** | P2 | 2-3 weeks | Vault, skills rendering, workflow builder UI |
| **Phase 3: Enterprise Features** | P3 | 1-2 months | Full UI design system, WebSockets, multi-tenancy |

---

## Phase 0: MVP Critical Path (P0)

**Goal**: Working product with visual feedback - trigger workflows and watch execution in real-time.

**Timeline**: 2-3 days
**Dependencies**: None (backend is ready)

---

### Task 0.1: Wire Agent Executor to Adapter Registry

**Priority**: 🔴 CRITICAL
**Time**: 2 hours
**File**: `src/queue/workers/executors/agent.executor.ts`
**Current State**: Stubbed with TODO comment at line 32

#### Implementation Steps

1. **Import Dependencies**
   ```typescript
   import { claudeCodeAdapter } from '@/integrations/adapters/claude-code';
   import { db } from '@/db/client';
   import { agents } from '@/db/schema';
   import { eq } from 'drizzle-orm';
   import { logger } from '@/observability/logger';
   import { recordUsage } from '@/observability/cost-tracker';
   ```

2. **Fetch Agent Configuration**
   ```typescript
   const agent = await db.query.agents.findFirst({
     where: eq(agents.id, node.agentId),
   });

   if (!agent) {
     throw new Error(`Agent ${node.agentId} not found`);
   }
   ```

3. **Get Credentials from Vault** (if needed)
   ```typescript
   // For now, assume no credentials needed (will add later)
   // const credentials = await vault.retrieve(agent.integration.connectionId);
   ```

4. **Execute Task with Adapter**
   ```typescript
   const task = {
     prompt: node.input.prompt,
     context: context.state,
     tools: node.input.tools || [],
     constraints: {
       timeout: node.timeout || 300000, // 5 minutes default
     },
   };

   const connection = await claudeCodeAdapter.connect({
     type: 'api-key',
     apiKey: process.env.ANTHROPIC_API_KEY,
   });

   const events = claudeCodeAdapter.execute(connection, task, {});
   ```

5. **Stream Output and Track Usage**
   ```typescript
   let finalResult = null;
   let totalTokens = { input: 0, output: 0 };

   for await (const event of events) {
     switch (event.type) {
       case 'output':
         logger.info('Agent output', { nodeId: node.id, content: event.content });
         break;

       case 'cost':
         totalTokens.input += event.usage.inputTokens;
         totalTokens.output += event.usage.outputTokens;
         break;

       case 'completed':
         finalResult = event.result;
         break;

       case 'error':
         throw event.error;
     }
   }

   // Record usage
   await recordUsage({
     agentId: agent.id,
     workflowRunId: context.workflowRunId,
     provider: 'anthropic',
     model: agent.modelConfig.model,
     inputTokens: totalTokens.input,
     outputTokens: totalTokens.output,
     estimatedCostUsd: claudeCodeAdapter.estimateCost(task).totalUsd,
   });

   await claudeCodeAdapter.disconnect(connection);

   return finalResult;
   ```

#### Acceptance Criteria
- ✅ Can fetch agent config from database
- ✅ Can call Claude Code adapter with task
- ✅ Streams output events to logs
- ✅ Records token usage and costs
- ✅ Returns execution result
- ✅ Handles errors gracefully

#### Testing
```bash
# Create test workflow
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d @test/fixtures/simple-agent-workflow.json

# Trigger execution
curl -X POST http://localhost:3000/api/workflows/{id}/run

# Check logs
make logs-app | grep "Agent output"

# Verify usage records
curl http://localhost:3000/api/costs
```

---

### Task 0.2: Create Backend SSE Endpoint

**Priority**: 🔴 CRITICAL
**Time**: 1 hour
**File**: `src/api/routes/runs.ts`
**Dependencies**: Task 0.1

#### Implementation Steps

1. **Add SSE Route**
   ```typescript
   // GET /api/runs/:id/events - Server-sent events stream
   app.get('/api/runs/:id/events', async (c) => {
     const { id } = c.req.param();

     // Verify run exists
     const run = await db.query.workflowRuns.findFirst({
       where: eq(workflowRuns.id, id),
     });

     if (!run) {
       return c.json({ error: 'Run not found' }, 404);
     }

     // Set SSE headers
     c.header('Content-Type', 'text/event-stream');
     c.header('Cache-Control', 'no-cache');
     c.header('Connection', 'keep-alive');

     const stream = new ReadableStream({
       start(controller) {
         // Subscribe to Redis pub/sub for this run
         const subscriber = createRedisSubscriber();
         subscriber.subscribe(`run:${id}`);

         subscriber.on('message', (channel, message) => {
           const event = JSON.parse(message);
           controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
         });

         // Cleanup on disconnect
         c.req.raw.signal.addEventListener('abort', () => {
           subscriber.unsubscribe();
           subscriber.quit();
           controller.close();
         });
       },
     });

     return new Response(stream);
   });
   ```

2. **Emit Events from Queue Workers**
   ```typescript
   // In workflow.processor.ts and node.processor.ts
   import { redis } from '@/queue/client';

   // When workflow starts
   await redis.publish(`run:${workflowRunId}`, JSON.stringify({
     type: 'run:started',
     runId: workflowRunId,
     timestamp: new Date().toISOString(),
   }));

   // When node starts
   await redis.publish(`run:${workflowRunId}`, JSON.stringify({
     type: 'node:started',
     runId: workflowRunId,
     nodeId: node.id,
     timestamp: new Date().toISOString(),
   }));

   // When node completes
   await redis.publish(`run:${workflowRunId}`, JSON.stringify({
     type: 'node:completed',
     runId: workflowRunId,
     nodeId: node.id,
     result: output,
     timestamp: new Date().toISOString(),
   }));

   // When run completes
   await redis.publish(`run:${workflowRunId}`, JSON.stringify({
     type: 'run:completed',
     runId: workflowRunId,
     result: finalOutput,
     timestamp: new Date().toISOString(),
   }));
   ```

#### Acceptance Criteria
- ✅ SSE endpoint streams events in real-time
- ✅ Events include all workflow/node state changes
- ✅ Connection cleanup on client disconnect
- ✅ Works with multiple concurrent clients

#### Testing
```bash
# Test SSE endpoint with curl
curl -N http://localhost:3000/api/runs/{id}/events

# Should see events streaming:
# data: {"type":"node:started","nodeId":"node1",...}
# data: {"type":"node:completed","nodeId":"node1",...}
```

---

### Task 0.3: MVP Frontend Setup

**Priority**: 🔴 CRITICAL
**Time**: 2-3 hours
**Dependencies**: None (can run parallel with backend)

#### Implementation Steps

1. **Initialize Vite Project**
   ```bash
   cd frontend
   bun create vite . --template react-ts
   bun install
   ```

2. **Install Dependencies**
   ```bash
   bun add react-router-dom @tanstack/react-query
   bun add -D tailwindcss postcss autoprefixer
   bun add -D @tailwindcss/vite
   ```

3. **Configure Tailwind v4**
   ```typescript
   // vite.config.ts
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';
   import tailwindcss from '@tailwindcss/vite';

   export default defineConfig({
     plugins: [react(), tailwindcss()],
     server: {
       port: 5173,
       proxy: {
         '/api': {
           target: 'http://localhost:3000',
           changeOrigin: true,
         },
       },
     },
   });
   ```

4. **Create Directory Structure**
   ```
   frontend/src/
   ├── api/
   │   └── client.ts          # Fetch wrapper
   ├── components/
   │   └── StatusBadge.tsx    # Colored status pill
   ├── pages/
   │   ├── WorkflowsList.tsx  # List all workflows
   │   ├── RunsList.tsx       # Runs for workflow
   │   └── RunDetail.tsx      # Real-time run viewer
   ├── App.tsx                # Router setup
   └── main.tsx               # Entry point
   ```

5. **Create API Client**
   ```typescript
   // src/api/client.ts
   const API_BASE = import.meta.env.VITE_API_URL || '/api';

   export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
     const response = await fetch(`${API_BASE}${path}`, {
       ...options,
       headers: {
         'Content-Type': 'application/json',
         ...options?.headers,
       },
     });

     if (!response.ok) {
       throw new Error(`API error: ${response.statusText}`);
     }

     return response.json();
   }
   ```

#### Acceptance Criteria
- ✅ Vite dev server runs on port 5173
- ✅ Proxy redirects /api to backend
- ✅ Tailwind CSS compiles
- ✅ React Router navigation works

---

### Task 0.4: Implement UI Pages

**Priority**: 🔴 CRITICAL
**Time**: 4-6 hours
**Dependencies**: Task 0.3

#### 0.4.1: Workflows List Page

**File**: `frontend/src/pages/WorkflowsList.tsx`

```typescript
import { useQuery } from '@tanstack/react-query';
import { fetchAPI } from '@/api/client';
import { StatusBadge } from '@/components/StatusBadge';

interface Workflow {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export function WorkflowsList() {
  const { data: workflows, isLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => fetchAPI<Workflow[]>('/workflows'),
  });

  const handleRun = async (workflowId: string) => {
    await fetchAPI(`/workflows/${workflowId}/run`, { method: 'POST' });
    // Navigate to runs list
    window.location.href = `/workflows/${workflowId}/runs`;
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold mb-6">Workflows</h1>

      <table className="w-full">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {workflows?.map(w => (
            <tr key={w.id}>
              <td>{w.name}</td>
              <td>{w.description}</td>
              <td>{new Date(w.createdAt).toLocaleDateString()}</td>
              <td>
                <button onClick={() => handleRun(w.id)}>
                  Run
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

#### 0.4.2: Runs List Page

**File**: `frontend/src/pages/RunsList.tsx`

```typescript
export function RunsList() {
  const { workflowId } = useParams();

  const { data: runs } = useQuery({
    queryKey: ['runs', workflowId],
    queryFn: () => fetchAPI<WorkflowRun[]>(`/workflows/${workflowId}/runs`),
  });

  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold mb-6">Workflow Runs</h1>

      <table className="w-full">
        <thead>
          <tr>
            <th>Status</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Trigger</th>
          </tr>
        </thead>
        <tbody>
          {runs?.map(run => (
            <tr key={run.id} onClick={() => navigate(`/runs/${run.id}`)}>
              <td><StatusBadge status={run.status} /></td>
              <td>{new Date(run.startedAt).toLocaleString()}</td>
              <td>{/* calculate duration */}</td>
              <td>{run.triggerType}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

#### 0.4.3: Run Detail Page with SSE

**File**: `frontend/src/pages/RunDetail.tsx`

```typescript
import { useEffect, useState } from 'react';

export function RunDetail() {
  const { runId } = useParams();
  const [events, setEvents] = useState<Event[]>([]);

  // Initial fetch
  const { data: run } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => fetchAPI<WorkflowRun>(`/runs/${runId}`),
  });

  const { data: nodes } = useQuery({
    queryKey: ['run-nodes', runId],
    queryFn: () => fetchAPI<NodeExecution[]>(`/runs/${runId}/nodes`),
  });

  // SSE connection
  useEffect(() => {
    const eventSource = new EventSource(`/api/runs/${runId}/events`);

    eventSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      setEvents(prev => [...prev, event]);

      // Invalidate queries to refetch
      queryClient.invalidateQueries(['run', runId]);
      queryClient.invalidateQueries(['run-nodes', runId]);
    };

    return () => eventSource.close();
  }, [runId]);

  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold mb-6">Run Detail</h1>

      <div className="mb-8">
        <p><strong>Workflow:</strong> {run?.workflowId}</p>
        <p><strong>Status:</strong> <StatusBadge status={run?.status} /></p>
        <p><strong>Started:</strong> {run?.startedAt}</p>
      </div>

      <h2 className="text-2xl font-bold mb-4">Node Executions</h2>
      <div className="space-y-4">
        {nodes?.map(node => (
          <div key={node.id} className="border p-4 rounded">
            <div className="flex justify-between mb-2">
              <span className="font-bold">{node.nodeId}</span>
              <StatusBadge status={node.status} />
            </div>

            {node.status === 'completed' && (
              <details>
                <summary>Output</summary>
                <pre>{JSON.stringify(node.output, null, 2)}</pre>
              </details>
            )}
          </div>
        ))}
      </div>

      <h2 className="text-2xl font-bold mt-8 mb-4">Live Events</h2>
      <div className="bg-black text-green-400 p-4 font-mono text-sm h-64 overflow-y-auto">
        {events.map((event, i) => (
          <div key={i}>{JSON.stringify(event)}</div>
        ))}
      </div>
    </div>
  );
}
```

#### Acceptance Criteria
- ✅ Can view all workflows
- ✅ Can trigger workflow run
- ✅ Can see runs for a workflow
- ✅ Can view run detail with real-time updates
- ✅ SSE connection shows live events

---

### Task 0.5: End-to-End Testing

**Priority**: 🔴 CRITICAL
**Time**: 2 hours
**Dependencies**: All previous P0 tasks

#### Test Scenarios

1. **Create Test Agent**
   ```bash
   curl -X POST http://localhost:3000/api/agents \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Test Agent",
       "description": "Simple test agent",
       "modelConfig": {
         "provider": "anthropic",
         "model": "claude-sonnet-4-5"
       },
       "tags": ["test"],
       "memoryMode": "stateless",
       "isolationLevel": "shared",
       "canSpawnSubAgents": false,
       "skills": [],
       "allowedMcpTools": []
     }'
   ```

2. **Create Test Workflow**
   ```bash
   curl -X POST http://localhost:3000/api/workflows \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Test Workflow",
       "description": "Simple single-node workflow",
       "nodes": [{
         "id": "node1",
         "type": "agent",
         "name": "Greeting Agent",
         "agentId": "{AGENT_ID}",
         "input": {
           "prompt": "Say hello and list 3 facts about TypeScript"
         }
       }],
       "edges": [],
       "triggers": [{ "type": "manual" }],
       "errorStrategy": {
         "retries": 1,
         "retryDelay": 1000,
         "onFailure": "stop"
       }
     }'
   ```

3. **Trigger from UI**
   - Open http://localhost:5173
   - Navigate to Workflows page
   - Click "Run" on Test Workflow
   - Navigate to run detail
   - Verify real-time updates appear

4. **Verify Outputs**
   - Check node execution shows output
   - Verify cost tracking recorded usage
   - Check logs show agent activity

#### Success Criteria
- ✅ Full workflow execution from UI trigger to completion
- ✅ Real-time updates visible in browser
- ✅ Node outputs stored and displayed
- ✅ Cost tracking records usage
- ✅ No errors in backend or frontend logs

---

## Phase 1: Production Readiness (P1)

**Goal**: Make the system reliable, observable, and production-ready.

**Timeline**: 1 week
**Dependencies**: Phase 0 complete

---

### Task 1.1: Implement Retry and Resume Endpoints

**Priority**: 🟡 HIGH
**Time**: 3 hours
**Files**: `src/api/routes/runs.ts`

#### Implementation

1. **Retry Endpoint**
   ```typescript
   // POST /api/runs/:id/retry
   app.post('/api/runs/:id/retry', async (c) => {
     const { id } = c.req.param();

     const run = await db.query.workflowRuns.findFirst({
       where: eq(workflowRuns.id, id),
     });

     if (!run || run.status !== 'failed') {
       return c.json({ error: 'Can only retry failed runs' }, 400);
     }

     // Create new run with same workflow
     const newRun = await createWorkflowRun({
       workflowId: run.workflowId,
       triggerType: 'manual',
       input: run.input,
     });

     // Enqueue for execution
     await enqueueWorkflow(newRun.id);

     return c.json(newRun, 201);
   });
   ```

2. **Human Review Resume**
   ```typescript
   // POST /api/runs/:id/review
   app.post('/api/runs/:id/review', async (c) => {
     const { id } = c.req.param();
     const { nodeId, decision } = await c.req.json();

     // Find paused node
     const node = await db.query.nodeExecutions.findFirst({
       where: and(
         eq(nodeExecutions.workflowRunId, id),
         eq(nodeExecutions.nodeId, nodeId),
         eq(nodeExecutions.status, 'waiting')
       ),
     });

     if (!node) {
       return c.json({ error: 'Node not in waiting state' }, 400);
     }

     // Resume execution with decision
     await enqueueNode({
       workflowRunId: id,
       nodeId,
       input: { ...node.input, reviewDecision: decision },
     });

     return c.json({ success: true });
   });
   ```

#### Acceptance Criteria
- ✅ Can retry failed workflow runs
- ✅ Can submit human review decisions
- ✅ Retried runs create new execution records
- ✅ Review decisions resume workflow

---

### Task 1.2: Database Log Persistence

**Priority**: 🟡 HIGH
**Time**: 4 hours
**File**: `src/observability/logger.ts`

#### Implementation

1. **Add Log Storage Service**
   ```typescript
   class Logger {
     async log(entry: LogEntry): Promise<void> {
       // Existing console output
       this.writeToConsole(entry);

       // New: Write to database
       await this.writeToDatabase(entry);
     }

     private async writeToDatabase(entry: LogEntry): Promise<void> {
       try {
         await db.insert(logs).values({
           timestamp: entry.timestamp,
           level: entry.level,
           source: entry.source,
           message: entry.message,
           metadata: entry.metadata,
           workflowRunId: entry.workflowRunId,
           agentId: entry.agentId,
           nodeExecutionId: entry.nodeExecutionId,
         });
       } catch (error) {
         // Don't throw - logging failures shouldn't break app
         console.error('Failed to persist log:', error);
       }
     }
   }
   ```

2. **Add Log Rotation**
   ```typescript
   // Daily cron job to delete old logs
   async function cleanupOldLogs() {
     const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

     await db.delete(logs)
       .where(lt(logs.timestamp, thirtyDaysAgo));
   }
   ```

---

### Task 1.3: Runtime Execution Strategies

**Priority**: 🟡 HIGH
**Time**: 8 hours
**Files**: `src/runtime/strategies/*.ts`

#### Implementation

1. **SharedProcessStrategy**
   ```typescript
   export class SharedProcessStrategy implements ExecutionRuntime {
     async execute(task: RuntimeTask): Promise<RuntimeResult> {
       // Execute directly in main process
       const events = task.adapter.execute(
         task.connection,
         task.task,
         { timeout: task.timeout }
       );

       // Collect results
       const outputs = [];
       for await (const event of events) {
         outputs.push(event);
       }

       return { success: true, outputs };
     }
   }
   ```

2. **ProcessIsolationStrategy**
   ```typescript
   export class ProcessIsolationStrategy implements ExecutionRuntime {
     async execute(task: RuntimeTask): Promise<RuntimeResult> {
       // Spawn child process
       const proc = Bun.spawn({
         cmd: ['bun', 'run', 'src/runtime/worker.ts'],
         env: {
           TASK_ID: task.id,
           ADAPTER_TYPE: task.adapter.type,
         },
         ipc: (message) => {
           // Handle IPC messages from worker
         },
       });

       // Monitor process
       const result = await proc.exited;
       return { success: result === 0 };
     }
   }
   ```

---

### Task 1.4: MCP Tool Discovery

**Priority**: 🟡 HIGH
**Time**: 6 hours
**File**: `src/mcp/manager.ts`

#### Implementation

1. **Connect to MCP Server**
   ```typescript
   async function connectToServer(config: MCPServerConfig): Promise<MCPClient> {
     switch (config.transport) {
       case 'stdio':
         return new StdioMCPClient(config.stdio.command, config.stdio.args);

       case 'http':
         return new HttpMCPClient(config.http.url, config.http.headers);

       case 'websocket':
         return new WebSocketMCPClient(config.websocket.url);
     }
   }
   ```

2. **Discover Tools**
   ```typescript
   async function discoverTools(serverId: string): Promise<MCPTool[]> {
     const server = await db.query.mcpServers.findFirst({
       where: eq(mcpServers.id, serverId),
     });

     const client = await connectToServer(server.config);
     const tools = await client.listTools();

     // Store in database
     for (const tool of tools) {
       await db.insert(mcpTools).values({
         serverId,
         name: tool.name,
         description: tool.description,
         inputSchema: tool.inputSchema,
         enabled: true,
         discoveredAt: new Date(),
       });
     }

     // Update last connected
     await db.update(mcpServers)
       .set({ lastConnectedAt: new Date() })
       .where(eq(mcpServers.id, serverId));

     return tools;
   }
   ```

---

## Phase 2: Feature Expansion (P2)

**Goal**: Add missing features for full system capabilities.

**Timeline**: 2-3 weeks
**Dependencies**: Phase 1 complete

### Task 2.1: Vault Service Implementation

**Time**: 6 hours

- Implement store/retrieve/delete methods
- Add OAuth token refresh logic
- Create API endpoints
- Add unit tests

### Task 2.2: Skills Template Rendering

**Time**: 8 hours

- Implement parameter interpolation
- Add Handlebars/Mustache support
- Create skill export/import
- Add built-in skill library

### Task 2.3: Additional Adapters

**Time**: 12 hours

- Codex adapter (OpenAI SDK)
- OpenCode adapter (API integration)
- Local bridge adapter (WebSocket)

### Task 2.4: Workflow Builder UI

**Time**: 16 hours

- Visual DAG editor with drag-drop
- Node configuration panels
- Edge creation/deletion
- Workflow validation

### Task 2.5: Agent Configuration UI

**Time**: 12 hours

- Create/edit agent forms
- Tool selection interface
- Skill assignment
- Preview panel

---

## Phase 3: Enterprise Features (P3)

**Goal**: Complete design system implementation and advanced features.

**Timeline**: 1-2 months
**Dependencies**: Phase 2 complete

### Task 3.1: Full UI Design System

**Time**: 3 weeks

Implement all 14 components and 10 views from `ui-specification.md`:

- Navigation components (Sidebar, NavItem, Account)
- Button variants (Primary, Secondary)
- Data display (Metric Cards, Module Cards)
- Form components (Search, Input, Textarea, Type Selector)
- Modal overlays
- All dashboard views
- Onboarding flow (4 steps)

### Task 3.2: WebSocket Real-time

**Time**: 1 week

- Replace SSE with WebSocket
- Channel-based subscriptions
- Redis pub/sub for scaling
- Connection management

### Task 3.3: Database Configuration UI

**Time**: 1 week

Implement `database-configuration.md` design:

- Config resolver with priority system
- Connection validation
- Settings page UI
- Onboarding integration

### Task 3.4: Multi-tenancy

**Time**: 2 weeks

- User accounts and authentication
- Role-based access control
- Tenant isolation
- Billing/usage tracking per tenant

---

## 7. Testing Strategy

### 7.1 Unit Tests

**Target Coverage**: 80%+

```bash
# Run all tests
bun test

# Watch mode
bun test --watch

# Coverage report
bun test --coverage
```

**Critical Test Areas**:
- Configuration resolution logic
- Queue worker processors
- Node executors
- Adapter implementations
- Validation schemas

### 7.2 Integration Tests

**Files**: `tests/integration/*.test.ts`

- API endpoint CRUD operations
- Workflow execution end-to-end
- Queue job processing
- Database transactions

### 7.3 End-to-End Tests

**Tools**: Playwright for browser testing

- User can create and trigger workflows
- Real-time updates appear correctly
- Error handling shows proper messages
- Navigation works across all pages

---

## 8. Deployment & DevOps

### 8.1 Docker Compose

**Development**:
```bash
make dev              # Start backend + frontend
make dev-all          # Include pgAdmin + redis-commander
make logs             # View all logs
make shell            # Enter backend container
```

**Production**:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### 8.2 Environment Configuration

**Required Variables**:
```bash
DATABASE_URL=postgres://user:pass@host:5432/pluribus
REDIS_URL=redis://host:6379
VAULT_MASTER_KEY=<32-byte-hex-key>
ANTHROPIC_API_KEY=<api-key>
```

### 8.3 Database Migrations

```bash
make db-migrate       # Run migrations
make db-generate      # Generate new migrations
make db-push          # Push schema directly (dev)
make db-studio        # Open Drizzle Studio
```

---

## 9. Quality Gates

### Phase 0 Gate (MVP)

- [ ] Agent executor successfully calls Claude Code adapter
- [ ] SSE endpoint streams events in real-time
- [ ] Frontend displays workflows and runs
- [ ] Can trigger workflow from UI and see execution
- [ ] No critical bugs in core flow

### Phase 1 Gate (Production Ready)

- [ ] Retry and resume endpoints functional
- [ ] Logs persisted to database
- [ ] Runtime isolation strategies implemented
- [ ] MCP tool discovery working
- [ ] Error handling comprehensive

### Phase 2 Gate (Feature Complete)

- [ ] Vault service fully implemented
- [ ] Skills rendering with parameters
- [ ] Additional adapters integrated
- [ ] Workflow builder UI operational
- [ ] Agent config UI complete

### Phase 3 Gate (Enterprise Ready)

- [ ] Full design system implemented
- [ ] WebSocket real-time updates
- [ ] Database configuration UI
- [ ] Multi-tenancy support
- [ ] Production load tested

---

## 10. Risk Mitigation

### Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Adapter integration complexity | High | Medium | Start with Claude Code (already done), add others iteratively |
| SSE connection stability | Medium | Low | Implement reconnection logic, health checks |
| Frontend state management | Medium | Medium | Use React Query for server state, minimize local state |
| Queue worker reliability | High | Low | BullMQ handles retries, add monitoring |

### Schedule Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| MVP takes longer than 3 days | Medium | Tasks are small and well-defined, can parallelize |
| Frontend complexity underestimated | High | MVP UI is intentionally simple, defer polish |
| Integration testing reveals issues | Medium | Test early and often, maintain test fixtures |

---

## Appendix A: File Change Checklist

### Phase 0 Changes

**Backend**:
- [ ] `src/queue/workers/executors/agent.executor.ts` - Wire adapter
- [ ] `src/api/routes/runs.ts` - Add SSE endpoint
- [ ] `src/queue/workers/workflow.processor.ts` - Emit events
- [ ] `src/queue/workers/node.processor.ts` - Emit events

**Frontend**:
- [ ] `frontend/vite.config.ts` - Configure
- [ ] `frontend/src/api/client.ts` - Create
- [ ] `frontend/src/components/StatusBadge.tsx` - Create
- [ ] `frontend/src/pages/WorkflowsList.tsx` - Create
- [ ] `frontend/src/pages/RunsList.tsx` - Create
- [ ] `frontend/src/pages/RunDetail.tsx` - Create
- [ ] `frontend/src/App.tsx` - Router setup

### Phase 1 Changes

- [ ] `src/api/routes/runs.ts` - Add retry/resume
- [ ] `src/observability/logger.ts` - Add DB persistence
- [ ] `src/runtime/strategies/shared.ts` - Implement
- [ ] `src/runtime/strategies/process.ts` - Implement
- [ ] `src/mcp/manager.ts` - Add discovery
- [ ] `src/mcp/client.ts` - Implement

---

## Appendix B: API Endpoint Reference

### Core Endpoints

| Method | Path | Phase | Description |
|--------|------|-------|-------------|
| GET | `/api/agents` | ✅ Done | List agents |
| POST | `/api/agents` | ✅ Done | Create agent |
| GET | `/api/workflows` | ✅ Done | List workflows |
| POST | `/api/workflows` | ✅ Done | Create workflow |
| POST | `/api/workflows/:id/run` | ✅ Done | Trigger workflow |
| GET | `/api/runs/:id` | ✅ Done | Get run details |
| GET | `/api/runs/:id/nodes` | ✅ Done | Get node executions |
| GET | `/api/runs/:id/events` | 🔨 P0 | SSE stream |
| POST | `/api/runs/:id/retry` | 🔨 P1 | Retry failed run |
| POST | `/api/runs/:id/review` | 🔨 P1 | Submit review decision |
| GET | `/api/mcp/servers` | ✅ Done | List MCP servers |
| POST | `/api/mcp/servers` | ✅ Done | Add MCP server |
| POST | `/api/mcp/servers/:id/discover` | 🔨 P1 | Discover tools |
| GET | `/api/skills` | ✅ Done | List skills |
| GET | `/api/costs` | ✅ Done | Get cost summary |
| GET | `/api/logs` | ✅ Done | Query logs |

---

## Appendix C: Component Architecture

### Backend Module Structure

```
src/
├── api/               # Hono REST API
│   ├── routes/       # Endpoint definitions
│   └── middleware/   # Error handler, validation
├── core/             # Domain logic
│   ├── agents/       # Agent registry (✅ Complete)
│   ├── workflows/    # Workflow engine (✅ 90%)
│   └── orchestrator/ # Scheduling (✅ Complete)
├── integrations/     # External adapters
│   ├── adapter.ts    # Base interface (✅ Complete)
│   └── adapters/
│       └── claude-code.ts  # Claude adapter (✅ Ready)
├── mcp/              # MCP server/tool management
├── skills/           # Skill templates
├── runtime/          # Execution isolation
├── observability/    # Logging, tracing, costs
├── vault/            # Credential encryption
├── db/               # Schema, migrations (✅ Complete)
├── queue/            # BullMQ queues (✅ Ready)
└── lib/              # Config, errors, utils
```

### Frontend Component Structure

```
frontend/src/
├── api/              # API client
├── components/       # Reusable UI components
├── pages/            # Page components
├── hooks/            # Custom React hooks
├── lib/              # Utilities
└── types/            # TypeScript types
```

---

## Conclusion

This implementation workflow provides a structured path from the current 95% complete state to a fully functional MVP in 2-3 days, followed by production readiness and feature expansion phases.

**Next Steps**:
1. Review and approve this workflow
2. Begin Phase 0 Task 0.1 (Agent Executor Wiring)
3. Execute tasks sequentially with validation at each step
4. Use `/sc:implement` for individual task implementation guidance

**Key Success Metrics**:
- Phase 0: Working MVP with visual workflow execution
- Phase 1: Production-ready with reliability and observability
- Phase 2: Feature-complete with all core capabilities
- Phase 3: Enterprise-ready with full design system

**Remember**: This is a **plan only** - no code execution. Use `/sc:implement` to execute specific tasks from this workflow.

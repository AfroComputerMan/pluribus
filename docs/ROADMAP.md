# Pluribus Implementation Roadmap

**Last Updated**: 2026-01-24
**Status**: Active Development

---

## Implementation Status Overview

| Module | Status | Completeness | Priority |
|--------|--------|--------------|----------|
| [Agents](#agents-module) | **Complete** | 95% | - |
| [Workflows](#workflows-module) | **Partial** | 40% | P0 |
| [Orchestrator](#orchestrator-module) | **Not Started** | 0% | P0 |
| [Queue Workers](#queue-workers) | **Not Started** | 0% | P0 |
| [Runtime Execution](#runtime-execution) | **Stub Only** | 10% | P1 |
| [Integrations](#integrations) | **Framework Only** | 15% | P1 |
| [MCP](#mcp-module) | **Partial** | 60% | P1 |
| [Skills](#skills-module) | **Partial** | 60% | P2 |
| [Observability](#observability-module) | **Partial** | 70% | P2 |
| [Vault](#vault-module) | **Partial** | 65% | P2 |
| [Frontend UI](#frontend-ui) | **Design Only** | 0% | P3 |
| [WebSocket](#websocket-real-time) | **Not Started** | 0% | P3 |
| [Database Configuration](#database-configuration) | **Not Started** | 0% | P3 |

---

## Module Details

### Agents Module
**Status: Complete** | **Location**: `src/core/agents/`

#### Implemented
- [x] Type definitions (`types.ts`)
- [x] Zod validation schemas (`schemas.ts`)
- [x] Service layer (`service.ts`)
- [x] Repository layer (`repository.ts`)
- [x] Full CRUD API endpoints
- [x] Tag filtering with PostgreSQL array containment
- [x] Full-text search on name/description
- [x] Pagination (limit/offset)
- [x] Tag statistics endpoints
- [x] Integration tests
- [x] Unit tests for schemas

#### Not Implemented
- [ ] Agent versioning
- [ ] Agent templates/cloning

---

### Workflows Module
**Status: Partial** | **Location**: `src/core/workflows/`

#### Implemented
- [x] Type definitions for all node types (`types.ts`)
  - AgentNode, ConditionNode, ParallelNode, LoopNode, HumanReviewNode
- [x] Workflow trigger types (manual, schedule, webhook, api)
- [x] Error strategy definitions (retries, fallback)
- [x] Zod validation schemas (`schemas.ts`)
- [x] Database tables (workflows, workflowRuns, nodeExecutions)
- [x] CRUD API endpoints for workflows
- [x] Run creation endpoint (`POST /api/workflows/:id/run`)
- [x] Integration tests for CRUD

#### Not Implemented (Critical Path)
- [ ] **Workflow Service** - business logic layer
- [ ] **Workflow Repository** - data access layer
- [ ] **DAG Execution Engine**
  - [ ] DAG traversal algorithm
  - [ ] Node dependency resolution
  - [ ] Input/output mapping between nodes
  - [ ] Parallel branch coordination
  - [ ] Join strategies (all/any/race)
- [ ] **Node Executors**
  - [ ] AgentNode executor (calls runtime)
  - [ ] ConditionNode evaluator (expression evaluation)
  - [ ] ParallelNode coordinator
  - [ ] LoopNode iterator
  - [ ] HumanReviewNode approval handler
- [ ] **Error Handling**
  - [ ] Retry logic implementation
  - [ ] Fallback node execution
  - [ ] onFailure callbacks
- [ ] **State Management**
  - [ ] Workflow context/state persistence
  - [ ] Checkpoint/resume capabilities
- [ ] Run retry endpoint (`POST /api/runs/:id/retry` - has TODO)
- [ ] Human review approval (`POST /api/runs/:id/review` - has TODO)

---

### Orchestrator Module
**Status: Not Started** | **Location**: `src/core/orchestrator/` (does not exist)

#### Not Implemented
- [ ] **Module Creation** - directory and file structure
- [ ] **Schedule Trigger Service**
  - [ ] Cron expression parsing
  - [ ] Schedule registration/deregistration
  - [ ] Next run calculation
- [ ] **Webhook Trigger Service**
  - [ ] Webhook endpoint receiver
  - [ ] Signature validation
  - [ ] Payload parsing and workflow matching
- [ ] **Event Bus**
  - [ ] Internal event pub/sub
  - [ ] Event-to-workflow mapping
- [ ] **Trigger Management API**
  - [ ] CRUD for triggers
  - [ ] Trigger enable/disable
  - [ ] Trigger history

---

### Queue Workers
**Status: Not Started** | **Location**: `src/queue/`

#### Implemented
- [x] Redis connection setup
- [x] BullMQ queue instances (workflow, node, schedule)
- [x] Job data type definitions
- [x] Enqueue helper functions
- [x] Retry configuration (exponential backoff)
- [x] Graceful shutdown

#### Not Implemented (Critical Path)
- [ ] **Workflow Queue Processor**
  - [ ] Job handler registration
  - [ ] Workflow initialization
  - [ ] First node(s) enqueuing
  - [ ] Run status updates
- [ ] **Node Queue Processor**
  - [ ] Node executor dispatch
  - [ ] Output capture and storage
  - [ ] Downstream node enqueuing
  - [ ] Error handling and retry
- [ ] **Schedule Queue Processor**
  - [ ] Cron job handler
  - [ ] Repeatable job management
  - [ ] Missed run handling
- [ ] **Event Listeners**
  - [ ] Job completed handler
  - [ ] Job failed handler
  - [ ] Job stalled detection
- [ ] **Monitoring**
  - [ ] Queue metrics (depth, latency)
  - [ ] Dead letter queue handling
  - [ ] Job progress tracking

---

### Runtime Execution
**Status: Stub Only** | **Location**: `src/runtime/`

#### Implemented
- [x] Type definitions (`types.ts`)
  - IsolationLevel (shared, process, container)
  - ResourceLimits interface
  - RuntimeTask and RuntimeResult
  - ExecutionRuntime interface
  - IsolationStrategy interface

#### Not Implemented
- [ ] **SharedProcessStrategy**
  - [ ] In-process execution
  - [ ] Resource tracking
- [ ] **ProcessIsolationStrategy**
  - [ ] Child process spawning
  - [ ] IPC communication
  - [ ] Process cleanup
- [ ] **ContainerIsolationStrategy**
  - [ ] Docker SDK integration
  - [ ] Container lifecycle management
  - [ ] Volume mounts for workspace
  - [ ] Network isolation
- [ ] **Resource Enforcement**
  - [ ] Memory limit enforcement
  - [ ] CPU quota enforcement
  - [ ] Timeout enforcement
- [ ] **Event Streaming**
  - [ ] Async generator for execution events
  - [ ] Real-time output streaming
- [ ] **RuntimeManager**
  - [ ] Strategy selection based on config
  - [ ] Fallback handling

---

### Integrations
**Status: Framework Only** | **Location**: `src/integrations/`

#### Implemented
- [x] Type definitions (`types.ts`)
  - AgentAdapter interface
  - Credential types (OAuth, API key)
  - Task and result types
  - Execution events (8 types)
  - Cost estimation interface
- [x] AdapterRegistry singleton (`registry.ts`)
- [x] Unit tests for registry

#### Not Implemented
- [ ] **Claude Code Adapter**
  - [ ] Process spawning (`claude` CLI)
  - [ ] Session management
  - [ ] Streaming output capture
  - [ ] Tool call handling
- [ ] **Codex Adapter**
  - [ ] OpenAI API integration
  - [ ] Codex-specific prompting
- [ ] **OpenCode Adapter**
  - [ ] OpenCode CLI integration
- [ ] **Local Bridge Adapter**
  - [ ] Local script execution
  - [ ] Custom tool integration
- [ ] **Adapter Lifecycle**
  - [ ] Connection pooling
  - [ ] Health checks
  - [ ] Automatic reconnection
- [ ] **Cost Tracking Integration**
  - [ ] Token counting
  - [ ] Cost estimation hooks

---

### MCP Module
**Status: Partial** | **Location**: `src/mcp/`

#### Implemented
- [x] Type definitions (`types.ts`)
- [x] Zod schemas (`schemas.ts`)
- [x] Database tables (mcpServers, mcpTools)
- [x] Full CRUD API for MCP servers
- [x] Tool enable/disable API
- [x] Integration tests

#### Not Implemented
- [ ] **MCP Client Implementation**
  - [ ] Stdio transport connection
  - [ ] HTTP transport connection
  - [ ] WebSocket transport connection
- [ ] **Tool Discovery**
  - [ ] Connect to MCP server
  - [ ] Call tools/list
  - [ ] Parse and store tool schemas
  - [ ] Update lastConnectedAt
  - [ ] Handle discovery errors
- [ ] **Tool Execution**
  - [ ] Tool call dispatch
  - [ ] Input validation against schema
  - [ ] Result capture
  - [ ] Timeout handling
- [ ] **Server Scanning** (`POST /api/mcp/scan` - has TODO)
  - [ ] Network/system scanning for MCP servers
- [ ] **Health Monitoring**
  - [ ] Periodic health checks
  - [ ] Auto-reconnection
  - [ ] Status updates

---

### Skills Module
**Status: Partial** | **Location**: `src/skills/`

#### Implemented
- [x] Type definitions (`types.ts`)
- [x] Zod schemas (`schemas.ts`)
- [x] Database table (skills)
- [x] Full CRUD API
- [x] Tag filtering
- [x] Integration tests

#### Not Implemented
- [ ] **Skill Service Layer** - missing service/repository pattern
- [ ] **Template Rendering Engine**
  - [ ] Parameter interpolation
  - [ ] Handlebars/Mustache support
  - [ ] Default value handling
- [ ] **Skill Import/Export**
  - [ ] JSON/YAML export format
  - [ ] Import validation
  - [ ] Conflict resolution
- [ ] **Skill Versioning**
  - [ ] Version tracking
  - [ ] Rollback support
- [ ] **Builtin Skills**
  - [ ] Default skill library
  - [ ] Skill categories

---

### Observability Module
**Status: Partial** | **Location**: `src/observability/`

#### Implemented
- [x] Type definitions (`types.ts`)
- [x] Logger class with structured logging
- [x] Child loggers with context
- [x] Console output formatting
- [x] Database tables (logs, usageRecords)
- [x] Log query API
- [x] Cost summary API
- [x] Dashboard metrics API
- [x] Unit tests for logger

#### Not Implemented
- [ ] **Database Log Persistence** (TODO in logger.ts:60)
  - [ ] Log storage service
  - [ ] Async log writing
  - [ ] Log rotation/retention
- [ ] **Distributed Tracing**
  - [ ] Trace/span creation
  - [ ] Context propagation
  - [ ] OpenTelemetry export
- [ ] **Metrics Collection**
  - [ ] Counter/gauge/histogram recording
  - [ ] Prometheus export
- [ ] **Cost Tracking**
  - [ ] Workflow cost aggregation (TODO in observability.ts:150)
  - [ ] Real-time cost estimation
  - [ ] Budget alerts
- [ ] **Alerting**
  - [ ] Error rate alerts
  - [ ] Cost threshold alerts
  - [ ] Notification dispatch

---

### Vault Module
**Status: Partial** | **Location**: `src/vault/`

#### Implemented
- [x] Type definitions (`types.ts`)
- [x] AES-256-GCM encryption (`crypto.ts`)
- [x] Per-credential key derivation
- [x] Database table (credentials)
- [x] Comprehensive crypto tests

#### Not Implemented
- [ ] **Vault Service**
  - [ ] Store credential (encrypt + persist)
  - [ ] Retrieve credential (fetch + decrypt)
  - [ ] Delete credential
  - [ ] List credentials (metadata only)
- [ ] **Vault Repository**
  - [ ] Database operations
- [ ] **Vault API Endpoints**
  - [ ] `POST /api/credentials` - store
  - [ ] `GET /api/credentials/:id` - retrieve
  - [ ] `DELETE /api/credentials/:id` - delete
  - [ ] `GET /api/credentials` - list metadata
- [ ] **OAuth Token Management**
  - [ ] Token refresh logic
  - [ ] Expiration tracking
- [ ] **Key Rotation**
  - [ ] Master key rotation
  - [ ] Re-encryption of existing credentials
- [ ] **Audit Logging**
  - [ ] Access logging
  - [ ] Change tracking

---

### Frontend UI
**Status: Design Only** | **Location**: None (not yet created)

Design specification complete in `docs/ui-specification.md`.

#### Design Assets (Complete)
- [x] Design system (colors, typography, layout)
- [x] 14 reusable component specifications
- [x] 10 view/screen layouts
- [x] 4-step onboarding flow
- [x] API endpoint mapping per view

#### Not Implemented

- [ ] **Project Setup**
  - [ ] Next.js project initialization
  - [ ] Tailwind CSS with design tokens
  - [ ] Component library setup (shadcn/ui or custom)
- [ ] **Design System Implementation**
  - [ ] Color tokens CSS variables
  - [ ] Typography (Oswald, JetBrains Mono)
  - [ ] Layout constants
- [ ] **Reusable Components**
  - [ ] Sidebar navigation
  - [ ] Button (primary/secondary)
  - [ ] Metric cards (primary/secondary)
  - [ ] Card container
  - [ ] Module card
  - [ ] Search input
  - [ ] Input field / Textarea
  - [ ] Type selector
  - [ ] Modal overlay
  - [ ] Section header
  - [ ] Nav items (active/inactive)
  - [ ] Account section
- [ ] **Views/Pages**
  - [ ] Dashboard (`/`) - Command center overview
  - [ ] Agent Detail (`/agents/:id`) - Individual agent view
  - [ ] Agent Graph (`/graph`) - Multi-agent visualization
  - [ ] Agent Config (`/agents/new`) - Create/edit agent
  - [ ] Skills Hub (`/skills`) - Skills & MCP tools
  - [ ] Repos View (`/repos`) - Connected repositories
  - [ ] Tools View (`/tools`) - Available tools browser
  - [ ] Modules Hub (`/modules`) - Installed modules
  - [ ] Module Detail (`/modules/:id`) - Module configuration
  - [ ] Create Module Modal
- [ ] **Onboarding Flow**
  - [ ] Welcome page (`/onboarding`)
  - [ ] Provider connection (`/onboarding/providers`)
  - [ ] MCP configuration (`/onboarding/mcp`)
  - [ ] Review & complete (`/onboarding/review`)
- [ ] **State Management**
  - [ ] API client setup
  - [ ] React Query / SWR for data fetching
  - [ ] Global state (Zustand / Context)
- [ ] **Real-time Features**
  - [ ] WebSocket connection hook
  - [ ] Agent output streaming
  - [ ] Graph node updates
  - [ ] Activity feed
  - [ ] Cost updates

---

### WebSocket Real-time
**Status: Not Started** | **Location**: `src/api/` (to be created)

Defined in `docs/architecture.md` section 10.4.

#### Not Implemented

- [ ] **WebSocket Server**
  - [ ] Bun WebSocket setup
  - [ ] Connection management
  - [ ] Authentication/authorization
- [ ] **Channels**
  - [ ] `agent:{agentId}` - Agent output streaming
  - [ ] `runs:{runId}` - Workflow node updates
  - [ ] `activity` - Dashboard activity feed
  - [ ] `costs` - Real-time cost updates
- [ ] **Events**
  - [ ] `output` - Agent output chunk
  - [ ] `status` - Agent status change
  - [ ] `node:started` - Node execution started
  - [ ] `node:output` - Node output
  - [ ] `node:completed` - Node finished
  - [ ] `run:started` - Workflow run started
  - [ ] `run:completed` - Workflow run finished
  - [ ] `cost:update` - Cost metric update
- [ ] **Integration**
  - [ ] Hook into queue workers for events
  - [ ] Redis pub/sub for multi-instance support

---

### Database Configuration
**Status: Not Started** | **Location**: `src/lib/config.ts`, Frontend

User-configurable system database connections with dual-mode support.

#### Design Goals
- **Self-hosted flexibility**: Users bring their own PostgreSQL/Redis instances
- **Simple development**: Developers configure via environment variables
- **Migration path**: Start with Docker defaults, migrate to managed services later

#### Configuration Priority
```
1. Environment variables (DATABASE_URL, REDIS_URL) - highest
2. UI-configured settings (stored in local config file)
3. Default values (localhost Docker containers) - lowest
```

#### Implemented
- [x] Environment variable support (`DATABASE_URL`, `REDIS_URL`)
- [x] Zod-validated config in `src/lib/config.ts`

#### Not Implemented

- [ ] **Config Storage** (chicken-egg problem)
  - [ ] Local config file for UI settings (`~/.pluribus/config.json` or similar)
  - [ ] Config file read at startup before DB connection
  - [ ] Secure storage for connection strings
- [ ] **Backend API**
  - [ ] `GET /api/config/database` - Get current config (masked passwords)
  - [ ] `PUT /api/config/database` - Update config (validates first)
  - [ ] `POST /api/config/database/test` - Test connection without saving
  - [ ] `GET /api/config/database/status` - Health check with latency
- [ ] **Connection Validation**
  - [ ] PostgreSQL: parse URL, connect, version check (14+), write test
  - [ ] Redis: parse URL, PING, version check (6+), SET/GET test
  - [ ] 10-second timeout on all validation
  - [ ] Return latency measurements
- [ ] **Onboarding Integration**
  - [ ] New step: `/onboarding/database`
  - [ ] Option: "Use Docker (Default)" vs "External DB"
  - [ ] Connection form with test button
  - [ ] Visual connection status indicator
- [ ] **Settings Page**
  - [ ] Database configuration section
  - [ ] Show current connection (masked)
  - [ ] Health status and latency display
  - [ ] Edit modal with validation
  - [ ] Indicator when env vars override UI
- [ ] **Migration Support** (optional)
  - [ ] Export data from current DB
  - [ ] Import data to new DB
  - [ ] Validation before switchover

#### UI Behavior: Env Var Override
When `DATABASE_URL` or `REDIS_URL` is set via environment:
- Show "Configured via environment variable" notice
- Display connection info (read-only)
- Disable edit controls
- Still show health status

#### Security Requirements
- [ ] Never log connection strings in plaintext
- [ ] Mask passwords in UI (`postgres://user:****@host`)
- [ ] Encrypt stored connection strings (use Vault)
- [ ] Validate SSL/TLS certificates option

---

## Implementation Priority

### P0 - Critical Path (Enables Core Functionality)

These must be completed for workflows to actually execute:

1. **Queue Workers** - Nothing processes jobs currently
2. **Workflow Execution Engine** - DAG traversal and node coordination
3. **Orchestrator** - Triggers and scheduling

### P1 - Core Features

Required for production use:

4. **Runtime Execution** - Agent isolation strategies
5. **Integrations** - At least one adapter (Claude Code)
6. **MCP Client** - Tool discovery and execution

### P2 - Enhancement

Improve usability and reliability:

7. **Vault Service** - Credential management API
8. **Observability** - Full logging and tracing
9. **Skills** - Template rendering

### P3 - User Interface & Configuration

Required for end-user interaction:

10. **Frontend UI** - Next.js application with all views
11. **WebSocket Real-time** - Live updates and streaming
12. **Onboarding Flow** - First-run user setup
13. **Database Configuration** - User-configurable PostgreSQL/Redis connections

---

## Known TODOs in Code

| File | Line | Description |
|------|------|-------------|
| `src/api/routes/runs.ts` | 132 | Enqueue new run for execution |
| `src/api/routes/runs.ts` | 164 | Resume workflow execution |
| `src/api/routes/mcp.ts` | 121 | Implement MCP tool discovery |
| `src/api/routes/mcp.ts` | 189 | Implement MCP server scanning |
| `src/observability/logger.ts` | 60 | Store logs in database |
| `src/api/routes/observability.ts` | 150 | Workflow cost aggregation |

---

## Architecture Notes

### Execution Flow (Target State)

```
User triggers workflow
        │
        ▼
┌─────────────────┐
│   API Handler   │ POST /api/workflows/:id/run
└────────┬────────┘
         │ Creates workflowRun record
         │ Calls enqueueWorkflow()
         ▼
┌─────────────────┐
│ Workflow Queue  │ BullMQ
└────────┬────────┘
         │ Job picked up by worker
         ▼
┌─────────────────┐
│Workflow Processor│ (NOT IMPLEMENTED)
└────────┬────────┘
         │ Resolves DAG, finds ready nodes
         │ Enqueues node jobs
         ▼
┌─────────────────┐
│   Node Queue    │ BullMQ
└────────┬────────┘
         │ Job picked up by worker
         ▼
┌─────────────────┐
│ Node Processor  │ (NOT IMPLEMENTED)
└────────┬────────┘
         │ Dispatches to appropriate executor
         ▼
┌─────────────────┐
│  Node Executor  │ (NOT IMPLEMENTED)
│ • AgentNode     │──▶ Runtime + Adapter
│ • ConditionNode │──▶ Expression Evaluator
│ • ParallelNode  │──▶ Branch Coordinator
│ • LoopNode      │──▶ Iterator
│ • HumanReview   │──▶ Approval Wait
└─────────────────┘
```

### Service Pattern

Each domain should follow this structure:

```
src/core/{domain}/
├── types.ts       # TypeScript interfaces
├── schemas.ts     # Zod validation schemas
├── service.ts     # Business logic (thin layer)
├── repository.ts  # Database operations
└── index.ts       # Public exports
```

Currently missing service/repository for: workflows, skills, vault.

---

## Next Steps

### Backend (P0-P2)
1. Create `src/queue/workers/` directory
2. Implement `WorkflowProcessor` class
3. Implement `NodeProcessor` class with executor dispatch
4. Create `src/core/orchestrator/` module
5. Add at least one integration adapter (Claude Code)
6. Wire up MCP client for tool discovery

### Frontend (P3)
7. Initialize Next.js project (separate repo or monorepo)
8. Implement design system (CSS tokens, fonts)
9. Build reusable component library
10. Create Dashboard and Agent views
11. Add WebSocket client for real-time updates
12. Implement onboarding flow (including database setup step)

### Configuration (P3)
13. Create local config file storage (`~/.pluribus/config.json`)
14. Add database configuration API endpoints
15. Implement connection validation (PostgreSQL/Redis)
16. Add Settings page database section
17. Handle env var override indicator in UI

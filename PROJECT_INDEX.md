# Project Index: Pluribus

Generated: 2026-01-30

## Overview

**Pluribus** is an Agent Organization System - a backend for orchestrating AI agents, workflows, and MCP (Model Context Protocol) tools. Built with Bun/TypeScript, it provides REST APIs, WebSocket support, and job queuing for managing complex agent interactions.

**Status**: Active Development - MVP complete (backend 100%, frontend MVP done)

---

## Project Structure

```
pluribus/
├── src/                    # Backend source (Bun/TypeScript)
│   ├── api/                # Hono routes and middleware
│   │   ├── routes/         # REST endpoints (8 route files)
│   │   └── middleware/     # Error handler, validation
│   ├── core/               # Domain logic
│   │   ├── agents/         # Agent registry (CRUD, tags)
│   │   ├── workflows/      # DAG workflow engine
│   │   └── orchestrator/   # Scheduling, webhooks, events
│   ├── db/                 # PostgreSQL + Drizzle ORM
│   ├── queue/              # BullMQ workers
│   │   └── workers/        # Workflow/node processors
│   │       └── executors/  # 5 node type executors
│   ├── integrations/       # Claude Code adapter
│   ├── mcp/                # MCP server/tool management
│   ├── skills/             # Skill/prompt templates
│   ├── runtime/            # Execution isolation (stub)
│   ├── vault/              # AES-256-GCM encryption
│   ├── observability/      # Logging, cost tracking
│   └── lib/                # Config, errors, utilities
├── frontend/               # React 19 + Vite + TailwindCSS v4
│   └── src/
│       ├── api/            # Type-safe API client
│       ├── components/     # UI components + workflow nodes
│       ├── pages/          # 4 page components
│       ├── hooks/          # SSE hooks
│       └── stores/         # Zustand state
├── docs/                   # Architecture, specs, PDCA cycles
└── docker-compose.yml      # Dev environment
```

---

## Entry Points

| Entry Point | Path | Description |
|-------------|------|-------------|
| Backend Server | `src/index.ts` | Bun HTTP server on port 3000 |
| Frontend App | `frontend/src/main.tsx` | React app entry |
| DB Migrations | `src/db/migrate.ts` | Drizzle migration runner |
| DB Seed | `src/db/seed.ts` | Sample data seeder |

---

## Core Modules

### Backend API Routes (`src/api/routes/`)
- **agents.ts** - CRUD + tag filtering, search
- **workflows.ts** - Workflow CRUD + run trigger
- **runs.ts** - Run management + SSE events endpoint
- **orchestrator.ts** - Scheduler, webhooks
- **mcp.ts** - MCP server/tool management
- **skills.ts** - Skill templates CRUD
- **vault.ts** - Credential storage
- **observability.ts** - Logs, metrics, dashboard

### Workflow Engine (`src/core/workflows/` + `src/queue/`)
- **DAG execution** with topological sorting
- **5 node types**: Agent, Condition, Parallel, Loop, HumanReview
- **BullMQ queues**: workflow, node, schedule
- **Error strategies**: retry, fallback, human-review

### Node Executors (`src/queue/workers/executors/`)
- **agent.executor.ts** - Claude Code adapter integration
- **condition.executor.ts** - Expression evaluation
- **parallel.executor.ts** - Branch coordination
- **loop.executor.ts** - Iteration logic
- **human-review.executor.ts** - Approval wait

### Integrations (`src/integrations/`)
- **Claude Code Adapter** - Process spawning, session management
- **AdapterRegistry** - Plugin system for AI providers

### Frontend Pages (`frontend/src/pages/`)
- **WorkflowsPage** - List all workflows, trigger runs
- **WorkflowRunsPage** - Runs for a workflow
- **RunDetailPage** - Real-time execution view with SSE
- **WorkflowBuilderPage** - Visual DAG editor (React Flow)

### Frontend Components (`frontend/src/components/`)
- **Layout.tsx** - App shell with navigation
- **DataTable.tsx** - Sortable/filterable tables
- **StatusBadge.tsx** - Colored status pills
- **JsonViewer.tsx** - Collapsible JSON display
- **workflow/WorkflowCanvas.tsx** - React Flow canvas
- **workflow/NodePalette.tsx** - Drag-and-drop node palette
- **workflow/nodes/** - 5 custom node components

---

## Database Schema

11 tables with UUID PKs, timezone-aware timestamps:

| Table | Purpose |
|-------|---------|
| `agents` | AI agent configurations |
| `workflows` | DAG definitions (nodes, edges, triggers) |
| `workflow_runs` | Execution instances |
| `node_executions` | Per-node execution records |
| `mcp_servers` | MCP server connections |
| `mcp_tools` | Discovered MCP tools |
| `skills` | Prompt/behavior templates |
| `credentials` | Encrypted secrets (AES-256-GCM) |
| `logs` | Structured logs |
| `scheduled_triggers` | Cron schedules |
| `webhook_triggers` | Webhook endpoints |
| `usage_records` | Token/cost tracking |

---

## Key Dependencies

### Backend
| Package | Version | Purpose |
|---------|---------|---------|
| hono | ^4.6.0 | Web framework |
| drizzle-orm | ^0.38.0 | Type-safe ORM |
| bullmq | ^5.20.0 | Job queue |
| ioredis | ^5.4.0 | Redis client |
| @anthropic-ai/sdk | ^0.30.0 | Claude API |
| zod | ^3.23.0 | Runtime validation |

### Frontend
| Package | Version | Purpose |
|---------|---------|---------|
| react | ^19.2.0 | UI framework |
| @xyflow/react | ^12.10.0 | Workflow canvas |
| @tanstack/react-query | ^5.90.20 | Data fetching |
| zustand | ^5.0.10 | State management |
| tailwindcss | ^4.1.18 | Styling |
| react-router-dom | ^7.13.0 | Routing |

---

## Development Commands

```bash
# Docker-based (recommended)
make dev              # Backend + frontend (ports 3000, 5173)
make dev-all          # + pgAdmin (8082) + redis-commander (8081)
make stop             # Stop all containers

# Database
make db-migrate       # Run migrations
make db-push          # Push schema (dev only)
make db-studio        # Drizzle Studio UI
make db-seed          # Seed sample data

# Testing
make test             # Run all tests
make test-watch       # Watch mode
bun test path/to/file # Single file

# Quality
make lint             # Biome linter
make format           # Code formatting
make typecheck        # TypeScript checking

# Frontend
make frontend-dev     # Local frontend
make frontend-build   # Production build
make frontend-lint    # ESLint
```

---

## API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Service health check |
| GET/POST | `/api/agents` | List/create agents |
| GET/PUT/DELETE | `/api/agents/:id` | Agent CRUD |
| GET/POST | `/api/workflows` | List/create workflows |
| GET/PUT/DELETE | `/api/workflows/:id` | Workflow CRUD |
| POST | `/api/workflows/:id/run` | Trigger workflow |
| GET | `/api/runs/:id` | Run details |
| GET | `/api/runs/:id/nodes` | Node executions |
| GET | `/api/runs/:id/events` | SSE real-time stream |
| GET/POST | `/api/mcp/servers` | MCP server management |
| GET/POST | `/api/skills` | Skill templates |
| POST | `/api/orchestrator/webhooks/:id` | Webhook trigger |
| GET | `/api/observability/logs` | Log queries |
| GET | `/api/observability/costs` | Usage/cost tracking |
| GET | `/api/observability/dashboard` | Metrics dashboard |

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `REDIS_URL` | Yes | Redis connection |
| `VAULT_MASTER_KEY` | Yes | Encryption key (32+ chars) |
| `PORT` | No | Server port (default: 3000) |
| `LOG_LEVEL` | No | debug/info/warn/error |
| `ANTHROPIC_API_KEY` | No | Anthropic API access |
| `OPENAI_API_KEY` | No | OpenAI API access |

---

## Configuration Files

| File | Purpose |
|------|---------|
| `bunfig.toml` | Bun configuration |
| `docker-compose.yml` | Development environment |
| `docker-compose.prod.yml` | Production setup |
| `Makefile` | Development commands |
| `biome.json` | Backend linter/formatter |
| `frontend/vite.config.ts` | Vite + API proxy |
| `frontend/eslint.config.js` | Frontend linting |
| `.serena/project.yml` | Serena MCP config |

---

## Code Patterns

- **Path Aliases**: Backend uses `@/` prefix (`@/core/agents`, `@/db/schema`)
- **Service Pattern**: `types.ts` → `schemas.ts` → `service.ts` → `repository.ts`
- **API Validation**: Zod schemas for all inputs
- **Logging**: Structured JSON with correlation IDs via `logger.child('module:name')`
- **Style**: Single quotes, semicolons, 2-space indent, 100-char width

---

## Implementation Status

| Module | Status | Completeness |
|--------|--------|--------------|
| Agents | **Complete** | 100% |
| Workflows | **Complete** | 100% |
| Orchestrator | **Complete** | 100% |
| Queue Workers | **Complete** | 100% |
| Integrations | **Complete** | 100% |
| MVP UI | **Complete** | 100% |
| Workflow Builder | **Complete** | 100% |
| Runtime Execution | **Stub Only** | 10% |
| MCP | **Partial** | 60% |
| Observability | **Partial** | 70% |
| Skills | **Partial** | 60% |
| Vault | **Partial** | 65% |

**Backend**: 100% complete for MVP - all node executors, Claude Code integration, SSE streaming

**Frontend**: MVP complete - workflows, runs, detail pages, visual workflow builder

**Next Priority**: P2 features (runtime execution, MCP client, vault service)

---

## Test Files

| Test | Path |
|------|------|
| Agent Executor | `src/queue/workers/executors/__tests__/agent.executor.test.ts` |

---

## Documentation

| Document | Path |
|----------|------|
| Architecture | `docs/architecture.md` |
| Roadmap | `docs/ROADMAP.md` |
| UI Specification | `docs/ui-specification.md` |
| Requirements | `docs/agent-organization-system-requirements.md` |
| Frontend Plan | `docs/frontend-workflow-builder-plan.md` |
| PDCA Cycles | `docs/pdca/` (agent-executor, sse-endpoint, workflow-builder) |

---

## File Statistics

- Backend source files: ~90 TypeScript files
- Frontend source files: ~23 TypeScript/TSX files
- Documentation: ~20 Markdown files

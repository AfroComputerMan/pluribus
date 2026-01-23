# Project Index: Pluribus

Generated: 2026-01-24

## Overview

Agent Organization System - Backend for orchestrating AI agents, workflows, and MCP (Model Context Protocol) tools. Built with Bun/TypeScript, provides REST APIs, WebSocket support, and job queuing.

## Project Structure

```
src/
├── api/                  # Hono REST API
│   ├── middleware/       # Error handler, validation
│   └── routes/           # Endpoint definitions
├── core/                 # Domain logic
│   ├── agents/           # Agent registry/management
│   └── workflows/        # DAG-based workflow engine
├── db/                   # Drizzle ORM schema/migrations
├── integrations/         # External adapters (Claude, OpenAI, etc.)
├── lib/                  # Config, errors, utilities
├── mcp/                  # MCP server/tool management
├── observability/        # Logging, tracing, cost tracking
├── queue/                # BullMQ job queues
├── runtime/              # Execution isolation
├── skills/               # Reusable prompt templates
└── vault/                # AES-256-GCM credential encryption
```

## Entry Points

- **CLI/Server**: `src/index.ts` - Bun.serve() on PORT (default 3000)
- **Database**: `src/db/migrate.ts` - Run migrations
- **Seed**: `src/db/seed.ts` - Populate sample data

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| API | Hono |
| Database | PostgreSQL 16 + Drizzle ORM |
| Queue | Redis 7 + BullMQ |
| Validation | Zod |
| Linting | Biome |

## API Routes

| Route | Purpose |
|-------|---------|
| `/health` | Service health check |
| `/api/agents` | Agent CRUD |
| `/api/workflows` | Workflow definitions |
| `/api/runs` | Workflow executions |
| `/api/mcp` | MCP servers/tools |
| `/api/skills` | Skill templates |
| `/api/logs` | Log queries |
| `/api/costs` | Usage/cost tracking |
| `/api/metrics` | Observability metrics |

## Database Schema (11 tables)

| Table | Purpose |
|-------|---------|
| `agents` | AI agent definitions with model config |
| `workflows` | DAG workflow definitions |
| `workflow_runs` | Workflow execution instances |
| `node_executions` | Individual node runs |
| `mcp_servers` | MCP server connections |
| `mcp_tools` | Discovered MCP tools |
| `skills` | Prompt/behavior templates |
| `credentials` | Encrypted secrets (AES-256-GCM) |
| `logs` | Structured log storage |
| `usage_records` | Token/cost tracking |

## Queues (BullMQ)

| Queue | Purpose |
|-------|---------|
| `workflow` | Workflow execution jobs |
| `node` | Individual node jobs |
| `schedule` | Cron-triggered workflows |

## Key Modules

### `src/core/agents/`
- **types.ts** - Agent type definitions
- **schemas.ts** - Zod validation schemas
- **service.ts** - Business logic
- **repository.ts** - Database operations

### `src/vault/crypto.ts`
- AES-256-GCM encryption for credentials
- Per-credential key derivation from master key

### `src/integrations/registry.ts`
- Adapter registry for agent backends
- Supports: claude-code, codex, openai, local-bridge

### `src/lib/config.ts`
- Zod-validated environment variables
- Feature flags for OAuth, container isolation

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

## Quick Commands

```bash
# Docker development
make dev              # Start with hot reload
make stop             # Stop containers
make health           # Check services

# Database
make db-migrate       # Run migrations
make db-push          # Push schema (dev)
make db-seed          # Seed data
make db-studio        # Drizzle Studio UI

# Testing
make test             # Run tests
make lint             # Biome linter
make typecheck        # TypeScript check
```

## Code Patterns

- **Imports**: Use `@/` path alias (e.g., `@/core/agents`)
- **Service pattern**: types.ts → schemas.ts → service.ts → repository.ts
- **Logging**: `logger.child('module:name')` with correlation IDs
- **Style**: Single quotes, semicolons, 2-space indent

## File Stats

- Total TypeScript files: 47
- Lines of code: ~2,050
- Test files: 0 (tests not yet implemented)

## Dependencies

| Package | Purpose |
|---------|---------|
| hono | Web framework |
| drizzle-orm | Database ORM |
| bullmq | Job queue |
| ioredis | Redis client |
| zod | Schema validation |
| @anthropic-ai/sdk | Claude API |
| openai | OpenAI API |

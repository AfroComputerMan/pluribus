# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pluribus is an Agent Organization System - a backend for orchestrating AI agents, workflows, and MCP (Model Context Protocol) tools. Built with Bun/TypeScript, it provides REST APIs, WebSocket support, and job queuing for managing complex agent interactions.

## Development Commands

### Docker-based Development (Primary)
```bash
make dev              # Start dev environment with hot reload
make dev-all          # Include pgAdmin (8082) + redis-commander (8081)
make stop             # Stop all containers
make shell            # Enter app container
make health           # Check service health
```

### Database
```bash
make db-generate      # Generate migrations from schema changes
make db-migrate       # Run migrations
make db-push          # Push schema directly (dev only)
make db-studio        # Open Drizzle Studio UI
make db-seed          # Seed database
```

### Testing & Quality
```bash
make test             # Run tests
make test-watch       # Watch mode
bun test path/to/file # Single test file
make lint             # Run biome linter
make format           # Format code
make typecheck        # TypeScript checking
```

### Local Development (without Docker)
```bash
bun install           # Install dependencies
bun run dev           # Start with hot reload (requires local postgres/redis)
```

## Architecture

### Tech Stack
- **Runtime**: Bun with strict TypeScript
- **API**: Hono framework
- **Database**: PostgreSQL 16 + Drizzle ORM
- **Queue**: Redis 7 + BullMQ
- **Validation**: Zod schemas throughout
- **Linting**: Biome

### Directory Structure
```
src/
├── api/              # Hono routes and middleware
│   ├── routes/       # Endpoint definitions
│   └── middleware/   # Error handler, validation
├── core/             # Domain logic
│   ├── agents/       # Agent registry and management
│   ├── workflows/    # DAG-based workflow engine
│   └── orchestrator/ # Scheduling and triggers
├── integrations/     # External adapters (Claude Code, Codex, etc.)
├── mcp/              # MCP server/tool management
├── skills/           # Reusable skill/prompt templates
├── runtime/          # Execution isolation strategies
├── observability/    # Structured logging, tracing, cost tracking
├── vault/            # AES-256-GCM credential encryption
├── db/               # Schema, migrations, client
├── queue/            # BullMQ queues and workers
└── lib/              # Config, errors, utilities
```

### Path Aliases
Use `@/` prefix for imports: `@/core/agents`, `@/db/schema`, `@/lib/config`, etc.

### Key Patterns

**Service Architecture**: Each domain follows types.ts → schemas.ts → service.ts → repository.ts

**API Validation**: Zod schemas validate all inputs. Separate schemas for create/update/filter operations.

**Configuration**: Zod-validated environment variables in `src/lib/config.ts`

**Logging**: Structured JSON logging with correlation IDs (workflowRunId, agentId). Use child loggers: `logger.child('agents:service')`

**Database**: 11 tables with UUID PKs, timezone-aware timestamps. Schema in `src/db/schema.ts`

**Queues**: Three BullMQ queues - `workflow`, `node`, `schedule`. Configured for exponential backoff retry.

## Code Style

- Single quotes, semicolons required, 2-space indent, 100-char line width
- `useConst` enforced, `noExplicitAny` warned
- Biome handles formatting and linting

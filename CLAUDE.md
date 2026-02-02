# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pluribus is an Agent Organization System - a backend for orchestrating AI agents, workflows, and MCP (Model Context Protocol) tools. Built with Bun/TypeScript, it provides REST APIs, WebSocket support, and job queuing for managing complex agent interactions.

## Development Commands

### Docker-based Development (Primary)
```bash
make dev              # Start backend + frontend (ports 3000, 5173)
make dev-backend      # Start backend only
make dev-frontend     # Start frontend only
make dev-all          # Include pgAdmin (8082) + redis-commander (8081)
make stop             # Stop all containers
make shell            # Enter backend container
make shell-frontend   # Enter frontend container
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

### Frontend Development
```bash
make frontend-dev     # Run frontend locally (http://localhost:5173)
make frontend-build   # Build frontend for production
make frontend-lint    # Run ESLint on frontend
make logs-frontend    # Show frontend container logs
```

### Local Development (without Docker)
```bash
make install          # Install all dependencies (backend + frontend)
bun run dev           # Start backend with hot reload (requires local postgres/redis)
cd frontend && bun run dev  # Start frontend locally
```

## Architecture

### Tech Stack
- **Runtime**: Bun with strict TypeScript
- **API**: Hono framework
- **Database**: PostgreSQL 16 + Drizzle ORM
- **Queue**: Redis 7 + BullMQ
- **Validation**: Zod schemas throughout
- **Linting**: Biome (backend), ESLint (frontend)
- **Frontend**: React 19, Vite, TailwindCSS v4, React Query

### Directory Structure
```
src/                  # Backend source
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

frontend/             # React frontend
├── src/
│   ├── api/          # API client with type-safe fetch wrapper
│   ├── components/   # Reusable UI components
│   │   ├── workflow/ # Workflow builder (canvas, nodes, config panels)
│   │   └── agents/   # Agent management (AgentForm)
│   ├── pages/        # Page components
│   │   ├── WorkflowsPage.tsx      # Workflows list
│   │   ├── WorkflowBuilderPage.tsx # Visual workflow editor
│   │   ├── AgentsPage.tsx         # Agents list + CRUD
│   │   └── ExecutionPage.tsx      # Real-time run visualization
│   ├── stores/       # Zustand state management
│   ├── hooks/        # Custom hooks (SSE, mutations)
│   └── lib/          # Utilities (validation, serialization, auto-layout)
├── vite.config.ts    # Vite config with API proxy + test config
└── index.html        # Entry point
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

## Frontend Testing

**Test runner**: Vitest with jsdom environment (configured in `vite.config.ts`)

**Running tests**:
```bash
cd frontend
bun run test              # Run all tests via vitest
bun run test -- --run     # Single run (no watch)
bun run test -- --run src/pages/AgentsPage.test.tsx  # Single file
```

**Key patterns**:
- Use `bun run test` (vitest) not `bun test` for DOM tests
- Mock API with `vi.mock('../api/client', ...)`
- Use `MemoryRouter` with actual routes for navigation tests
- Wait for async operations with `waitFor(() => expect(...))`
- Use `globalThis.fetch` not `global.fetch` for TypeScript compatibility

**Test structure** (follows TDD):
```typescript
vi.mock('../api/client', () => ({
  api: { agents: { list: vi.fn(), ... } }
}));
const mockApi = api as any;

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/path']}>
        <Routes>
          <Route path="/path" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
```

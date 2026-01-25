# Pluribus - Agent Organization System

A backend for orchestrating AI agents, workflows, and MCP (Model Context Protocol) tools. Built with Bun/TypeScript, it provides REST APIs, WebSocket support, and job queuing for managing complex agent interactions.

## Quick Start

### Backend

```bash
# Start development environment with Docker
make dev

# Or include additional services (pgAdmin + Redis Commander)
make dev-all

# Run tests
make test

# Check service health
make health
```

See [CLAUDE.md](./CLAUDE.md) for detailed backend development instructions.

### Frontend

The MVP UI is built with Vite, React, TypeScript, and Tailwind CSS.

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies (if not already done)
npm install

# Start development server (runs on port 5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

**Environment Variables:**

Copy `frontend/.env.example` to `frontend/.env` and configure as needed:
- `VITE_API_BASE_URL`: Backend API base URL (default: `/api`, proxied by Vite)

**Development Setup:**

The frontend uses Vite's proxy configuration to forward `/api` requests to the backend running on `http://localhost:3000`. Make sure the backend is running before starting frontend development.

## Architecture

### Tech Stack

**Backend:**
- Runtime: Bun with strict TypeScript
- API: Hono framework
- Database: PostgreSQL 16 + Drizzle ORM
- Queue: Redis 7 + BullMQ
- Validation: Zod schemas

**Frontend:**
- Build Tool: Vite
- Framework: React 19
- Language: TypeScript
- Styling: Tailwind CSS v4
- Routing: React Router v7
- Data Fetching: TanStack Query (React Query)

### Directory Structure

```
pluribus/
├── src/                    # Backend source code
│   ├── api/               # Hono routes and middleware
│   ├── core/              # Domain logic (agents, workflows, orchestrator)
│   ├── integrations/      # External adapters
│   ├── mcp/               # MCP server/tool management
│   ├── db/                # Database schema and migrations
│   └── queue/             # BullMQ queues and workers
├── frontend/              # Frontend application
│   ├── src/
│   │   ├── api/          # API client and types
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Page components
│   │   └── App.tsx       # App entry point with routing
│   └── dist/             # Production build output
├── docker/               # Docker configuration
├── tests/                # Backend tests
└── Makefile             # Development commands
```

## Development

### Backend Commands

See [CLAUDE.md](./CLAUDE.md) for comprehensive backend development guide.

### Frontend Commands

```bash
cd frontend

# Development
npm run dev          # Start dev server with hot reload
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
```

## Documentation

- [CLAUDE.md](./CLAUDE.md) - Development guide for backend
- [PROJECT_INDEX.md](./PROJECT_INDEX.md) - Project overview and structure
- [CLAUDE_CODE_ADAPTER.md](./CLAUDE_CODE_ADAPTER.md) - Claude Code adapter documentation

## License

See LICENSE file for details.

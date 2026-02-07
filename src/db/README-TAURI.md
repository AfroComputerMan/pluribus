# Tauri SQLite Database

This directory contains both PostgreSQL (backend) and SQLite (Tauri desktop) database code.

## Files

### PostgreSQL (Backend)
- `schema.ts` - PostgreSQL schema using Drizzle ORM
- `client.ts` - PostgreSQL client connection
- `migrate.ts` - PostgreSQL migrations
- `seed.ts` - Database seeding

### SQLite (Tauri Desktop)
- `tauri-schema.ts` - SQLite schema using Drizzle ORM
- `tauri-client.ts` - SQLite proxy client for Tauri IPC
- `tauri-migrations.ts` - Manual SQLite migration runner

## SQLite Schema

The Tauri desktop app uses a local SQLite database with 7 tables:

1. **projects** - Code repositories managed by Pluribus Desktop
2. **sessions** - Individual agent sessions within a project
3. **messages** - Conversation history (user/assistant/tool messages)
4. **teams** - Agent teams for collaborative work (future)
5. **tasks** - Task management for team coordination (future)
6. **usage_records** - Granular cost and token tracking
7. **settings** - Application configuration

## Usage

### Initialize Database (on app startup)

```typescript
import { runTauriMigrations } from '@/db';

// Run migrations to create/update tables
await runTauriMigrations();
```

### Query with Drizzle ORM

```typescript
import { tauriDb, tauriSchema } from '@/db';
import type { NewProject, Project } from '@/db';
import { eq } from 'drizzle-orm';

// Insert a project
const newProject: NewProject = {
  id: crypto.randomUUID(),
  name: 'My Project',
  path: '/path/to/project',
  defaultModel: 'sonnet',
  defaultAutonomy: 'supervised'
};

await tauriDb.insert(tauriSchema.projects).values(newProject);

// Query projects
const allProjects = await tauriDb.select().from(tauriSchema.projects);

// Query with filter
const project = await tauriDb
  .select()
  .from(tauriSchema.projects)
  .where(eq(tauriSchema.projects.id, projectId));

// Update
await tauriDb
  .update(tauriSchema.projects)
  .set({ name: 'Updated Name' })
  .where(eq(tauriSchema.projects.id, projectId));

// Delete
await tauriDb
  .delete(tauriSchema.projects)
  .where(eq(tauriSchema.projects.id, projectId));
```

### Join Queries

```typescript
// Get all sessions for a project with messages
const sessionsWithMessages = await tauriDb
  .select()
  .from(tauriSchema.sessions)
  .leftJoin(
    tauriSchema.messages,
    eq(tauriSchema.sessions.id, tauriSchema.messages.sessionId)
  )
  .where(eq(tauriSchema.sessions.projectId, projectId));
```

## Architecture

The **sqlite-proxy pattern** bridges Drizzle ORM in TypeScript with SQLite execution in Rust:

1. **Frontend**: Drizzle ORM generates SQL queries in TypeScript
2. **Proxy**: Callback function intercepts queries and params
3. **Tauri IPC**: `invoke('execute_sql')` or `invoke('select_sql')` calls Rust
4. **Backend**: Rust executes SQL against SQLite and returns results
5. **Frontend**: Drizzle maps results back to TypeScript types

This gives us:
- Type-safe queries in TypeScript
- SQLite performance in Rust
- No network overhead (local IPC)
- Full Drizzle ORM features (joins, filters, etc.)

## Adding Migrations

To add a new migration, edit `tauri-migrations.ts`:

```typescript
const MIGRATIONS: Migration[] = [
  // ... existing migrations
  {
    version: 2,
    description: 'Add new_column to projects table',
    sql: `
      ALTER TABLE projects ADD COLUMN new_column TEXT;
    `
  }
];
```

Migrations run automatically on app startup via `runTauriMigrations()`.

## Type Safety

All table types are exported from `tauri-schema.ts`:

- `Project`, `NewProject` - projects table
- `Session`, `NewSession` - sessions table
- `Message`, `NewMessage` - messages table
- `Team`, `NewTeam` - teams table
- `Task`, `NewTask` - tasks table
- `UsageRecord`, `NewUsageRecord` - usage_records table
- `Setting`, `NewSetting` - settings table

Use `NewX` for inserts, `X` for query results.

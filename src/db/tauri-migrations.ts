import { invoke } from '@tauri-apps/api/core';

/**
 * Manual migration system for Tauri SQLite database.
 *
 * Since drizzle-kit doesn't work well with sqlite-proxy (it needs direct file access),
 * we maintain migrations manually here. Each migration has a version number and SQL.
 *
 * The _migrations table tracks which versions have been applied.
 */

interface Migration {
  version: number;
  sql: string;
  description?: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema - projects, sessions, messages, teams, tasks, usage, settings',
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        default_model TEXT DEFAULT 'sonnet',
        default_autonomy TEXT DEFAULT 'supervised',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        claude_session_id TEXT,
        model TEXT NOT NULL DEFAULT 'sonnet',
        autonomy_level TEXT DEFAULT 'supervised',
        worktree_path TEXT,
        worktree_branch TEXT,
        allowed_tools TEXT,
        system_prompt_append TEXT,
        max_turns INTEGER,
        max_budget_usd REAL,
        total_cost_usd REAL DEFAULT 0,
        total_input_tokens INTEGER DEFAULT 0,
        total_output_tokens INTEGER DEFAULT 0,
        turn_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        content_type TEXT DEFAULT 'text',
        tool_name TEXT,
        tool_input TEXT,
        tool_use_id TEXT,
        is_error INTEGER DEFAULT 0,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cost_usd REAL,
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session_order ON messages(session_id, order_index);

      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        name TEXT NOT NULL,
        status TEXT DEFAULT 'idle',
        claude_team_dir TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        assigned_agent TEXT,
        dependencies TEXT,
        file_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_id);

      CREATE TABLE IF NOT EXISTS usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_usage_records_session ON usage_records(session_id);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    description: 'Add missing indexes for tasks and usage_records',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_id);
      CREATE INDEX IF NOT EXISTS idx_usage_records_session ON usage_records(session_id);
    `
  }
];

/**
 * Run all pending migrations.
 *
 * Creates the _migrations tracking table if needed, then applies
 * any migrations with version > current database version.
 *
 * Call this on app startup to ensure the database schema is up to date.
 */
export async function runMigrations(): Promise<void> {
  try {
    // Ensure foreign key enforcement is enabled (SQLite defaults to OFF)
    await invoke('execute_sql', {
      sql: 'PRAGMA foreign_keys = ON',
      params: []
    });

    // Create migrations table if not exists
    await invoke('execute_sql', {
      sql: 'CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))',
      params: []
    });

    // Get current version
    const rows = await invoke<any[]>('select_sql', {
      sql: 'SELECT MAX(version) as version FROM _migrations',
      params: []
    });

    const currentVersion = rows?.[0]?.version ?? 0;
    console.log(`Current database version: ${currentVersion}`);

    // Run pending migrations
    let appliedCount = 0;
    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        console.log(`Applying migration ${migration.version}: ${migration.description || 'no description'}`);

        // Split by semicolons and run each statement
        const statements = migration.sql
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0);

        for (const stmt of statements) {
          await invoke('execute_sql', { sql: stmt, params: [] });
        }

        // Record migration as applied
        await invoke('execute_sql', {
          sql: 'INSERT INTO _migrations (version) VALUES (?)',
          params: [migration.version]
        });

        appliedCount++;
        console.log(`Migration ${migration.version} applied successfully`);
      }
    }

    if (appliedCount === 0) {
      console.log('No pending migrations');
    } else {
      console.log(`Applied ${appliedCount} migration(s)`);
    }
  } catch (error) {
    console.error('Migration error:', error);
    throw new Error(`Failed to run migrations: ${error}`);
  }
}

/**
 * Get the current database version.
 */
export async function getDatabaseVersion(): Promise<number> {
  try {
    const rows = await invoke<any[]>('select_sql', {
      sql: 'SELECT MAX(version) as version FROM _migrations',
      params: []
    });
    return rows?.[0]?.version ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Get all applied migrations.
 */
export async function getAppliedMigrations(): Promise<{ version: number; appliedAt: string }[]> {
  try {
    const rows = await invoke<any[]>('select_sql', {
      sql: 'SELECT version, applied_at FROM _migrations ORDER BY version',
      params: []
    });
    return rows.map((row: any) => ({
      version: row.version,
      appliedAt: row.applied_at
    }));
  } catch {
    return [];
  }
}

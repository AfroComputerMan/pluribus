import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as schema from '@/db/schema';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Migration tests using docker-compose test database
 *
 * Requires running: docker compose -f docker-compose.test.yml up -d
 * Or uses GitHub Actions services in CI
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://test:test@localhost:5433/pluribus_test';

describe('Database Migrations', () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL, { max: 5 });
    db = drizzle(client, { schema });

    // Run migrations
    await migrate(db, { migrationsFolder: './drizzle/migrations' });
  }, 60000);

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  test('migrations create all expected tables', async () => {
    const tables = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tableNames = tables.map((r) => r.table_name);

    // Verify all expected tables exist
    expect(tableNames).toContain('agents');
    expect(tableNames).toContain('workflows');
    expect(tableNames).toContain('workflow_runs');
    expect(tableNames).toContain('node_executions');
    expect(tableNames).toContain('mcp_servers');
    expect(tableNames).toContain('mcp_tools');
    expect(tableNames).toContain('skills');
    expect(tableNames).toContain('credentials');
    expect(tableNames).toContain('logs');
    expect(tableNames).toContain('usage_records');
  });

  test('agents table has correct columns', async () => {
    const columns = await db.execute<{ column_name: string; data_type: string }>(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'agents'
      ORDER BY ordinal_position
    `);

    const columnMap = Object.fromEntries(columns.map((c) => [c.column_name, c.data_type]));

    expect(columnMap.id).toBe('uuid');
    expect(columnMap.name).toBe('character varying');
    expect(columnMap.description).toBe('text');
    expect(columnMap.tags).toBe('ARRAY');
    expect(columnMap.model_config).toBe('jsonb');
    expect(columnMap.memory_mode).toBe('character varying');
    expect(columnMap.isolation_level).toBe('character varying');
    expect(columnMap.can_spawn_sub_agents).toBe('boolean');
    expect(columnMap.max_sub_agents).toBe('integer');
    expect(columnMap.skills).toBe('ARRAY');
    expect(columnMap.allowed_mcp_tools).toBe('ARRAY');
    expect(columnMap.integration).toBe('jsonb');
    expect(columnMap.created_at).toBe('timestamp with time zone');
    expect(columnMap.updated_at).toBe('timestamp with time zone');
  });

  test('workflows table has correct columns', async () => {
    const columns = await db.execute<{ column_name: string; data_type: string }>(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'workflows'
      ORDER BY ordinal_position
    `);

    const columnMap = Object.fromEntries(columns.map((c) => [c.column_name, c.data_type]));

    expect(columnMap.id).toBe('uuid');
    expect(columnMap.name).toBe('character varying');
    expect(columnMap.nodes).toBe('jsonb');
    expect(columnMap.edges).toBe('jsonb');
    expect(columnMap.triggers).toBe('jsonb');
    expect(columnMap.error_strategy).toBe('jsonb');
  });

  test('indexes are created correctly', async () => {
    const indexes = await db.execute<{ indexname: string; tablename: string }>(sql`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `);

    const indexNames = indexes.map((i) => i.indexname);

    // Check for expected indexes
    expect(indexNames).toContain('idx_agents_tags');
    expect(indexNames).toContain('idx_workflow_runs_workflow');
    expect(indexNames).toContain('idx_workflow_runs_status');
    expect(indexNames).toContain('idx_node_executions_run');
    expect(indexNames).toContain('idx_mcp_tools_server');
    expect(indexNames).toContain('idx_skills_tags');
    expect(indexNames).toContain('idx_logs_timestamp');
    expect(indexNames).toContain('idx_logs_workflow_run');
    expect(indexNames).toContain('idx_logs_level');
    expect(indexNames).toContain('idx_usage_timestamp');
    expect(indexNames).toContain('idx_usage_agent');
    expect(indexNames).toContain('idx_usage_workflow');
  });

  test('foreign keys are created correctly', async () => {
    const fks = await db.execute<{
      constraint_name: string;
      table_name: string;
      column_name: string;
      foreign_table: string;
    }>(sql`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.table_name
    `);

    // Find specific foreign keys
    const nodeExecFk = fks.find(
      (fk) => fk.table_name === 'node_executions' && fk.column_name === 'workflow_run_id'
    );
    expect(nodeExecFk?.foreign_table).toBe('workflow_runs');

    const mcpToolsFk = fks.find(
      (fk) => fk.table_name === 'mcp_tools' && fk.column_name === 'server_id'
    );
    expect(mcpToolsFk?.foreign_table).toBe('mcp_servers');
  });
});

describe('Migration Idempotency', () => {
  test('running migrations twice does not fail', async () => {
    const client1 = postgres(TEST_DATABASE_URL, { max: 5 });
    const db1 = drizzle(client1, { schema });

    // Run migrations (already ran in beforeAll above)
    await expect(migrate(db1, { migrationsFolder: './drizzle/migrations' })).resolves.not.toThrow();

    await client1.end();

    // Run again with fresh connection
    const client2 = postgres(TEST_DATABASE_URL, { max: 5 });
    const db2 = drizzle(client2, { schema });

    await expect(migrate(db2, { migrationsFolder: './drizzle/migrations' })).resolves.not.toThrow();

    await client2.end();
  });
});

import * as schema from '@/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Docker-based test database setup
 * Uses docker-compose.test.yml services instead of testcontainers
 *
 * Requires running: docker compose -f docker-compose.test.yml up -d
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://test:test@localhost:5433/pluribus_test';

const TEST_REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6380';

/**
 * Create a database connection for tests
 */
export function createDockerTestDb() {
  const client = postgres(TEST_DATABASE_URL, { max: 5 });
  const db = drizzle(client, { schema });
  return { db, client };
}

/**
 * Run migrations on the test database
 */
export async function migrateTestDb() {
  const { db, client } = createDockerTestDb();
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
  await client.end();
}

/**
 * Reset the test database (truncate all tables)
 */
export async function resetTestDb() {
  const { client } = createDockerTestDb();

  // Truncate all tables in reverse dependency order
  await client`TRUNCATE TABLE
    usage_records,
    logs,
    node_executions,
    workflow_runs,
    mcp_tools,
    mcp_servers,
    skills,
    credentials,
    workflows,
    agents
    CASCADE`;

  await client.end();
}

/**
 * Check if test database is available
 */
export async function checkTestDbHealth(): Promise<boolean> {
  try {
    const client = postgres(TEST_DATABASE_URL, { max: 1 });
    await client`SELECT 1`;
    await client.end();
    return true;
  } catch {
    return false;
  }
}

export { TEST_DATABASE_URL, TEST_REDIS_URL };

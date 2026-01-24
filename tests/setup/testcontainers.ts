import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '@/db/schema';

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  db: ReturnType<typeof drizzle>;
  pgClient: ReturnType<typeof postgres>;
  cleanup: () => Promise<void>;
}

/**
 * Start PostgreSQL and Redis test containers
 * Used for integration tests that need real database/cache
 */
export async function startTestContainers(): Promise<TestContainers> {
  // Start containers in parallel
  const [postgresContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('pluribus_test')
      .withUsername('test')
      .withPassword('test')
      .withStartupTimeout(90000) // 90s startup timeout
      .start(),
    new RedisContainer('redis:7-alpine')
      .withStartupTimeout(60000) // 60s startup timeout
      .start(),
  ]);

  // Create postgres client
  const connectionString = postgresContainer.getConnectionUri();
  const pgClient = postgres(connectionString, { max: 5 });
  const db = drizzle(pgClient, { schema });

  // Run migrations
  await migrate(db, { migrationsFolder: './drizzle/migrations' });

  return {
    postgres: postgresContainer,
    redis: redisContainer,
    db,
    pgClient,
    cleanup: async () => {
      await pgClient.end();
      await Promise.all([
        postgresContainer.stop(),
        redisContainer.stop(),
      ]);
    },
  };
}

/**
 * Start only PostgreSQL container (for migration tests)
 */
export async function startPostgresContainer(): Promise<{
  container: StartedPostgreSqlContainer;
  connectionString: string;
  cleanup: () => Promise<void>;
}> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('pluribus_test')
    .withUsername('test')
    .withPassword('test')
    .withStartupTimeout(90000) // 90s startup timeout
    .start();

  return {
    container,
    connectionString: container.getConnectionUri(),
    cleanup: async () => {
      await container.stop();
    },
  };
}

/**
 * Create a fresh database client for testing
 */
export function createTestDb(connectionString: string) {
  const client = postgres(connectionString, { max: 5 });
  const db = drizzle(client, { schema });
  return { db, client };
}

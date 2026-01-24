import * as schema from '@/db/schema';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export interface TestContainers {
  postgres: StartedPostgreSqlContainer | null;
  redis: StartedRedisContainer | null;
  db: ReturnType<typeof drizzle<typeof schema>>;
  pgClient: ReturnType<typeof postgres>;
  cleanup: () => Promise<void>;
}

// Cache for shared containers (used when running multiple test files)
let sharedContainers: TestContainers | null = null;

/**
 * Check if CI services are available via environment variables
 */
function getCIServiceUrls(): { databaseUrl: string; redisUrl: string } | null {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const redisUrl = process.env.TEST_REDIS_URL;

  if (databaseUrl && redisUrl) {
    return { databaseUrl, redisUrl };
  }
  return null;
}

/**
 * Start PostgreSQL and Redis test containers
 * Uses CI services if TEST_DATABASE_URL and TEST_REDIS_URL are set,
 * otherwise falls back to testcontainers for local development.
 */
export async function startTestContainers(): Promise<TestContainers> {
  // Check if we should use CI services
  const ciServices = getCIServiceUrls();

  if (ciServices) {
    // Use CI-provided services (much faster)
    const pgClient = postgres(ciServices.databaseUrl, { max: 5 });
    const db = drizzle(pgClient, { schema });

    // Migrations should already be run by CI, but ensure they're applied
    await migrate(db, { migrationsFolder: './drizzle/migrations' });

    return {
      postgres: null,
      redis: null,
      db,
      pgClient,
      cleanup: async () => {
        await pgClient.end();
        // Don't stop CI services
      },
    };
  }

  // Return cached containers if available (for running multiple test files locally)
  if (sharedContainers) {
    return sharedContainers;
  }

  // Start containers in parallel (local development)
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

  sharedContainers = {
    postgres: postgresContainer,
    redis: redisContainer,
    db,
    pgClient,
    cleanup: async () => {
      await pgClient.end();
      await Promise.all([postgresContainer.stop(), redisContainer.stop()]);
      sharedContainers = null;
    },
  };

  return sharedContainers;
}

/**
 * Start only PostgreSQL container (for migration tests)
 * Uses CI services if TEST_DATABASE_URL is set.
 */
export async function startPostgresContainer(): Promise<{
  container: StartedPostgreSqlContainer | null;
  connectionString: string;
  cleanup: () => Promise<void>;
}> {
  // Check for CI service
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (databaseUrl) {
    return {
      container: null,
      connectionString: databaseUrl,
      cleanup: async () => {
        // Don't stop CI services
      },
    };
  }

  // Local development: start testcontainer
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

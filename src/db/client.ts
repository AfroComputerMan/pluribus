import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

// Database connection
const connectionString =
  process.env.DATABASE_URL || 'postgres://pluribus:pluribus@localhost:5432/pluribus';

// Create postgres client
// Max connections: Use 1 for migrations, more for runtime
const client = postgres(connectionString, {
  max: process.env.NODE_ENV === 'production' ? 20 : 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Create drizzle instance with schema
export const db = drizzle(client, {
  schema,
  logger: process.env.LOG_LEVEL === 'debug',
});

// Export types
export type Database = typeof db;

// Graceful shutdown helper
export async function closeDatabase(): Promise<void> {
  await client.end();
}

// Health check
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

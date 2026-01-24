import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { closeDatabase, db } from './client';

async function runMigrations(): Promise<void> {
  console.log('Running migrations...');

  try {
    await migrate(db, { migrationsFolder: './drizzle/migrations' });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

runMigrations();

// PostgreSQL database exports (backend)
export { db, closeDatabase, checkDatabaseHealth } from './client';
export type { Database } from './client';
export * from './schema';

// Tauri SQLite database exports (desktop frontend)
export { db as tauriDb, schema as tauriSchema } from './tauri-client';
export {
  runMigrations as runTauriMigrations,
  getDatabaseVersion as getTauriDatabaseVersion,
  getAppliedMigrations as getTauriAppliedMigrations
} from './tauri-migrations';
export type {
  Project,
  NewProject,
  Session,
  NewSession,
  Message,
  NewMessage,
  Team,
  NewTeam,
  Task,
  NewTask,
  UsageRecord,
  NewUsageRecord,
  Setting,
  NewSetting
} from './tauri-schema';

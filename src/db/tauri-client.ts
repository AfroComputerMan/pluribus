import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { invoke } from '@tauri-apps/api/core';
import * as schema from './tauri-schema';

/**
 * SQLite proxy client for Tauri desktop application.
 *
 * This implements the Drizzle sqlite-proxy pattern where:
 * - Drizzle ORM runs in the frontend TypeScript
 * - Actual SQL execution happens in Rust via Tauri IPC
 * - We get type-safe queries with SQLite performance
 *
 * The proxy callback is invoked by Drizzle for every SQL query.
 * It delegates to Tauri's execute_sql (for INSERT/UPDATE/DELETE)
 * or select_sql (for SELECT queries).
 */
const db = drizzle(
  async (sql: string, params: unknown[], method: 'all' | 'run' | 'get' | 'values') => {
    try {
      if (method === 'run') {
        // For INSERT/UPDATE/DELETE queries
        await invoke('execute_sql', { sql, params });
        return { rows: [] };
      }

      // For SELECT queries
      const rows = await invoke<unknown[]>('select_sql', { sql, params });

      // Drizzle expects rows in different formats depending on method
      if (method === 'get') {
        // Return single row for .get() queries
        return { rows: rows.length > 0 ? [rows[0]] : [] };
      }

      if (method === 'values') {
        // Return raw values (array of arrays) for .values() queries
        return { rows: rows as any[][] };
      }

      // Default 'all' method - return all rows
      return { rows: rows as any[][] };
    } catch (error) {
      console.error('SQLite proxy error:', error);
      throw error;
    }
  },
  { schema }
);

export { db, schema };

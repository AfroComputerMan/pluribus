/**
 * Example usage of Tauri SQLite database with Drizzle ORM.
 *
 * This file demonstrates common database operations for the desktop app.
 * Import and use these patterns in your Tauri frontend components.
 */

import { tauriDb, tauriSchema, runTauriMigrations } from '@/db';
import type { NewProject, NewSession, NewMessage, Project } from '@/db';
import { eq, desc, and, sql } from 'drizzle-orm';

/**
 * Initialize database on app startup
 */
export async function initializeDatabase() {
  await runTauriMigrations();
  console.log('Database initialized and migrations applied');
}

/**
 * Project CRUD operations
 */
export class ProjectService {
  static async create(data: NewProject): Promise<void> {
    await tauriDb.insert(tauriSchema.projects).values(data);
  }

  static async getAll(): Promise<Project[]> {
    return await tauriDb
      .select()
      .from(tauriSchema.projects)
      .orderBy(desc(tauriSchema.projects.createdAt));
  }

  static async getById(id: string): Promise<Project | undefined> {
    const results = await tauriDb
      .select()
      .from(tauriSchema.projects)
      .where(eq(tauriSchema.projects.id, id));
    return results[0];
  }

  static async update(id: string, data: Partial<NewProject>): Promise<void> {
    await tauriDb
      .update(tauriSchema.projects)
      .set(data)
      .where(eq(tauriSchema.projects.id, id));
  }

  static async delete(id: string): Promise<void> {
    await tauriDb
      .delete(tauriSchema.projects)
      .where(eq(tauriSchema.projects.id, id));
  }
}

/**
 * Session operations with project relationship
 */
export class SessionService {
  static async create(data: NewSession): Promise<void> {
    await tauriDb.insert(tauriSchema.sessions).values(data);
  }

  static async getByProject(projectId: string) {
    return await tauriDb
      .select()
      .from(tauriSchema.sessions)
      .where(eq(tauriSchema.sessions.projectId, projectId))
      .orderBy(desc(tauriSchema.sessions.createdAt));
  }

  static async getActive() {
    return await tauriDb
      .select()
      .from(tauriSchema.sessions)
      .where(eq(tauriSchema.sessions.status, 'running'))
      .orderBy(desc(tauriSchema.sessions.createdAt));
  }

  static async updateStatus(sessionId: string, status: string): Promise<void> {
    await tauriDb
      .update(tauriSchema.sessions)
      .set({ status })
      .where(eq(tauriSchema.sessions.id, sessionId));
  }

  static async incrementUsage(
    sessionId: string,
    inputTokens: number,
    outputTokens: number,
    cost: number
  ): Promise<void> {
    await tauriDb
      .update(tauriSchema.sessions)
      .set({
        totalInputTokens: sql`${tauriSchema.sessions.totalInputTokens} + ${inputTokens}`,
        totalOutputTokens: sql`${tauriSchema.sessions.totalOutputTokens} + ${outputTokens}`,
        totalCostUsd: sql`${tauriSchema.sessions.totalCostUsd} + ${cost}`,
        turnCount: sql`${tauriSchema.sessions.turnCount} + 1`
      })
      .where(eq(tauriSchema.sessions.id, sessionId));
  }
}

/**
 * Message operations with ordering
 */
export class MessageService {
  static async create(data: NewMessage): Promise<void> {
    await tauriDb.insert(tauriSchema.messages).values(data);
  }

  static async getBySession(sessionId: string) {
    return await tauriDb
      .select()
      .from(tauriSchema.messages)
      .where(eq(tauriSchema.messages.sessionId, sessionId))
      .orderBy(tauriSchema.messages.orderIndex);
  }

  static async getLatest(sessionId: string, limit: number = 10) {
    return await tauriDb
      .select()
      .from(tauriSchema.messages)
      .where(eq(tauriSchema.messages.sessionId, sessionId))
      .orderBy(desc(tauriSchema.messages.orderIndex))
      .limit(limit);
  }

  static async deleteBySession(sessionId: string): Promise<void> {
    await tauriDb
      .delete(tauriSchema.messages)
      .where(eq(tauriSchema.messages.sessionId, sessionId));
  }
}

/**
 * Usage tracking and cost analysis
 */
export class UsageService {
  static async record(data: {
    sessionId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): Promise<void> {
    await tauriDb.insert(tauriSchema.usageRecords).values(data);
  }

  static async getSessionTotal(sessionId: string) {
    const result = await tauriDb
      .select({
        totalCost: sql<number>`SUM(${tauriSchema.usageRecords.costUsd})`,
        totalInput: sql<number>`SUM(${tauriSchema.usageRecords.inputTokens})`,
        totalOutput: sql<number>`SUM(${tauriSchema.usageRecords.outputTokens})`,
        recordCount: sql<number>`COUNT(*)`
      })
      .from(tauriSchema.usageRecords)
      .where(eq(tauriSchema.usageRecords.sessionId, sessionId));

    return result[0];
  }

  static async getProjectTotal(projectId: string) {
    const result = await tauriDb
      .select({
        totalCost: sql<number>`SUM(${tauriSchema.usageRecords.costUsd})`,
        totalInput: sql<number>`SUM(${tauriSchema.usageRecords.inputTokens})`,
        totalOutput: sql<number>`SUM(${tauriSchema.usageRecords.outputTokens})`
      })
      .from(tauriSchema.usageRecords)
      .innerJoin(
        tauriSchema.sessions,
        eq(tauriSchema.usageRecords.sessionId, tauriSchema.sessions.id)
      )
      .where(eq(tauriSchema.sessions.projectId, projectId));

    return result[0];
  }
}

/**
 * Settings management
 */
export class SettingsService {
  static async get(key: string): Promise<string | undefined> {
    const results = await tauriDb
      .select()
      .from(tauriSchema.settings)
      .where(eq(tauriSchema.settings.key, key));
    return results[0]?.value;
  }

  static async set(key: string, value: string): Promise<void> {
    // Upsert pattern - SQLite REPLACE
    await tauriDb
      .insert(tauriSchema.settings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: tauriSchema.settings.key,
        set: { value }
      });
  }

  static async getAll(): Promise<Record<string, string>> {
    const results = await tauriDb.select().from(tauriSchema.settings);
    return Object.fromEntries(results.map(r => [r.key, r.value]));
  }
}

/**
 * Complex query example - Get project with all sessions and message counts
 */
export async function getProjectDashboard(projectId: string) {
  // Get project
  const project = await ProjectService.getById(projectId);
  if (!project) return null;

  // Get sessions with message counts
  const sessionsWithCounts = await tauriDb
    .select({
      session: tauriSchema.sessions,
      messageCount: sql<number>`COUNT(${tauriSchema.messages.id})`
    })
    .from(tauriSchema.sessions)
    .leftJoin(
      tauriSchema.messages,
      eq(tauriSchema.sessions.id, tauriSchema.messages.sessionId)
    )
    .where(eq(tauriSchema.sessions.projectId, projectId))
    .groupBy(tauriSchema.sessions.id)
    .orderBy(desc(tauriSchema.sessions.createdAt));

  // Get total usage
  const usage = await UsageService.getProjectTotal(projectId);

  return {
    project,
    sessions: sessionsWithCounts,
    usage
  };
}

/**
 * Example: Create a new project and session
 */
export async function createProjectWithSession(
  projectName: string,
  projectPath: string
) {
  const projectId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  // Create project
  await ProjectService.create({
    id: projectId,
    name: projectName,
    path: projectPath,
    defaultModel: 'sonnet',
    defaultAutonomy: 'supervised'
  });

  // Create initial session
  await SessionService.create({
    id: sessionId,
    projectId,
    name: 'Main Session',
    status: 'created',
    model: 'sonnet',
    autonomyLevel: 'supervised',
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    turnCount: 0
  });

  return { projectId, sessionId };
}

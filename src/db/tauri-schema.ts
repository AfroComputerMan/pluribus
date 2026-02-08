import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Projects table - represents code repositories managed by Pluribus Desktop
 */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  defaultModel: text('default_model').default('sonnet'),
  defaultAutonomy: text('default_autonomy').default('supervised'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

/**
 * Sessions table - individual agent sessions within a project
 * Tracks execution state, costs, and token usage
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').notNull().default('created'),
  claudeSessionId: text('claude_session_id'),
  model: text('model').notNull().default('sonnet'),
  autonomyLevel: text('autonomy_level').default('supervised'),
  worktreePath: text('worktree_path'),
  worktreeBranch: text('worktree_branch'),
  allowedTools: text('allowed_tools'),        // JSON array
  systemPromptAppend: text('system_prompt_append'),
  maxTurns: integer('max_turns'),
  maxBudgetUsd: real('max_budget_usd'),
  totalCostUsd: real('total_cost_usd').default(0),
  totalInputTokens: integer('total_input_tokens').default(0),
  totalOutputTokens: integer('total_output_tokens').default(0),
  turnCount: integer('turn_count').default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_sessions_project').on(t.projectId),
  index('idx_sessions_status').on(t.status),
]);

/**
 * Messages table - conversation history for each session
 * Stores user messages, assistant responses, and tool interactions
 */
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(),               // user|assistant|system|tool_use|tool_result
  content: text('content').notNull(),
  contentType: text('content_type').default('text'),
  toolName: text('tool_name'),
  toolInput: text('tool_input'),              // JSON
  toolUseId: text('tool_use_id'),
  isError: integer('is_error', { mode: 'boolean' }).default(false),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: real('cost_usd'),
  orderIndex: integer('order_index').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_messages_session_order').on(t.sessionId, t.orderIndex),
]);

/**
 * Teams table - agent teams for collaborative work (future feature)
 */
export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id),
  name: text('name').notNull(),
  status: text('status').default('idle'),
  claudeTeamDir: text('claude_team_dir'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

/**
 * Tasks table - task management for team coordination (future feature)
 */
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  teamId: text('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').default('pending'),
  assignedAgent: text('assigned_agent'),
  dependencies: text('dependencies'),         // JSON array of task IDs
  filePath: text('file_path'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_tasks_team').on(t.teamId),
]);

/**
 * Usage records table - granular cost and token tracking per request
 */
export const usageRecords = sqliteTable('usage_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_usage_records_session').on(t.sessionId),
]);

/**
 * Settings table - application configuration and preferences
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// Type exports for use in application code
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

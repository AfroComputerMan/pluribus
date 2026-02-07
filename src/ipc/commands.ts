import { invoke } from '@tauri-apps/api/core';
import { Channel } from '@tauri-apps/api/core';

// ── Types ──────────────────────────────────────────

export interface CreateSessionInput {
  projectId: string;
  name: string;
  model?: string;
  autonomyLevel?: 'ask' | 'supervised' | 'autonomous';
  useWorktree?: boolean;
  baseBranch?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  systemPromptAppend?: string;
  allowedTools?: string[];
}

export interface SessionSummary {
  id: string;
  projectId: string;
  name: string;
  status: 'created' | 'running' | 'completed' | 'failed' | 'killed' | 'paused';
  claudeSessionId?: string;
  model: string;
  autonomyLevel: string;
  worktreePath?: string;
  worktreeBranch?: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  defaultModel: string;
  defaultAutonomy: string;
  createdAt: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  sessionId: string;
  headCommit: string;
  isLocked: boolean;
}

export interface CliInfo {
  available: boolean;
  version?: string;
  path?: string;
}

export interface CreateTeamInput {
  projectId: string;
  name: string;
  prompt: string;
  teammateCount?: number;
}

export interface Team {
  id: string;
  projectId: string;
  name: string;
  status: string;
  claudeTeamDir?: string;
  createdAt: string;
}

export interface TeamTask {
  id: string;
  title: string;
  status: string;
  assignedAgent?: string;
  dependencies?: string[];
  filePath?: string;
}

export interface AppSettings {
  defaultModel: string;
  defaultAutonomy: string;
  theme: 'light' | 'dark' | 'system';
  editorCommand: string;
  worktreeAutoCleanupHours: number;
  claudeCliPath?: string;
}

// ── Session Commands ───────────────────────────────

export const sessionCommands = {
  create: (input: CreateSessionInput) =>
    invoke<SessionSummary>('create_session', { input }),

  list: (projectId?: string) =>
    invoke<SessionSummary[]>('list_sessions', { projectId }),

  get: (id: string) =>
    invoke<SessionSummary>('get_session', { id }),

  delete: (id: string) =>
    invoke<void>('delete_session', { id }),
};

// ── Chat Commands ──────────────────────────────────

export const chatCommands = {
  sendMessage: (sessionId: string, message: string, channel: Channel<string>) =>
    invoke<void>('send_message', { sessionId, message, channel }),

  abort: (sessionId: string) =>
    invoke<void>('abort_session', { sessionId }),

  resume: (sessionId: string, message?: string, channel?: Channel<string>) =>
    invoke<void>('resume_session', { sessionId, message, channel }),
};

// ── Project Commands ───────────────────────────────

export const projectCommands = {
  open: (path: string) =>
    invoke<Project>('open_project', { path }),

  list: () =>
    invoke<Project[]>('list_projects'),

  get: (id: string) =>
    invoke<Project>('get_project', { id }),
};

// ── Worktree Commands ──────────────────────────────

export const worktreeCommands = {
  create: (projectPath: string, sessionId: string, baseBranch?: string) =>
    invoke<WorktreeInfo>('create_worktree', { projectPath, sessionId, baseBranch }),

  remove: (projectPath: string, sessionId: string, deleteBranch: boolean) =>
    invoke<void>('remove_worktree', { projectPath, sessionId, deleteBranch }),

  list: (projectPath: string) =>
    invoke<WorktreeInfo[]>('list_worktrees', { projectPath }),

  prune: (projectPath: string) =>
    invoke<number>('prune_worktrees', { projectPath }),
};

// ── Team Commands ──────────────────────────────────

export const teamCommands = {
  create: (input: CreateTeamInput) =>
    invoke<Team>('create_team', { input }),

  list: (projectId?: string) =>
    invoke<Team[]>('list_teams', { projectId }),

  start: (teamId: string, prompt: string, channel: Channel<string>) =>
    invoke<void>('start_team', { teamId, prompt, channel }),

  getTasks: (teamDir: string) =>
    invoke<TeamTask[]>('get_team_tasks', { teamDir }),
};

// ── Settings Commands ──────────────────────────────

export const settingsCommands = {
  get: () =>
    invoke<AppSettings>('get_settings'),

  update: (updates: Partial<AppSettings>) =>
    invoke<AppSettings>('update_settings', { updates }),
};

// ── CLI Commands ───────────────────────────────────

export const cliCommands = {
  check: () =>
    invoke<CliInfo>('check_claude_cli'),
};

// ── DB Proxy Commands (used by Drizzle) ────────────

export const dbCommands = {
  execute: (sql: string, params: unknown[]) =>
    invoke<void>('execute_sql', { sql, params }),

  select: (sql: string, params: unknown[]) =>
    invoke<unknown[]>('select_sql', { sql, params }),
};

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
  projectPath?: string;
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

type RawSessionSummary = Partial<SessionSummary> & {
  project_id?: string;
  project_path?: string;
  claude_session_id?: string;
  autonomy_level?: string;
  worktree_path?: string;
  worktree_branch?: string;
  total_cost_usd?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  turn_count?: number;
  created_at?: string;
};

export function normalizeSessionSummary(raw: RawSessionSummary): SessionSummary {
  const projectPath = raw.projectPath ?? raw.project_path ?? raw.projectId ?? raw.project_id ?? '';
  const projectId = raw.projectId ?? raw.project_id ?? projectPath;
  return {
    id: raw.id ?? '',
    projectId,
    projectPath,
    name: raw.name ?? 'Session',
    status: (raw.status as SessionSummary['status']) ?? 'created',
    claudeSessionId: raw.claudeSessionId ?? raw.claude_session_id,
    model: raw.model ?? 'sonnet',
    autonomyLevel: raw.autonomyLevel ?? raw.autonomy_level ?? 'supervised',
    worktreePath: raw.worktreePath ?? raw.worktree_path,
    worktreeBranch: raw.worktreeBranch ?? raw.worktree_branch,
    totalCostUsd: raw.totalCostUsd ?? raw.total_cost_usd ?? 0,
    totalInputTokens: raw.totalInputTokens ?? raw.total_input_tokens ?? 0,
    totalOutputTokens: raw.totalOutputTokens ?? raw.total_output_tokens ?? 0,
    turnCount: raw.turnCount ?? raw.turn_count ?? 0,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
  };
}

export interface SendMessageInput {
  sessionId: string;
  projectPath: string;
  message: string;
  model: string;
  autonomyLevel: string;
  channel: Channel<string>;
  worktreePath?: string | null;
  maxTurns?: number | null;
  allowedTools?: string[] | null;
}

export function buildSendMessageArgs(input: SendMessageInput) {
  return {
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    worktreePath: input.worktreePath ?? null,
    model: input.model,
    autonomyLevel: input.autonomyLevel,
    message: input.message,
    maxTurns: input.maxTurns ?? null,
    allowedTools: input.allowedTools ?? null,
    channel: input.channel,
  };
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
  create: async (input: CreateSessionInput) =>
    normalizeSessionSummary(await invoke<RawSessionSummary>('create_session', { input })),

  list: async (projectId?: string) =>
    (await invoke<RawSessionSummary[]>('list_sessions', { projectId }))
      .map(normalizeSessionSummary),

  get: async (id: string) =>
    normalizeSessionSummary(await invoke<RawSessionSummary>('get_session', { id })),

  delete: (id: string) =>
    invoke<void>('delete_session', { id }),
};

// ── Chat Commands ──────────────────────────────────

export const chatCommands = {
  sendMessage: (input: SendMessageInput) =>
    invoke<void>('send_message', buildSendMessageArgs(input)),

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

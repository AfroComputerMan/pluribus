import { describe, expect, test, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => {
  class MockChannel<T = unknown> {
    private _onmessage: ((response: T) => void) = () => {};
    id = 1;
    set onmessage(handler: (response: T) => void) { this._onmessage = handler; }
    get onmessage() { return this._onmessage; }
  }

  return {
    Channel: MockChannel,
    invoke: mockInvoke,
  };
});

import {
  buildSendMessageArgs,
  normalizeSessionSummary,
  sessionCommands,
  chatCommands,
  projectCommands,
  worktreeCommands,
  teamCommands,
  settingsCommands,
  cliCommands,
  dbCommands,
} from './commands';
import { Channel } from '@tauri-apps/api/core';

beforeEach(() => {
  mockInvoke.mockReset();
});

// ── Pure function tests ───────────────────────────

describe('buildSendMessageArgs', () => {
  test('maps frontend request to tauri command args', () => {
    const args = buildSendMessageArgs({
      sessionId: 's1',
      projectPath: '/tmp/repo',
      message: 'hello',
      model: 'sonnet',
      autonomyLevel: 'supervised',
      channel: {} as never,
    });

    expect(args).toMatchObject({
      sessionId: 's1',
      projectPath: '/tmp/repo',
      message: 'hello',
      model: 'sonnet',
      autonomyLevel: 'supervised',
      worktreePath: null,
      maxTurns: null,
      allowedTools: null,
    });
  });

  test('passes optional fields when provided', () => {
    const channel = new Channel<string>();
    const args = buildSendMessageArgs({
      sessionId: 's1',
      projectPath: '/tmp/repo',
      message: 'hello',
      model: 'opus',
      autonomyLevel: 'autonomous',
      channel,
      worktreePath: '/tmp/wt',
      maxTurns: 5,
      allowedTools: ['bash', 'read'],
    });

    expect(args.worktreePath).toBe('/tmp/wt');
    expect(args.maxTurns).toBe(5);
    expect(args.allowedTools).toEqual(['bash', 'read']);
    expect(args.channel).toBe(channel);
  });
});

describe('normalizeSessionSummary', () => {
  test('normalizes snake_case session payload from rust into frontend shape', () => {
    const normalized = normalizeSessionSummary({
      id: 's1',
      project_path: '/tmp/repo',
      model: 'sonnet',
      autonomy_level: 'supervised',
      status: 'created',
      created_at: '2026-02-07T00:00:00Z',
    });

    expect(normalized.projectPath).toBe('/tmp/repo');
    expect(normalized.projectId).toBe('/tmp/repo');
    expect(normalized.autonomyLevel).toBe('supervised');
    expect(normalized.createdAt).toBe('2026-02-07T00:00:00Z');
    expect(normalized.totalCostUsd).toBe(0);
    expect(normalized.totalInputTokens).toBe(0);
    expect(normalized.totalOutputTokens).toBe(0);
    expect(normalized.turnCount).toBe(0);
  });

  test('prefers camelCase fields over snake_case', () => {
    const normalized = normalizeSessionSummary({
      id: 's1',
      projectPath: '/camel',
      project_path: '/snake',
      autonomyLevel: 'autonomous',
      autonomy_level: 'supervised',
    });

    expect(normalized.projectPath).toBe('/camel');
    expect(normalized.autonomyLevel).toBe('autonomous');
  });

  test('fills defaults for missing fields', () => {
    const normalized = normalizeSessionSummary({});

    expect(normalized.id).toBe('');
    expect(normalized.name).toBe('Session');
    expect(normalized.status).toBe('created');
    expect(normalized.model).toBe('sonnet');
    expect(normalized.autonomyLevel).toBe('supervised');
    expect(normalized.totalCostUsd).toBe(0);
    expect(normalized.turnCount).toBe(0);
  });

  test('normalizes all token/cost fields from snake_case', () => {
    const normalized = normalizeSessionSummary({
      id: 's1',
      total_cost_usd: 1.5,
      total_input_tokens: 1000,
      total_output_tokens: 500,
      turn_count: 3,
    });

    expect(normalized.totalCostUsd).toBe(1.5);
    expect(normalized.totalInputTokens).toBe(1000);
    expect(normalized.totalOutputTokens).toBe(500);
    expect(normalized.turnCount).toBe(3);
  });
});

// ── Session Commands ──────────────────────────────

describe('sessionCommands', () => {
  test('create invokes create_session and normalizes result', async () => {
    mockInvoke.mockResolvedValue({
      id: 's1',
      project_path: '/repo',
      status: 'created',
      model: 'sonnet',
    });

    const result = await sessionCommands.create({
      projectId: 'p1',
      name: 'Test Session',
    });

    expect(mockInvoke).toHaveBeenCalledWith('create_session', {
      input: { projectId: 'p1', name: 'Test Session' },
    });
    expect(result.id).toBe('s1');
    expect(result.projectPath).toBe('/repo');
  });

  test('list invokes list_sessions and normalizes each result', async () => {
    mockInvoke.mockResolvedValue([
      { id: 's1', status: 'running', model: 'sonnet' },
      { id: 's2', status: 'completed', model: 'opus' },
    ]);

    const result = await sessionCommands.list('p1');

    expect(mockInvoke).toHaveBeenCalledWith('list_sessions', { projectId: 'p1' });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('s1');
    expect(result[1].id).toBe('s2');
  });

  test('list passes undefined when no projectId given', async () => {
    mockInvoke.mockResolvedValue([]);

    await sessionCommands.list();

    expect(mockInvoke).toHaveBeenCalledWith('list_sessions', { projectId: undefined });
  });

  test('get invokes get_session and normalizes result', async () => {
    mockInvoke.mockResolvedValue({
      id: 's1',
      status: 'running',
      model: 'sonnet',
    });

    const result = await sessionCommands.get('s1');

    expect(mockInvoke).toHaveBeenCalledWith('get_session', { id: 's1' });
    expect(result.id).toBe('s1');
  });

  test('delete invokes delete_session', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await sessionCommands.delete('s1');

    expect(mockInvoke).toHaveBeenCalledWith('delete_session', { id: 's1' });
  });
});

// ── Chat Commands ─────────────────────────────────

describe('chatCommands', () => {
  test('sendMessage invokes send_message with built args', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const channel = new Channel<string>();

    await chatCommands.sendMessage({
      sessionId: 's1',
      projectPath: '/repo',
      message: 'hello',
      model: 'sonnet',
      autonomyLevel: 'supervised',
      channel,
    });

    expect(mockInvoke).toHaveBeenCalledWith('send_message', expect.objectContaining({
      sessionId: 's1',
      projectPath: '/repo',
      message: 'hello',
      model: 'sonnet',
      autonomyLevel: 'supervised',
      channel,
      worktreePath: null,
      maxTurns: null,
      allowedTools: null,
    }));
  });

  test('abort invokes abort_session', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await chatCommands.abort('s1');

    expect(mockInvoke).toHaveBeenCalledWith('abort_session', { sessionId: 's1' });
  });

  test('resume invokes resume_session with optional args', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const channel = new Channel<string>();

    await chatCommands.resume('s1', 'continue', channel);

    expect(mockInvoke).toHaveBeenCalledWith('resume_session', {
      sessionId: 's1',
      message: 'continue',
      channel,
    });
  });

  test('resume passes undefined for optional args when not provided', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await chatCommands.resume('s1');

    expect(mockInvoke).toHaveBeenCalledWith('resume_session', {
      sessionId: 's1',
      message: undefined,
      channel: undefined,
    });
  });
});

// ── Project Commands ──────────────────────────────

describe('projectCommands', () => {
  test('open invokes open_project', async () => {
    const project = { id: 'p1', name: 'My Project', path: '/repo' };
    mockInvoke.mockResolvedValue(project);

    const result = await projectCommands.open('/repo');

    expect(mockInvoke).toHaveBeenCalledWith('open_project', { path: '/repo' });
    expect(result).toEqual(project);
  });

  test('list invokes list_projects', async () => {
    const projects = [{ id: 'p1', name: 'A', path: '/a' }];
    mockInvoke.mockResolvedValue(projects);

    const result = await projectCommands.list();

    expect(mockInvoke).toHaveBeenCalledWith('list_projects');
    expect(result).toEqual(projects);
  });

  test('get invokes get_project', async () => {
    const project = { id: 'p1', name: 'A', path: '/a' };
    mockInvoke.mockResolvedValue(project);

    const result = await projectCommands.get('p1');

    expect(mockInvoke).toHaveBeenCalledWith('get_project', { id: 'p1' });
    expect(result).toEqual(project);
  });
});

// ── Worktree Commands ─────────────────────────────

describe('worktreeCommands', () => {
  test('create invokes create_worktree', async () => {
    const info = { path: '/wt', branch: 'feat', sessionId: 's1', headCommit: 'abc', isLocked: false };
    mockInvoke.mockResolvedValue(info);

    const result = await worktreeCommands.create('/repo', 's1', 'main');

    expect(mockInvoke).toHaveBeenCalledWith('create_worktree', {
      projectPath: '/repo',
      sessionId: 's1',
      baseBranch: 'main',
    });
    expect(result).toEqual(info);
  });

  test('create passes undefined baseBranch when not provided', async () => {
    mockInvoke.mockResolvedValue({});

    await worktreeCommands.create('/repo', 's1');

    expect(mockInvoke).toHaveBeenCalledWith('create_worktree', {
      projectPath: '/repo',
      sessionId: 's1',
      baseBranch: undefined,
    });
  });

  test('remove invokes remove_worktree', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await worktreeCommands.remove('/repo', 's1', true);

    expect(mockInvoke).toHaveBeenCalledWith('remove_worktree', {
      projectPath: '/repo',
      sessionId: 's1',
      deleteBranch: true,
    });
  });

  test('list invokes list_worktrees', async () => {
    mockInvoke.mockResolvedValue([]);

    await worktreeCommands.list('/repo');

    expect(mockInvoke).toHaveBeenCalledWith('list_worktrees', { projectPath: '/repo' });
  });

  test('prune invokes prune_worktrees', async () => {
    mockInvoke.mockResolvedValue(3);

    const result = await worktreeCommands.prune('/repo');

    expect(mockInvoke).toHaveBeenCalledWith('prune_worktrees', { projectPath: '/repo' });
    expect(result).toBe(3);
  });
});

// ── Team Commands ─────────────────────────────────

describe('teamCommands', () => {
  test('create invokes create_team', async () => {
    const team = { id: 't1', projectId: 'p1', name: 'Team', status: 'active', createdAt: '' };
    mockInvoke.mockResolvedValue(team);

    const result = await teamCommands.create({
      projectId: 'p1',
      name: 'Team',
      prompt: 'Do stuff',
    });

    expect(mockInvoke).toHaveBeenCalledWith('create_team', {
      input: { projectId: 'p1', name: 'Team', prompt: 'Do stuff' },
    });
    expect(result).toEqual(team);
  });

  test('list invokes list_teams', async () => {
    mockInvoke.mockResolvedValue([]);

    await teamCommands.list('p1');

    expect(mockInvoke).toHaveBeenCalledWith('list_teams', { projectId: 'p1' });
  });

  test('start invokes start_team with channel', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const channel = new Channel<string>();

    await teamCommands.start('t1', 'go', channel);

    expect(mockInvoke).toHaveBeenCalledWith('start_team', {
      teamId: 't1',
      prompt: 'go',
      channel,
    });
  });

  test('getTasks invokes get_team_tasks', async () => {
    const tasks = [{ id: '1', title: 'Task', status: 'pending' }];
    mockInvoke.mockResolvedValue(tasks);

    const result = await teamCommands.getTasks('/team/dir');

    expect(mockInvoke).toHaveBeenCalledWith('get_team_tasks', { teamDir: '/team/dir' });
    expect(result).toEqual(tasks);
  });
});

// ── Settings Commands ─────────────────────────────

describe('settingsCommands', () => {
  test('get invokes get_settings', async () => {
    const settings = { defaultModel: 'sonnet', theme: 'dark' };
    mockInvoke.mockResolvedValue(settings);

    const result = await settingsCommands.get();

    expect(mockInvoke).toHaveBeenCalledWith('get_settings');
    expect(result).toEqual(settings);
  });

  test('update invokes update_settings with partial updates', async () => {
    const updated = { defaultModel: 'opus', theme: 'dark' };
    mockInvoke.mockResolvedValue(updated);

    const result = await settingsCommands.update({ defaultModel: 'opus' });

    expect(mockInvoke).toHaveBeenCalledWith('update_settings', {
      updates: { defaultModel: 'opus' },
    });
    expect(result).toEqual(updated);
  });
});

// ── CLI Commands ──────────────────────────────────

describe('cliCommands', () => {
  test('check invokes check_claude_cli', async () => {
    const info = { available: true, version: '1.0.0', path: '/usr/bin/claude' };
    mockInvoke.mockResolvedValue(info);

    const result = await cliCommands.check();

    expect(mockInvoke).toHaveBeenCalledWith('check_claude_cli');
    expect(result).toEqual(info);
  });
});

// ── DB Commands ───────────────────────────────────

describe('dbCommands', () => {
  test('execute invokes execute_sql', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await dbCommands.execute('INSERT INTO foo VALUES (?)', ['bar']);

    expect(mockInvoke).toHaveBeenCalledWith('execute_sql', {
      sql: 'INSERT INTO foo VALUES (?)',
      params: ['bar'],
    });
  });

  test('select invokes select_sql', async () => {
    mockInvoke.mockResolvedValue([{ id: 1 }]);

    const result = await dbCommands.select('SELECT * FROM foo', []);

    expect(mockInvoke).toHaveBeenCalledWith('select_sql', {
      sql: 'SELECT * FROM foo',
      params: [],
    });
    expect(result).toEqual([{ id: 1 }]);
  });
});

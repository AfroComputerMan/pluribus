import { describe, expect, test } from 'vitest';
import { buildSendMessageArgs, normalizeSessionSummary } from './commands';

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
});

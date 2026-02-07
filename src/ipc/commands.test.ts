import { describe, expect, test } from 'vitest';
import { buildSendMessageArgs } from './commands';

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

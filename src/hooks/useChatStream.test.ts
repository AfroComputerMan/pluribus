import { describe, expect, test, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Hoisted mocks ─────────────────────────────────

const { mockInvoke, mockDispatch, capturedCallbacks } = vi.hoisted(() => {
  const capturedCallbacks: {
    onLine?: (line: string) => void;
    onError?: (error: string) => void;
    onEnd?: () => void;
  } = {};

  return {
    mockInvoke: vi.fn(),
    mockDispatch: vi.fn(),
    capturedCallbacks,
  };
});

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

vi.mock('@/ipc/channels', () => ({
  createStreamChannel: vi.fn((callbacks) => {
    capturedCallbacks.onLine = callbacks.onLine;
    capturedCallbacks.onError = callbacks.onError;
    capturedCallbacks.onEnd = callbacks.onEnd;
    return { id: 1, onmessage: () => {} };
  }),
}));

vi.mock('@/ipc/commands', () => ({
  chatCommands: {
    sendMessage: mockInvoke,
  },
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      dispatch: mockDispatch,
    }),
  },
}));

vi.mock('@/lib/ndjson-parser', () => ({
  parseCLILine: vi.fn((line: string) => {
    try {
      const parsed = JSON.parse(line);
      return parsed?.type ? parsed : null;
    } catch {
      return null;
    }
  }),
  cliMessageToUIActions: vi.fn((msg: { type: string }) => {
    if (msg.type === 'system') {
      return [{ type: 'init_session', sessionId: 'test', model: 'sonnet', tools: [] }];
    }
    if (msg.type === 'result') {
      return [{ type: 'session_complete', sessionId: 'test', totalCost: 0.01, numTurns: 1, durationMs: 100 }];
    }
    return [];
  }),
}));

import { useChatStream } from './useChatStream';

const makeSession = (overrides = {}) => ({
  id: 'session-1',
  projectId: 'proj-1',
  projectPath: '/tmp/repo',
  name: 'Test Session',
  status: 'running' as const,
  model: 'sonnet',
  autonomyLevel: 'supervised',
  totalCostUsd: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  turnCount: 0,
  createdAt: '2026-02-08T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  mockInvoke.mockReset();
  mockDispatch.mockReset();
  capturedCallbacks.onLine = undefined;
  capturedCallbacks.onError = undefined;
  capturedCallbacks.onEnd = undefined;
});

describe('useChatStream', () => {
  test('returns sendMessage function and isStreaming state', () => {
    const { result } = renderHook(() => useChatStream());

    expect(result.current.sendMessage).toBeTypeOf('function');
    expect(result.current.isStreaming).toBe(false);
  });

  test('sendMessage calls chatCommands.sendMessage with correct args', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatStream());
    const session = makeSession();

    await act(async () => {
      await result.current.sendMessage(session, 'hello world');
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        projectPath: '/tmp/repo',
        message: 'hello world',
        model: 'sonnet',
        autonomyLevel: 'supervised',
      }),
    );
  });

  test('sets isStreaming to true during send', async () => {
    // Make invoke hang so we can check isStreaming
    let resolveInvoke: () => void;
    mockInvoke.mockReturnValue(new Promise<void>((resolve) => { resolveInvoke = resolve; }));

    const { result } = renderHook(() => useChatStream());

    // Start send but don't await
    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage(makeSession(), 'hi');
    });

    // isStreaming should be true while invoke is pending
    expect(result.current.isStreaming).toBe(true);

    // Complete the invoke
    await act(async () => {
      resolveInvoke!();
      await sendPromise!;
    });
  });

  test('onLine callback parses and dispatches actions to chat store', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.sendMessage(makeSession(), 'hello');
    });

    // Simulate a stream line
    act(() => {
      capturedCallbacks.onLine!('{"type":"system","subtype":"init","session_id":"test","model":"sonnet","tools":[]}');
    });

    expect(mockDispatch).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'init_session',
    }));
  });

  test('onLine skips null parse results (empty/unparseable lines)', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.sendMessage(makeSession(), 'hello');
    });

    act(() => {
      capturedCallbacks.onLine!('not valid json');
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test('onError dispatches session_error action and resets streaming', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.sendMessage(makeSession(), 'hello');
    });

    act(() => {
      capturedCallbacks.onError!('process crashed');
    });

    expect(mockDispatch).toHaveBeenCalledWith('session-1', {
      type: 'session_error',
      sessionId: 'session-1',
      error: 'process crashed',
    });
    expect(result.current.isStreaming).toBe(false);
  });

  test('onEnd resets isStreaming to false', async () => {
    let resolveInvoke: () => void;
    mockInvoke.mockReturnValue(new Promise<void>((resolve) => { resolveInvoke = resolve; }));

    const { result } = renderHook(() => useChatStream());

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage(makeSession(), 'hi');
    });

    expect(result.current.isStreaming).toBe(true);

    act(() => {
      capturedCallbacks.onEnd!();
    });

    expect(result.current.isStreaming).toBe(false);

    await act(async () => {
      resolveInvoke!();
      await sendPromise!;
    });
  });

  test('invoke error dispatches session_error and resets streaming', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC connection failed'));
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.sendMessage(makeSession(), 'hello');
    });

    expect(mockDispatch).toHaveBeenCalledWith('session-1', {
      type: 'session_error',
      sessionId: 'session-1',
      error: 'IPC connection failed',
    });
    expect(result.current.isStreaming).toBe(false);
  });

  test('invoke error with non-Error object stringifies it', async () => {
    mockInvoke.mockRejectedValue('plain string error');
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.sendMessage(makeSession(), 'hello');
    });

    expect(mockDispatch).toHaveBeenCalledWith('session-1', {
      type: 'session_error',
      sessionId: 'session-1',
      error: 'plain string error',
    });
  });

  test('prevents concurrent sends (guard via streamingRef)', async () => {
    let resolveFirst: () => void;
    mockInvoke.mockReturnValueOnce(new Promise<void>((resolve) => { resolveFirst = resolve; }));

    const { result } = renderHook(() => useChatStream());

    // Start first send
    let firstPromise: Promise<void>;
    act(() => {
      firstPromise = result.current.sendMessage(makeSession(), 'first');
    });

    expect(result.current.isStreaming).toBe(true);
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Attempt second send while first is in-flight
    act(() => {
      result.current.sendMessage(makeSession(), 'second');
    });

    // Second call should be ignored
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst!();
      await firstPromise!;
    });
  });

  test('uses projectPath fallback to projectId when projectPath is missing', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatStream());

    const session = makeSession({ projectPath: undefined, projectId: 'fallback-id' });

    await act(async () => {
      await result.current.sendMessage(session, 'hello');
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: 'fallback-id',
      }),
    );
  });

  test('passes worktreePath from session', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatStream());

    const session = makeSession({ worktreePath: '/tmp/worktree' });

    await act(async () => {
      await result.current.sendMessage(session, 'hello');
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: '/tmp/worktree',
      }),
    );
  });
});

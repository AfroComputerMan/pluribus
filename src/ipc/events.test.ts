import { describe, expect, test, vi, beforeEach } from 'vitest';

const { mockListen } = vi.hoisted(() => ({
  mockListen: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}));

import {
  onSessionStatusChanged,
  onPermissionRequest,
  onProcessError,
} from './events';

beforeEach(() => {
  mockListen.mockReset();
});

describe('onSessionStatusChanged', () => {
  test('registers listener for session-status-changed event', async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);

    const callback = vi.fn();
    const result = await onSessionStatusChanged(callback);

    expect(mockListen).toHaveBeenCalledWith('session-status-changed', expect.any(Function));
    expect(result).toBe(unlisten);
  });

  test('passes event payload to callback', async () => {
    let capturedHandler: ((event: unknown) => void) | undefined;
    mockListen.mockImplementation((_event: string, handler: (event: unknown) => void) => {
      capturedHandler = handler;
      return Promise.resolve(vi.fn());
    });

    const callback = vi.fn();
    await onSessionStatusChanged(callback);

    const payload = {
      sessionId: 'session-1',
      status: 'running' as const,
    };
    capturedHandler!({ payload });

    expect(callback).toHaveBeenCalledWith(payload);
  });

  test('passes exitCode when present in payload', async () => {
    let capturedHandler: ((event: unknown) => void) | undefined;
    mockListen.mockImplementation((_event: string, handler: (event: unknown) => void) => {
      capturedHandler = handler;
      return Promise.resolve(vi.fn());
    });

    const callback = vi.fn();
    await onSessionStatusChanged(callback);

    const payload = {
      sessionId: 'session-1',
      status: 'completed' as const,
      exitCode: 0,
    };
    capturedHandler!({ payload });

    expect(callback).toHaveBeenCalledWith(payload);
    expect(callback.mock.calls[0][0].exitCode).toBe(0);
  });

  test('unlisten function stops listening', async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);

    const result = await onSessionStatusChanged(vi.fn());
    result();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe('onPermissionRequest', () => {
  test('registers listener for permission-request event', async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);

    const callback = vi.fn();
    const result = await onPermissionRequest(callback);

    expect(mockListen).toHaveBeenCalledWith('permission-request', expect.any(Function));
    expect(result).toBe(unlisten);
  });

  test('passes event payload to callback', async () => {
    let capturedHandler: ((event: unknown) => void) | undefined;
    mockListen.mockImplementation((_event: string, handler: (event: unknown) => void) => {
      capturedHandler = handler;
      return Promise.resolve(vi.fn());
    });

    const callback = vi.fn();
    await onPermissionRequest(callback);

    const payload = {
      requestId: 'req-1',
      sessionId: 'session-1',
      toolName: 'bash',
      toolInput: { command: 'ls' },
    };
    capturedHandler!({ payload });

    expect(callback).toHaveBeenCalledWith(payload);
  });
});

describe('onProcessError', () => {
  test('registers listener for process-error event', async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);

    const callback = vi.fn();
    const result = await onProcessError(callback);

    expect(mockListen).toHaveBeenCalledWith('process-error', expect.any(Function));
    expect(result).toBe(unlisten);
  });

  test('passes event payload to callback', async () => {
    let capturedHandler: ((event: unknown) => void) | undefined;
    mockListen.mockImplementation((_event: string, handler: (event: unknown) => void) => {
      capturedHandler = handler;
      return Promise.resolve(vi.fn());
    });

    const callback = vi.fn();
    await onProcessError(callback);

    const payload = {
      sessionId: 'session-1',
      error: 'process crashed unexpectedly',
    };
    capturedHandler!({ payload });

    expect(callback).toHaveBeenCalledWith(payload);
  });
});

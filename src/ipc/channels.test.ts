import { describe, expect, test, vi } from 'vitest';

// Mock @tauri-apps/api/core with a simple Channel stub
vi.mock('@tauri-apps/api/core', () => {
  class MockChannel<T = unknown> {
    private _onmessage: ((response: T) => void) = () => {};
    id = 1;

    set onmessage(handler: (response: T) => void) {
      this._onmessage = handler;
    }

    get onmessage() {
      return this._onmessage;
    }
  }

  return {
    Channel: MockChannel,
    invoke: vi.fn(),
  };
});

import { createStreamChannel, createCollectorChannel } from './channels';

describe('createStreamChannel', () => {
  test('calls onLine for normal lines', () => {
    const onLine = vi.fn();
    const channel = createStreamChannel({ onLine });

    channel.onmessage('{"type":"text","content":"hello"}');
    channel.onmessage('{"type":"tool_use","name":"read"}');

    expect(onLine).toHaveBeenCalledTimes(2);
    expect(onLine).toHaveBeenCalledWith('{"type":"text","content":"hello"}');
    expect(onLine).toHaveBeenCalledWith('{"type":"tool_use","name":"read"}');
  });

  test('calls onEnd when receiving __STREAM_END__ sentinel', () => {
    const onLine = vi.fn();
    const onEnd = vi.fn();
    const channel = createStreamChannel({ onLine, onEnd });

    channel.onmessage('line1');
    channel.onmessage('__STREAM_END__');

    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith('line1');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  test('calls onError when receiving __STREAM_ERROR__ sentinel', () => {
    const onLine = vi.fn();
    const onError = vi.fn();
    const channel = createStreamChannel({ onLine, onError });

    channel.onmessage('__STREAM_ERROR__:process exited with code 1');

    expect(onLine).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('process exited with code 1');
  });

  test('strips __STREAM_ERROR__ prefix from error messages', () => {
    const onLine = vi.fn();
    const onError = vi.fn();
    const channel = createStreamChannel({ onLine, onError });

    channel.onmessage('__STREAM_ERROR__:');

    expect(onError).toHaveBeenCalledWith('');
  });

  test('does not throw when onEnd is not provided', () => {
    const onLine = vi.fn();
    const channel = createStreamChannel({ onLine });

    expect(() => channel.onmessage('__STREAM_END__')).not.toThrow();
  });

  test('does not throw when onError is not provided', () => {
    const onLine = vi.fn();
    const channel = createStreamChannel({ onLine });

    expect(() => channel.onmessage('__STREAM_ERROR__:something broke')).not.toThrow();
  });

  test('handles empty lines as normal lines', () => {
    const onLine = vi.fn();
    const channel = createStreamChannel({ onLine });

    channel.onmessage('');

    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith('');
  });

  test('handles rapid succession of lines', () => {
    const onLine = vi.fn();
    const onEnd = vi.fn();
    const channel = createStreamChannel({ onLine, onEnd });

    for (let i = 0; i < 100; i++) {
      channel.onmessage(`line-${i}`);
    }
    channel.onmessage('__STREAM_END__');

    expect(onLine).toHaveBeenCalledTimes(100);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  test('handles lines that look similar to sentinels but are not', () => {
    const onLine = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();
    const channel = createStreamChannel({ onLine, onError, onEnd });

    channel.onmessage('__STREAM_END__ extra');
    channel.onmessage('prefix__STREAM_ERROR__:foo');

    expect(onLine).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('createCollectorChannel', () => {
  test('collects normal lines into array', () => {
    const { channel, getLines } = createCollectorChannel();

    channel.onmessage('line1');
    channel.onmessage('line2');
    channel.onmessage('line3');

    expect(getLines()).toEqual(['line1', 'line2', 'line3']);
  });

  test('does not collect error sentinel lines', () => {
    const { channel, getLines } = createCollectorChannel();

    channel.onmessage('line1');
    channel.onmessage('__STREAM_ERROR__:something failed');
    channel.onmessage('line2');

    expect(getLines()).toEqual(['line1', 'line2']);
  });

  test('does not collect end sentinel line', () => {
    const { channel, getLines } = createCollectorChannel();

    channel.onmessage('line1');
    channel.onmessage('__STREAM_END__');

    expect(getLines()).toEqual(['line1']);
  });

  test('getLines returns a copy, not a reference', () => {
    const { channel, getLines } = createCollectorChannel();

    channel.onmessage('line1');
    const snapshot1 = getLines();
    channel.onmessage('line2');
    const snapshot2 = getLines();

    expect(snapshot1).toEqual(['line1']);
    expect(snapshot2).toEqual(['line1', 'line2']);
    expect(snapshot1).not.toBe(snapshot2);
  });

  test('waitForEnd resolves with all collected lines on __STREAM_END__', async () => {
    const { channel, waitForEnd } = createCollectorChannel();

    const promise = waitForEnd();

    channel.onmessage('a');
    channel.onmessage('b');
    channel.onmessage('c');
    channel.onmessage('__STREAM_END__');

    const result = await promise;
    expect(result).toEqual(['a', 'b', 'c']);
  });

  test('waitForEnd excludes error lines from result', async () => {
    const { channel, waitForEnd } = createCollectorChannel();

    const promise = waitForEnd();

    channel.onmessage('good');
    channel.onmessage('__STREAM_ERROR__:bad');
    channel.onmessage('also good');
    channel.onmessage('__STREAM_END__');

    const result = await promise;
    expect(result).toEqual(['good', 'also good']);
  });

  test('collects empty lines', () => {
    const { channel, getLines } = createCollectorChannel();

    channel.onmessage('');
    channel.onmessage('data');
    channel.onmessage('');

    expect(getLines()).toEqual(['', 'data', '']);
  });
});

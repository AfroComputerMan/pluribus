import { Channel } from '@tauri-apps/api/core';

export type StreamLineHandler = (line: string) => void;
export type StreamErrorHandler = (error: string) => void;
export type StreamEndHandler = () => void;

export interface StreamCallbacks {
  onLine: StreamLineHandler;
  onError?: StreamErrorHandler;
  onEnd?: StreamEndHandler;
}

/**
 * Create a Tauri Channel for streaming NDJSON from a claude CLI session.
 *
 * Each session gets its own channel — no global event fan-out.
 * Lines are raw strings that should be parsed by the NDJSON parser.
 */
export function createStreamChannel(callbacks: StreamCallbacks): Channel<string> {
  const channel = new Channel<string>();

  channel.onmessage = (line: string) => {
    // Special sentinel values from Rust
    if (line === '__STREAM_END__') {
      callbacks.onEnd?.();
      return;
    }
    if (line.startsWith('__STREAM_ERROR__:')) {
      callbacks.onError?.(line.slice('__STREAM_ERROR__:'.length));
      return;
    }

    callbacks.onLine(line);
  };

  return channel;
}

/**
 * Create a Channel that collects all lines into an array.
 * Useful for testing or for commands that return all output at once.
 */
export function createCollectorChannel(): {
  channel: Channel<string>;
  getLines: () => string[];
  waitForEnd: () => Promise<string[]>;
} {
  const lines: string[] = [];
  let resolveEnd: ((lines: string[]) => void) | null = null;

  const channel = new Channel<string>();
  channel.onmessage = (line: string) => {
    if (line === '__STREAM_END__') {
      resolveEnd?.(lines);
      return;
    }
    if (!line.startsWith('__STREAM_ERROR__:')) {
      lines.push(line);
    }
  };

  return {
    channel,
    getLines: () => [...lines],
    waitForEnd: () => new Promise((resolve) => { resolveEnd = resolve; }),
  };
}

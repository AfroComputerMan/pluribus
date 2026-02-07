import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock Tauri API for tests
(globalThis as typeof globalThis & { __TAURI__: unknown }).__TAURI__ = {
  invoke: async () => ({}),
  event: {
    listen: () => Promise.resolve(() => {}),
    once: () => Promise.resolve(() => {}),
    emit: () => Promise.resolve(),
  },
} as any;

import '@testing-library/jest-dom';
import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock Tauri API for tests
globalThis.__TAURI__ = {
  invoke: async () => ({}),
  event: {
    listen: () => Promise.resolve(() => {}),
    once: () => Promise.resolve(() => {}),
    emit: () => Promise.resolve(),
  },
} as any;

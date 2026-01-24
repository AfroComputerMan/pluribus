import { describe, expect, test, beforeEach } from 'bun:test';
import { adapterRegistry, getAdapter } from '@/integrations/registry';
import type { AgentAdapter, IntegrationType } from '@/integrations/types';

describe('AdapterRegistry', () => {
  // Create mock adapters for testing
  const createMockAdapter = (id: string, type: IntegrationType): AgentAdapter => ({
    id,
    type,
    name: `Mock ${type} Adapter`,
    connect: async () => ({
      id: 'conn-1',
      adapterId: id,
      status: 'connected',
      credentials: { type: 'api-key', data: { key: 'test' } },
      connectedAt: new Date(),
    }),
    disconnect: async () => {},
    validateCredentials: async () => true,
    execute: async function* () {
      yield { type: 'completed', result: { success: true, output: 'test' } };
    },
    getCapabilities: () => ({
      supportsStreaming: true,
      supportsTools: true,
      supportsImages: false,
      maxContextTokens: 100000,
      supportedModels: ['test-model'],
    }),
    estimateCost: () => ({
      estimatedInputTokens: 100,
      estimatedOutputTokens: 200,
      estimatedCostUsd: 0.01,
      model: 'test-model',
    }),
  });

  beforeEach(() => {
    // Clear registry before each test
    adapterRegistry.clear();
  });

  describe('register', () => {
    test('registers an adapter', () => {
      const adapter = createMockAdapter('adapter-1', 'claude-code');
      adapterRegistry.register(adapter);

      expect(adapterRegistry.has('adapter-1')).toBe(true);
    });

    test('throws on duplicate registration', () => {
      const adapter = createMockAdapter('adapter-1', 'claude-code');
      adapterRegistry.register(adapter);

      expect(() => adapterRegistry.register(adapter)).toThrow(
        "Adapter with id 'adapter-1' is already registered"
      );
    });
  });

  describe('unregister', () => {
    test('removes registered adapter', () => {
      const adapter = createMockAdapter('adapter-1', 'claude-code');
      adapterRegistry.register(adapter);

      const result = adapterRegistry.unregister('adapter-1');

      expect(result).toBe(true);
      expect(adapterRegistry.has('adapter-1')).toBe(false);
    });

    test('returns false for non-existent adapter', () => {
      const result = adapterRegistry.unregister('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('get', () => {
    test('returns adapter by id', () => {
      const adapter = createMockAdapter('adapter-1', 'claude-code');
      adapterRegistry.register(adapter);

      const result = adapterRegistry.get('adapter-1');

      expect(result).toBe(adapter);
    });

    test('returns undefined for non-existent id', () => {
      const result = adapterRegistry.get('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('getByType', () => {
    test('returns adapters of specified type', () => {
      adapterRegistry.register(createMockAdapter('claude-1', 'claude-code'));
      adapterRegistry.register(createMockAdapter('claude-2', 'claude-code'));
      adapterRegistry.register(createMockAdapter('openai-1', 'openai'));

      const claudeAdapters = adapterRegistry.getByType('claude-code');

      expect(claudeAdapters.length).toBe(2);
      expect(claudeAdapters.every((a) => a.type === 'claude-code')).toBe(true);
    });

    test('returns empty array for non-existent type', () => {
      adapterRegistry.register(createMockAdapter('claude-1', 'claude-code'));

      const result = adapterRegistry.getByType('local-bridge');

      expect(result).toEqual([]);
    });
  });

  describe('getAll', () => {
    test('returns all registered adapters', () => {
      adapterRegistry.register(createMockAdapter('adapter-1', 'claude-code'));
      adapterRegistry.register(createMockAdapter('adapter-2', 'openai'));

      const all = adapterRegistry.getAll();

      expect(all.length).toBe(2);
    });

    test('returns empty array when no adapters registered', () => {
      const all = adapterRegistry.getAll();

      expect(all).toEqual([]);
    });
  });

  describe('has', () => {
    test('returns true for registered adapter', () => {
      adapterRegistry.register(createMockAdapter('adapter-1', 'claude-code'));

      expect(adapterRegistry.has('adapter-1')).toBe(true);
    });

    test('returns false for non-existent adapter', () => {
      expect(adapterRegistry.has('non-existent')).toBe(false);
    });
  });

  describe('clear', () => {
    test('removes all adapters', () => {
      adapterRegistry.register(createMockAdapter('adapter-1', 'claude-code'));
      adapterRegistry.register(createMockAdapter('adapter-2', 'openai'));

      adapterRegistry.clear();

      expect(adapterRegistry.getAll()).toEqual([]);
    });
  });
});

describe('getAdapter helper', () => {
  // Create mock adapters for testing
  const createMockAdapterForHelper = (id: string, type: IntegrationType): AgentAdapter => ({
    id,
    type,
    name: `Mock ${type} Adapter`,
    connect: async () => ({
      id: 'conn-1',
      adapterId: id,
      status: 'connected',
      credentials: { type: 'api-key', data: { key: 'test' } },
      connectedAt: new Date(),
    }),
    disconnect: async () => {},
    validateCredentials: async () => true,
    execute: async function* () {
      yield { type: 'completed', result: { success: true, output: 'test' } };
    },
    getCapabilities: () => ({
      supportsStreaming: true,
      supportsTools: true,
      supportsImages: false,
      maxContextTokens: 100000,
      supportedModels: ['test-model'],
    }),
    estimateCost: () => ({
      estimatedInputTokens: 100,
      estimatedOutputTokens: 200,
      estimatedCostUsd: 0.01,
      model: 'test-model',
    }),
  });

  beforeEach(() => {
    adapterRegistry.clear();
  });

  test('returns adapter when found', () => {
    const adapter = createMockAdapterForHelper('test-adapter', 'claude-code');
    adapterRegistry.register(adapter);

    const result = getAdapter('test-adapter');

    expect(result).toBe(adapter);
  });

  test('throws when adapter not found', () => {
    expect(() => getAdapter('non-existent')).toThrow(
      "Adapter 'non-existent' not found"
    );
  });
});

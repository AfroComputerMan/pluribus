/**
 * API Client Tests - Agents CRUD
 * TDD: Write tests first, then implement
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from './client';
import type { Agent } from './client';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('api.agents', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('list', () => {
    it('fetches agents list with default params', async () => {
      const mockAgents: Agent[] = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Test Agent',
          description: 'A test agent',
          tags: ['test'],
          modelConfig: { provider: 'anthropic', model: 'claude-3-opus' },
          memoryMode: 'stateless',
          isolationLevel: 'shared',
          canSpawnSubAgents: false,
          maxSubAgents: null,
          skills: [],
          allowedMcpTools: [],
          integration: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: mockAgents, meta: { limit: 50, offset: 0 } }),
      });

      const result = await api.agents.list();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/agents'),
        expect.objectContaining({ headers: expect.any(Headers) }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Test Agent');
    });

    it('passes limit and offset params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: [], meta: { limit: 10, offset: 20 } }),
      });

      await api.agents.list({ limit: 10, offset: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/limit=10.*offset=20|offset=20.*limit=10/),
        expect.any(Object),
      );
    });

    it('passes search param', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: [], meta: { limit: 50, offset: 0 } }),
      });

      await api.agents.list({ search: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('search=test'),
        expect.any(Object),
      );
    });

    it('passes tags filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: [], meta: { limit: 50, offset: 0 } }),
      });

      await api.agents.list({ tags: ['ai', 'coding'] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/tags=ai.*tags=coding|tags=coding.*tags=ai/),
        expect.any(Object),
      );
    });
  });

  describe('get', () => {
    it('fetches single agent by id', async () => {
      const mockAgent: Agent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Agent',
        description: 'A test agent',
        tags: ['test'],
        modelConfig: { provider: 'anthropic', model: 'claude-3-opus' },
        memoryMode: 'stateless',
        isolationLevel: 'shared',
        canSpawnSubAgents: false,
        maxSubAgents: null,
        skills: [],
        allowedMcpTools: [],
        integration: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: mockAgent }),
      });

      const result = await api.agents.get('123e4567-e89b-12d3-a456-426614174000');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/agents/123e4567-e89b-12d3-a456-426614174000'),
        expect.any(Object),
      );
      expect(result.data.name).toBe('Test Agent');
    });

    it('throws ApiError on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ error: 'Agent not found' }),
      });

      await expect(api.agents.get('nonexistent')).rejects.toThrow(ApiError);
    });
  });

  describe('create', () => {
    it('creates agent with POST request', async () => {
      const input = {
        name: 'New Agent',
        description: 'A new agent',
        tags: ['new'],
        modelConfig: { provider: 'anthropic' as const, model: 'claude-3-opus' },
        memoryMode: 'stateless' as const,
        isolationLevel: 'shared' as const,
        canSpawnSubAgents: false,
        maxSubAgents: null,
        skills: [],
        allowedMcpTools: [],
        integration: null,
      };

      const mockAgent: Agent = {
        ...input,
        id: '123e4567-e89b-12d3-a456-426614174000',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: mockAgent }),
      });

      const result = await api.agents.create(input);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/agents'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
      expect(result.data.id).toBe('123e4567-e89b-12d3-a456-426614174000');
    });
  });

  describe('update', () => {
    it('updates agent with PUT request', async () => {
      const input = { name: 'Updated Agent' };

      const mockAgent: Agent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Updated Agent',
        description: 'A test agent',
        tags: ['test'],
        modelConfig: { provider: 'anthropic', model: 'claude-3-opus' },
        memoryMode: 'stateless',
        isolationLevel: 'shared',
        canSpawnSubAgents: false,
        maxSubAgents: null,
        skills: [],
        allowedMcpTools: [],
        integration: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: mockAgent }),
      });

      const result = await api.agents.update('123e4567-e89b-12d3-a456-426614174000', input);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/agents/123e4567-e89b-12d3-a456-426614174000'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(input),
        }),
      );
      expect(result.data.name).toBe('Updated Agent');
    });
  });

  describe('delete', () => {
    it('deletes agent with DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({}),
      });

      await api.agents.delete('123e4567-e89b-12d3-a456-426614174000');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/agents/123e4567-e89b-12d3-a456-426614174000'),
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });
});

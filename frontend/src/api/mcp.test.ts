/**
 * MCP API Client Tests
 * Tests for MCP server and tool API methods
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from './client';

// Mock the global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('MCP API', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('mcp.servers.list', () => {
    it('fetches list of MCP servers', async () => {
      const mockServers = {
        data: [
          {
            id: 'server-1',
            name: 'Local MCP',
            transport: 'stdio',
            enabled: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        meta: { limit: 50, offset: 0 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve(mockServers),
      });

      const result = await api.mcp.servers.list();

      expect(mockFetch).toHaveBeenCalledWith('/api/mcp/servers', expect.any(Object));
      expect(result).toEqual(mockServers);
    });

    it('supports filter parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: [], meta: { limit: 10, offset: 0 } }),
      });

      await api.mcp.servers.list({ enabled: true, search: 'test', limit: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('enabled=true'),
        expect.any(Object),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('search=test'),
        expect.any(Object),
      );
    });
  });

  describe('mcp.servers.get', () => {
    it('fetches a single MCP server by ID', async () => {
      const mockServer = {
        data: {
          id: 'server-1',
          name: 'Local MCP',
          transport: 'stdio',
          enabled: true,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve(mockServer),
      });

      const result = await api.mcp.servers.get('server-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/mcp/servers/server-1', expect.any(Object));
      expect(result).toEqual(mockServer);
    });
  });

  describe('mcp.servers.discover', () => {
    it('triggers tool discovery for a server', async () => {
      const mockResult = {
        data: {
          serverId: 'server-1',
          toolsDiscovered: 5,
          tools: [{ name: 'tool1' }, { name: 'tool2' }],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve(mockResult),
      });

      const result = await api.mcp.servers.discover('server-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/mcp/servers/server-1/discover', {
        method: 'POST',
        headers: expect.any(Headers),
      });
      expect(result.data.toolsDiscovered).toBe(5);
    });
  });

  describe('mcp.tools.list', () => {
    it('fetches list of MCP tools', async () => {
      const mockTools = {
        data: [
          {
            id: 'tool-1',
            serverId: 'server-1',
            name: 'read_file',
            description: 'Read a file',
            enabled: true,
          },
        ],
        meta: { limit: 50, offset: 0 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve(mockTools),
      });

      const result = await api.mcp.tools.list();

      expect(mockFetch).toHaveBeenCalledWith('/api/mcp/tools', expect.any(Object));
      expect(result).toEqual(mockTools);
    });

    it('supports filtering by serverId', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: [], meta: { limit: 50, offset: 0 } }),
      });

      await api.mcp.tools.list({ serverId: 'server-1' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('serverId=server-1'),
        expect.any(Object),
      );
    });
  });

  describe('mcp.tools.update', () => {
    it('updates tool enabled status', async () => {
      const mockTool = {
        data: {
          id: 'tool-1',
          name: 'read_file',
          enabled: false,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve(mockTool),
      });

      const result = await api.mcp.tools.update('tool-1', { enabled: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/mcp/tools/tool-1', {
        method: 'PUT',
        headers: expect.any(Headers),
        body: JSON.stringify({ enabled: false }),
      });
      expect(result.data.enabled).toBe(false);
    });
  });

  describe('mcp.scan', () => {
    it('triggers a scan of all enabled servers', async () => {
      const mockResult = {
        data: {
          status: 'completed',
          message: 'All enabled servers scanned for tools',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve(mockResult),
      });

      const result = await api.mcp.scan();

      expect(mockFetch).toHaveBeenCalledWith('/api/mcp/scan', {
        method: 'POST',
        headers: expect.any(Headers),
      });
      expect(result.data.status).toBe('completed');
    });
  });
});

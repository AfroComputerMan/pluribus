/**
 * McpToolsPage Tests
 * Tests for MCP server and tool management page
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { McpToolsPage } from './McpToolsPage';
import { api } from '../api/client';

// Mock the API client
vi.mock('../api/client', () => ({
  api: {
    mcp: {
      servers: {
        list: vi.fn(),
        discover: vi.fn(),
      },
      tools: {
        list: vi.fn(),
        update: vi.fn(),
      },
      scan: vi.fn(),
    },
  },
}));

const mockApi = api as unknown as {
  mcp: {
    servers: {
      list: ReturnType<typeof vi.fn>;
      discover: ReturnType<typeof vi.fn>;
    };
    tools: {
      list: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    scan: ReturnType<typeof vi.fn>;
  };
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/mcp']}>
        <Routes>
          <Route path="/mcp" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('McpToolsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('Server List', () => {
    it('renders loading state initially', () => {
      mockApi.mcp.servers.list.mockReturnValue(new Promise(() => {})); // Never resolves
      mockApi.mcp.tools.list.mockReturnValue(new Promise(() => {}));

      render(<McpToolsPage />, { wrapper: createWrapper() });

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('displays list of MCP servers', async () => {
      mockApi.mcp.servers.list.mockResolvedValue({
        data: [
          {
            id: 'server-1',
            name: 'Local MCP Server',
            transport: 'stdio',
            enabled: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'server-2',
            name: 'Remote API Server',
            transport: 'http',
            enabled: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.tools.list.mockResolvedValue({
        data: [],
        meta: { limit: 50, offset: 0 },
      });

      render(<McpToolsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Local MCP Server')).toBeInTheDocument();
      });
      expect(screen.getByText('Remote API Server')).toBeInTheDocument();
    });

    it('shows enabled/disabled status badges', async () => {
      mockApi.mcp.servers.list.mockResolvedValue({
        data: [
          {
            id: 'server-1',
            name: 'Enabled Server',
            transport: 'stdio',
            enabled: true,
          },
          {
            id: 'server-2',
            name: 'Disabled Server',
            transport: 'http',
            enabled: false,
          },
        ],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.tools.list.mockResolvedValue({
        data: [],
        meta: { limit: 50, offset: 0 },
      });

      render(<McpToolsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Enabled')).toBeInTheDocument();
      });
      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('shows transport type for each server', async () => {
      mockApi.mcp.servers.list.mockResolvedValue({
        data: [
          { id: 'server-1', name: 'Stdio Server', transport: 'stdio', enabled: true },
          { id: 'server-2', name: 'HTTP Server', transport: 'http', enabled: true },
        ],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.tools.list.mockResolvedValue({
        data: [],
        meta: { limit: 50, offset: 0 },
      });

      render(<McpToolsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('stdio')).toBeInTheDocument();
      });
      expect(screen.getByText('http')).toBeInTheDocument();
    });

    it('displays error state when server list fails', async () => {
      mockApi.mcp.servers.list.mockRejectedValue(new Error('Network error'));
      mockApi.mcp.tools.list.mockResolvedValue({
        data: [],
        meta: { limit: 50, offset: 0 },
      });

      render(<McpToolsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });
    });
  });

  describe('Tool Discovery', () => {
    it('triggers tool discovery for a server', async () => {
      const user = userEvent.setup();

      mockApi.mcp.servers.list.mockResolvedValue({
        data: [
          { id: 'server-1', name: 'Test Server', transport: 'stdio', enabled: true },
        ],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.tools.list.mockResolvedValue({
        data: [],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.servers.discover.mockResolvedValue({
        data: { serverId: 'server-1', toolsDiscovered: 3, tools: [] },
      });

      render(<McpToolsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Test Server')).toBeInTheDocument();
      });

      const discoverButton = screen.getByRole('button', { name: /discover/i });
      await user.click(discoverButton);

      await waitFor(() => {
        expect(mockApi.mcp.servers.discover).toHaveBeenCalledWith('server-1');
      });
    });

    it('shows discovery results', async () => {
      const user = userEvent.setup();

      mockApi.mcp.servers.list.mockResolvedValue({
        data: [
          { id: 'server-1', name: 'Test Server', transport: 'stdio', enabled: true },
        ],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.tools.list.mockResolvedValue({
        data: [],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.servers.discover.mockResolvedValue({
        data: { serverId: 'server-1', toolsDiscovered: 5, tools: [] },
      });

      render(<McpToolsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Test Server')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /discover/i }));

      await waitFor(() => {
        expect(screen.getByText(/5 tools discovered/i)).toBeInTheDocument();
      });
    });
  });

  describe('Tool List', () => {
    it('displays tools for selected server', async () => {
      const user = userEvent.setup();

      mockApi.mcp.servers.list.mockResolvedValue({
        data: [
          { id: 'server-1', name: 'Test Server', transport: 'stdio', enabled: true },
        ],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.tools.list.mockResolvedValue({
        data: [
          {
            id: 'tool-1',
            serverId: 'server-1',
            name: 'read_file',
            description: 'Reads a file from disk',
            enabled: true,
          },
          {
            id: 'tool-2',
            serverId: 'server-1',
            name: 'write_file',
            description: 'Writes content to a file',
            enabled: true,
          },
        ],
        meta: { limit: 50, offset: 0 },
      });

      render(<McpToolsPage />, { wrapper: createWrapper() });

      // Click on server to show its tools
      await waitFor(() => {
        expect(screen.getByText('Test Server')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Test Server'));

      await waitFor(() => {
        expect(screen.getByText('read_file')).toBeInTheDocument();
      });
      expect(screen.getByText('write_file')).toBeInTheDocument();
    });

    it('toggles tool enabled status', async () => {
      const user = userEvent.setup();

      mockApi.mcp.servers.list.mockResolvedValue({
        data: [
          { id: 'server-1', name: 'Test Server', transport: 'stdio', enabled: true },
        ],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.tools.list.mockResolvedValue({
        data: [
          {
            id: 'tool-1',
            serverId: 'server-1',
            name: 'read_file',
            description: 'Reads a file',
            enabled: true,
          },
        ],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.tools.update.mockResolvedValue({
        data: { id: 'tool-1', name: 'read_file', enabled: false },
      });

      render(<McpToolsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Test Server')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Test Server'));

      await waitFor(() => {
        expect(screen.getByText('read_file')).toBeInTheDocument();
      });

      // Find and click the toggle switch
      const toggleSwitch = screen.getByRole('switch');
      await user.click(toggleSwitch);

      await waitFor(() => {
        expect(mockApi.mcp.tools.update).toHaveBeenCalledWith('tool-1', { enabled: false });
      });
    });
  });

  describe('Scan All', () => {
    it('triggers scan of all servers', async () => {
      const user = userEvent.setup();

      mockApi.mcp.servers.list.mockResolvedValue({
        data: [
          { id: 'server-1', name: 'Server 1', transport: 'stdio', enabled: true },
          { id: 'server-2', name: 'Server 2', transport: 'http', enabled: true },
        ],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.tools.list.mockResolvedValue({
        data: [],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.scan.mockResolvedValue({
        data: { status: 'completed', message: 'All servers scanned' },
      });

      render(<McpToolsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Server 1')).toBeInTheDocument();
      });

      const scanButton = screen.getByRole('button', { name: /scan all/i });
      await user.click(scanButton);

      await waitFor(() => {
        expect(mockApi.mcp.scan).toHaveBeenCalled();
      });
    });
  });

  describe('Empty State', () => {
    it('shows empty state when no servers exist', async () => {
      mockApi.mcp.servers.list.mockResolvedValue({
        data: [],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.tools.list.mockResolvedValue({
        data: [],
        meta: { limit: 50, offset: 0 },
      });

      render(<McpToolsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText(/no mcp servers/i)).toBeInTheDocument();
      });
    });
  });

  describe('Search', () => {
    it('filters servers by search term', async () => {
      const user = userEvent.setup();

      mockApi.mcp.servers.list.mockResolvedValue({
        data: [
          { id: 'server-1', name: 'Filesystem MCP', transport: 'stdio', enabled: true },
          { id: 'server-2', name: 'GitHub API', transport: 'http', enabled: true },
        ],
        meta: { limit: 50, offset: 0 },
      });
      mockApi.mcp.tools.list.mockResolvedValue({
        data: [],
        meta: { limit: 50, offset: 0 },
      });

      render(<McpToolsPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Filesystem MCP')).toBeInTheDocument();
        expect(screen.getByText('GitHub API')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'GitHub');

      await waitFor(() => {
        expect(screen.queryByText('Filesystem MCP')).not.toBeInTheDocument();
      });
      expect(screen.getByText('GitHub API')).toBeInTheDocument();
    });
  });
});

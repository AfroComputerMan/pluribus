/**
 * McpToolsPage
 * Displays list of MCP servers and their tools with management capabilities
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type McpServer, type McpTool } from '../api/client';
import { Button } from '../components/Button';

// Custom status badge for enabled/disabled
function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

export function McpToolsPage() {
  const queryClient = useQueryClient();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null);

  // Fetch MCP servers
  const {
    data: serversData,
    isLoading: serversLoading,
    error: serversError,
  } = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: () => api.mcp.servers.list(),
  });

  // Fetch tools (filtered by selected server if any)
  const { data: toolsData, isLoading: toolsLoading } = useQuery({
    queryKey: ['mcp-tools', selectedServerId],
    queryFn: () =>
      api.mcp.tools.list(selectedServerId ? { serverId: selectedServerId } : undefined),
    enabled: !!selectedServerId,
  });

  // Discover tools mutation
  const discoverMutation = useMutation({
    mutationFn: (serverId: string) => api.mcp.servers.discover(serverId),
    onSuccess: (result) => {
      setDiscoveryMessage(`${result.data.toolsDiscovered} tools discovered`);
      queryClient.invalidateQueries({ queryKey: ['mcp-tools'] });
      setTimeout(() => setDiscoveryMessage(null), 3000);
    },
  });

  // Scan all servers mutation
  const scanMutation = useMutation({
    mutationFn: () => api.mcp.scan(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-tools'] });
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
  });

  // Toggle tool enabled status mutation
  const toggleToolMutation = useMutation({
    mutationFn: ({ toolId, enabled }: { toolId: string; enabled: boolean }) =>
      api.mcp.tools.update(toolId, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-tools'] });
    },
  });

  const handleServerClick = (server: McpServer) => {
    setSelectedServerId(server.id === selectedServerId ? null : server.id);
  };

  const handleDiscover = (serverId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    discoverMutation.mutate(serverId);
  };

  const handleToggleTool = (tool: McpTool) => {
    toggleToolMutation.mutate({ toolId: tool.id, enabled: !tool.enabled });
  };

  // Filter servers by search term
  const filteredServers =
    serversData?.data.filter(
      (server) =>
        server.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        server.description?.toLowerCase().includes(searchTerm.toLowerCase()),
    ) || [];

  if (serversLoading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">MCP Tools</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          Loading MCP servers...
        </div>
      </div>
    );
  }

  if (serversError) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">MCP Tools</h1>
        <div className="bg-white shadow rounded-lg p-8 text-center text-red-500">
          Error loading MCP servers: {serversError.message}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">MCP Tools</h1>
        <Button
          variant="primary"
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
        >
          {scanMutation.isPending ? 'Scanning...' : 'Scan All'}
        </Button>
      </div>

      {/* Discovery message */}
      {discoveryMessage && (
        <div className="mb-4 p-3 bg-green-100 text-green-800 rounded-md">
          {discoveryMessage}
        </div>
      )}

      {/* Search input */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search servers..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Empty state */}
      {filteredServers.length === 0 && (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          No MCP servers found. Configure MCP servers in the backend to get started.
        </div>
      )}

      {/* Server list */}
      <div className="space-y-4">
        {filteredServers.map((server) => (
          <div
            key={server.id}
            className="bg-white shadow rounded-lg overflow-hidden"
          >
            {/* Server header */}
            <div
              className="p-4 cursor-pointer hover:bg-gray-50 flex items-center justify-between"
              onClick={() => handleServerClick(server)}
            >
              <div className="flex items-center gap-4">
                <div>
                  <h3 className="font-medium text-gray-900">{server.name}</h3>
                  {server.description && (
                    <p className="text-sm text-gray-500">{server.description}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600 font-mono">{server.transport}</span>
                <EnabledBadge enabled={server.enabled} />
                <Button
                  variant="secondary"
                  onClick={(e) => handleDiscover(server.id, e)}
                  disabled={discoverMutation.isPending}
                >
                  {discoverMutation.isPending && discoverMutation.variables === server.id
                    ? 'Discovering...'
                    : 'Discover'}
                </Button>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${
                    selectedServerId === server.id ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>

            {/* Tools list (expanded) */}
            {selectedServerId === server.id && (
              <div className="border-t border-gray-200 bg-gray-50 p-4">
                {toolsLoading ? (
                  <p className="text-gray-500 text-sm">Loading tools...</p>
                ) : toolsData?.data.length === 0 ? (
                  <p className="text-gray-500 text-sm">
                    No tools found. Click "Discover" to scan for tools.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      Available Tools ({toolsData?.data.length || 0})
                    </h4>
                    {toolsData?.data.map((tool) => (
                      <div
                        key={tool.id}
                        className="flex items-center justify-between bg-white p-3 rounded border border-gray-200"
                      >
                        <div>
                          <span className="font-mono text-sm text-gray-900">
                            {tool.name}
                          </span>
                          {tool.description && (
                            <p className="text-xs text-gray-500">{tool.description}</p>
                          )}
                        </div>
                        <button
                          role="switch"
                          aria-checked={tool.enabled}
                          onClick={() => handleToggleTool(tool)}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                            tool.enabled ? 'bg-blue-600' : 'bg-gray-200'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              tool.enabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

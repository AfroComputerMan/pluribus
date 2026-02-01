import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExecutionPage } from './ExecutionPage';

// Mock the API client
vi.mock('../api/client', () => ({
  api: {
    workflowRuns: {
      get: vi.fn(),
    },
    workflows: {
      get: vi.fn(),
    },
    nodeRuns: {
      list: vi.fn(),
    },
  },
}));

// Mock useWorkflowEvents hook
vi.mock('../hooks/useWorkflowEvents', () => ({
  useWorkflowEvents: vi.fn(() => ({
    events: [],
    latestEvent: null,
    isConnected: true,
    error: null,
    close: vi.fn(),
  })),
}));

// Mock React Flow
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children, nodes, onNodeClick }: {
    children: React.ReactNode;
    nodes: Array<{ id: string; data: Record<string, unknown> }>;
    onNodeClick?: (event: unknown, node: { id: string }) => void;
  }) => (
    <div data-testid="react-flow">
      {nodes?.map((node) => (
        <div
          key={node.id}
          data-testid={`node-${node.id}`}
          data-status={node.data.executionStatus}
          onClick={(e) => onNodeClick?.(e, node)}
        >
          {String(node.data.label || node.id)}
        </div>
      ))}
      {children}
    </div>
  ),
  Background: () => <div data-testid="react-flow-background" />,
  Controls: () => <div data-testid="react-flow-controls" />,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

// Import mocked modules
import { api } from '../api/client';
import { useWorkflowEvents } from '../hooks/useWorkflowEvents';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as any;

const mockUseWorkflowEvents = useWorkflowEvents as ReturnType<typeof vi.fn>;

function renderWithProviders(runId: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/runs/${runId}/visualize`]}>
        <Routes>
          <Route path="/runs/:id/visualize" element={<ExecutionPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ExecutionPage', () => {
  const mockRun = {
    id: 'run-1',
    workflowId: 'workflow-1',
    status: 'running',
    input: {},
    output: null,
    error: null,
    startedAt: '2026-02-01T10:00:00Z',
    completedAt: null,
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-02-01T10:00:00Z',
  };

  const mockWorkflow = {
    id: 'workflow-1',
    name: 'Test Workflow',
    description: 'A test workflow',
    nodes: [
      { id: 'node-1', type: 'agent', label: 'Agent 1' },
      { id: 'node-2', type: 'agent', label: 'Agent 2' },
    ],
    edges: [
      { id: 'edge-1', from: 'node-1', to: 'node-2' },
    ],
    triggers: [],
    errorStrategy: {},
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-02-01T10:00:00Z',
  };

  const mockNodeRuns = [
    {
      id: 'exec-1',
      workflowRunId: 'run-1',
      nodeId: 'node-1',
      status: 'completed',
      input: {},
      output: { result: 'ok' },
      error: null,
      startedAt: '2026-02-01T10:00:01Z',
      completedAt: '2026-02-01T10:00:03Z',
      createdAt: '2026-02-01T10:00:01Z',
      updatedAt: '2026-02-01T10:00:03Z',
    },
    {
      id: 'exec-2',
      workflowRunId: 'run-1',
      nodeId: 'node-2',
      status: 'running',
      input: {},
      output: null,
      error: null,
      startedAt: '2026-02-01T10:00:03Z',
      completedAt: null,
      createdAt: '2026-02-01T10:00:03Z',
      updatedAt: '2026-02-01T10:00:03Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    mockApi.workflowRuns.get.mockResolvedValue({ data: mockRun });
    mockApi.workflows.get.mockResolvedValue({ data: mockWorkflow });
    mockApi.nodeRuns.list.mockResolvedValue({ data: mockNodeRuns });
  });

  describe('loading state', () => {
    it('shows loading state while fetching data', () => {
      mockApi.workflowRuns.get.mockReturnValue(new Promise(() => {})); // Never resolves

      renderWithProviders('run-1');

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('data display', () => {
    it('displays workflow name in header', async () => {
      renderWithProviders('run-1');

      await waitFor(() => {
        expect(screen.getByText('Test Workflow')).toBeInTheDocument();
      });
    });

    it('displays run status', async () => {
      renderWithProviders('run-1');

      await waitFor(() => {
        // StatusBadge capitalizes the first letter
        expect(screen.getByText('Running')).toBeInTheDocument();
      });
    });

    it('renders ExecutionOverlay with nodes', async () => {
      renderWithProviders('run-1');

      await waitFor(() => {
        expect(screen.getByTestId('react-flow')).toBeInTheDocument();
      });
    });
  });

  describe('SSE integration', () => {
    it('calls useWorkflowEvents with run ID when run is active', async () => {
      renderWithProviders('run-1');

      // Wait for the data to load
      await waitFor(() => {
        expect(screen.getByText('Test Workflow')).toBeInTheDocument();
      });

      // Verify the hook was called (it gets called during initial render and after data loads)
      expect(mockUseWorkflowEvents).toHaveBeenCalled();

      // Check that the last call was with the run ID (when run is active)
      const calls = mockUseWorkflowEvents.mock.calls;
      const lastCallWithId = calls.find((call: unknown[]) => call[0] === 'run-1');
      expect(lastCallWithId).toBeDefined();
    });

    it('does not enable SSE when run is completed', async () => {
      // Override with a completed run
      mockApi.workflowRuns.get.mockResolvedValue({
        data: { ...mockRun, status: 'completed' },
      });

      renderWithProviders('run-1');

      // Wait for the data to load
      await waitFor(() => {
        expect(screen.getByText('Test Workflow')).toBeInTheDocument();
      });

      // Verify hook was called with undefined runId (since run is not active)
      expect(mockUseWorkflowEvents).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ enabled: false })
      );
    });
  });

  describe('node click handling', () => {
    it('opens modal when node is clicked', async () => {
      renderWithProviders('run-1');

      await waitFor(() => {
        expect(screen.getByTestId('node-node-1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('node-node-1'));

      await waitFor(() => {
        expect(screen.getByText('Node Execution Details')).toBeInTheDocument();
      });
    });

    it('closes modal when close button is clicked', async () => {
      renderWithProviders('run-1');

      await waitFor(() => {
        expect(screen.getByTestId('node-node-1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('node-node-1'));

      await waitFor(() => {
        expect(screen.getByText('Node Execution Details')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /close/i }));

      await waitFor(() => {
        expect(screen.queryByText('Node Execution Details')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when run fetch fails', async () => {
      mockApi.workflowRuns.get.mockRejectedValue(new Error('Failed to fetch'));

      renderWithProviders('run-1');

      await waitFor(() => {
        expect(screen.getByText(/error|failed/i)).toBeInTheDocument();
      });
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExecutionOverlay } from './ExecutionOverlay';
import type { NodeRun } from '../../api/client';

// Mock React Flow
interface MockNodeData {
  label?: string;
  executionStatus?: string;
  duration?: string;
}

interface MockNode {
  id: string;
  data: MockNodeData;
}

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children, nodes, onNodeClick }: {
    children: React.ReactNode;
    nodes: MockNode[];
    onNodeClick?: (event: unknown, node: { id: string }) => void;
  }) => (
    <div data-testid="react-flow">
      {nodes.map((node) => (
        <div
          key={node.id}
          data-testid={`node-${node.id}`}
          data-status={node.data.executionStatus}
          onClick={(e) => onNodeClick?.(e, node)}
        >
          {node.data.label || node.id}
          {node.data.executionStatus && (
            <span data-testid={`status-${node.id}`}>{node.data.executionStatus}</span>
          )}
          {node.data.duration && (
            <span data-testid={`duration-${node.id}`}>{node.data.duration}</span>
          )}
        </div>
      ))}
      {children}
    </div>
  ),
  Background: () => <div data-testid="react-flow-background" />,
  Controls: () => <div data-testid="react-flow-controls" />,
  MiniMap: () => <div data-testid="react-flow-minimap" />,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

describe('ExecutionOverlay', () => {
  const mockNodes = [
    { id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: { label: 'Agent 1' } },
    { id: 'node-2', type: 'agent', position: { x: 200, y: 0 }, data: { label: 'Agent 2' } },
    { id: 'node-3', type: 'condition', position: { x: 100, y: 100 }, data: { label: 'Check' } },
  ];

  const mockEdges = [
    { id: 'edge-1', source: 'node-1', target: 'node-3' },
    { id: 'edge-2', source: 'node-2', target: 'node-3' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders React Flow canvas with nodes', () => {
      render(
        <ExecutionOverlay
          nodes={mockNodes}
          edges={mockEdges}
          nodeExecutions={[]}
        />
      );

      expect(screen.getByTestId('react-flow')).toBeInTheDocument();
      expect(screen.getByTestId('node-node-1')).toBeInTheDocument();
      expect(screen.getByTestId('node-node-2')).toBeInTheDocument();
      expect(screen.getByTestId('node-node-3')).toBeInTheDocument();
    });

    it('renders background and controls', () => {
      render(
        <ExecutionOverlay
          nodes={mockNodes}
          edges={mockEdges}
          nodeExecutions={[]}
        />
      );

      expect(screen.getByTestId('react-flow-background')).toBeInTheDocument();
      expect(screen.getByTestId('react-flow-controls')).toBeInTheDocument();
    });

    it('renders minimap when showMiniMap is true', () => {
      render(
        <ExecutionOverlay
          nodes={mockNodes}
          edges={mockEdges}
          nodeExecutions={[]}
          showMiniMap
        />
      );

      expect(screen.getByTestId('react-flow-minimap')).toBeInTheDocument();
    });
  });

  describe('node status mapping', () => {
    it('maps pending status to nodes', () => {
      const nodeExecutions: NodeRun[] = [
        {
          id: 'exec-1',
          workflowRunId: 'run-1',
          nodeId: 'node-1',
          status: 'pending',
          input: {},
          output: null,
          error: null,
          startedAt: null,
          completedAt: null,
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ];

      render(
        <ExecutionOverlay
          nodes={mockNodes}
          edges={mockEdges}
          nodeExecutions={nodeExecutions}
        />
      );

      expect(screen.getByTestId('status-node-1')).toHaveTextContent('pending');
    });

    it('maps running status to nodes', () => {
      const nodeExecutions: NodeRun[] = [
        {
          id: 'exec-1',
          workflowRunId: 'run-1',
          nodeId: 'node-1',
          status: 'running',
          input: {},
          output: null,
          error: null,
          startedAt: '2026-02-01T00:00:00Z',
          completedAt: null,
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ];

      render(
        <ExecutionOverlay
          nodes={mockNodes}
          edges={mockEdges}
          nodeExecutions={nodeExecutions}
        />
      );

      expect(screen.getByTestId('status-node-1')).toHaveTextContent('running');
    });

    it('maps completed status to nodes', () => {
      const nodeExecutions: NodeRun[] = [
        {
          id: 'exec-1',
          workflowRunId: 'run-1',
          nodeId: 'node-1',
          status: 'completed',
          input: {},
          output: { result: 'success' },
          error: null,
          startedAt: '2026-02-01T00:00:00Z',
          completedAt: '2026-02-01T00:00:05Z',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:05Z',
        },
      ];

      render(
        <ExecutionOverlay
          nodes={mockNodes}
          edges={mockEdges}
          nodeExecutions={nodeExecutions}
        />
      );

      expect(screen.getByTestId('status-node-1')).toHaveTextContent('completed');
    });

    it('maps failed status to nodes', () => {
      const nodeExecutions: NodeRun[] = [
        {
          id: 'exec-1',
          workflowRunId: 'run-1',
          nodeId: 'node-1',
          status: 'failed',
          input: {},
          output: null,
          error: 'Something went wrong',
          startedAt: '2026-02-01T00:00:00Z',
          completedAt: '2026-02-01T00:00:03Z',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:03Z',
        },
      ];

      render(
        <ExecutionOverlay
          nodes={mockNodes}
          edges={mockEdges}
          nodeExecutions={nodeExecutions}
        />
      );

      expect(screen.getByTestId('status-node-1')).toHaveTextContent('failed');
    });

    it('shows duration for completed nodes', () => {
      const nodeExecutions: NodeRun[] = [
        {
          id: 'exec-1',
          workflowRunId: 'run-1',
          nodeId: 'node-1',
          status: 'completed',
          input: {},
          output: {},
          error: null,
          startedAt: '2026-02-01T00:00:00Z',
          completedAt: '2026-02-01T00:00:05Z',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:05Z',
        },
      ];

      render(
        <ExecutionOverlay
          nodes={mockNodes}
          edges={mockEdges}
          nodeExecutions={nodeExecutions}
        />
      );

      expect(screen.getByTestId('duration-node-1')).toHaveTextContent('5s');
    });
  });

  describe('node click handling', () => {
    it('calls onNodeClick when a node is clicked', () => {
      const onNodeClick = vi.fn();

      render(
        <ExecutionOverlay
          nodes={mockNodes}
          edges={mockEdges}
          nodeExecutions={[]}
          onNodeClick={onNodeClick}
        />
      );

      fireEvent.click(screen.getByTestId('node-node-1'));

      expect(onNodeClick).toHaveBeenCalledWith('node-1');
    });
  });

  describe('connection status', () => {
    it('shows connected indicator when isConnected is true', () => {
      render(
        <ExecutionOverlay
          nodes={mockNodes}
          edges={mockEdges}
          nodeExecutions={[]}
          isConnected={true}
        />
      );

      expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('shows disconnected indicator when isConnected is false', () => {
      render(
        <ExecutionOverlay
          nodes={mockNodes}
          edges={mockEdges}
          nodeExecutions={[]}
          isConnected={false}
        />
      );

      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });
  });
});

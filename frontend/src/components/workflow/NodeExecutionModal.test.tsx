import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeExecutionModal } from './NodeExecutionModal';
import type { NodeRun } from '../../api/client';

describe('NodeExecutionModal', () => {
  const baseExecution: NodeRun = {
    id: 'exec-1',
    workflowRunId: 'run-1',
    nodeId: 'node-1',
    status: 'completed',
    input: { message: 'Hello' },
    output: { result: 'Success' },
    error: null,
    startedAt: '2026-02-01T10:00:00Z',
    completedAt: '2026-02-01T10:00:05Z',
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-02-01T10:00:05Z',
  };

  describe('rendering', () => {
    it('renders nothing when execution is null', () => {
      const { container } = render(
        <NodeExecutionModal execution={null} onClose={vi.fn()} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders modal when execution is provided', () => {
      render(<NodeExecutionModal execution={baseExecution} onClose={vi.fn()} />);

      expect(screen.getByText('Node Execution Details')).toBeInTheDocument();
    });

    it('displays node ID', () => {
      render(<NodeExecutionModal execution={baseExecution} onClose={vi.fn()} />);

      expect(screen.getByText('node-1')).toBeInTheDocument();
    });

    it('displays execution status', () => {
      render(<NodeExecutionModal execution={baseExecution} onClose={vi.fn()} />);

      expect(screen.getByText('completed')).toBeInTheDocument();
    });
  });

  describe('timestamps', () => {
    it('displays started timestamp', () => {
      render(<NodeExecutionModal execution={baseExecution} onClose={vi.fn()} />);

      expect(screen.getByText(/Started/)).toBeInTheDocument();
    });

    it('displays completed timestamp', () => {
      render(<NodeExecutionModal execution={baseExecution} onClose={vi.fn()} />);

      expect(screen.getByText(/Completed/)).toBeInTheDocument();
    });

    it('displays duration', () => {
      render(<NodeExecutionModal execution={baseExecution} onClose={vi.fn()} />);

      expect(screen.getByText('5s')).toBeInTheDocument();
    });

    it('shows pending state for nodes not yet started', () => {
      const pendingExecution: NodeRun = {
        ...baseExecution,
        status: 'pending',
        startedAt: null,
        completedAt: null,
      };

      render(<NodeExecutionModal execution={pendingExecution} onClose={vi.fn()} />);

      expect(screen.getByText('pending')).toBeInTheDocument();
    });
  });

  describe('input/output display', () => {
    it('displays input JSON', () => {
      render(<NodeExecutionModal execution={baseExecution} onClose={vi.fn()} />);

      expect(screen.getByText('Input')).toBeInTheDocument();
      expect(screen.getByText(/"message"/)).toBeInTheDocument();
    });

    it('displays output JSON', () => {
      render(<NodeExecutionModal execution={baseExecution} onClose={vi.fn()} />);

      expect(screen.getByText('Output')).toBeInTheDocument();
      expect(screen.getByText(/"result"/)).toBeInTheDocument();
    });

    it('handles empty input', () => {
      const emptyInput: NodeRun = {
        ...baseExecution,
        input: {},
      };

      render(<NodeExecutionModal execution={emptyInput} onClose={vi.fn()} />);

      expect(screen.getByText('Input')).toBeInTheDocument();
    });

    it('handles null output', () => {
      const nullOutput: NodeRun = {
        ...baseExecution,
        output: null,
      };

      render(<NodeExecutionModal execution={nullOutput} onClose={vi.fn()} />);

      // Should still show Output section with "No output" or similar
      expect(screen.getByText('Output')).toBeInTheDocument();
    });
  });

  describe('error display', () => {
    it('displays error message for failed executions', () => {
      const failedExecution: NodeRun = {
        ...baseExecution,
        status: 'failed',
        error: 'Something went wrong during execution',
        output: null,
      };

      render(<NodeExecutionModal execution={failedExecution} onClose={vi.fn()} />);

      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('Something went wrong during execution')).toBeInTheDocument();
    });

    it('does not display error section when no error', () => {
      render(<NodeExecutionModal execution={baseExecution} onClose={vi.fn()} />);

      expect(screen.queryByText('Error')).not.toBeInTheDocument();
    });
  });

  describe('close functionality', () => {
    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();

      render(<NodeExecutionModal execution={baseExecution} onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: /close/i }));

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn();

      render(<NodeExecutionModal execution={baseExecution} onClose={onClose} />);

      fireEvent.click(screen.getByTestId('modal-backdrop'));

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('status-specific styling', () => {
    it('shows success styling for completed status', () => {
      render(<NodeExecutionModal execution={baseExecution} onClose={vi.fn()} />);

      const statusBadge = screen.getByText('completed');
      expect(statusBadge.className).toContain('green');
    });

    it('shows error styling for failed status', () => {
      const failedExecution: NodeRun = {
        ...baseExecution,
        status: 'failed',
        error: 'Error',
      };

      render(<NodeExecutionModal execution={failedExecution} onClose={vi.fn()} />);

      const statusBadge = screen.getByText('failed');
      expect(statusBadge.className).toContain('red');
    });

    it('shows running styling for running status', () => {
      const runningExecution: NodeRun = {
        ...baseExecution,
        status: 'running',
        completedAt: null,
      };

      render(<NodeExecutionModal execution={runningExecution} onClose={vi.fn()} />);

      const statusBadge = screen.getByText('running');
      expect(statusBadge.className).toContain('blue');
    });
  });
});

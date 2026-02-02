// frontend/src/components/workflow/LogStreamViewer.test.tsx
// TDD: Tests for LogStreamViewer component

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LogStreamViewer } from './LogStreamViewer';
import type { LogEntry } from '../../api/client';

describe('LogStreamViewer', () => {
  const mockLogs: LogEntry[] = [
    {
      id: 1,
      timestamp: '2026-01-30T10:00:00Z',
      level: 'info',
      source: 'workflow-engine',
      message: 'Workflow started',
      workflowRunId: 'run-1',
    },
    {
      id: 2,
      timestamp: '2026-01-30T10:00:01Z',
      level: 'debug',
      source: 'node-executor',
      message: 'Processing node-1',
      workflowRunId: 'run-1',
      nodeExecutionId: 'node-exec-1',
    },
    {
      id: 3,
      timestamp: '2026-01-30T10:00:02Z',
      level: 'error',
      source: 'agent-runtime',
      message: 'Agent task failed: timeout',
      workflowRunId: 'run-1',
      nodeExecutionId: 'node-exec-1',
    },
    {
      id: 4,
      timestamp: '2026-01-30T10:00:03Z',
      level: 'warn',
      source: 'node-executor',
      message: 'Retrying node execution',
      workflowRunId: 'run-1',
      nodeExecutionId: 'node-exec-2',
    },
  ];

  describe('log display', () => {
    it('renders all log entries', () => {
      render(<LogStreamViewer logs={mockLogs} />);

      expect(screen.getByText('Workflow started')).toBeInTheDocument();
      expect(screen.getByText('Processing node-1')).toBeInTheDocument();
      expect(screen.getByText('Agent task failed: timeout')).toBeInTheDocument();
      expect(screen.getByText('Retrying node execution')).toBeInTheDocument();
    });

    it('displays timestamps for each log', () => {
      render(<LogStreamViewer logs={mockLogs} />);

      // Should display 4 timestamp elements (one per log)
      // Format varies by locale, so just check that we have timestamp containers
      const container = screen.getByTestId('log-container');
      const timestamps = container.querySelectorAll('.text-gray-500.w-20');
      expect(timestamps).toHaveLength(4);
    });

    it('displays log level with appropriate styling', () => {
      render(<LogStreamViewer logs={mockLogs} />);

      const errorBadge = screen.getByText('error');
      const warnBadge = screen.getByText('warn');
      const infoBadge = screen.getByText('info');
      const debugBadge = screen.getByText('debug');

      expect(errorBadge.className).toContain('text-red');
      expect(warnBadge.className).toContain('text-yellow');
      expect(infoBadge.className).toContain('text-blue');
      expect(debugBadge.className).toContain('text-gray');
    });

    it('displays source for each log', () => {
      render(<LogStreamViewer logs={mockLogs} />);

      expect(screen.getByText('workflow-engine')).toBeInTheDocument();
      expect(screen.getAllByText('node-executor')).toHaveLength(2);
      expect(screen.getByText('agent-runtime')).toBeInTheDocument();
    });

    it('shows empty state when no logs', () => {
      render(<LogStreamViewer logs={[]} />);

      expect(screen.getByText(/No logs/i)).toBeInTheDocument();
    });
  });

  describe('node filtering', () => {
    it('filters logs by node ID', () => {
      render(<LogStreamViewer logs={mockLogs} filterNodeId="node-exec-1" />);

      // Should only show logs for node-exec-1
      expect(screen.getByText('Processing node-1')).toBeInTheDocument();
      expect(screen.getByText('Agent task failed: timeout')).toBeInTheDocument();
      expect(screen.queryByText('Workflow started')).not.toBeInTheDocument();
      expect(screen.queryByText('Retrying node execution')).not.toBeInTheDocument();
    });

    it('shows all logs when no filter', () => {
      render(<LogStreamViewer logs={mockLogs} />);

      expect(screen.getByText('Workflow started')).toBeInTheDocument();
      expect(screen.getByText('Retrying node execution')).toBeInTheDocument();
    });
  });

  describe('level filtering', () => {
    it('filters logs by level', () => {
      render(<LogStreamViewer logs={mockLogs} filterLevel="error" />);

      expect(screen.getByText('Agent task failed: timeout')).toBeInTheDocument();
      expect(screen.queryByText('Workflow started')).not.toBeInTheDocument();
    });

    it('allows user to change level filter', async () => {
      render(<LogStreamViewer logs={mockLogs} showLevelFilter />);

      const select = screen.getByTestId('level-filter');
      fireEvent.change(select, { target: { value: 'error' } });

      await waitFor(() => {
        expect(screen.getByText('Agent task failed: timeout')).toBeInTheDocument();
        expect(screen.queryByText('Workflow started')).not.toBeInTheDocument();
      });
    });
  });

  describe('auto-scroll', () => {
    it('enables auto-scroll by default', () => {
      render(<LogStreamViewer logs={mockLogs} />);

      const container = screen.getByTestId('log-container');
      expect(container.getAttribute('data-auto-scroll')).toBe('true');
    });

    it('allows disabling auto-scroll', () => {
      render(<LogStreamViewer logs={mockLogs} autoScroll={false} />);

      const container = screen.getByTestId('log-container');
      expect(container.getAttribute('data-auto-scroll')).toBe('false');
    });

    it('shows auto-scroll toggle button', () => {
      render(<LogStreamViewer logs={mockLogs} showAutoScrollToggle />);

      expect(screen.getByRole('button', { name: /auto-scroll/i })).toBeInTheDocument();
    });
  });

  describe('search functionality', () => {
    it('filters logs by search text', () => {
      render(<LogStreamViewer logs={mockLogs} searchText="timeout" />);

      // Text is split by highlight, so search for partial match
      expect(screen.getByText(/Agent task failed/)).toBeInTheDocument();
      expect(screen.queryByText('Workflow started')).not.toBeInTheDocument();
    });

    it('shows search input when showSearch is true', () => {
      render(<LogStreamViewer logs={mockLogs} showSearch />);

      expect(screen.getByPlaceholderText(/Search logs/i)).toBeInTheDocument();
    });

    it('highlights matching text in search results', () => {
      render(<LogStreamViewer logs={mockLogs} searchText="timeout" />);

      const highlight = screen.getByText('timeout');
      expect(highlight.tagName).toBe('MARK');
    });
  });

  describe('loading state', () => {
    it('shows loading indicator when isLoading is true', () => {
      render(<LogStreamViewer logs={[]} isLoading />);

      expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
    });

    it('shows streaming indicator when isStreaming is true', () => {
      render(<LogStreamViewer logs={mockLogs} isStreaming />);

      expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument();
    });
  });

  describe('max height', () => {
    it('applies max height style', () => {
      render(<LogStreamViewer logs={mockLogs} maxHeight="400px" />);

      const container = screen.getByTestId('log-container');
      expect(container.style.maxHeight).toBe('400px');
    });

    it('defaults to 300px max height', () => {
      render(<LogStreamViewer logs={mockLogs} />);

      const container = screen.getByTestId('log-container');
      expect(container.style.maxHeight).toBe('300px');
    });
  });
});

// frontend/src/components/workflow/CostTrackingPanel.test.tsx
// TDD: Tests for CostTrackingPanel component

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CostTrackingPanel } from './CostTrackingPanel';
import type { UsageRecord } from '../../api/client';

describe('CostTrackingPanel', () => {
  const mockUsageRecords: UsageRecord[] = [
    {
      id: 1,
      timestamp: '2026-01-30T10:00:00Z',
      agentId: 'agent-1',
      workflowRunId: 'run-1',
      provider: 'anthropic',
      model: 'claude-3-opus',
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCostUsd: 0.05,
    },
    {
      id: 2,
      timestamp: '2026-01-30T10:01:00Z',
      agentId: 'agent-2',
      workflowRunId: 'run-1',
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      inputTokens: 2000,
      outputTokens: 800,
      estimatedCostUsd: 0.03,
    },
    {
      id: 3,
      timestamp: '2026-01-30T10:02:00Z',
      agentId: 'agent-1',
      workflowRunId: 'run-1',
      provider: 'openai',
      model: 'gpt-4',
      inputTokens: 500,
      outputTokens: 200,
      estimatedCostUsd: 0.02,
    },
  ];

  describe('total cost display', () => {
    it('displays total estimated cost', () => {
      render(<CostTrackingPanel usageRecords={mockUsageRecords} />);

      // Total: $0.05 + $0.03 + $0.02 = $0.10
      expect(screen.getByText('$0.10')).toBeInTheDocument();
    });

    it('displays empty state when no records', () => {
      render(<CostTrackingPanel usageRecords={[]} />);

      // When no records, show empty state message instead of $0.00
      expect(screen.getByText(/No usage data/i)).toBeInTheDocument();
    });
  });

  describe('token usage display', () => {
    it('displays total input tokens', () => {
      render(<CostTrackingPanel usageRecords={mockUsageRecords} />);

      // Total input: 1000 + 2000 + 500 = 3500
      expect(screen.getByText('3,500')).toBeInTheDocument();
    });

    it('displays total output tokens', () => {
      render(<CostTrackingPanel usageRecords={mockUsageRecords} />);

      // Total output: 500 + 800 + 200 = 1500
      expect(screen.getByText('1,500')).toBeInTheDocument();
    });

    it('displays total tokens', () => {
      render(<CostTrackingPanel usageRecords={mockUsageRecords} />);

      // Total: 3500 + 1500 = 5000
      expect(screen.getByText('5,000')).toBeInTheDocument();
    });
  });

  describe('breakdown by model', () => {
    it('displays cost breakdown by model when showBreakdown is true', () => {
      render(<CostTrackingPanel usageRecords={mockUsageRecords} showBreakdown />);

      expect(screen.getByText('claude-3-opus')).toBeInTheDocument();
      expect(screen.getByText('claude-3-sonnet')).toBeInTheDocument();
      expect(screen.getByText('gpt-4')).toBeInTheDocument();
    });

    it('shows model token counts in breakdown', () => {
      render(<CostTrackingPanel usageRecords={mockUsageRecords} showBreakdown />);

      // opus: 1000 input + 500 output = 1,500
      // sonnet: 2000 input + 800 output = 2,800
      // gpt-4: 500 input + 200 output = 700
      const breakdownSection = screen.getByTestId('model-breakdown');
      expect(breakdownSection).toBeInTheDocument();
    });
  });

  describe('per-node costs', () => {
    it('displays all records without filter', () => {
      render(
        <CostTrackingPanel
          usageRecords={mockUsageRecords}
        />,
      );

      // Total of all 3 records: $0.10
      expect(screen.getByText('$0.10')).toBeInTheDocument();
    });
  });

  describe('loading and empty states', () => {
    it('shows loading state', () => {
      render(<CostTrackingPanel usageRecords={[]} isLoading />);

      expect(screen.getByTestId('cost-loading')).toBeInTheDocument();
    });

    it('shows empty state message', () => {
      render(<CostTrackingPanel usageRecords={[]} />);

      expect(screen.getByText(/No usage data/i)).toBeInTheDocument();
    });
  });

  describe('compact mode', () => {
    it('renders compact view when compact prop is true', () => {
      render(<CostTrackingPanel usageRecords={mockUsageRecords} compact />);

      const container = screen.getByTestId('cost-panel');
      expect(container.className).toContain('compact');
    });

    it('shows only total in compact mode', () => {
      render(<CostTrackingPanel usageRecords={mockUsageRecords} compact />);

      // Should show total cost
      expect(screen.getByText('$0.10')).toBeInTheDocument();
      // Should NOT show breakdown
      expect(screen.queryByTestId('model-breakdown')).not.toBeInTheDocument();
    });
  });

  describe('formatting', () => {
    it('formats large numbers with commas', () => {
      const largeUsage: UsageRecord[] = [
        {
          id: 1,
          timestamp: '2026-01-30T10:00:00Z',
          agentId: 'agent-1',
          workflowRunId: 'run-1',
          provider: 'anthropic',
          model: 'claude-3-opus',
          inputTokens: 1234567,
          outputTokens: 987654,
          estimatedCostUsd: 125.50,
        },
      ];

      render(<CostTrackingPanel usageRecords={largeUsage} />);

      expect(screen.getByText('1,234,567')).toBeInTheDocument();
      expect(screen.getByText('987,654')).toBeInTheDocument();
      expect(screen.getByText('$125.50')).toBeInTheDocument();
    });

    it('formats small costs with appropriate precision', () => {
      const smallCost: UsageRecord[] = [
        {
          id: 1,
          timestamp: '2026-01-30T10:00:00Z',
          agentId: 'agent-1',
          workflowRunId: 'run-1',
          provider: 'anthropic',
          model: 'claude-3-haiku',
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 0.001,
        },
      ];

      render(<CostTrackingPanel usageRecords={smallCost} />);

      // Should show small amounts with appropriate precision
      expect(screen.getByText(/\$0\.00/)).toBeInTheDocument();
    });
  });
});

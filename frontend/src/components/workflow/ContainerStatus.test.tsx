// frontend/src/components/workflow/ContainerStatus.test.tsx
// TDD: Tests for ContainerStatus component

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContainerStatus } from './ContainerStatus';
import type { ResourceUsage, ResourceLimits } from '../../api/client';

describe('ContainerStatus', () => {
  const mockResourceUsage: ResourceUsage = {
    memoryPeakMB: 256,
    cpuTimeMs: 5000,
    wallTimeMs: 60000,
  };

  const mockResourceLimits: ResourceLimits = {
    maxMemoryMB: 512,
    maxCpuPercent: 100,
    maxDurationMs: 300000,
  };

  describe('isolation level display', () => {
    it('displays container isolation level with icon', () => {
      render(
        <ContainerStatus
          isolationLevel="container"
          resourceUsage={mockResourceUsage}
          resourceLimits={mockResourceLimits}
        />,
      );

      expect(screen.getByText('Container')).toBeInTheDocument();
      expect(screen.getByTestId('isolation-icon')).toBeInTheDocument();
    });

    it('displays process isolation level', () => {
      render(
        <ContainerStatus
          isolationLevel="process"
          resourceUsage={mockResourceUsage}
          resourceLimits={mockResourceLimits}
        />,
      );

      expect(screen.getByText('Process')).toBeInTheDocument();
    });

    it('displays shared isolation level', () => {
      render(
        <ContainerStatus
          isolationLevel="shared"
          resourceUsage={mockResourceUsage}
          resourceLimits={mockResourceLimits}
        />,
      );

      expect(screen.getByText('Shared')).toBeInTheDocument();
    });

    it('handles undefined isolation level gracefully', () => {
      render(<ContainerStatus resourceUsage={mockResourceUsage} />);

      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });

  describe('resource limits display', () => {
    it('displays memory limit', () => {
      render(
        <ContainerStatus
          isolationLevel="container"
          resourceLimits={mockResourceLimits}
        />,
      );

      expect(screen.getByText(/512 MB/)).toBeInTheDocument();
    });

    it('displays CPU limit', () => {
      render(
        <ContainerStatus
          isolationLevel="container"
          resourceLimits={mockResourceLimits}
        />,
      );

      expect(screen.getByText(/100%/)).toBeInTheDocument();
    });

    it('displays timeout limit', () => {
      render(
        <ContainerStatus
          isolationLevel="container"
          resourceLimits={mockResourceLimits}
        />,
      );

      // 300000ms = 5 minutes
      expect(screen.getByText(/5m/)).toBeInTheDocument();
    });

    it('shows no limits when undefined', () => {
      render(<ContainerStatus isolationLevel="shared" />);

      expect(screen.getByText(/No limits/i)).toBeInTheDocument();
    });
  });

  describe('resource usage display', () => {
    it('displays peak memory usage', () => {
      render(
        <ContainerStatus
          isolationLevel="container"
          resourceUsage={mockResourceUsage}
          resourceLimits={mockResourceLimits}
        />,
      );

      expect(screen.getByText(/256 MB/)).toBeInTheDocument();
    });

    it('displays CPU time', () => {
      render(
        <ContainerStatus
          isolationLevel="container"
          resourceUsage={mockResourceUsage}
        />,
      );

      // 5000ms = 5s
      expect(screen.getByText(/5s/)).toBeInTheDocument();
    });

    it('displays wall time', () => {
      render(
        <ContainerStatus
          isolationLevel="container"
          resourceUsage={mockResourceUsage}
        />,
      );

      // 60000ms = 1m
      expect(screen.getByText(/1m/)).toBeInTheDocument();
    });

    it('shows memory usage percentage when limits set', () => {
      render(
        <ContainerStatus
          isolationLevel="container"
          resourceUsage={mockResourceUsage}
          resourceLimits={mockResourceLimits}
        />,
      );

      // 256/512 = 50%
      expect(screen.getByText(/50%/)).toBeInTheDocument();
    });

    it('shows no usage when undefined', () => {
      render(<ContainerStatus isolationLevel="container" />);

      expect(screen.getByText(/No usage data/i)).toBeInTheDocument();
    });
  });

  describe('progress bar visualization', () => {
    it('renders memory progress bar when both usage and limits are set', () => {
      render(
        <ContainerStatus
          isolationLevel="container"
          resourceUsage={mockResourceUsage}
          resourceLimits={mockResourceLimits}
        />,
      );

      const progressBar = screen.getByTestId('memory-progress-bar');
      expect(progressBar).toBeInTheDocument();
    });

    it('applies warning color when memory usage exceeds 75%', () => {
      const highUsage: ResourceUsage = {
        memoryPeakMB: 400,
        cpuTimeMs: 5000,
        wallTimeMs: 60000,
      };

      render(
        <ContainerStatus
          isolationLevel="container"
          resourceUsage={highUsage}
          resourceLimits={mockResourceLimits}
        />,
      );

      const progressBar = screen.getByTestId('memory-progress-bar');
      expect(progressBar.className).toContain('bg-yellow');
    });

    it('applies danger color when memory usage exceeds 90%', () => {
      const criticalUsage: ResourceUsage = {
        memoryPeakMB: 480,
        cpuTimeMs: 5000,
        wallTimeMs: 60000,
      };

      render(
        <ContainerStatus
          isolationLevel="container"
          resourceUsage={criticalUsage}
          resourceLimits={mockResourceLimits}
        />,
      );

      const progressBar = screen.getByTestId('memory-progress-bar');
      expect(progressBar.className).toContain('bg-red');
    });
  });

  describe('compact mode', () => {
    it('renders compact view when compact prop is true', () => {
      render(
        <ContainerStatus
          isolationLevel="container"
          resourceUsage={mockResourceUsage}
          compact
        />,
      );

      const container = screen.getByTestId('container-status');
      expect(container.className).toContain('compact');
    });
  });
});

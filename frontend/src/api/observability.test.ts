// frontend/src/api/observability.test.ts
// TDD: Tests for observability API methods and types

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Import after mock setup
import { api, type LogEntry, type UsageRecord, type CostSummary } from './client';

describe('api.observability', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('logs', () => {
    it('fetches logs with default params', async () => {
      const mockLogs: LogEntry[] = [
        {
          id: 1,
          timestamp: '2026-01-30T10:00:00Z',
          level: 'info',
          source: 'workflow-engine',
          message: 'Workflow started',
          workflowRunId: 'run-1',
        },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: mockLogs, meta: { limit: 100, offset: 0 } }),
      });

      const result = await api.observability.logs();

      expect(mockFetch).toHaveBeenCalledWith('/api/logs', expect.any(Object));
      expect(result.data).toEqual(mockLogs);
    });

    it('fetches logs with filters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: [], meta: { limit: 50, offset: 0 } }),
      });

      await api.observability.logs({
        workflowRunId: 'run-123',
        level: 'error',
        limit: 50,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflowRunId=run-123'),
        expect.any(Object),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('level=error'),
        expect.any(Object),
      );
    });

    it('fetches logs for specific node', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: [], meta: { limit: 100, offset: 0 } }),
      });

      await api.observability.logs({
        workflowRunId: 'run-123',
        nodeExecutionId: 'node-exec-456',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('nodeExecutionId=node-exec-456'),
        expect.any(Object),
      );
    });
  });

  describe('costs', () => {
    it('fetches cost summary', async () => {
      const mockSummary: CostSummary = {
        totalCostUsd: 1.25,
        byAgent: { 'agent-1': 0.75, 'agent-2': 0.50 },
        byWorkflow: { 'workflow-1': 1.25 },
        byModel: { 'claude-3-opus': 1.25 },
        byDay: { '2026-01-30': 1.25 },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: mockSummary }),
      });

      const result = await api.observability.costs();

      expect(mockFetch).toHaveBeenCalledWith('/api/costs', expect.any(Object));
      expect(result.data).toEqual(mockSummary);
    });

    it('fetches costs with date filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: { totalCostUsd: 0, byAgent: {}, byWorkflow: {}, byModel: {}, byDay: {} } }),
      });

      await api.observability.costs({
        from: '2026-01-01',
        to: '2026-01-31',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('from=2026-01-01'),
        expect.any(Object),
      );
    });

    it('fetches usage records for workflow run', async () => {
      const mockUsage: UsageRecord[] = [
        {
          id: 1,
          timestamp: '2026-01-30T10:00:00Z',
          agentId: 'agent-1',
          workflowRunId: 'run-123',
          provider: 'anthropic',
          model: 'claude-3-opus',
          inputTokens: 1000,
          outputTokens: 500,
          estimatedCostUsd: 0.05,
        },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ data: mockUsage }),
      });

      const result = await api.observability.usage({ workflowRunId: 'run-123' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflowRunId=run-123'),
        expect.any(Object),
      );
      expect(result.data).toEqual(mockUsage);
    });
  });
});

describe('NodeRun with resource usage', () => {
  it('includes resourceUsage in NodeRun type', async () => {
    const mockNodeRun = {
      id: 'node-run-1',
      workflowRunId: 'run-1',
      nodeId: 'node-1',
      status: 'completed',
      input: {},
      output: { result: 'success' },
      error: null,
      startedAt: '2026-01-30T10:00:00Z',
      completedAt: '2026-01-30T10:01:00Z',
      createdAt: '2026-01-30T10:00:00Z',
      updatedAt: '2026-01-30T10:01:00Z',
      // New fields for Phase 6
      resourceUsage: {
        memoryPeakMB: 256,
        cpuTimeMs: 5000,
        wallTimeMs: 60000,
      },
      isolationLevel: 'container',
      resourceLimits: {
        maxMemoryMB: 512,
        maxCpuPercent: 100,
        maxDurationMs: 300000,
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => Promise.resolve({ data: [mockNodeRun] }),
    });

    const result = await api.nodeRuns.list('run-1');

    expect(result.data[0].resourceUsage?.memoryPeakMB).toBe(256);
    expect(result.data[0].isolationLevel).toBe('container');
    expect(result.data[0].resourceLimits?.maxMemoryMB).toBe(512);
  });
});

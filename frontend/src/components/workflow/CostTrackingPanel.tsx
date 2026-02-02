// frontend/src/components/workflow/CostTrackingPanel.tsx
// Phase 6: Docker execution monitoring - cost tracking display

import { useMemo } from 'react';
import type { UsageRecord } from '../../api/client';

interface CostTrackingPanelProps {
  usageRecords: UsageRecord[];
  nodeId?: string;
  showBreakdown?: boolean;
  isLoading?: boolean;
  compact?: boolean;
}

/**
 * Format number with commas
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format cost in USD
 */
function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

interface ModelBreakdown {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

export function CostTrackingPanel({
  usageRecords,
  nodeId,
  showBreakdown = false,
  isLoading = false,
  compact = false,
}: CostTrackingPanelProps) {
  // Calculate totals
  const totals = useMemo(() => {
    const records = nodeId
      ? usageRecords.filter((r) => r.workflowRunId === nodeId)
      : usageRecords;

    return records.reduce(
      (acc, record) => ({
        inputTokens: acc.inputTokens + record.inputTokens,
        outputTokens: acc.outputTokens + record.outputTokens,
        cost: acc.cost + record.estimatedCostUsd,
      }),
      { inputTokens: 0, outputTokens: 0, cost: 0 },
    );
  }, [usageRecords, nodeId]);

  // Calculate breakdown by model
  const modelBreakdown = useMemo((): ModelBreakdown[] => {
    const byModel = new Map<string, ModelBreakdown>();

    usageRecords.forEach((record) => {
      const key = `${record.provider}:${record.model}`;
      const existing = byModel.get(key) || {
        model: record.model,
        provider: record.provider,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
      };

      byModel.set(key, {
        ...existing,
        inputTokens: existing.inputTokens + record.inputTokens,
        outputTokens: existing.outputTokens + record.outputTokens,
        totalTokens: existing.totalTokens + record.inputTokens + record.outputTokens,
        cost: existing.cost + record.estimatedCostUsd,
      });
    });

    return Array.from(byModel.values()).sort((a, b) => b.cost - a.cost);
  }, [usageRecords]);

  const totalTokens = totals.inputTokens + totals.outputTokens;
  const hasData = usageRecords.length > 0;

  if (isLoading) {
    return (
      <div
        data-testid="cost-loading"
        className="bg-white rounded-lg border border-gray-200 p-4"
      >
        <div className="animate-pulse flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-200 rounded-full" />
          <span className="text-gray-400">Loading cost data...</span>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div
        data-testid="cost-panel"
        className="compact bg-gray-50 rounded-lg border border-gray-200 px-3 py-2 flex items-center justify-between"
      >
        <span className="text-sm text-gray-500">Cost:</span>
        <span className="font-semibold text-gray-900">{formatCost(totals.cost)}</span>
      </div>
    );
  }

  return (
    <div
      data-testid="cost-panel"
      className="bg-white rounded-lg border border-gray-200 p-4"
    >
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Cost & Usage</h3>

      {!hasData ? (
        <p className="text-sm text-gray-500 italic">No usage data available</p>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Total Cost */}
            <div className="col-span-2 bg-blue-50 rounded-lg p-3">
              <div className="text-xs text-blue-600 font-medium">Estimated Cost</div>
              <div className="text-2xl font-bold text-blue-900">{formatCost(totals.cost)}</div>
            </div>

            {/* Token Counts */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500">Input Tokens</div>
              <div className="text-lg font-semibold text-gray-900">
                {formatNumber(totals.inputTokens)}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500">Output Tokens</div>
              <div className="text-lg font-semibold text-gray-900">
                {formatNumber(totals.outputTokens)}
              </div>
            </div>

            {/* Total Tokens */}
            <div className="col-span-2 bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500">Total Tokens</div>
              <div className="text-lg font-semibold text-gray-900">
                {formatNumber(totalTokens)}
              </div>
            </div>
          </div>

          {/* Model Breakdown */}
          {showBreakdown && modelBreakdown.length > 0 && (
            <div data-testid="model-breakdown">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                By Model
              </h4>
              <div className="space-y-2">
                {modelBreakdown.map((model) => (
                  <div
                    key={`${model.provider}:${model.model}`}
                    className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0"
                  >
                    <div>
                      <span className="font-medium text-gray-900">{model.model}</span>
                      <span className="text-gray-400 text-xs ml-1">({model.provider})</span>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-gray-900">{formatCost(model.cost)}</div>
                      <div className="text-xs text-gray-500">
                        {formatNumber(model.totalTokens)} tokens
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

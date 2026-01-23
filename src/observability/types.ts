// Observability types

// Log entry
export interface LogEntry {
  id?: number;
  timestamp: Date;
  level: LogLevel;
  source: string;
  message: string;
  metadata?: Record<string, unknown>;

  // Correlation
  workflowRunId?: string;
  agentId?: string;
  nodeExecutionId?: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Log filter
export interface LogFilter {
  level?: LogLevel;
  source?: string;
  workflowRunId?: string;
  agentId?: string;
  from?: Date;
  to?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}

// Trace (OpenTelemetry-compatible)
export interface Trace {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: Date;
  attributes: Record<string, unknown>;
}

export type TraceStatus = 'ok' | 'error';

// Metric
export interface Metric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels?: Record<string, string>;
  timestamp?: Date;
}

export interface MetricFilter {
  name?: string;
  labels?: Record<string, string>;
  from?: Date;
  to?: Date;
}

export interface MetricSeries {
  name: string;
  labels: Record<string, string>;
  datapoints: Array<{ timestamp: Date; value: number }>;
}

// Usage/Cost tracking
export interface UsageRecord {
  id?: number;
  timestamp: Date;
  agentId: string;
  workflowRunId?: string;

  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;

  estimatedCostUsd: number;
}

export interface CostFilter {
  agentId?: string;
  workflowId?: string;
  from?: Date;
  to?: Date;
}

export interface CostSummary {
  totalCostUsd: number;
  byAgent: Record<string, number>;
  byWorkflow: Record<string, number>;
  byModel: Record<string, number>;
  byDay: Record<string, number>;
}

// Real-time events
export type ObservabilityEvent =
  | { type: 'log'; entry: LogEntry }
  | { type: 'metric'; metric: Metric }
  | { type: 'usage'; record: UsageRecord };

// Dashboard data
export interface DashboardMetrics {
  totalAgents: number;
  totalWorkflows: number;
  activeRuns: number;
  completedRuns24h: number;
  failedRuns24h: number;
  totalCost24h: number;
  topAgentsByCost: Array<{ agentId: string; name: string; cost: number }>;
  runsByHour: Array<{ hour: string; count: number }>;
}

// ==================
// Schedule Types
// ==================

export interface ScheduledTrigger {
  id: string;
  workflowId: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduleInput {
  workflowId: string;
  cron: string;
  timezone?: string;
  enabled?: boolean;
}

export interface UpdateScheduleInput {
  cron?: string;
  timezone?: string;
  enabled?: boolean;
}

export interface ScheduleFilter {
  workflowId?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

// ==================
// Webhook Types
// ==================

export interface WebhookTrigger {
  id: string;
  workflowId: string;
  name: string;
  secret: string;
  enabled: boolean;
  lastTriggeredAt: Date | null;
  triggerCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWebhookInput {
  workflowId: string;
  name: string;
  secret?: string; // Auto-generated if not provided
  enabled?: boolean;
}

export interface UpdateWebhookInput {
  name?: string;
  enabled?: boolean;
  regenerateSecret?: boolean;
}

export interface WebhookFilter {
  workflowId?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

export interface WebhookPayload {
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signature?: string;
}

// ==================
// Event Bus Types
// ==================

export type EventType =
  | 'workflow:triggered'
  | 'workflow:started'
  | 'workflow:completed'
  | 'workflow:failed'
  | 'workflow:cancelled'
  | 'node:started'
  | 'node:completed'
  | 'node:failed'
  | 'schedule:fired'
  | 'webhook:received';

export interface OrchestratorEvent {
  id: string;
  type: EventType;
  timestamp: Date;
  workflowId?: string;
  runId?: string;
  nodeId?: string;
  triggerId?: string;
  data: Record<string, unknown>;
}

export type EventHandler = (event: OrchestratorEvent) => void | Promise<void>;

export interface EventSubscription {
  id: string;
  eventTypes: EventType[];
  handler: EventHandler;
}

// ==================
// Trigger Execution
// ==================

export interface TriggerResult {
  success: boolean;
  runId?: string;
  error?: string;
  triggeredAt: Date;
}

// ==================
// Cron Parsing
// ==================

export interface CronSchedule {
  expression: string;
  timezone: string;
  nextRun: Date;
  previousRun: Date | null;
}

export interface ParsedCron {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

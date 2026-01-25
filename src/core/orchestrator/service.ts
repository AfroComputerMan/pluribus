import { logger } from '@/observability/logger';
import { type EventBus, getEventBus } from './event-bus';
import { type SchedulerService, getSchedulerService } from './scheduler';
import type {
  CreateScheduleInput,
  CreateWebhookInput,
  EventHandler,
  EventType,
  OrchestratorEvent,
  ScheduleFilter,
  ScheduledTrigger,
  TriggerResult,
  UpdateScheduleInput,
  UpdateWebhookInput,
  WebhookFilter,
  WebhookPayload,
  WebhookTrigger,
} from './types';
import { type WebhookService, getWebhookService } from './webhook';

const log = logger.child('orchestrator:service');

export interface OrchestratorConfig {
  schedulerIntervalMs?: number;
  maxEventHistory?: number;
}

/**
 * Main orchestrator service that coordinates schedules, webhooks, and events.
 */
export class OrchestratorService {
  private scheduler: SchedulerService;
  private webhookService: WebhookService;
  private eventBus: EventBus;
  private config: OrchestratorConfig;

  constructor(
    config: OrchestratorConfig = {},
    scheduler?: SchedulerService,
    webhookService?: WebhookService,
    eventBus?: EventBus
  ) {
    this.config = {
      schedulerIntervalMs: config.schedulerIntervalMs || 60000,
      maxEventHistory: config.maxEventHistory || 1000,
    };

    this.scheduler = scheduler || getSchedulerService();
    this.webhookService = webhookService || getWebhookService();
    this.eventBus = eventBus || getEventBus();
  }

  // ==================
  // Lifecycle Management
  // ==================

  /**
   * Start the orchestrator (scheduler polling).
   */
  start(): void {
    log.info('Starting orchestrator');
    this.scheduler.start(this.config.schedulerIntervalMs);
    log.info('Orchestrator started');
  }

  /**
   * Stop the orchestrator.
   */
  stop(): void {
    log.info('Stopping orchestrator');
    this.scheduler.stop();
    log.info('Orchestrator stopped');
  }

  /**
   * Check if the orchestrator is running.
   */
  isRunning(): boolean {
    return this.scheduler.isRunning();
  }

  // ==================
  // Schedule Management
  // ==================

  /**
   * Create a new scheduled trigger.
   */
  async createSchedule(input: CreateScheduleInput): Promise<ScheduledTrigger> {
    return this.scheduler.createSchedule(input);
  }

  /**
   * Get a schedule by ID.
   */
  async getSchedule(id: string): Promise<ScheduledTrigger | null> {
    return this.scheduler.getSchedule(id);
  }

  /**
   * List schedules with optional filters.
   */
  async listSchedules(filter?: ScheduleFilter): Promise<ScheduledTrigger[]> {
    return this.scheduler.listSchedules(filter);
  }

  /**
   * Update a schedule.
   */
  async updateSchedule(id: string, input: UpdateScheduleInput): Promise<ScheduledTrigger> {
    return this.scheduler.updateSchedule(id, input);
  }

  /**
   * Delete a schedule.
   */
  async deleteSchedule(id: string): Promise<boolean> {
    return this.scheduler.deleteSchedule(id);
  }

  /**
   * Enable a schedule.
   */
  async enableSchedule(id: string): Promise<ScheduledTrigger> {
    return this.scheduler.enableSchedule(id);
  }

  /**
   * Disable a schedule.
   */
  async disableSchedule(id: string): Promise<ScheduledTrigger> {
    return this.scheduler.disableSchedule(id);
  }

  /**
   * Manually trigger a schedule.
   */
  async triggerScheduleNow(id: string): Promise<TriggerResult> {
    return this.scheduler.triggerScheduleNow(id);
  }

  // ==================
  // Webhook Management
  // ==================

  /**
   * Create a new webhook trigger.
   */
  async createWebhook(input: CreateWebhookInput): Promise<WebhookTrigger> {
    return this.webhookService.createWebhook(input);
  }

  /**
   * Get a webhook by ID.
   */
  async getWebhook(id: string): Promise<WebhookTrigger | null> {
    return this.webhookService.getWebhook(id);
  }

  /**
   * List webhooks with optional filters.
   */
  async listWebhooks(filter?: WebhookFilter): Promise<WebhookTrigger[]> {
    return this.webhookService.listWebhooks(filter);
  }

  /**
   * Update a webhook.
   */
  async updateWebhook(id: string, input: UpdateWebhookInput): Promise<WebhookTrigger> {
    return this.webhookService.updateWebhook(id, input);
  }

  /**
   * Delete a webhook.
   */
  async deleteWebhook(id: string): Promise<boolean> {
    return this.webhookService.deleteWebhook(id);
  }

  /**
   * Regenerate webhook secret.
   */
  async regenerateWebhookSecret(id: string): Promise<WebhookTrigger> {
    return this.webhookService.regenerateSecret(id);
  }

  /**
   * Enable a webhook.
   */
  async enableWebhook(id: string): Promise<WebhookTrigger> {
    return this.webhookService.enableWebhook(id);
  }

  /**
   * Disable a webhook.
   */
  async disableWebhook(id: string): Promise<WebhookTrigger> {
    return this.webhookService.disableWebhook(id);
  }

  /**
   * Handle an incoming webhook request.
   */
  async handleWebhook(webhookId: string, payload: WebhookPayload): Promise<TriggerResult> {
    return this.webhookService.handleWebhook(webhookId, payload);
  }

  /**
   * Get webhook URL.
   */
  getWebhookUrl(webhookId: string, baseUrl = ''): string {
    return this.webhookService.getWebhookUrl(webhookId, baseUrl);
  }

  /**
   * Validate webhook signature.
   */
  validateWebhookSignature(secret: string, payload: string, signature: string): boolean {
    return this.webhookService.validateSignature(secret, payload, signature);
  }

  /**
   * Generate webhook signature (for testing).
   */
  generateWebhookSignature(secret: string, payload: string): string {
    return this.webhookService.generateSignature(secret, payload);
  }

  // ==================
  // Event Management
  // ==================

  /**
   * Subscribe to specific event types.
   */
  subscribe(eventTypes: EventType[], handler: EventHandler): string {
    return this.eventBus.subscribe(eventTypes, handler);
  }

  /**
   * Subscribe to all event types.
   */
  subscribeAll(handler: EventHandler): string {
    return this.eventBus.subscribeAll(handler);
  }

  /**
   * Unsubscribe from events.
   */
  unsubscribe(subscriptionId: string): boolean {
    return this.eventBus.unsubscribe(subscriptionId);
  }

  /**
   * Publish an event (for internal use or testing).
   */
  async publishEvent(event: Omit<OrchestratorEvent, 'id' | 'timestamp'>): Promise<void> {
    return this.eventBus.publish(event);
  }

  /**
   * Get recent events from history.
   */
  getRecentEvents(limit = 100): OrchestratorEvent[] {
    return this.eventBus.getRecentEvents(limit);
  }

  /**
   * Get events for a specific workflow.
   */
  getWorkflowEvents(workflowId: string, limit = 100): OrchestratorEvent[] {
    return this.eventBus.getWorkflowEvents(workflowId, limit);
  }

  /**
   * Get events for a specific run.
   */
  getRunEvents(runId: string): OrchestratorEvent[] {
    return this.eventBus.getRunEvents(runId);
  }

  // ==================
  // Service Access
  // ==================

  /**
   * Get the scheduler service instance.
   */
  getScheduler(): SchedulerService {
    return this.scheduler;
  }

  /**
   * Get the webhook service instance.
   */
  getWebhookHandler(): WebhookService {
    return this.webhookService;
  }

  /**
   * Get the event bus instance.
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }
}

// Default singleton instance
let orchestratorService: OrchestratorService | null = null;

/**
 * Initialize the orchestrator service.
 */
export function initializeOrchestrator(config?: OrchestratorConfig): OrchestratorService {
  if (orchestratorService) {
    log.warn('Orchestrator already initialized, returning existing instance');
    return orchestratorService;
  }

  orchestratorService = new OrchestratorService(config);
  return orchestratorService;
}

/**
 * Get the orchestrator service.
 */
export function getOrchestratorService(): OrchestratorService {
  if (!orchestratorService) {
    orchestratorService = new OrchestratorService();
  }
  return orchestratorService;
}

/**
 * Reset the orchestrator service (for testing).
 */
export function resetOrchestratorService(): void {
  if (orchestratorService) {
    orchestratorService.stop();
  }
  orchestratorService = null;
}

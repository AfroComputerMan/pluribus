import { createHmac, timingSafeEqual } from 'node:crypto';
import { type WorkflowService, getWorkflowService } from '@/core/workflows/service';
import { logger } from '@/observability/logger';
import { type EventBus, getEventBus } from './event-bus';
import { type OrchestratorRepository, getOrchestratorRepository } from './repository';
import type {
  CreateWebhookInput,
  TriggerResult,
  UpdateWebhookInput,
  WebhookFilter,
  WebhookPayload,
  WebhookTrigger,
} from './types';

const log = logger.child('orchestrator:webhook');

/**
 * Webhook service handles HTTP webhook triggers for workflows.
 */
export class WebhookService {
  private repository: OrchestratorRepository;
  private workflowService: WorkflowService;
  private eventBus: EventBus;

  constructor(
    repository?: OrchestratorRepository,
    workflowService?: WorkflowService,
    eventBus?: EventBus
  ) {
    this.repository = repository || getOrchestratorRepository();
    this.workflowService = workflowService || getWorkflowService();
    this.eventBus = eventBus || getEventBus();
  }

  // ==================
  // Webhook CRUD
  // ==================

  /**
   * Create a new webhook trigger.
   */
  async createWebhook(input: CreateWebhookInput): Promise<WebhookTrigger> {
    log.info('Creating webhook', { workflowId: input.workflowId, name: input.name });

    const webhook = await this.repository.createWebhook(input);

    log.info('Webhook created', {
      webhookId: webhook.id,
      workflowId: webhook.workflowId,
    });

    return webhook;
  }

  /**
   * Get a webhook by ID.
   */
  async getWebhook(id: string): Promise<WebhookTrigger | null> {
    return this.repository.findWebhookById(id);
  }

  /**
   * List webhooks with optional filters.
   */
  async listWebhooks(filter?: WebhookFilter): Promise<WebhookTrigger[]> {
    return this.repository.findWebhooks(filter);
  }

  /**
   * Update a webhook.
   */
  async updateWebhook(id: string, input: UpdateWebhookInput): Promise<WebhookTrigger> {
    log.info('Updating webhook', { webhookId: id, ...input });

    const webhook = await this.repository.updateWebhook(id, input);

    log.info('Webhook updated', { webhookId: webhook.id });

    return webhook;
  }

  /**
   * Delete a webhook.
   */
  async deleteWebhook(id: string): Promise<boolean> {
    log.info('Deleting webhook', { webhookId: id });

    const deleted = await this.repository.deleteWebhook(id);

    if (deleted) {
      log.info('Webhook deleted', { webhookId: id });
    }

    return deleted;
  }

  /**
   * Regenerate webhook secret.
   */
  async regenerateSecret(id: string): Promise<WebhookTrigger> {
    return this.updateWebhook(id, { regenerateSecret: true });
  }

  /**
   * Enable a webhook.
   */
  async enableWebhook(id: string): Promise<WebhookTrigger> {
    return this.updateWebhook(id, { enabled: true });
  }

  /**
   * Disable a webhook.
   */
  async disableWebhook(id: string): Promise<WebhookTrigger> {
    return this.updateWebhook(id, { enabled: false });
  }

  // ==================
  // Webhook Execution
  // ==================

  /**
   * Handle an incoming webhook request.
   */
  async handleWebhook(webhookId: string, payload: WebhookPayload): Promise<TriggerResult> {
    const triggeredAt = new Date();

    log.info('Handling webhook', { webhookId });

    // Find the webhook
    const webhook = await this.repository.findWebhookById(webhookId);

    if (!webhook) {
      log.warn('Webhook not found', { webhookId });
      return {
        success: false,
        error: 'Webhook not found',
        triggeredAt,
      };
    }

    // Check if webhook is enabled
    if (!webhook.enabled) {
      log.warn('Webhook is disabled', { webhookId });
      return {
        success: false,
        error: 'Webhook is disabled',
        triggeredAt,
      };
    }

    // Validate signature if provided
    if (payload.signature) {
      const isValid = this.validateSignature(
        webhook.secret,
        JSON.stringify(payload.body),
        payload.signature
      );

      if (!isValid) {
        log.warn('Invalid webhook signature', { webhookId });
        return {
          success: false,
          error: 'Invalid signature',
          triggeredAt,
        };
      }
    }

    try {
      // Trigger the workflow
      const run = await this.workflowService.triggerRun(webhook.workflowId, 'webhook', {
        webhookId: webhook.id,
        headers: payload.headers,
        body: payload.body,
      });

      // Record the trigger
      await this.repository.recordWebhookTrigger(webhook.id);

      // Publish event
      await this.eventBus.publish({
        type: 'webhook:received',
        workflowId: webhook.workflowId,
        runId: run.id,
        triggerId: webhook.id,
        data: {
          webhookName: webhook.name,
          hasSignature: !!payload.signature,
        },
      });

      log.info('Webhook handled successfully', {
        webhookId: webhook.id,
        workflowId: webhook.workflowId,
        runId: run.id,
      });

      return {
        success: true,
        runId: run.id,
        triggeredAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.error('Webhook execution failed', {
        webhookId: webhook.id,
        workflowId: webhook.workflowId,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
        triggeredAt,
      };
    }
  }

  /**
   * Validate a webhook signature using HMAC-SHA256.
   */
  validateSignature(secret: string, payload: string, signature: string): boolean {
    try {
      // Expected format: "sha256=<hex_signature>"
      const [algorithm, providedHash] = signature.split('=');

      if (algorithm !== 'sha256' || !providedHash) {
        return false;
      }

      const expectedHash = createHmac('sha256', secret).update(payload).digest('hex');

      // Use timing-safe comparison to prevent timing attacks
      const expectedBuffer = Buffer.from(expectedHash, 'hex');
      const providedBuffer = Buffer.from(providedHash, 'hex');

      if (expectedBuffer.length !== providedBuffer.length) {
        return false;
      }

      return timingSafeEqual(expectedBuffer, providedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Generate a signature for a payload (for testing or client use).
   */
  generateSignature(secret: string, payload: string): string {
    const hash = createHmac('sha256', secret).update(payload).digest('hex');

    return `sha256=${hash}`;
  }

  /**
   * Get webhook URL for a given webhook ID.
   * This is a helper that returns the expected URL format.
   */
  getWebhookUrl(webhookId: string, baseUrl = ''): string {
    return `${baseUrl}/api/webhooks/${webhookId}`;
  }
}

// Default singleton instance
let webhookService: WebhookService | null = null;

/**
 * Get or create the default webhook service.
 */
export function getWebhookService(): WebhookService {
  if (!webhookService) {
    webhookService = new WebhookService();
  }
  return webhookService;
}

/**
 * Reset the default webhook service (for testing).
 */
export function resetWebhookService(): void {
  webhookService = null;
}

import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { createHmac } from 'crypto';
import { WebhookService } from '@/core/orchestrator/webhook';
import type { OrchestratorRepository } from '@/core/orchestrator/repository';
import type { WorkflowService } from '@/core/workflows/service';
import type { EventBus } from '@/core/orchestrator/event-bus';
import type { WebhookTrigger } from '@/core/orchestrator/types';

describe('WebhookService', () => {
  let webhookService: WebhookService;
  let mockRepository: Partial<OrchestratorRepository>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockWorkflowService: any;
  let mockEventBus: Partial<EventBus>;

  const createMockWebhook = (overrides: Partial<WebhookTrigger> = {}): WebhookTrigger => ({
    id: 'webhook-123',
    workflowId: 'workflow-123',
    name: 'Test Webhook',
    secret: 'a'.repeat(64), // 32 bytes in hex
    enabled: true,
    lastTriggeredAt: null,
    triggerCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    mockRepository = {
      findWebhookById: mock(() => Promise.resolve(null)),
      findWebhookBySecret: mock(() => Promise.resolve(null)),
      findWebhooks: mock(() => Promise.resolve([])),
      createWebhook: mock(() => Promise.resolve(createMockWebhook())),
      updateWebhook: mock(() => Promise.resolve(createMockWebhook())),
      recordWebhookTrigger: mock(() => Promise.resolve(createMockWebhook())),
      deleteWebhook: mock(() => Promise.resolve(true)),
    };

    mockWorkflowService = {
      triggerRun: mock((_workflowId: string, _triggerType?: string, _input?: Record<string, unknown>) =>
        Promise.resolve({
          id: 'run-123',
          workflowId: 'workflow-123',
          status: 'pending' as const,
          triggerType: 'webhook' as const,
          input: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          error: null,
        })
      ),
    };

    mockEventBus = {
      publish: mock(() => Promise.resolve()),
    };

    webhookService = new WebhookService(
      mockRepository as OrchestratorRepository,
      mockWorkflowService as unknown as WorkflowService,
      mockEventBus as EventBus
    );
  });

  describe('createWebhook', () => {
    it('should create a webhook', async () => {
      const input = {
        workflowId: 'workflow-123',
        name: 'Test Webhook',
      };

      const result = await webhookService.createWebhook(input);

      expect(mockRepository.createWebhook).toHaveBeenCalledWith(input);
      expect(result.id).toBe('webhook-123');
    });
  });

  describe('handleWebhook', () => {
    it('should trigger workflow when webhook is valid and enabled', async () => {
      const webhook = createMockWebhook();
      (mockRepository.findWebhookById as ReturnType<typeof mock>).mockResolvedValue(webhook);

      const payload = {
        headers: { 'content-type': 'application/json' },
        body: { data: 'test' },
      };

      const result = await webhookService.handleWebhook('webhook-123', payload);

      expect(result.success).toBe(true);
      expect(result.runId).toBe('run-123');
      expect(mockWorkflowService.triggerRun).toHaveBeenCalledWith(
        'workflow-123',
        'webhook',
        expect.objectContaining({
          webhookId: 'webhook-123',
          body: { data: 'test' },
        })
      );
      expect(mockRepository.recordWebhookTrigger).toHaveBeenCalledWith('webhook-123');
      expect(mockEventBus.publish).toHaveBeenCalled();
    });

    it('should return error for non-existent webhook', async () => {
      (mockRepository.findWebhookById as ReturnType<typeof mock>).mockResolvedValue(null);

      const result = await webhookService.handleWebhook('non-existent', {
        headers: {},
        body: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Webhook not found');
    });

    it('should return error for disabled webhook', async () => {
      const webhook = createMockWebhook({ enabled: false });
      (mockRepository.findWebhookById as ReturnType<typeof mock>).mockResolvedValue(webhook);

      const result = await webhookService.handleWebhook('webhook-123', {
        headers: {},
        body: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Webhook is disabled');
    });

    it('should validate signature when provided', async () => {
      const webhook = createMockWebhook();
      (mockRepository.findWebhookById as ReturnType<typeof mock>).mockResolvedValue(webhook);

      const payload = { data: 'test' };
      const payloadString = JSON.stringify(payload);
      const signature = `sha256=${createHmac('sha256', webhook.secret)
        .update(payloadString)
        .digest('hex')}`;

      const result = await webhookService.handleWebhook('webhook-123', {
        headers: {},
        body: payload,
        signature,
      });

      expect(result.success).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const webhook = createMockWebhook();
      (mockRepository.findWebhookById as ReturnType<typeof mock>).mockResolvedValue(webhook);

      const result = await webhookService.handleWebhook('webhook-123', {
        headers: {},
        body: { data: 'test' },
        signature: 'sha256=invalid',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid signature');
    });

    it('should handle workflow trigger errors', async () => {
      const webhook = createMockWebhook();
      (mockRepository.findWebhookById as ReturnType<typeof mock>).mockResolvedValue(webhook);
      (mockWorkflowService.triggerRun as ReturnType<typeof mock>).mockRejectedValue(
        new Error('Workflow error')
      );

      const result = await webhookService.handleWebhook('webhook-123', {
        headers: {},
        body: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Workflow error');
    });
  });

  describe('validateSignature', () => {
    it('should validate correct HMAC-SHA256 signature', () => {
      const secret = 'my-secret-key';
      const payload = '{"data":"test"}';
      const hash = createHmac('sha256', secret).update(payload).digest('hex');
      const signature = `sha256=${hash}`;

      const isValid = webhookService.validateSignature(secret, payload, signature);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect signature', () => {
      const isValid = webhookService.validateSignature(
        'secret',
        '{"data":"test"}',
        'sha256=wrong'
      );

      expect(isValid).toBe(false);
    });

    it('should reject signature with wrong algorithm prefix', () => {
      const isValid = webhookService.validateSignature(
        'secret',
        '{"data":"test"}',
        'md5=somehash'
      );

      expect(isValid).toBe(false);
    });

    it('should reject malformed signature', () => {
      expect(webhookService.validateSignature('secret', 'payload', 'invalid')).toBe(false);
      expect(webhookService.validateSignature('secret', 'payload', '')).toBe(false);
      expect(webhookService.validateSignature('secret', 'payload', 'sha256=')).toBe(false);
    });
  });

  describe('generateSignature', () => {
    it('should generate valid HMAC-SHA256 signature', () => {
      const secret = 'my-secret-key';
      const payload = '{"data":"test"}';

      const signature = webhookService.generateSignature(secret, payload);

      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);

      // Verify the generated signature is valid
      const isValid = webhookService.validateSignature(secret, payload, signature);
      expect(isValid).toBe(true);
    });
  });

  describe('getWebhookUrl', () => {
    it('should generate correct URL with base URL', () => {
      const url = webhookService.getWebhookUrl('webhook-123', 'https://api.example.com');
      expect(url).toBe('https://api.example.com/api/webhooks/webhook-123');
    });

    it('should generate correct URL without base URL', () => {
      const url = webhookService.getWebhookUrl('webhook-123');
      expect(url).toBe('/api/webhooks/webhook-123');
    });
  });

  describe('CRUD operations', () => {
    it('should get webhook by ID', async () => {
      const webhook = createMockWebhook();
      (mockRepository.findWebhookById as ReturnType<typeof mock>).mockResolvedValue(webhook);

      const result = await webhookService.getWebhook('webhook-123');

      expect(result).toEqual(webhook);
      expect(mockRepository.findWebhookById).toHaveBeenCalledWith('webhook-123');
    });

    it('should list webhooks with filter', async () => {
      const webhooks = [createMockWebhook()];
      (mockRepository.findWebhooks as ReturnType<typeof mock>).mockResolvedValue(webhooks);

      const filter = { workflowId: 'workflow-123' };
      const result = await webhookService.listWebhooks(filter);

      expect(result).toEqual(webhooks);
      expect(mockRepository.findWebhooks).toHaveBeenCalledWith(filter);
    });

    it('should update webhook', async () => {
      const updated = createMockWebhook({ name: 'Updated' });
      (mockRepository.updateWebhook as ReturnType<typeof mock>).mockResolvedValue(updated);

      const result = await webhookService.updateWebhook('webhook-123', { name: 'Updated' });

      expect(result.name).toBe('Updated');
    });

    it('should delete webhook', async () => {
      const result = await webhookService.deleteWebhook('webhook-123');

      expect(result).toBe(true);
      expect(mockRepository.deleteWebhook).toHaveBeenCalledWith('webhook-123');
    });

    it('should regenerate secret', async () => {
      await webhookService.regenerateSecret('webhook-123');

      expect(mockRepository.updateWebhook).toHaveBeenCalledWith('webhook-123', {
        regenerateSecret: true,
      });
    });

    it('should enable webhook', async () => {
      await webhookService.enableWebhook('webhook-123');

      expect(mockRepository.updateWebhook).toHaveBeenCalledWith('webhook-123', { enabled: true });
    });

    it('should disable webhook', async () => {
      await webhookService.disableWebhook('webhook-123');

      expect(mockRepository.updateWebhook).toHaveBeenCalledWith('webhook-123', { enabled: false });
    });
  });
});

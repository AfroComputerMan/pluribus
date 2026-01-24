import { describe, expect, test } from 'bun:test';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  CredentialError,
  IntegrationError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
  WorkflowExecutionError,
} from '@/lib/errors';

describe('AppError', () => {
  test('creates error with all properties', () => {
    const error = new AppError('Test error', 'TEST_CODE', 418, { foo: 'bar' });

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.statusCode).toBe(418);
    expect(error.details).toEqual({ foo: 'bar' });
    expect(error.name).toBe('AppError');
  });

  test('toJSON returns proper structure', () => {
    const error = new AppError('Test error', 'TEST_CODE', 400, { field: 'name' });
    const json = error.toJSON();

    expect(json).toEqual({
      error: {
        code: 'TEST_CODE',
        message: 'Test error',
        details: { field: 'name' },
      },
    });
  });

  test('toJSON omits details when not provided', () => {
    const error = new AppError('Test error', 'TEST_CODE', 400);
    const json = error.toJSON();

    expect(json).toEqual({
      error: {
        code: 'TEST_CODE',
        message: 'Test error',
      },
    });
  });
});

describe('ValidationError', () => {
  test('has correct status code and code', () => {
    const error = new ValidationError('Invalid input');

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.name).toBe('ValidationError');
  });

  test('includes details when provided', () => {
    const error = new ValidationError('Invalid input', { field: 'email' });

    expect(error.details).toEqual({ field: 'email' });
  });
});

describe('AuthenticationError', () => {
  test('has correct defaults', () => {
    const error = new AuthenticationError();

    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTHENTICATION_ERROR');
    expect(error.message).toBe('Authentication required');
  });

  test('accepts custom message', () => {
    const error = new AuthenticationError('Token expired');

    expect(error.message).toBe('Token expired');
  });
});

describe('AuthorizationError', () => {
  test('has correct defaults', () => {
    const error = new AuthorizationError();

    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('AUTHORIZATION_ERROR');
    expect(error.message).toBe('Access denied');
  });
});

describe('NotFoundError', () => {
  test('generates message with resource and id', () => {
    const error = new NotFoundError('Agent', 'abc-123');

    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe("Agent with id 'abc-123' not found");
    expect(error.details).toEqual({ resource: 'Agent', id: 'abc-123' });
  });

  test('generates message without id', () => {
    const error = new NotFoundError('Configuration');

    expect(error.message).toBe('Configuration not found');
    expect(error.details).toEqual({ resource: 'Configuration', id: undefined });
  });
});

describe('ConflictError', () => {
  test('has correct status code', () => {
    const error = new ConflictError('Resource already exists');

    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('CONFLICT');
  });
});

describe('RateLimitError', () => {
  test('has correct status code and details', () => {
    const error = new RateLimitError(60);

    expect(error.statusCode).toBe(429);
    expect(error.code).toBe('RATE_LIMIT');
    expect(error.details).toEqual({ retryAfter: 60 });
  });
});

describe('InternalError', () => {
  test('has correct defaults', () => {
    const error = new InternalError();

    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).toBe('Internal server error');
  });
});

describe('ServiceUnavailableError', () => {
  test('includes service name', () => {
    const error = new ServiceUnavailableError('Redis');

    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.message).toBe('Service unavailable: Redis');
    expect(error.details).toEqual({ service: 'Redis' });
  });
});

describe('IntegrationError', () => {
  test('includes integration name', () => {
    const error = new IntegrationError('Claude', 'API timeout', { requestId: '123' });

    expect(error.statusCode).toBe(502);
    expect(error.code).toBe('INTEGRATION_ERROR');
    expect(error.details).toEqual({ integration: 'Claude', requestId: '123' });
  });
});

describe('CredentialError', () => {
  test('has correct status code', () => {
    const error = new CredentialError('Invalid API key');

    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('CREDENTIAL_ERROR');
  });
});

describe('WorkflowExecutionError', () => {
  test('includes workflow context', () => {
    const cause = new Error('Original error');
    const error = new WorkflowExecutionError('wf-123', 'node-1', 'Node failed', cause);

    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('WORKFLOW_EXECUTION_ERROR');
    expect(error.details).toEqual({
      workflowId: 'wf-123',
      nodeId: 'node-1',
      cause: 'Original error',
    });
  });
});

// Base error class
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

// 400 Bad Request
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

// 401 Unauthorized
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

// 403 Forbidden
export class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 'AUTHORIZATION_ERROR', 403);
    this.name = 'AuthorizationError';
  }
}

// 404 Not Found
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    super(message, 'NOT_FOUND', 404, { resource, id });
    this.name = 'NotFoundError';
  }
}

// 409 Conflict
export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, details);
    this.name = 'ConflictError';
  }
}

// 429 Too Many Requests
export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super('Too many requests', 'RATE_LIMIT', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

// 500 Internal Server Error
export class InternalError extends AppError {
  constructor(message = 'Internal server error', details?: Record<string, unknown>) {
    super(message, 'INTERNAL_ERROR', 500, details);
    this.name = 'InternalError';
  }
}

// 503 Service Unavailable
export class ServiceUnavailableError extends AppError {
  constructor(service: string) {
    super(`Service unavailable: ${service}`, 'SERVICE_UNAVAILABLE', 503, { service });
    this.name = 'ServiceUnavailableError';
  }
}

// Integration-specific errors
export class IntegrationError extends AppError {
  constructor(
    integration: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'INTEGRATION_ERROR', 502, { integration, ...details });
    this.name = 'IntegrationError';
  }
}

export class CredentialError extends AppError {
  constructor(message: string) {
    super(message, 'CREDENTIAL_ERROR', 401);
    this.name = 'CredentialError';
  }
}

export class WorkflowExecutionError extends AppError {
  constructor(
    workflowId: string,
    nodeId: string,
    message: string,
    cause?: Error
  ) {
    super(message, 'WORKFLOW_EXECUTION_ERROR', 500, {
      workflowId,
      nodeId,
      cause: cause?.message,
    });
    this.name = 'WorkflowExecutionError';
  }
}

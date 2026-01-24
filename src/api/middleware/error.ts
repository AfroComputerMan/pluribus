import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { AppError } from '@/lib/errors';
import { logger } from '@/observability';

// Error handler middleware
export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    // Handle AppError (our custom errors)
    if (err instanceof AppError) {
      logger.error(err.message, {
        code: err.code,
        statusCode: err.statusCode,
        details: err.details,
      });

      return c.json(
        err.toJSON(),
        err.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503
      );
    }

    // Handle Hono HTTPException
    if (err instanceof HTTPException) {
      logger.error(err.message, {
        status: err.status,
      });

      return c.json(
        {
          error: {
            code: 'HTTP_ERROR',
            message: err.message,
          },
        },
        err.status
      );
    }

    // Handle unknown errors
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('Unhandled error', {
      message: error.message,
      stack: error.stack,
    });

    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
        },
      },
      500
    );
  }
}

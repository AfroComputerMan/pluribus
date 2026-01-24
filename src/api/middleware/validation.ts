import type { Context, Next } from 'hono';
import { ZodError, type ZodSchema } from 'zod';

import { ValidationError } from '@/lib/errors';

// Validate request body
export function validateBody<T>(schema: ZodSchema<T>) {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      const parsed = schema.parse(body);
      c.set('validatedBody', parsed);
      await next();
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError('Invalid request body', {
          errors: err.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      throw err;
    }
  };
}

// Validate query parameters
export function validateQuery<T>(schema: ZodSchema<T>) {
  return async (c: Context, next: Next) => {
    try {
      const query = c.req.query();
      const parsed = schema.parse(query);
      c.set('validatedQuery', parsed);
      await next();
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError('Invalid query parameters', {
          errors: err.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      throw err;
    }
  };
}

// Validate path parameters
export function validateParams<T>(schema: ZodSchema<T>) {
  return async (c: Context, next: Next) => {
    try {
      const params = c.req.param();
      const parsed = schema.parse(params);
      c.set('validatedParams', parsed);
      await next();
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError('Invalid path parameters', {
          errors: err.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      throw err;
    }
  };
}

// Get validated data from context
export function getValidatedBody<T>(c: Context): T {
  return c.get('validatedBody') as T;
}

export function getValidatedQuery<T>(c: Context): T {
  return c.get('validatedQuery') as T;
}

export function getValidatedParams<T>(c: Context): T {
  return c.get('validatedParams') as T;
}

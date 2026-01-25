import { z } from 'zod';

// OAuth credential data schema
export const oauthCredentialDataSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenType: z.string().default('Bearer'),
  scope: z.string(),
  expiresAt: z.coerce.date(),
});

// API key credential data schema
export const apiKeyCredentialDataSchema = z.object({
  key: z.string().min(1),
});

// Create credential input schema
export const createCredentialSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['oauth', 'api-key']),
  integration: z.string().min(1).max(50),
  data: z.union([oauthCredentialDataSchema, apiKeyCredentialDataSchema]),
  expiresAt: z.coerce.date().optional(),
});

// Credential metadata schema (without secrets)
export const credentialMetadataSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(['oauth', 'api-key']),
  integration: z.string(),
  expiresAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// Credential filter schema
export const credentialFilterSchema = z.object({
  type: z.enum(['oauth', 'api-key']).optional(),
  integration: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Decrypted credential schema
export const credentialSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(['oauth', 'api-key']),
  integration: z.string(),
  data: z.union([oauthCredentialDataSchema, apiKeyCredentialDataSchema]),
  expiresAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

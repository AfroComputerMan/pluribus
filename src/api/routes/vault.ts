import { Hono } from 'hono';
import type { z } from 'zod';

import { createLogger } from '@/observability/logger';
import { createCredentialSchema, credentialFilterSchema, vaultService } from '@/vault';
import { getValidatedBody, getValidatedQuery, validateBody, validateQuery } from '../middleware';

const vault = new Hono();
const logger = createLogger('api:vault');

// GET /api/credentials - List credentials (metadata only)
vault.get('/', validateQuery(credentialFilterSchema), async (c) => {
  const filter = getValidatedQuery<z.infer<typeof credentialFilterSchema>>(c);
  const items = await vaultService.listCredentials(filter);

  logger.info('Listed credentials', {
    count: items.length,
    filter,
  });

  return c.json({
    data: items,
    meta: {
      limit: filter.limit,
      offset: filter.offset,
    },
  });
});

// GET /api/credentials/:id - Retrieve and decrypt credential
vault.get('/:id', async (c) => {
  const id = c.req.param('id');

  logger.info('Retrieving credential', { id });

  const credential = await vaultService.retrieveCredential(id);

  // Audit log access
  logger.warn('Credential accessed', {
    id: credential.id,
    type: credential.type,
    integration: credential.integration,
  });

  return c.json({ data: credential });
});

// POST /api/credentials - Store new credential
vault.post('/', validateBody(createCredentialSchema), async (c) => {
  const input = getValidatedBody<z.infer<typeof createCredentialSchema>>(c);

  logger.info('Creating credential', {
    name: input.name,
    type: input.type,
    integration: input.integration,
  });

  const credential = await vaultService.storeCredential(input);

  // Return without sensitive data
  return c.json(
    {
      data: {
        id: credential.id,
        name: credential.name,
        type: credential.type,
        integration: credential.integration,
        expiresAt: credential.expiresAt,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
      },
    },
    201
  );
});

// DELETE /api/credentials/:id - Delete credential
vault.delete('/:id', async (c) => {
  const id = c.req.param('id');

  logger.info('Deleting credential', { id });

  await vaultService.deleteCredential(id);

  logger.warn('Credential deleted', { id });

  return c.json({ success: true });
});

// POST /api/credentials/:id/refresh - Refresh OAuth token
vault.post('/:id/refresh', async (c) => {
  const id = c.req.param('id');

  logger.info('Refreshing OAuth token', { id });

  const credential = await vaultService.refreshOAuthToken(id);

  logger.info('OAuth token refreshed', {
    id: credential.id,
    integration: credential.integration,
  });

  // Return without sensitive data
  return c.json({
    data: {
      id: credential.id,
      name: credential.name,
      type: credential.type,
      integration: credential.integration,
      expiresAt: credential.expiresAt,
      updatedAt: credential.updatedAt,
    },
  });
});

export { vault };

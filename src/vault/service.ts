import { IntegrationError, ValidationError } from '@/lib/errors';
import { createLogger } from '@/observability/logger';
import { decrypt, encrypt } from './crypto';
import { vaultRepository } from './repository';
import type {
  ApiKeyCredentialData,
  CreateCredentialInput,
  Credential,
  CredentialFilter,
  CredentialMetadata,
  OAuthCredentialData,
} from './types';

const logger = createLogger('vault:service');

export class VaultService {
  async storeCredential(input: CreateCredentialInput): Promise<Credential> {
    logger.info('Storing credential', {
      name: input.name,
      type: input.type,
      integration: input.integration,
    });

    // Validate credential data based on type
    if (input.type === 'oauth') {
      const data = input.data as OAuthCredentialData;
      if (!data.accessToken || !data.refreshToken) {
        throw new ValidationError('OAuth credentials must include accessToken and refreshToken');
      }
    } else if (input.type === 'api-key') {
      const data = input.data as ApiKeyCredentialData;
      if (!data.key) {
        throw new ValidationError('API key credentials must include key');
      }
    }

    // Create a placeholder credential to get an ID
    const tempId = crypto.randomUUID();

    // Encrypt the credential data
    const dataJson = JSON.stringify(input.data);
    const encrypted = encrypt(dataJson, tempId);

    // Store in database
    const stored = await vaultRepository.create({
      name: input.name,
      type: input.type,
      integration: input.integration,
      encryptedData: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      expiresAt: input.expiresAt,
    });

    // Re-encrypt with actual ID from database
    const reencrypted = encrypt(dataJson, stored.id);
    const updated = await vaultRepository.update(stored.id, {
      encryptedData: reencrypted.ciphertext,
      iv: reencrypted.iv,
      authTag: reencrypted.authTag,
    });

    logger.info('Credential stored successfully', {
      id: updated.id,
      type: input.type,
    });

    // Return decrypted credential
    return this.retrieveCredential(updated.id);
  }

  async retrieveCredential(id: string): Promise<Credential> {
    logger.debug('Retrieving credential', { id });

    const encrypted = await vaultRepository.findById(id);

    // Decrypt the data
    const decryptedJson = decrypt(
      {
        ciphertext: encrypted.encryptedData,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
      encrypted.id
    );

    const data = JSON.parse(decryptedJson);

    logger.info('Credential retrieved', {
      id: encrypted.id,
      type: encrypted.type,
    });

    return {
      id: encrypted.id,
      name: encrypted.name,
      type: encrypted.type,
      integration: encrypted.integration,
      data,
      expiresAt: encrypted.expiresAt,
      createdAt: encrypted.createdAt,
      updatedAt: encrypted.updatedAt,
    };
  }

  async deleteCredential(id: string): Promise<void> {
    logger.info('Deleting credential', { id });

    await vaultRepository.delete(id);

    logger.info('Credential deleted', { id });
  }

  async listCredentials(filter?: CredentialFilter): Promise<CredentialMetadata[]> {
    logger.debug('Listing credentials', { filter });

    const encrypted = await vaultRepository.findAll(filter);

    // Return only metadata (no secrets)
    return encrypted.map((cred) => ({
      id: cred.id,
      name: cred.name,
      type: cred.type as 'oauth' | 'api-key',
      integration: cred.integration,
      expiresAt: cred.expiresAt ?? null,
      createdAt: cred.createdAt,
      updatedAt: cred.updatedAt,
    })) as CredentialMetadata[];
  }

  async refreshOAuthToken(id: string): Promise<Credential> {
    logger.info('Refreshing OAuth token', { id });

    const credential = await this.retrieveCredential(id);

    if (credential.type !== 'oauth') {
      throw new ValidationError('Can only refresh OAuth credentials');
    }

    const oauthData = credential.data as OAuthCredentialData;

    // Check if token is expired or about to expire (within 5 minutes)
    const expiresAt = new Date(oauthData.expiresAt);
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

    if (expiresAt > fiveMinutesFromNow) {
      logger.debug('Token not expired, skipping refresh', {
        id,
        expiresAt: expiresAt.toISOString(),
      });
      return credential;
    }

    // TODO: Implement actual OAuth refresh logic based on integration
    // For now, this is a placeholder that would need integration-specific implementations
    throw new IntegrationError(
      credential.integration,
      'OAuth token refresh not implemented for this integration'
    );
  }
}

export const vaultService = new VaultService();

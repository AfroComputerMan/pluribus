import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { credentials } from '@/db/schema';
import { NotFoundError } from '@/lib/errors';
import type { CredentialFilter, EncryptedCredential } from './types';

export class VaultRepository {
  async findById(id: string): Promise<EncryptedCredential> {
    const result = await db.query.credentials.findFirst({
      where: eq(credentials.id, id),
    });

    if (!result) {
      throw new NotFoundError('Credential', id);
    }

    return {
      id: result.id,
      name: result.name,
      type: result.type as 'oauth' | 'api-key',
      integration: result.integration,
      encryptedData: result.encryptedData,
      iv: result.iv,
      authTag: result.authTag,
      expiresAt: result.expiresAt ?? undefined,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }

  async findAll(filter?: CredentialFilter & { limit?: number; offset?: number }) {
    const conditions = [];

    if (filter?.type) {
      conditions.push(eq(credentials.type, filter.type));
    }

    if (filter?.integration) {
      conditions.push(eq(credentials.integration, filter.integration));
    }

    const query = db
      .select()
      .from(credentials)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(credentials.updatedAt));

    if (filter?.limit) {
      query.limit(filter.limit);
    }

    if (filter?.offset) {
      query.offset(filter.offset);
    }

    return query;
  }

  async create(data: {
    name: string;
    type: 'oauth' | 'api-key';
    integration: string;
    encryptedData: string;
    iv: string;
    authTag: string;
    expiresAt?: Date;
  }): Promise<EncryptedCredential> {
    const [result] = await db
      .insert(credentials)
      .values({
        name: data.name,
        type: data.type,
        integration: data.integration,
        encryptedData: data.encryptedData,
        iv: data.iv,
        authTag: data.authTag,
        expiresAt: data.expiresAt,
      })
      .returning();

    if (!result) {
      throw new Error('Insert failed to return created credential');
    }

    return {
      id: result.id,
      name: result.name,
      type: result.type as 'oauth' | 'api-key',
      integration: result.integration,
      encryptedData: result.encryptedData,
      iv: result.iv,
      authTag: result.authTag,
      expiresAt: result.expiresAt ?? undefined,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }

  async update(
    id: string,
    data: {
      encryptedData?: string;
      iv?: string;
      authTag?: string;
      expiresAt?: Date;
    }
  ): Promise<EncryptedCredential> {
    const [result] = await db
      .update(credentials)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(credentials.id, id))
      .returning();

    if (!result) {
      throw new NotFoundError('Credential', id);
    }

    return {
      id: result.id,
      name: result.name,
      type: result.type as 'oauth' | 'api-key',
      integration: result.integration,
      encryptedData: result.encryptedData,
      iv: result.iv,
      authTag: result.authTag,
      expiresAt: result.expiresAt ?? undefined,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(credentials).where(eq(credentials.id, id)).returning();

    if (result.length === 0) {
      throw new NotFoundError('Credential', id);
    }

    return true;
  }
}

export const vaultRepository = new VaultRepository();

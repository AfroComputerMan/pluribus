import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Get the master key from environment
function getMasterKey(): Buffer {
  const key = process.env.VAULT_MASTER_KEY;
  if (!key) {
    throw new Error('VAULT_MASTER_KEY is not set');
  }

  // If key is hex-encoded, decode it
  if (/^[0-9a-f]+$/i.test(key) && key.length === 64) {
    return Buffer.from(key, 'hex');
  }

  // Otherwise, hash it to get a consistent 32-byte key
  return createHash('sha256').update(key).digest();
}

// Derive a unique key for each credential
function deriveKey(credentialId: string): Buffer {
  const masterKey = getMasterKey();
  return createHash('sha256').update(masterKey).update(credentialId).digest();
}

export interface EncryptedData {
  ciphertext: string; // Base64
  iv: string; // Base64
  authTag: string; // Base64
}

// Encrypt data
export function encrypt(data: string, credentialId: string): EncryptedData {
  const key = deriveKey(credentialId);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return {
    ciphertext: encrypted,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

// Decrypt data
export function decrypt(encryptedData: EncryptedData, credentialId: string): string {
  const key = deriveKey(credentialId);
  const iv = Buffer.from(encryptedData.iv, 'base64');
  const authTag = Buffer.from(encryptedData.authTag, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData.ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// Generate a secure random key for new installations
export function generateMasterKey(): string {
  return randomBytes(32).toString('hex');
}

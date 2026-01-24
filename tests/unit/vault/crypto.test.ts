import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { encrypt, decrypt, generateMasterKey } from '@/vault/crypto';

describe('vault/crypto', () => {
  const originalEnv = process.env.VAULT_MASTER_KEY;

  beforeAll(() => {
    // Set a test master key
    process.env.VAULT_MASTER_KEY = 'test-master-key-for-unit-tests-min32chars';
  });

  afterAll(() => {
    // Restore original env
    if (originalEnv) {
      process.env.VAULT_MASTER_KEY = originalEnv;
    } else {
      delete process.env.VAULT_MASTER_KEY;
    }
  });

  describe('encrypt/decrypt', () => {
    test('encrypts and decrypts data correctly', () => {
      const credentialId = 'cred-123';
      const plaintext = 'my-secret-api-key';

      const encrypted = encrypt(plaintext, credentialId);
      const decrypted = decrypt(encrypted, credentialId);

      expect(decrypted).toBe(plaintext);
    });

    test('produces different ciphertext for same input (random IV)', () => {
      const credentialId = 'cred-123';
      const plaintext = 'my-secret-api-key';

      const encrypted1 = encrypt(plaintext, credentialId);
      const encrypted2 = encrypt(plaintext, credentialId);

      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    test('handles empty strings', () => {
      const credentialId = 'cred-123';
      const plaintext = '';

      const encrypted = encrypt(plaintext, credentialId);
      const decrypted = decrypt(encrypted, credentialId);

      expect(decrypted).toBe('');
    });

    test('handles unicode characters', () => {
      const credentialId = 'cred-123';
      const plaintext = 'password🔐with€special©chars日本語';

      const encrypted = encrypt(plaintext, credentialId);
      const decrypted = decrypt(encrypted, credentialId);

      expect(decrypted).toBe(plaintext);
    });

    test('handles long strings', () => {
      const credentialId = 'cred-123';
      const plaintext = 'x'.repeat(10000);

      const encrypted = encrypt(plaintext, credentialId);
      const decrypted = decrypt(encrypted, credentialId);

      expect(decrypted).toBe(plaintext);
    });

    test('different credential IDs produce different keys', () => {
      const plaintext = 'same-secret';

      const encrypted1 = encrypt(plaintext, 'cred-1');
      const encrypted2 = encrypt(plaintext, 'cred-2');

      // Decryption with wrong credential ID should fail
      expect(() => decrypt(encrypted1, 'cred-2')).toThrow();
      expect(() => decrypt(encrypted2, 'cred-1')).toThrow();
    });

    test('decryption fails with tampered ciphertext', () => {
      const credentialId = 'cred-123';
      const encrypted = encrypt('secret', credentialId);

      // Tamper with ciphertext
      const tampered = {
        ...encrypted,
        ciphertext: encrypted.ciphertext.replace(/./g, 'x'),
      };

      expect(() => decrypt(tampered, credentialId)).toThrow();
    });

    test('decryption fails with tampered auth tag', () => {
      const credentialId = 'cred-123';
      const encrypted = encrypt('secret', credentialId);

      // Tamper with auth tag
      const tampered = {
        ...encrypted,
        authTag: 'AAAAAAAAAAAAAAAAAAAAAA==', // Invalid tag
      };

      expect(() => decrypt(tampered, credentialId)).toThrow();
    });

    test('encrypted data has expected structure', () => {
      const encrypted = encrypt('test', 'cred-123');

      expect(encrypted).toHaveProperty('ciphertext');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('authTag');

      // All should be base64 strings
      expect(typeof encrypted.ciphertext).toBe('string');
      expect(typeof encrypted.iv).toBe('string');
      expect(typeof encrypted.authTag).toBe('string');

      // IV should be 16 bytes (24 base64 chars with padding)
      expect(Buffer.from(encrypted.iv, 'base64').length).toBe(16);

      // Auth tag should be 16 bytes
      expect(Buffer.from(encrypted.authTag, 'base64').length).toBe(16);
    });
  });

  describe('generateMasterKey', () => {
    test('generates 32-byte hex key', () => {
      const key = generateMasterKey();

      expect(key.length).toBe(64); // 32 bytes = 64 hex chars
      expect(/^[0-9a-f]+$/i.test(key)).toBe(true);
    });

    test('generates unique keys', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(generateMasterKey());
      }
      expect(keys.size).toBe(100);
    });
  });
});

describe('vault/crypto without VAULT_MASTER_KEY', () => {
  test('throws when VAULT_MASTER_KEY is not set', () => {
    const originalKey = process.env.VAULT_MASTER_KEY;
    delete process.env.VAULT_MASTER_KEY;

    try {
      expect(() => encrypt('test', 'cred-123')).toThrow('VAULT_MASTER_KEY is not set');
    } finally {
      process.env.VAULT_MASTER_KEY = originalKey;
    }
  });
});

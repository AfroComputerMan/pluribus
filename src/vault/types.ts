// Credential vault types

export interface Credential {
  id: string;
  name: string;
  type: 'oauth' | 'api-key';
  integration: string;
  data: OAuthCredentialData | ApiKeyCredentialData;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface OAuthCredentialData {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string;
  expiresAt: Date;
}

export interface ApiKeyCredentialData {
  key: string;
}

// Encrypted credential as stored in DB
export interface EncryptedCredential {
  id: string;
  name: string;
  type: 'oauth' | 'api-key';
  integration: string;
  encryptedData: string;  // Base64 encoded
  iv: string;              // Base64 encoded
  authTag: string;         // Base64 encoded
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Create credential input
export interface CreateCredentialInput {
  name: string;
  type: 'oauth' | 'api-key';
  integration: string;
  data: OAuthCredentialData | ApiKeyCredentialData;
  expiresAt?: Date;
}

// Credential filter
export interface CredentialFilter {
  type?: 'oauth' | 'api-key';
  integration?: string;
}

// Credential metadata (safe to expose)
export interface CredentialMetadata {
  id: string;
  name: string;
  type: 'oauth' | 'api-key';
  integration: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Vault interface
export interface CredentialVault {
  // Storage
  store(input: CreateCredentialInput): Promise<string>;
  retrieve(credentialId: string): Promise<Credential>;
  delete(credentialId: string): Promise<void>;

  // OAuth helpers
  refreshOAuthToken(credentialId: string): Promise<Credential>;

  // Listing
  list(filter?: CredentialFilter): Promise<CredentialMetadata[]>;
}

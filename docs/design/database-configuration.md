# Database Configuration System - Design Specification

**Version**: 1.0
**Created**: 2026-01-24
**Status**: Design Complete

---

## 1. Overview

### 1.1 Problem Statement
Pluribus currently requires `DATABASE_URL` and `REDIS_URL` environment variables at startup. Users deploying self-hosted instances need a way to configure database connections through the UI without requiring environment variable management.

### 1.2 Design Goals
1. **Dual-mode configuration**: Environment variables for dev, UI for production
2. **Priority hierarchy**: Env vars > UI settings > defaults
3. **Zero-downtime migration**: Switch databases without data loss
4. **Secure storage**: Connection strings encrypted at rest

### 1.3 Constraints
- **Chicken-egg problem**: Can't store config in PostgreSQL before connecting
- **Must work offline**: No external config services required
- **Backward compatible**: Existing env var deployments continue to work

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              STARTUP FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ConfigResolver                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Environment     │  │ Local Config    │  │ Default         │             │
│  │ Variables       │→ │ File            │→ │ Values          │             │
│  │ (Priority 1)    │  │ (Priority 2)    │  │ (Priority 3)    │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DatabaseManager                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Connection Pool Management                                           │   │
│  │ • PostgreSQL client (postgres.js)                                    │   │
│  │ • Redis client (ioredis)                                             │   │
│  │ • Health monitoring                                                   │   │
│  │ • Graceful reconnection                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API Layer                                       │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                   │
│  │ GET /config   │  │ PUT /config   │  │ POST /test    │                   │
│  │ /database     │  │ /database     │  │ /connection   │                   │
│  └───────────────┘  └───────────────┘  └───────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Startup    │────▶│ ConfigResolver│────▶│ DatabaseMgr  │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  process.env │   │ config.json  │   │   defaults   │
│ DATABASE_URL │   │ (encrypted)  │   │  localhost   │
│  REDIS_URL   │   │              │   │              │
└──────────────┘   └──────────────┘   └──────────────┘
```

---

## 3. File Structure

```
src/
├── lib/
│   ├── config.ts              # Existing - enhance with ConfigResolver
│   └── config/
│       ├── index.ts           # Public exports
│       ├── types.ts           # Configuration types
│       ├── schemas.ts         # Zod validation schemas
│       ├── resolver.ts        # Priority-based config resolution
│       ├── file-store.ts      # Local JSON file storage
│       └── validator.ts       # Connection validation
├── api/
│   └── routes/
│       └── config.ts          # New API routes
└── db/
    └── client.ts              # Enhance to use ConfigResolver
```

---

## 4. Type Definitions

### 4.1 Configuration Types

```typescript
// src/lib/config/types.ts

export type ConfigSource = 'env' | 'file' | 'default';

export interface DatabaseConfig {
  postgresql: {
    url: string;
    maxConnections?: number;
    idleTimeout?: number;
    connectTimeout?: number;
    ssl?: boolean | 'require' | 'prefer';
  };
  redis: {
    url: string;
    maxRetries?: number;
    retryDelay?: number;
  };
}

export interface ResolvedConfig {
  postgresql: {
    url: string;
    source: ConfigSource;
    maxConnections: number;
    idleTimeout: number;
    connectTimeout: number;
    ssl: boolean | 'require' | 'prefer';
  };
  redis: {
    url: string;
    source: ConfigSource;
    maxRetries: number;
    retryDelay: number;
  };
}

export interface ConnectionStatus {
  connected: boolean;
  latencyMs: number | null;
  version: string | null;
  error: string | null;
  checkedAt: string;
}

export interface DatabaseStatus {
  postgresql: ConnectionStatus;
  redis: ConnectionStatus;
  configSource: {
    postgresql: ConfigSource;
    redis: ConfigSource;
  };
}

export interface ConfigUpdateInput {
  postgresql?: {
    url: string;
    maxConnections?: number;
    ssl?: boolean | 'require' | 'prefer';
  };
  redis?: {
    url: string;
  };
}
```

### 4.2 Validation Schemas

```typescript
// src/lib/config/schemas.ts

import { z } from 'zod';

// PostgreSQL URL validation
export const postgresUrlSchema = z.string().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
    } catch {
      return false;
    }
  },
  { message: 'Invalid PostgreSQL URL format' }
);

// Redis URL validation
export const redisUrlSchema = z.string().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'redis:' || parsed.protocol === 'rediss:';
    } catch {
      return false;
    }
  },
  { message: 'Invalid Redis URL format' }
);

// Full database config schema
export const databaseConfigSchema = z.object({
  postgresql: z.object({
    url: postgresUrlSchema,
    maxConnections: z.number().min(1).max(100).optional(),
    idleTimeout: z.number().min(0).max(3600).optional(),
    connectTimeout: z.number().min(1).max(60).optional(),
    ssl: z.union([z.boolean(), z.literal('require'), z.literal('prefer')]).optional(),
  }),
  redis: z.object({
    url: redisUrlSchema,
    maxRetries: z.number().min(0).max(10).optional(),
    retryDelay: z.number().min(100).max(10000).optional(),
  }),
});

// Config update input schema
export const configUpdateSchema = z.object({
  postgresql: z.object({
    url: postgresUrlSchema,
    maxConnections: z.number().min(1).max(100).optional(),
    ssl: z.union([z.boolean(), z.literal('require'), z.literal('prefer')]).optional(),
  }).optional(),
  redis: z.object({
    url: redisUrlSchema,
  }).optional(),
}).refine(
  (data) => data.postgresql || data.redis,
  { message: 'At least one database configuration is required' }
);

// Connection test request schema
export const connectionTestSchema = z.object({
  type: z.enum(['postgresql', 'redis']),
  url: z.string().url(),
  timeout: z.number().min(1000).max(30000).optional().default(10000),
});
```

---

## 5. API Specification

### 5.1 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config/database` | Get current config (masked) with status |
| PUT | `/api/config/database` | Update database configuration |
| POST | `/api/config/database/test` | Test connection without saving |
| GET | `/api/config/database/status` | Health check with detailed status |

### 5.2 GET /api/config/database

**Response 200:**
```json
{
  "postgresql": {
    "url": "postgres://user:****@host:5432/pluribus",
    "source": "env",
    "maxConnections": 20,
    "ssl": "require",
    "status": {
      "connected": true,
      "latencyMs": 3,
      "version": "16.1"
    }
  },
  "redis": {
    "url": "redis://****@host:6379",
    "source": "file",
    "status": {
      "connected": true,
      "latencyMs": 1,
      "version": "7.2.3"
    }
  },
  "canEdit": {
    "postgresql": false,
    "redis": true
  }
}
```

**Notes:**
- Passwords are always masked with `****`
- `source` indicates where the config came from
- `canEdit` is `false` when source is `env` (locked by environment)

### 5.3 PUT /api/config/database

**Request:**
```json
{
  "postgresql": {
    "url": "postgres://user:pass@new-host:5432/pluribus",
    "maxConnections": 25,
    "ssl": "require"
  }
}
```

**Response 200:**
```json
{
  "success": true,
  "postgresql": {
    "url": "postgres://user:****@new-host:5432/pluribus",
    "source": "file",
    "status": {
      "connected": true,
      "latencyMs": 5,
      "version": "16.1"
    }
  },
  "restartRequired": false
}
```

**Response 400 (env override):**
```json
{
  "error": "Cannot update PostgreSQL configuration: overridden by DATABASE_URL environment variable",
  "code": "CONFIG_LOCKED_BY_ENV"
}
```

**Response 400 (validation failed):**
```json
{
  "error": "Connection test failed",
  "code": "CONNECTION_FAILED",
  "details": {
    "type": "postgresql",
    "message": "Connection refused"
  }
}
```

### 5.4 POST /api/config/database/test

**Request:**
```json
{
  "type": "postgresql",
  "url": "postgres://user:pass@host:5432/pluribus",
  "timeout": 10000
}
```

**Response 200:**
```json
{
  "success": true,
  "latencyMs": 4,
  "version": "16.1",
  "permissions": {
    "read": true,
    "write": true
  }
}
```

**Response 400:**
```json
{
  "success": false,
  "error": "Connection timeout after 10000ms",
  "code": "TIMEOUT"
}
```

### 5.5 GET /api/config/database/status

**Response 200:**
```json
{
  "healthy": true,
  "postgresql": {
    "connected": true,
    "latencyMs": 2,
    "version": "16.1",
    "activeConnections": 5,
    "maxConnections": 20
  },
  "redis": {
    "connected": true,
    "latencyMs": 1,
    "version": "7.2.3",
    "memoryUsedMb": 12.5,
    "queueDepth": {
      "workflow": 0,
      "node": 3,
      "schedule": 0
    }
  },
  "checkedAt": "2026-01-24T12:00:00.000Z"
}
```

---

## 6. Local Config File Storage

### 6.1 File Location

```
~/.pluribus/
├── config.json          # Main configuration (encrypted sensitive values)
└── config.json.backup   # Backup before updates
```

**Platform-specific paths:**
- Linux: `~/.pluribus/config.json`
- macOS: `~/.pluribus/config.json`
- Windows: `%APPDATA%\pluribus\config.json`

### 6.2 File Format

```json
{
  "version": 1,
  "updatedAt": "2026-01-24T12:00:00.000Z",
  "database": {
    "postgresql": {
      "encryptedUrl": {
        "ciphertext": "base64...",
        "iv": "base64...",
        "authTag": "base64..."
      },
      "maxConnections": 20,
      "ssl": "require"
    },
    "redis": {
      "encryptedUrl": {
        "ciphertext": "base64...",
        "iv": "base64...",
        "authTag": "base64..."
      }
    }
  }
}
```

### 6.3 Encryption

Connection URLs are encrypted using the existing vault crypto module:

```typescript
// Encryption uses VAULT_MASTER_KEY with credential ID "config:database"
import { encrypt, decrypt } from '@/vault/crypto';

const encrypted = encrypt(postgresUrl, 'config:postgresql');
const decrypted = decrypt(encrypted, 'config:postgresql');
```

---

## 7. ConfigResolver Implementation

### 7.1 Resolution Logic

```typescript
// src/lib/config/resolver.ts

export class ConfigResolver {
  private fileStore: FileStore;

  async resolve(): Promise<ResolvedConfig> {
    const envConfig = this.loadFromEnv();
    const fileConfig = await this.fileStore.load();
    const defaults = this.getDefaults();

    return {
      postgresql: {
        url: envConfig.postgresql?.url
          ?? fileConfig?.postgresql?.url
          ?? defaults.postgresql.url,
        source: envConfig.postgresql?.url ? 'env'
          : fileConfig?.postgresql?.url ? 'file'
          : 'default',
        maxConnections: envConfig.postgresql?.maxConnections
          ?? fileConfig?.postgresql?.maxConnections
          ?? defaults.postgresql.maxConnections,
        // ... other fields
      },
      redis: {
        url: envConfig.redis?.url
          ?? fileConfig?.redis?.url
          ?? defaults.redis.url,
        source: envConfig.redis?.url ? 'env'
          : fileConfig?.redis?.url ? 'file'
          : 'default',
        // ... other fields
      },
    };
  }

  private loadFromEnv(): Partial<DatabaseConfig> {
    return {
      postgresql: process.env.DATABASE_URL
        ? { url: process.env.DATABASE_URL }
        : undefined,
      redis: process.env.REDIS_URL
        ? { url: process.env.REDIS_URL }
        : undefined,
    };
  }

  private getDefaults(): DatabaseConfig {
    return {
      postgresql: {
        url: 'postgres://pluribus:pluribus@localhost:5432/pluribus',
        maxConnections: 10,
        idleTimeout: 20,
        connectTimeout: 10,
        ssl: false,
      },
      redis: {
        url: 'redis://localhost:6379',
        maxRetries: 3,
        retryDelay: 1000,
      },
    };
  }
}
```

### 7.2 Startup Sequence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Application Startup                             │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Load VAULT_MASTER_KEY from environment                                   │
│    └── Required for decrypting config file                                  │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. ConfigResolver.resolve()                                                 │
│    ├── Check DATABASE_URL env var                                           │
│    ├── Check REDIS_URL env var                                              │
│    ├── Load ~/.pluribus/config.json (if exists)                             │
│    ├── Decrypt connection URLs                                              │
│    └── Apply defaults for missing values                                    │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. Initialize DatabaseManager                                               │
│    ├── Create PostgreSQL connection pool                                    │
│    ├── Create Redis connection                                              │
│    └── Verify connections with health check                                 │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. Start HTTP server                                                        │
│    └── API routes now available                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Connection Validator

### 8.1 PostgreSQL Validation

```typescript
// src/lib/config/validator.ts

export async function validatePostgresConnection(
  url: string,
  timeout: number = 10000
): Promise<ValidationResult> {
  const startTime = Date.now();

  try {
    const client = postgres(url, {
      max: 1,
      connect_timeout: Math.floor(timeout / 1000),
      idle_timeout: 5,
    });

    // 1. Basic connection
    const [{ version }] = await client`SELECT version()`;

    // 2. Version check (require PostgreSQL 14+)
    const versionMatch = version.match(/PostgreSQL (\d+)/);
    const majorVersion = versionMatch ? parseInt(versionMatch[1]) : 0;
    if (majorVersion < 14) {
      throw new Error(`PostgreSQL 14+ required, found ${majorVersion}`);
    }

    // 3. Write permission check
    await client`CREATE TEMP TABLE _pluribus_test (id int)`;
    await client`DROP TABLE _pluribus_test`;

    await client.end();

    return {
      success: true,
      latencyMs: Date.now() - startTime,
      version: versionMatch ? `${majorVersion}` : 'unknown',
      permissions: { read: true, write: true },
    };
  } catch (error) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function validateRedisConnection(
  url: string,
  timeout: number = 10000
): Promise<ValidationResult> {
  const startTime = Date.now();

  try {
    const redis = new IORedis(url, {
      connectTimeout: timeout,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // No retries for validation
    });

    // 1. Basic connection
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error('Unexpected PING response');

    // 2. Version check
    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:(\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    // 3. Write permission check
    const testKey = '_pluribus_test_' + Date.now();
    await redis.set(testKey, 'test', 'EX', 5);
    await redis.del(testKey);

    await redis.quit();

    return {
      success: true,
      latencyMs: Date.now() - startTime,
      version,
      permissions: { read: true, write: true },
    };
  } catch (error) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

---

## 9. Security Considerations

### 9.1 Password Masking

```typescript
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    return '****';
  }
}
```

### 9.2 Logging Policy

```typescript
// NEVER log these fields:
// - Full connection URLs
// - Passwords
// - Decrypted config file contents

// Safe to log:
// - Masked URLs (password replaced with ****)
// - Host names only
// - Connection status (success/failure)
// - Latency measurements
```

### 9.3 File Permissions

```typescript
// Config file should be readable only by owner
// Linux/macOS: chmod 600 ~/.pluribus/config.json

import { chmod } from 'node:fs/promises';
await chmod(configPath, 0o600);
```

---

## 10. UI Integration Points

### 10.1 Onboarding Step

```
Route: /onboarding/database

API Calls:
1. GET /api/config/database/status  → Check current state
2. POST /api/config/database/test   → Validate user input
3. PUT /api/config/database         → Save configuration
```

### 10.2 Settings Page

```
Route: /settings/database

API Calls:
1. GET /api/config/database         → Load current config
2. POST /api/config/database/test   → Test before save
3. PUT /api/config/database         → Save changes
4. GET /api/config/database/status  → Poll for health
```

### 10.3 UI States

| State | Display |
|-------|---------|
| `source: 'env'` | Show lock icon, disable edit, show "Set via environment" badge |
| `source: 'file'` | Enable edit, show "Custom configuration" badge |
| `source: 'default'` | Enable edit, show "Using defaults" badge, suggest configuration |
| `connected: true` | Green status indicator |
| `connected: false` | Red status indicator, show error message |

---

## 11. Migration Path

### 11.1 From Docker to External

```
1. User clicks "Migrate" in settings
2. UI prompts for new database credentials
3. POST /api/config/database/test validates new connection
4. System creates migration plan:
   a. Export data from current DB (pg_dump equivalent)
   b. Validate target schema
   c. Import data to new DB
   d. Verify row counts
5. User confirms migration
6. PUT /api/config/database applies new config
7. System reconnects to new database
```

### 11.2 Data Export Format

```json
{
  "version": 1,
  "exportedAt": "2026-01-24T12:00:00.000Z",
  "source": "postgres://...@localhost:5432/pluribus",
  "tables": {
    "agents": { "count": 15 },
    "workflows": { "count": 8 },
    "workflowRuns": { "count": 234 },
    // ...
  },
  "data": "base64-encoded-sql-dump"
}
```

---

## 12. Error Handling

| Error Code | HTTP | Description |
|------------|------|-------------|
| `CONFIG_LOCKED_BY_ENV` | 400 | Cannot modify config locked by environment variable |
| `CONNECTION_FAILED` | 400 | Database connection test failed |
| `VALIDATION_ERROR` | 400 | Invalid configuration format |
| `TIMEOUT` | 400 | Connection timeout |
| `VERSION_UNSUPPORTED` | 400 | Database version too old |
| `PERMISSION_DENIED` | 400 | Insufficient database permissions |
| `FILE_WRITE_ERROR` | 500 | Cannot write config file |
| `ENCRYPTION_ERROR` | 500 | Cannot encrypt/decrypt config |

---

## 13. Testing Strategy

### 13.1 Unit Tests

```typescript
describe('ConfigResolver', () => {
  it('prioritizes env vars over file config');
  it('prioritizes file config over defaults');
  it('decrypts connection URLs from file');
  it('returns correct source for each field');
});

describe('ConnectionValidator', () => {
  it('validates PostgreSQL connection');
  it('validates Redis connection');
  it('returns latency measurements');
  it('handles connection timeout');
  it('detects permission issues');
});
```

### 13.2 Integration Tests

```typescript
describe('Config API', () => {
  it('GET /api/config/database returns masked URLs');
  it('PUT /api/config/database validates before saving');
  it('PUT /api/config/database rejects when env locked');
  it('POST /api/config/database/test validates connection');
});
```

---

## 14. Implementation Checklist

- [ ] Create `src/lib/config/types.ts`
- [ ] Create `src/lib/config/schemas.ts`
- [ ] Create `src/lib/config/file-store.ts`
- [ ] Create `src/lib/config/resolver.ts`
- [ ] Create `src/lib/config/validator.ts`
- [ ] Create `src/api/routes/config.ts`
- [ ] Update `src/db/client.ts` to use ConfigResolver
- [ ] Update `src/queue/client.ts` to use ConfigResolver
- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Update API documentation

---

## 15. Next Steps

After design approval:
1. Use `/sc:implement` to generate the implementation
2. Update `docs/ROADMAP.md` to mark tasks as in-progress
3. Create frontend components after backend is complete

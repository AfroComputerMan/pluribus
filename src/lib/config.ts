import { z } from 'zod';

// Environment schema validation
const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Security
  VAULT_MASTER_KEY: z.string().min(32),

  // OAuth (optional)
  ANTHROPIC_CLIENT_ID: z.string().optional(),
  ANTHROPIC_CLIENT_SECRET: z.string().optional(),
  ANTHROPIC_REDIRECT_URI: z.string().url().optional(),

  OPENAI_CLIENT_ID: z.string().optional(),
  OPENAI_CLIENT_SECRET: z.string().optional(),
  OPENAI_REDIRECT_URI: z.string().url().optional(),

  // API Keys (fallback)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

// Parse and validate environment
function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment configuration:');
    console.error(result.error.format());
    throw new Error('Invalid environment configuration');
  }

  return result.data;
}

// Singleton config
let _config: Env | null = null;

export function getConfig(): Env {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// Type-safe config access
export const config = new Proxy({} as Env, {
  get(_, prop: keyof Env) {
    return getConfig()[prop];
  },
});

// Feature flags
export const features = {
  get containerIsolation(): boolean {
    return !!process.env.DOCKER_HOST;
  },

  get oauthEnabled(): boolean {
    const cfg = getConfig();
    return !!(
      (cfg.ANTHROPIC_CLIENT_ID && cfg.ANTHROPIC_CLIENT_SECRET) ||
      (cfg.OPENAI_CLIENT_ID && cfg.OPENAI_CLIENT_SECRET)
    );
  },
};

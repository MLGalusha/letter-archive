import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://app:app@localhost:5432/app'),
  PORT: z.coerce.number().default(3002),
  SITE_URL: z.string().default('http://localhost:5174'),
  STORAGE_DIR: z.string().default('./storage'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.4'),
  CORS_ORIGINS: z.string().optional(),
  PYTHON_VENV_PATH: z.string().default('./python/venv'),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  JWT_SECRET: z.string().default('change-me-in-production'),
  JWT_EXPIRY: z.string().default('24h'),
  ALLOW_ADMIN_SETUP: z.coerce.boolean().default(process.env.NODE_ENV !== 'production'),
  SEED_DEV_ADMIN: z.coerce.boolean().default(process.env.NODE_ENV !== 'production'),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GCLOUD_PROJECT: z.string().optional(),
  CLOUD_RUN_REGION: z.string().optional(),
  CLOUD_RUN_WORKER_JOB_NAME: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const hasOpenAI = Boolean(env.OPENAI_API_KEY);
// On Cloud Run, ADC (Application Default Credentials) is available automatically
// without GOOGLE_APPLICATION_CREDENTIALS. Only gate on the env var for local dev
// where explicit credentials are needed.
export const hasGoogleVision = Boolean(env.GOOGLE_APPLICATION_CREDENTIALS) ||
  process.env.NODE_ENV === 'production';

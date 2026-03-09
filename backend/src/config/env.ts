import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://app:app@localhost:5433/app'),
  PORT: z.coerce.number().default(3002),
  STORAGE_DIR: z.string().default('./storage'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.4'),
  CORS_ORIGINS: z.string().optional(),
  PYTHON_VENV_PATH: z.string().default('./python/venv'),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const hasOpenAI = Boolean(env.OPENAI_API_KEY);
export const hasGoogleVision = Boolean(env.GOOGLE_APPLICATION_CREDENTIALS);

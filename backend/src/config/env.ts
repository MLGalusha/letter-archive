import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://app:app@localhost:5432/app'),
  PORT: z.coerce.number().default(3001),
  STORAGE_DIR: z.string().default('./storage'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.2'),
});

export const env = envSchema.parse(process.env);

export const hasOpenAI = Boolean(env.OPENAI_API_KEY);

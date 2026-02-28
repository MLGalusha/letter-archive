import OpenAI from 'openai';
import { env, hasOpenAI } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';

export const log = createLogger({ module: 'openai' });
export const openai = hasOpenAI ? new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  timeout: 5 * 60 * 1000, // 5 minute timeout per request
}) : null;

log.info(
  { enabled: hasOpenAI, model: hasOpenAI ? env.OPENAI_MODEL : 'n/a' },
  hasOpenAI ? 'OpenAI client initialized' : 'OpenAI disabled - using stub mode',
);

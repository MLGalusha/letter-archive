/**
 * API Usage Tracking Service
 *
 * Logs OpenAI API call usage (tokens, cost, duration) to the api_usage_logs table.
 * All calls are fire-and-forget — failures are logged but never break the main flow.
 */

import { db, apiUsageLogs } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'usage-tracking' });

// Model pricing per 1M tokens — update as OpenAI pricing changes
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o-2024-08-06': { input: 2.50, output: 10.00 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-5.4': { input: 2.50, output: 10.00 }, // default estimate
  'gpt-5.4-mini': { input: 0.40, output: 1.60 },
};

export interface LogUsageParams {
  letterId?: string;
  callType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number;
}

// --- Batched insert logic ---
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5_000;

interface UsageRow {
  letterId: string | null;
  callType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: string;
  outputCost: string;
  totalCost: string;
  durationMs: number | null;
}

let pendingRows: UsageRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushUsageBatch(): Promise<void> {
  if (pendingRows.length === 0) return;
  const batch = pendingRows;
  pendingRows = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    await db.insert(apiUsageLogs).values(batch);
  } catch (err) {
    log.error({ err, batchSize: batch.length }, 'Failed to flush API usage batch');
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushUsageBatch().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

// Flush on process shutdown
process.on('SIGINT', () => { flushUsageBatch().catch(() => {}); });
process.on('SIGTERM', () => { flushUsageBatch().catch(() => {}); });

/**
 * Log an API usage record. Batches inserts for efficiency — flushes every
 * 20 records or every 5 seconds, whichever comes first.
 * Fire-and-forget — errors are caught and logged, never propagated.
 */
export async function logApiUsage(params: LogUsageParams): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const pricing = MODEL_PRICING[params.model] || { input: 2.50, output: 10.00 };
  const inputCost = (params.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (params.outputTokens / 1_000_000) * pricing.output;
  const totalCost = inputCost + outputCost;

  pendingRows.push({
    letterId: params.letterId || null,
    callType: params.callType,
    model: params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    totalTokens: params.inputTokens + params.outputTokens,
    inputCost: inputCost.toFixed(6),
    outputCost: outputCost.toFixed(6),
    totalCost: totalCost.toFixed(6),
    durationMs: params.durationMs || null,
  });

  if (pendingRows.length >= BATCH_SIZE) {
    await flushUsageBatch();
  } else {
    scheduleFlush();
  }
}

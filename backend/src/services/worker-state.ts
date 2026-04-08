import { eq } from 'drizzle-orm';
import { db, workerState } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'worker-state' });

const SINGLETON_ID = 'singleton';

export interface WorkerStateSnapshot {
  lastTickAt: string | null;
  isPolling: boolean;
  lastError: string | null;
  currentBatchSize: number | null;
  updatedAt: string | null;
}

/**
 * Write a partial update to the worker_state singleton. Failures are logged
 * but swallowed — the worker should never crash because we couldn't write
 * its heartbeat.
 */
export async function setWorkerState(partial: {
  lastTickAt?: Date | null;
  isPolling?: boolean;
  lastError?: string | null;
  currentBatchSize?: number | null;
}): Promise<void> {
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (partial.lastTickAt !== undefined) updates.lastTickAt = partial.lastTickAt;
    if (partial.isPolling !== undefined) updates.isPolling = partial.isPolling;
    if (partial.lastError !== undefined) updates.lastError = partial.lastError;
    if (partial.currentBatchSize !== undefined) updates.currentBatchSize = partial.currentBatchSize;

    // Upsert-style: update; if no row exists, insert it.
    const result = await db
      .update(workerState)
      .set(updates)
      .where(eq(workerState.id, SINGLETON_ID))
      .returning({ id: workerState.id });

    if (result.length === 0) {
      await db.insert(workerState).values({
        id: SINGLETON_ID,
        ...updates,
      });
    }
  } catch (err) {
    log.warn({ err }, 'Failed to write worker state');
  }
}

/**
 * Read the worker state singleton. Returns an empty snapshot if the row
 * doesn't exist yet or the read fails.
 */
export async function getWorkerState(): Promise<WorkerStateSnapshot> {
  try {
    const rows = await db
      .select()
      .from(workerState)
      .where(eq(workerState.id, SINGLETON_ID))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return {
        lastTickAt: null,
        isPolling: false,
        lastError: null,
        currentBatchSize: null,
        updatedAt: null,
      };
    }

    return {
      lastTickAt: row.lastTickAt?.toISOString() ?? null,
      isPolling: row.isPolling,
      lastError: row.lastError,
      currentBatchSize: row.currentBatchSize,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    };
  } catch (err) {
    log.warn({ err }, 'Failed to read worker state');
    return {
      lastTickAt: null,
      isPolling: false,
      lastError: null,
      currentBatchSize: null,
      updatedAt: null,
    };
  }
}

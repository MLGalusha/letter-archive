import { eq } from 'drizzle-orm';
import { db, workerState } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'worker-state' });

const SINGLETON_ID = 'singleton';

export interface WorkerStateUpdate {
  lastTickAt?: Date | null;
  isPolling?: boolean;
  lastError?: string | null;
  currentBatchSize?: number | null;
}

export interface WorkerStateSnapshot {
  lastTickAt: string | null;
  isPolling: boolean;
  lastError: string | null;
  currentBatchSize: number | null;
  updatedAt: string | null;
}

async function writeWorkerState(partial: WorkerStateUpdate): Promise<void> {
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
}

/**
 * Write a best-effort worker-state update. Heartbeat visibility must not make
 * ordinary processing fail when the state row is temporarily unavailable.
 */
export async function setWorkerState(partial: WorkerStateUpdate): Promise<void> {
  try {
    await writeWorkerState(partial);
  } catch (err) {
    log.warn({ err }, 'Failed to write worker state');
  }
}

/**
 * Write worker state without containing the failure. Exit handoff relies on
 * this variant so a failed idle-state publication makes the worker job fail.
 */
export async function setWorkerStateOrThrow(partial: WorkerStateUpdate): Promise<void> {
  await writeWorkerState(partial);
}

/**
 * Serializes heartbeat writes with the exit handoff. Once relinquishment
 * begins, new heartbeats are ignored and every accepted heartbeat settles
 * before the required idle-state write runs.
 */
export function createWorkerStatePublisher({
  writeBestEffort = setWorkerState,
  writeRequired = setWorkerStateOrThrow,
}: {
  writeBestEffort?: (partial: WorkerStateUpdate) => Promise<void>;
  writeRequired?: (partial: WorkerStateUpdate) => Promise<void>;
} = {}) {
  let writesEnabled = true;
  let tail: Promise<void> = Promise.resolve();
  let relinquishment: Promise<void> | null = null;

  const enqueue = (
    write: (partial: WorkerStateUpdate) => Promise<void>,
    partial: WorkerStateUpdate,
  ): Promise<void> => {
    const queued = tail.then(() => write(partial));
    // A required write still rejects to its caller, but must not permanently
    // poison the queue used by fatal cleanup.
    tail = queued.catch(() => undefined);
    return queued;
  };

  return {
    publishHeartbeat(partial: WorkerStateUpdate): void {
      if (!writesEnabled) return;
      void enqueue(writeBestEffort, partial);
    },

    async relinquish(partial: WorkerStateUpdate): Promise<void> {
      if (relinquishment) return relinquishment;
      writesEnabled = false;
      relinquishment = enqueue(writeRequired, partial);
      return relinquishment;
    },

    async resume(partial: WorkerStateUpdate): Promise<void> {
      await enqueue(writeBestEffort, partial);
      relinquishment = null;
      writesEnabled = true;
    },
  };
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

import { randomUUID } from 'node:crypto';
import {
  and,
  eq,
  gt,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { db, workerState } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'worker-state' });

const SINGLETON_ID = 'singleton';
const WORKER_STATE_REPORT_WAIT_MS = 5_000;

export const WORKER_EXECUTION_LEASE_MS = 120_000;

export interface WorkerExecutionLease {
  token: string;
}

export interface WorkerStateUpdate {
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

type WorkerStateWriter = (
  token: string,
  update: WorkerStateUpdate,
) => Promise<boolean>;

function databaseNow() {
  return sql<Date>`clock_timestamp()`;
}

function newLeaseDeadline() {
  return sql<Date>`
    clock_timestamp() + (${WORKER_EXECUTION_LEASE_MS} * interval '1 millisecond')
  `;
}

function activeExecutionConditions(token: string) {
  return [
    eq(workerState.id, SINGLETON_ID),
    eq(workerState.executionToken, token),
    isNotNull(workerState.executionLeaseExpiresAt),
    gt(workerState.executionLeaseExpiresAt, databaseNow()),
  ];
}

/**
 * Adds the singleton execution lease to a stage's atomic claim statement.
 * Direct request-owned claims omit this condition; automatic worker claims
 * pass their token so a preflight that outlives global ownership cannot start
 * a fresh stage afterward.
 */
export function activeWorkerExecutionCondition(token: string) {
  return sql`EXISTS (
    SELECT 1
    FROM ${workerState}
    WHERE ${workerState.id} = ${SINGLETON_ID}
      AND ${workerState.executionToken} = ${token}
      AND ${workerState.executionLeaseExpiresAt} > clock_timestamp()
  )`;
}

function reportedStateUpdate(update: WorkerStateUpdate) {
  const values: Record<string, unknown> = {
    lastTickAt: databaseNow(),
    isPolling: true,
    updatedAt: databaseNow(),
  };
  if (update.lastError !== undefined) values.lastError = update.lastError;
  if (update.currentBatchSize !== undefined) {
    values.currentBatchSize = update.currentBatchSize;
  }
  return values;
}

/**
 * Atomically acquires the singleton when it is unowned or its prior lease has
 * expired. The migration owns singleton creation; a zero-row update means that
 * another execution remains authoritative.
 */
export async function acquireWorkerExecutionLease(): Promise<WorkerExecutionLease | null> {
  const token = randomUUID();
  const claimed = await db
    .update(workerState)
    .set({
      executionToken: token,
      executionLeaseExpiresAt: newLeaseDeadline(),
      lastTickAt: databaseNow(),
      isPolling: true,
      lastError: null,
      currentBatchSize: 0,
      updatedAt: databaseNow(),
    })
    .where(and(
      eq(workerState.id, SINGLETON_ID),
      or(
        isNull(workerState.executionToken),
        lte(workerState.executionLeaseExpiresAt, databaseNow()),
      ),
    ))
    .returning({ id: workerState.id });

  return claimed.length > 0 ? { token } : null;
}

/**
 * Renews only the exact execution while its lease is still live. An expired
 * owner cannot resurrect itself after another execution becomes eligible.
 */
export async function renewWorkerExecutionLease(token: string): Promise<boolean> {
  const renewed = await db
    .update(workerState)
    .set({
      executionLeaseExpiresAt: newLeaseDeadline(),
      lastTickAt: databaseNow(),
      isPolling: true,
      updatedAt: databaseNow(),
    })
    .where(and(...activeExecutionConditions(token)))
    .returning({ id: workerState.id });

  return renewed.length > 0;
}

/**
 * Publishes observational state only for the exact live execution.
 */
export async function publishWorkerState(
  token: string,
  update: WorkerStateUpdate,
): Promise<boolean> {
  const published = await db
    .update(workerState)
    .set(reportedStateUpdate(update))
    .where(and(...activeExecutionConditions(token)))
    .returning({ id: workerState.id });

  return published.length > 0;
}

/**
 * Releases only the exact token. A release remains safe after lease expiry, but
 * loses to any successor that has already replaced the token.
 */
export async function releaseWorkerExecutionLease(
  token: string,
  update: WorkerStateUpdate = {},
): Promise<boolean> {
  const values: Record<string, unknown> = {
    executionToken: null,
    executionLeaseExpiresAt: null,
    lastTickAt: databaseNow(),
    isPolling: false,
    currentBatchSize: update.currentBatchSize === undefined
      ? 0
      : update.currentBatchSize,
    updatedAt: databaseNow(),
  };
  if (update.lastError !== undefined) values.lastError = update.lastError;

  const released = await db
    .update(workerState)
    .set(values)
    .where(and(
      eq(workerState.id, SINGLETON_ID),
      eq(workerState.executionToken, token),
    ))
    .returning({ id: workerState.id });

  return released.length > 0;
}

/**
 * Uses the PostgreSQL clock so API and worker process clock skew cannot affect
 * the decision to request another execution.
 */
export async function hasActiveWorkerExecutionLease(): Promise<boolean> {
  const active = await db
    .select({ id: workerState.id })
    .from(workerState)
    .where(and(
      eq(workerState.id, SINGLETON_ID),
      isNotNull(workerState.executionToken),
      isNotNull(workerState.executionLeaseExpiresAt),
      gt(workerState.executionLeaseExpiresAt, databaseNow()),
    ))
    .limit(1);

  return active.length > 0;
}

/**
 * Serializes best-effort reports ahead of one terminal, required release. The
 * execution token is captured once and never exposed through the publisher.
 */
export function createWorkerStatePublisher(
  token: string,
  {
    writeBestEffort = publishWorkerState,
    writeRelease = releaseWorkerExecutionLease,
    reportWaitMs = WORKER_STATE_REPORT_WAIT_MS,
  }: {
    writeBestEffort?: WorkerStateWriter;
    writeRelease?: WorkerStateWriter;
    reportWaitMs?: number;
  } = {},
) {
  let tail: Promise<void> = Promise.resolve();
  let release: Promise<boolean> | null = null;
  let reportsEnabled = true;

  return {
    publish(update: WorkerStateUpdate): void {
      if (release || !reportsEnabled) return;

      const reported = tail.then(async () => {
        if (!reportsEnabled) return;

        let timeout: NodeJS.Timeout | null = null;
        const result = await Promise.race([
          Promise.resolve()
            .then(() => writeBestEffort(token, update))
            .then(
              () => ({ kind: 'complete' as const }),
              (error: unknown) => ({ kind: 'failed' as const, error }),
            ),
          new Promise<{ kind: 'timeout' }>((resolve) => {
            timeout = setTimeout(
              () => resolve({ kind: 'timeout' }),
              reportWaitMs,
            );
          }),
        ]);
        if (timeout !== null) clearTimeout(timeout);

        if (result.kind === 'failed') {
          log.warn({ err: result.error }, 'Failed to publish worker state');
        } else if (result.kind === 'timeout') {
          // The exact-token fence makes a late report harmless after release.
          // Stop queueing observations so one stuck connection cannot block the
          // required release and post-release durable work recheck.
          reportsEnabled = false;
          log.warn(
            { reportWaitMs },
            'Timed out publishing worker state; suppressing later reports',
          );
        }
      });
      tail = reported;
    },

    release(update: WorkerStateUpdate = {}): Promise<boolean> {
      if (release) return release;

      release = tail.then(() => writeRelease(token, update));
      tail = release.then(
        () => undefined,
        () => undefined,
      );
      return release;
    },
  };
}

/**
 * Reads the singleton without exposing its execution token. `isPolling` is
 * false as soon as PostgreSQL considers the lease expired, even if a crashed
 * execution never published its final idle state.
 */
export async function getWorkerState(): Promise<WorkerStateSnapshot> {
  try {
    const rows = await db
      .select({
        lastTickAt: workerState.lastTickAt,
        isPolling: sql<boolean>`
          ${workerState.isPolling}
          AND ${workerState.executionToken} IS NOT NULL
          AND ${workerState.executionLeaseExpiresAt} > clock_timestamp()
        `,
        lastError: workerState.lastError,
        currentBatchSize: workerState.currentBatchSize,
        updatedAt: workerState.updatedAt,
      })
      .from(workerState)
      .where(eq(workerState.id, SINGLETON_ID))
      .limit(1);

    const row = rows[0];
    if (!row) return emptyWorkerState();

    return {
      lastTickAt: row.lastTickAt?.toISOString() ?? null,
      isPolling: row.isPolling,
      lastError: row.lastError,
      currentBatchSize: row.currentBatchSize,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    };
  } catch (err) {
    log.warn({ err }, 'Failed to read worker state');
    return emptyWorkerState();
  }
}

function emptyWorkerState(): WorkerStateSnapshot {
  return {
    lastTickAt: null,
    isPolling: false,
    lastError: null,
    currentBatchSize: null,
    updatedAt: null,
  };
}

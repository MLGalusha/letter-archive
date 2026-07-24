import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNotNull, lte, ne, sql } from 'drizzle-orm';
import {
  db,
  letters,
  type ContentStatus,
  type ExtraContentClaimKind,
  type JobStatus,
} from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  withLeaseHeartbeat,
  type LeaseHeartbeat,
} from './lease-heartbeat.js';
import { buildMetadataSourceInvalidationPatch } from './metadata-job.js';
import { observedTimestampMatches } from './shared.js';
import { activeWorkerExecutionCondition } from '../worker-state.js';

const log = createLogger({ module: 'extra-content-job' });
const LEASE_EXPIRED_ERROR = 'Extra-content lease expired before the attempt completed';

type ClaimableJobStatus = Exclude<JobStatus, 'RUNNING'>;

export interface ExtraContentPatch {
  extraContentTranscript: string | null;
  extraContentStatus: ContentStatus;
  extraContentVerifiedAt: null;
  extraContentVerifiedBy: null;
}

export type ExtraContentHeartbeat = LeaseHeartbeat;

export type ExtraContentJobResult<T> =
  | { kind: 'completed'; value: T }
  | { kind: 'claim_lost' }
  | { kind: 'superseded' };

export interface RecoveredExtraContentRow {
  id: string;
  dateRaw: string;
}

export interface ExtraContentRecoveryResult {
  requeued: RecoveredExtraContentRow[];
  failed: RecoveredExtraContentRow[];
}

interface ExtraContentJobOptions<T> {
  letterId: string;
  expectedStatus: ClaimableJobStatus;
  expectedUpdatedAt: Date;
  claimKind: ExtraContentClaimKind;
  workerExecutionToken?: string;
  produce: (
    heartbeat: ExtraContentHeartbeat,
  ) => Promise<{ value: T; patch: ExtraContentPatch }>;
}

function databaseNow() {
  return sql<Date>`clock_timestamp()`;
}

function newLeaseDeadline() {
  return sql<Date>`clock_timestamp() + interval '5 minutes'`;
}

function activeOwnedExtraContentConditions(
  letterId: string,
  runId: string,
  dirty: boolean,
) {
  return [
    eq(letters.id, letterId),
    eq(letters.extraContentJobStatus, 'RUNNING'),
    eq(letters.extraContentJobRunId, runId),
    eq(letters.extraContentJobLeaseRunId, runId),
    eq(letters.extraContentJobDirty, dirty),
    isNotNull(letters.extraContentJobLeaseExpiresAt),
    gt(letters.extraContentJobLeaseExpiresAt, databaseNow()),
  ];
}

function clearedExtraContentOwnership() {
  return {
    extraContentJobRunId: null,
    extraContentJobLeaseExpiresAt: null,
    extraContentJobLeaseRunId: null,
    extraContentJobClaimKind: null,
    extraContentJobDirty: false,
  };
}

/**
 * Human changes are authoritative over in-flight extra-content generation.
 * Spread this into the same update as the human content mutation.
 */
export function buildHumanExtraContentJobPatch() {
  return {
    extraContentJobStatus: 'SUCCESS' as const,
    extraContentJobError: null,
    ...clearedExtraContentOwnership(),
  };
}

/**
 * Source changes preserve a live attempt's complete tuple and mark it dirty.
 * An idle row clears any rolling-deployment metadata and returns to PENDING.
 */
export function buildExtraContentSourceInvalidationPatch() {
  return {
    extraContentJobStatus: sql<JobStatus>`CASE
      WHEN ${letters.extraContentJobStatus} = 'RUNNING'
        THEN ${letters.extraContentJobStatus}
      ELSE 'PENDING'::job_status
    END`,
    extraContentJobError: sql<string | null>`CASE
      WHEN ${letters.extraContentJobStatus} = 'RUNNING'
        THEN ${letters.extraContentJobError}
      ELSE NULL
    END`,
    extraContentJobRunId: sql<string | null>`CASE
      WHEN ${letters.extraContentJobStatus} = 'RUNNING'
        THEN ${letters.extraContentJobRunId}
      ELSE NULL
    END`,
    extraContentJobLeaseExpiresAt: sql<Date | null>`CASE
      WHEN ${letters.extraContentJobStatus} = 'RUNNING'
        THEN ${letters.extraContentJobLeaseExpiresAt}
      ELSE NULL
    END`,
    extraContentJobLeaseRunId: sql<string | null>`CASE
      WHEN ${letters.extraContentJobStatus} = 'RUNNING'
        THEN ${letters.extraContentJobLeaseRunId}
      ELSE NULL
    END`,
    extraContentJobClaimKind: sql<ExtraContentClaimKind | null>`CASE
      WHEN ${letters.extraContentJobStatus} = 'RUNNING'
        THEN ${letters.extraContentJobClaimKind}
      ELSE NULL
    END`,
    extraContentJobDirty: sql<boolean>`CASE
      WHEN ${letters.extraContentJobStatus} = 'RUNNING' THEN true
      ELSE false
    END`,
  };
}

async function requeueDirtyAttempt(letterId: string, runId: string): Promise<boolean> {
  const rows = await db
    .update(letters)
    .set({
      extraContentJobStatus: 'PENDING',
      extraContentJobError: null,
      ...clearedExtraContentOwnership(),
      updatedAt: new Date(),
    })
    .where(and(...activeOwnedExtraContentConditions(letterId, runId, true)))
    .returning({ id: letters.id });

  return rows.length > 0;
}

/** Extends only the exact clean run's still-live lease. */
export async function renewExtraContentLease(
  letterId: string,
  runId: string,
): Promise<boolean> {
  const renewed = await db
    .update(letters)
    .set({ extraContentJobLeaseExpiresAt: newLeaseDeadline() })
    .where(and(...activeOwnedExtraContentConditions(letterId, runId, false)))
    .returning({ id: letters.id });

  return renewed.length > 0;
}

export async function withExtraContentHeartbeat<T>(
  letterId: string,
  runId: string,
  operation: (heartbeat: ExtraContentHeartbeat) => Promise<T>,
): Promise<T> {
  return withLeaseHeartbeat(
    {
      renew: () => renewExtraContentLease(letterId, runId),
      onRenewalError: (error: unknown) => {
        log.warn(
          { letterId, runId, err: error },
          'Failed to renew extra-content lease; will retry',
        );
      },
    },
    operation,
  );
}

/**
 * Administratively revokes an exact run even after lease expiry. A source
 * invalidation wins by returning the row to PENDING instead of discarding it.
 */
export async function cancelExtraContentAttempt(
  letterId: string,
  runId: string,
  error = 'Cancelled by admin',
): Promise<boolean> {
  const cancelled = await db
    .update(letters)
    .set({
      extraContentJobStatus: sql<JobStatus>`CASE
        WHEN ${letters.extraContentJobDirty} THEN 'PENDING'::job_status
        ELSE 'FAILED'::job_status
      END`,
      extraContentJobError: sql<string | null>`CASE
        WHEN ${letters.extraContentJobDirty} THEN NULL
        ELSE ${error}
      END`,
      ...clearedExtraContentOwnership(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      eq(letters.extraContentJobStatus, 'RUNNING'),
      eq(letters.extraContentJobRunId, runId),
    ))
    .returning({ id: letters.id });

  return cancelled.length > 0;
}

/**
 * Owns one extra-content attempt from exact-state claim through publication.
 * Producers return a patch so revoked, expired, or dirty attempts cannot write
 * content before discovering that they lost ownership.
 */
export async function runExtraContentJob<T>({
  letterId,
  expectedStatus,
  expectedUpdatedAt,
  claimKind,
  workerExecutionToken,
  produce,
}: ExtraContentJobOptions<T>): Promise<ExtraContentJobResult<T>> {
  const runId = randomUUID();
  const claimed = await db
    .update(letters)
    .set({
      extraContentJobStatus: 'RUNNING',
      extraContentJobError: null,
      extraContentJobRunId: runId,
      extraContentJobLeaseExpiresAt: newLeaseDeadline(),
      extraContentJobLeaseRunId: runId,
      extraContentJobClaimKind: claimKind,
      extraContentJobDirty: false,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      eq(letters.extraContentJobStatus, expectedStatus),
      ne(letters.entityExtractionStatus, 'RUNNING'),
      observedTimestampMatches(letters.updatedAt, expectedUpdatedAt),
      ...(workerExecutionToken
        ? [activeWorkerExecutionCondition(workerExecutionToken)]
        : []),
    ))
    .returning({ id: letters.id });

  if (claimed.length === 0) return { kind: 'claim_lost' };

  return withExtraContentHeartbeat(letterId, runId, async (heartbeat) => {
    try {
      const { value, patch } = await produce(heartbeat);
      if (!heartbeat.hasOwnership()) {
        await requeueDirtyAttempt(letterId, runId);
        return { kind: 'superseded' };
      }

      const completed = await db
        .update(letters)
        .set({
          ...patch,
          ...buildMetadataSourceInvalidationPatch(),
          extraContentJobStatus: 'SUCCESS',
          extraContentJobError: null,
          ...clearedExtraContentOwnership(),
          updatedAt: new Date(),
        })
        .where(and(...activeOwnedExtraContentConditions(letterId, runId, false)))
        .returning({ id: letters.id });

      if (completed.length > 0) return { kind: 'completed', value };

      await requeueDirtyAttempt(letterId, runId);
      return { kind: 'superseded' };
    } catch (error) {
      if (!heartbeat.hasOwnership()) {
        await requeueDirtyAttempt(letterId, runId);
        return { kind: 'superseded' };
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      try {
        const failed = await db
          .update(letters)
          .set({
            extraContentJobStatus: 'FAILED',
            extraContentJobError: message,
            ...clearedExtraContentOwnership(),
            updatedAt: new Date(),
          })
          .where(and(...activeOwnedExtraContentConditions(letterId, runId, false)))
          .returning({ id: letters.id });

        if (failed.length === 0) {
          await requeueDirtyAttempt(letterId, runId);
          return { kind: 'superseded' };
        }
      } catch (statusError) {
        log.error(
          { letterId, runId, err: statusError, originalError: error },
          'Failed to persist extra-content job failure',
        );
      }
      throw error;
    }
  });
}

/**
 * Reconciles only expired, fully-owned lease tuples. Dirty source changes win
 * over requested-versus-queued intent. Conditional UPDATE RETURNING makes the
 * returned rows authoritative even when multiple reconcilers race.
 */
export async function recoverExpiredExtraContentJobs(
  workerExecutionToken?: string,
): Promise<ExtraContentRecoveryResult> {
  const dirty = await db
    .update(letters)
    .set({
      extraContentJobStatus: 'PENDING',
      extraContentJobError: null,
      ...clearedExtraContentOwnership(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.extraContentJobStatus, 'RUNNING'),
      eq(letters.extraContentJobDirty, true),
      isNotNull(letters.extraContentJobRunId),
      isNotNull(letters.extraContentJobLeaseExpiresAt),
      isNotNull(letters.extraContentJobLeaseRunId),
      isNotNull(letters.extraContentJobClaimKind),
      eq(letters.extraContentJobLeaseRunId, letters.extraContentJobRunId),
      lte(letters.extraContentJobLeaseExpiresAt, databaseNow()),
      ...(workerExecutionToken
        ? [activeWorkerExecutionCondition(workerExecutionToken)]
        : []),
    ))
    .returning({ id: letters.id, dateRaw: letters.dateRaw });

  const queued = await db
    .update(letters)
    .set({
      extraContentJobStatus: 'PENDING',
      extraContentJobError: null,
      ...clearedExtraContentOwnership(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.extraContentJobStatus, 'RUNNING'),
      eq(letters.extraContentJobDirty, false),
      eq(letters.extraContentJobClaimKind, 'QUEUED'),
      isNotNull(letters.extraContentJobRunId),
      isNotNull(letters.extraContentJobLeaseExpiresAt),
      isNotNull(letters.extraContentJobLeaseRunId),
      eq(letters.extraContentJobLeaseRunId, letters.extraContentJobRunId),
      lte(letters.extraContentJobLeaseExpiresAt, databaseNow()),
      ...(workerExecutionToken
        ? [activeWorkerExecutionCondition(workerExecutionToken)]
        : []),
    ))
    .returning({ id: letters.id, dateRaw: letters.dateRaw });

  const failed = await db
    .update(letters)
    .set({
      extraContentJobStatus: 'FAILED',
      extraContentJobError: LEASE_EXPIRED_ERROR,
      ...clearedExtraContentOwnership(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.extraContentJobStatus, 'RUNNING'),
      eq(letters.extraContentJobDirty, false),
      eq(letters.extraContentJobClaimKind, 'REQUESTED'),
      isNotNull(letters.extraContentJobRunId),
      isNotNull(letters.extraContentJobLeaseExpiresAt),
      isNotNull(letters.extraContentJobLeaseRunId),
      eq(letters.extraContentJobLeaseRunId, letters.extraContentJobRunId),
      lte(letters.extraContentJobLeaseExpiresAt, databaseNow()),
      ...(workerExecutionToken
        ? [activeWorkerExecutionCondition(workerExecutionToken)]
        : []),
    ))
    .returning({ id: letters.id, dateRaw: letters.dateRaw });

  return { requeued: [...dirty, ...queued], failed };
}

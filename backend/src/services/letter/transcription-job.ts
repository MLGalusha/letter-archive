import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import {
  db,
  letters,
  type ContentStatus,
  type JobStatus,
  type TranscriptionClaimKind,
  type WorkflowState,
} from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  withLeaseHeartbeat,
  type LeaseHeartbeat,
} from './lease-heartbeat.js';
import { buildMetadataSourceInvalidationPatch } from './metadata-job.js';

const log = createLogger({ module: 'transcription-job' });
const LEASE_EXPIRED_ERROR = 'Transcription lease expired before the attempt completed';

export interface ObservedTranscriptionState {
  status: JobStatus;
  workflow: WorkflowState;
  transcriptionText: string | null;
  transcriptionError: string | null;
  transcriptionAttemptCount: number;
  transcriptionLeaseExpiresAt: Date | null;
  transcriptionLeaseRunId: string | null;
  transcriptionClaimKind: TranscriptionClaimKind | null;
  metadataStatus: JobStatus;
  entityExtractionStatus: JobStatus;
  deadLetter: boolean;
  transcriptStatus: ContentStatus;
}

export interface TranscriptionStateSource {
  transcriptionStatus: JobStatus;
  workflow: WorkflowState;
  transcriptionText: string | null;
  transcriptionError: string | null;
  transcriptionAttemptCount: number;
  transcriptionLeaseExpiresAt: Date | null;
  transcriptionLeaseRunId: string | null;
  transcriptionClaimKind: TranscriptionClaimKind | null;
  metadataStatus: JobStatus;
  entityExtractionStatus: JobStatus;
  deadLetter: boolean;
  transcriptStatus: ContentStatus;
}

export interface TranscriptionClaim {
  runId: string;
}

export type TranscriptionHeartbeat = LeaseHeartbeat;

export interface RecoveredTranscriptionRow {
  id: string;
  dateRaw: string;
}

export interface TranscriptionRecoveryResult {
  requeued: RecoveredTranscriptionRow[];
  failed: RecoveredTranscriptionRow[];
}

function databaseNow() {
  return sql<Date>`clock_timestamp()`;
}

function newLeaseDeadline() {
  return sql<Date>`clock_timestamp() + interval '5 minutes'`;
}

export function observeTranscriptionState(
  source: TranscriptionStateSource,
): ObservedTranscriptionState {
  return {
    status: source.transcriptionStatus,
    workflow: source.workflow,
    transcriptionText: source.transcriptionText,
    transcriptionError: source.transcriptionError,
    transcriptionAttemptCount: source.transcriptionAttemptCount,
    transcriptionLeaseExpiresAt: source.transcriptionLeaseExpiresAt,
    transcriptionLeaseRunId: source.transcriptionLeaseRunId,
    transcriptionClaimKind: source.transcriptionClaimKind,
    metadataStatus: source.metadataStatus,
    entityExtractionStatus: source.entityExtractionStatus,
    deadLetter: source.deadLetter,
    transcriptStatus: source.transcriptStatus,
  };
}

export function observedTranscriptionStateConditions(observed: ObservedTranscriptionState) {
  return [
    eq(letters.transcriptionStatus, observed.status),
    eq(letters.workflow, observed.workflow),
    observed.transcriptionText === null
      ? isNull(letters.transcriptionText)
      : eq(letters.transcriptionText, observed.transcriptionText),
    observed.transcriptionError === null
      ? isNull(letters.transcriptionError)
      : eq(letters.transcriptionError, observed.transcriptionError),
    eq(letters.transcriptionAttemptCount, observed.transcriptionAttemptCount),
    isNull(letters.transcriptionRunId),
    observed.transcriptionLeaseExpiresAt === null
      ? isNull(letters.transcriptionLeaseExpiresAt)
      : eq(letters.transcriptionLeaseExpiresAt, observed.transcriptionLeaseExpiresAt),
    observed.transcriptionLeaseRunId === null
      ? isNull(letters.transcriptionLeaseRunId)
      : eq(letters.transcriptionLeaseRunId, observed.transcriptionLeaseRunId),
    observed.transcriptionClaimKind === null
      ? isNull(letters.transcriptionClaimKind)
      : eq(letters.transcriptionClaimKind, observed.transcriptionClaimKind),
    eq(letters.metadataStatus, observed.metadataStatus),
    eq(letters.entityExtractionStatus, observed.entityExtractionStatus),
    eq(letters.deadLetter, observed.deadLetter),
    eq(letters.transcriptStatus, observed.transcriptStatus),
  ];
}

function hasPairedLeaseMetadata(observed: ObservedTranscriptionState): boolean {
  return (observed.transcriptionLeaseExpiresAt === null)
    === (observed.transcriptionClaimKind === null);
}

function activeOwnedTranscriptionConditions(letterId: string, runId: string) {
  return [
    eq(letters.id, letterId),
    eq(letters.transcriptionStatus, 'RUNNING'),
    eq(letters.transcriptionRunId, runId),
    eq(letters.transcriptionLeaseRunId, runId),
    isNotNull(letters.transcriptionLeaseExpiresAt),
    gt(letters.transcriptionLeaseExpiresAt, databaseNow()),
  ];
}

function clearedOwnershipTuple() {
  return {
    transcriptionRunId: null,
    transcriptionLeaseExpiresAt: null,
    transcriptionLeaseRunId: null,
    transcriptionClaimKind: null,
  };
}

function revokedTranscriptionWorkflow(runId: string) {
  return sql<WorkflowState>`CASE
    WHEN ${letters.transcriptionLeaseRunId} = ${runId}
      AND ${letters.transcriptionClaimKind} = 'REQUESTED'
      THEN ${letters.workflow}
    WHEN ${letters.transcriptionLeaseRunId} = ${runId}
      AND ${letters.transcriptionClaimKind} = 'QUEUED'
      THEN 'UPLOADED'
    WHEN ${letters.workflow} = 'TRANSCRIBING' THEN 'UPLOADED'
    ELSE ${letters.workflow}
  END`;
}

/**
 * Claims queued work from the exact eligible state that the caller inspected.
 * PostgreSQL, rather than an application process clock, owns the lease deadline.
 */
export async function claimQueuedTranscription(
  letterId: string,
  observed: ObservedTranscriptionState,
): Promise<TranscriptionClaim | null> {
  if (
    observed.status !== 'PENDING'
    || observed.workflow !== 'UPLOADED'
    || observed.metadataStatus === 'RUNNING'
    || observed.entityExtractionStatus === 'RUNNING'
    || !hasPairedLeaseMetadata(observed)
    || observed.deadLetter
  ) {
    return null;
  }

  const runId = randomUUID();
  const claimed = await db
    .update(letters)
    .set({
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: runId,
      transcriptionLeaseExpiresAt: newLeaseDeadline(),
      transcriptionLeaseRunId: runId,
      transcriptionClaimKind: 'QUEUED',
      workflow: 'TRANSCRIBING',
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      ...observedTranscriptionStateConditions(observed),
    ))
    .returning({ id: letters.id });

  return claimed.length > 0 ? { runId } : null;
}

/**
 * Claims synchronous admin work without hiding or otherwise changing the
 * existing workflow/content while the replacement is being produced.
 */
export async function claimRequestedTranscription(
  letterId: string,
  observed: ObservedTranscriptionState,
): Promise<TranscriptionClaim | null> {
  if (
    observed.status === 'RUNNING'
    || observed.metadataStatus === 'RUNNING'
    || observed.entityExtractionStatus === 'RUNNING'
    || !hasPairedLeaseMetadata(observed)
  ) {
    return null;
  }

  const runId = randomUUID();
  const claimed = await db
    .update(letters)
    .set({
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: runId,
      transcriptionLeaseExpiresAt: newLeaseDeadline(),
      transcriptionLeaseRunId: runId,
      transcriptionClaimKind: 'REQUESTED',
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      deadLetter: false,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      ...observedTranscriptionStateConditions(observed),
    ))
    .returning({ id: letters.id });

  return claimed.length > 0 ? { runId } : null;
}

/** Extends only the exact run's still-live lease. This is not user-visible work. */
export async function renewTranscriptionLease(
  letterId: string,
  runId: string,
): Promise<boolean> {
  const renewed = await db
    .update(letters)
    .set({ transcriptionLeaseExpiresAt: newLeaseDeadline() })
    .where(and(...activeOwnedTranscriptionConditions(letterId, runId)))
    .returning({ id: letters.id });

  return renewed.length > 0;
}

/**
 * Keeps a claimed attempt alive while an operation runs. Renewals never overlap.
 * A transient database exception is logged and retried on the next interval;
 * an authoritative false result permanently marks ownership lost.
 */
export async function withTranscriptionHeartbeat<T>(
  letterId: string,
  runId: string,
  operation: (heartbeat: TranscriptionHeartbeat) => Promise<T>,
): Promise<T> {
  return withLeaseHeartbeat(
    {
      renew: () => renewTranscriptionLease(letterId, runId),
      onRenewalError: (error: unknown) => {
        log.warn(
          { letterId, runId, err: error },
          'Failed to renew transcription lease; will retry',
        );
      },
    },
    operation,
  );
}

/** Publishes a completed result only for the exact run's still-live lease. */
export async function completeTranscription(
  letterId: string,
  runId: string,
  transcriptionText: string | null,
): Promise<boolean> {
  const updated = await db
    .update(letters)
    .set({
      transcriptionText,
      transcriptionStatus: 'SUCCESS',
      transcriptionError: null,
      transcribedAt: new Date(),
      transcriptStatus: transcriptionText === null ? 'EMPTY' : 'AI_DRAFT',
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      ...buildMetadataSourceInvalidationPatch(),
      // The completed transcription is the new primary source, so its stage
      // transition wins over the generic metadata-source workflow fallback.
      workflow: 'TRANSCRIBED',
      ...clearedOwnershipTuple(),
      updatedAt: new Date(),
    })
    .where(and(...activeOwnedTranscriptionConditions(letterId, runId)))
    .returning({ id: letters.id });

  return updated.length > 0;
}

async function revokeTranscription(
  letterId: string,
  runId: string,
  error: string,
  requireLiveLease: boolean,
): Promise<boolean> {
  const ownershipConditions = requireLiveLease
    ? activeOwnedTranscriptionConditions(letterId, runId)
    : [
      eq(letters.id, letterId),
      eq(letters.transcriptionStatus, 'RUNNING'),
      eq(letters.transcriptionRunId, runId),
    ];

  const failed = await db
    .update(letters)
    .set({
      transcriptionStatus: 'FAILED',
      transcriptionError: error,
      workflow: revokedTranscriptionWorkflow(runId),
      ...clearedOwnershipTuple(),
      updatedAt: new Date(),
    })
    .where(and(...ownershipConditions))
    .returning({ id: letters.id });

  return failed.length > 0;
}

/** Records producer failure only while the exact run still owns a live lease. */
export async function failTranscription(
  letterId: string,
  runId: string,
  error: string,
): Promise<boolean> {
  return revokeTranscription(letterId, runId, error, true);
}

/**
 * Administratively revokes an exact run even after its lease expires. Bound
 * requested/queued intent remains authoritative. For rollout-era unbound or
 * mismatched work, current TRANSCRIBING returns to UPLOADED and other workflows
 * are preserved rather than trusting inherited intent metadata.
 */
export async function cancelTranscriptionAttempt(
  letterId: string,
  runId: string,
  error = 'Cancelled by admin',
): Promise<boolean> {
  return revokeTranscription(letterId, runId, error, false);
}

/**
 * Reclaims only expired, fully-owned lease tuples. Conditional UPDATE RETURNING
 * makes the returned rows the authoritative recovery report under concurrency.
 */
export async function recoverExpiredTranscriptions(): Promise<TranscriptionRecoveryResult> {
  const requeued = await db
    .update(letters)
    .set({
      transcriptionStatus: 'PENDING',
      transcriptionError: null,
      workflow: 'UPLOADED',
      ...clearedOwnershipTuple(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.transcriptionStatus, 'RUNNING'),
      eq(letters.transcriptionClaimKind, 'QUEUED'),
      isNotNull(letters.transcriptionRunId),
      isNotNull(letters.transcriptionLeaseExpiresAt),
      isNotNull(letters.transcriptionLeaseRunId),
      eq(letters.transcriptionLeaseRunId, letters.transcriptionRunId),
      lte(letters.transcriptionLeaseExpiresAt, databaseNow()),
    ))
    .returning({ id: letters.id, dateRaw: letters.dateRaw });

  const failed = await db
    .update(letters)
    .set({
      transcriptionStatus: 'FAILED',
      transcriptionError: LEASE_EXPIRED_ERROR,
      ...clearedOwnershipTuple(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.transcriptionStatus, 'RUNNING'),
      eq(letters.transcriptionClaimKind, 'REQUESTED'),
      isNotNull(letters.transcriptionRunId),
      isNotNull(letters.transcriptionLeaseExpiresAt),
      isNotNull(letters.transcriptionLeaseRunId),
      eq(letters.transcriptionLeaseRunId, letters.transcriptionRunId),
      lte(letters.transcriptionLeaseExpiresAt, databaseNow()),
    ))
    .returning({ id: letters.id, dateRaw: letters.dateRaw });

  return { requeued, failed };
}

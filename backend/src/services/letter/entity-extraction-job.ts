import { randomUUID } from 'node:crypto';
import {
  and,
  eq,
  gt,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
} from 'drizzle-orm';
import {
  db,
  letters,
  type EntityExtractionClaimKind,
  type JobStatus,
  type LetterType,
} from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import { isEntityExtractionStateEligible } from '../processing-eligibility.js';
import { activeWorkerExecutionCondition } from '../worker-state.js';
import {
  withLeaseHeartbeat,
  type LeaseHeartbeat,
} from './lease-heartbeat.js';

const log = createLogger({ module: 'entity-extraction-job' });
const LEASE_EXPIRED_ERROR =
  'Entity extraction lease expired before the attempt completed';

export interface EntityExtractionStateSource {
  type: LetterType;
  transcriptionStatus: JobStatus;
  metadataStatus: JobStatus;
  extraContentJobStatus: JobStatus;
  entityExtractionStatus: JobStatus;
  entityExtractionRevision: number;
  entityExtractionRunId: string | null;
  entityExtractionRunRevision: number | null;
  entityExtractionLeaseExpiresAt: Date | null;
  entityExtractionLeaseRunId: string | null;
  entityExtractionClaimKind: EntityExtractionClaimKind | null;
  deadLetter: boolean;
}

export interface ObservedEntityExtractionState {
  type: LetterType;
  transcriptionStatus: JobStatus;
  metadataStatus: JobStatus;
  extraContentJobStatus: JobStatus;
  status: JobStatus;
  revision: number;
  runId: string | null;
  runRevision: number | null;
  leaseExpiresAt: Date | null;
  leaseRunId: string | null;
  claimKind: EntityExtractionClaimKind | null;
  deadLetter: boolean;
}

export interface EntityExtractionClaim {
  runId: string;
  revision: number;
}

export type EntityExtractionHeartbeat = LeaseHeartbeat;

export interface RecoveredEntityExtractionRow {
  id: string;
  dateRaw: string;
}

export interface EntityExtractionRecoveryResult {
  requeued: RecoveredEntityExtractionRow[];
  failed: RecoveredEntityExtractionRow[];
}

export function observeEntityExtractionState(
  source: EntityExtractionStateSource,
): ObservedEntityExtractionState {
  return {
    type: source.type,
    transcriptionStatus: source.transcriptionStatus,
    metadataStatus: source.metadataStatus,
    extraContentJobStatus: source.extraContentJobStatus,
    status: source.entityExtractionStatus,
    revision: source.entityExtractionRevision,
    runId: source.entityExtractionRunId,
    runRevision: source.entityExtractionRunRevision,
    leaseExpiresAt: source.entityExtractionLeaseExpiresAt,
    leaseRunId: source.entityExtractionLeaseRunId,
    claimKind: source.entityExtractionClaimKind,
    deadLetter: source.deadLetter,
  };
}

export function observedEntityExtractionStateConditions(
  observed: ObservedEntityExtractionState,
) {
  return [
    eq(letters.type, observed.type),
    eq(letters.transcriptionStatus, observed.transcriptionStatus),
    eq(letters.metadataStatus, observed.metadataStatus),
    eq(letters.extraContentJobStatus, observed.extraContentJobStatus),
    eq(letters.entityExtractionStatus, observed.status),
    eq(letters.entityExtractionRevision, observed.revision),
    observed.runId === null
      ? isNull(letters.entityExtractionRunId)
      : eq(letters.entityExtractionRunId, observed.runId),
    observed.runRevision === null
      ? isNull(letters.entityExtractionRunRevision)
      : eq(letters.entityExtractionRunRevision, observed.runRevision),
    observed.leaseExpiresAt === null
      ? isNull(letters.entityExtractionLeaseExpiresAt)
      : eq(letters.entityExtractionLeaseExpiresAt, observed.leaseExpiresAt),
    observed.leaseRunId === null
      ? isNull(letters.entityExtractionLeaseRunId)
      : eq(letters.entityExtractionLeaseRunId, observed.leaseRunId),
    observed.claimKind === null
      ? isNull(letters.entityExtractionClaimKind)
      : eq(letters.entityExtractionClaimKind, observed.claimKind),
    eq(letters.deadLetter, observed.deadLetter),
  ];
}

function databaseNow() {
  return sql<Date>`clock_timestamp()`;
}

function newLeaseDeadline() {
  return sql<Date>`clock_timestamp() + interval '5 minutes'`;
}

function hasEmptyRunTuple(observed: ObservedEntityExtractionState): boolean {
  return observed.runId === null && observed.runRevision === null;
}

function hasPairedLeaseMetadata(
  observed: ObservedEntityExtractionState,
): boolean {
  const present = [
    observed.leaseExpiresAt,
    observed.leaseRunId,
    observed.claimKind,
  ].filter(value => value !== null).length;
  return present === 0 || present === 3;
}

function hasClaimableSource(observed: ObservedEntityExtractionState): boolean {
  return isEntityExtractionStateEligible(observed)
    && hasEmptyRunTuple(observed)
    && hasPairedLeaseMetadata(observed);
}

async function claimEntityExtraction(
  letterId: string,
  observed: ObservedEntityExtractionState,
  claimKind: EntityExtractionClaimKind,
  workerExecutionToken?: string,
): Promise<EntityExtractionClaim | null> {
  const runId = randomUUID();
  const result = await db
    .update(letters)
    .set({
      entityExtractionStatus: 'RUNNING',
      entityExtractionRunId: runId,
      entityExtractionRunRevision: sql`${letters.entityExtractionRevision} + 1`,
      entityExtractionLeaseExpiresAt: newLeaseDeadline(),
      entityExtractionLeaseRunId: runId,
      entityExtractionClaimKind: claimKind,
      entityExtractionError: null,
      ...(claimKind === 'REQUESTED' ? { deadLetter: false } : {}),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      ...observedEntityExtractionStateConditions(observed),
      ...(workerExecutionToken
        ? [activeWorkerExecutionCondition(workerExecutionToken)]
        : []),
    ))
    .returning({ revision: letters.entityExtractionRunRevision });

  const revision = result[0]?.revision;
  return revision === null || revision === undefined ? null : { runId, revision };
}

/** Claims automatic durable work from an exact eligible PENDING state. */
export async function claimQueuedEntityExtraction(
  letterId: string,
  observed: ObservedEntityExtractionState,
  workerExecutionToken?: string,
): Promise<EntityExtractionClaim | null> {
  if (
    !hasClaimableSource(observed)
    || observed.status !== 'PENDING'
    || observed.deadLetter
  ) {
    return null;
  }

  return claimEntityExtraction(
    letterId,
    observed,
    'QUEUED',
    workerExecutionToken,
  );
}

/** Claims an explicit entity-only replacement without exposing it as queued work. */
export async function claimRequestedEntityExtraction(
  letterId: string,
  observed: ObservedEntityExtractionState,
): Promise<EntityExtractionClaim | null> {
  if (!hasClaimableSource(observed) || observed.status === 'RUNNING') {
    return null;
  }

  return claimEntityExtraction(letterId, observed, 'REQUESTED');
}

/**
 * Every current-code terminal or invalidation writer clears this complete
 * ownership tuple. Rolling-version residue may remain only when an older
 * executable performs the write.
 */
export function clearedEntityExtractionOwnership() {
  return {
    entityExtractionRunId: null,
    entityExtractionRunRevision: null,
    entityExtractionLeaseExpiresAt: null,
    entityExtractionLeaseRunId: null,
    entityExtractionClaimKind: null,
  };
}

/** Refreshes the deadline from the PostgreSQL clock. */
export function entityExtractionLeaseRenewalPatch() {
  return {
    entityExtractionLeaseExpiresAt: newLeaseDeadline(),
  };
}

/** The exact current ownership tuple, without interpreting its deadline. */
export function ownedEntityExtractionAttemptConditions(
  letterId: string,
  claim: EntityExtractionClaim,
) {
  return [
    eq(letters.id, letterId),
    eq(letters.entityExtractionStatus, 'RUNNING'),
    eq(letters.entityExtractionRunId, claim.runId),
    eq(letters.entityExtractionRunRevision, claim.revision),
    eq(letters.entityExtractionRevision, claim.revision - 1),
    eq(letters.entityExtractionLeaseRunId, claim.runId),
    isNotNull(letters.entityExtractionLeaseExpiresAt),
    isNotNull(letters.entityExtractionClaimKind),
    ne(letters.extraContentJobStatus, 'RUNNING'),
  ];
}

/**
 * The exact current attempt predicate used before acquiring a row lock and by
 * every owner action that can race with recovery.
 */
export function activeEntityExtractionAttemptConditions(
  letterId: string,
  claim: EntityExtractionClaim,
) {
  return [
    ...ownedEntityExtractionAttemptConditions(letterId, claim),
    gt(letters.entityExtractionLeaseExpiresAt, databaseNow()),
  ];
}

/** Extends only the exact still-live run/revision-bound lease. */
export async function renewEntityExtractionLease(
  letterId: string,
  claim: EntityExtractionClaim,
): Promise<boolean> {
  const renewed = await db
    .update(letters)
    .set(entityExtractionLeaseRenewalPatch())
    .where(and(...activeEntityExtractionAttemptConditions(letterId, claim)))
    .returning({ id: letters.id });

  return renewed.length > 0;
}

export async function withEntityExtractionHeartbeat<T>(
  letterId: string,
  claim: EntityExtractionClaim,
  operation: (heartbeat: EntityExtractionHeartbeat) => Promise<T>,
): Promise<T> {
  return withLeaseHeartbeat(
    {
      renew: () => renewEntityExtractionLease(letterId, claim),
      onRenewalError: (error: unknown) => {
        log.warn(
          { letterId, runId: claim.runId, revision: claim.revision, err: error },
          'Failed to renew entity extraction lease; will retry',
        );
      },
    },
    operation,
  );
}

/** Records producer failure only while the exact claim still owns a live lease. */
export async function failEntityExtraction(
  letterId: string,
  claim: EntityExtractionClaim,
  error: string,
): Promise<boolean> {
  const result = await db
    .update(letters)
    .set({
      entityExtractionStatus: 'FAILED',
      ...clearedEntityExtractionOwnership(),
      entityExtractionError: error,
      updatedAt: new Date(),
    })
    .where(and(...activeEntityExtractionAttemptConditions(letterId, claim)))
    .returning({ id: letters.id });

  return result.length > 0;
}

/**
 * Administratively revokes an exact run/revision even when it is expired,
 * unleased, or has rollout-era mismatched lease residue.
 */
export async function cancelEntityExtractionAttempt(
  letterId: string,
  claim: EntityExtractionClaim,
  error = 'Cancelled by admin',
): Promise<boolean> {
  const result = await db
    .update(letters)
    .set({
      entityExtractionStatus: 'FAILED',
      ...clearedEntityExtractionOwnership(),
      entityExtractionError: error,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      eq(letters.entityExtractionStatus, 'RUNNING'),
      eq(letters.entityExtractionRunId, claim.runId),
      eq(letters.entityExtractionRunRevision, claim.revision),
    ))
    .returning({ id: letters.id });

  return result.length > 0;
}

/**
 * Closes only a tokenless attempt from the migration-0051 drain window.
 * Current or rollout-residue liveness is never interpreted as legacy intent.
 */
export async function cancelLegacyEntityExtraction(
  letterId: string,
  error: string,
): Promise<boolean> {
  const result = await db
    .update(letters)
    .set({
      entityExtractionStatus: 'FAILED',
      ...clearedEntityExtractionOwnership(),
      entityExtractionError: error,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      eq(letters.entityExtractionStatus, 'RUNNING'),
      isNull(letters.entityExtractionRunId),
      isNull(letters.entityExtractionRunRevision),
      isNull(letters.entityExtractionLeaseExpiresAt),
      isNull(letters.entityExtractionLeaseRunId),
      isNull(letters.entityExtractionClaimKind),
    ))
    .returning({ id: letters.id });

  return result.length > 0;
}

/**
 * Reconciles only exact, fully-bound current attempts. Queued work returns to
 * the durable queue; requested replacement work fails visibly. Legacy,
 * unleased, partial, and mismatched attempts remain manual.
 */
export async function recoverExpiredEntityExtractionJobs(
  workerExecutionToken?: string,
): Promise<EntityExtractionRecoveryResult> {
  const commonConditions = [
    eq(letters.entityExtractionStatus, 'RUNNING'),
    isNotNull(letters.entityExtractionRunId),
    isNotNull(letters.entityExtractionRunRevision),
    eq(
      letters.entityExtractionRunRevision,
      sql`${letters.entityExtractionRevision} + 1`,
    ),
    isNotNull(letters.entityExtractionLeaseExpiresAt),
    isNotNull(letters.entityExtractionLeaseRunId),
    eq(
      letters.entityExtractionLeaseRunId,
      letters.entityExtractionRunId,
    ),
    lte(letters.entityExtractionLeaseExpiresAt, databaseNow()),
  ];
  const workerConditions = workerExecutionToken
    ? [activeWorkerExecutionCondition(workerExecutionToken)]
    : [];

  const requeued = await db
    .update(letters)
    .set({
      entityExtractionStatus: 'PENDING',
      ...clearedEntityExtractionOwnership(),
      entityExtractionError: null,
      updatedAt: new Date(),
    })
    .where(and(
      ...commonConditions,
      eq(letters.entityExtractionClaimKind, 'QUEUED'),
      ...workerConditions,
    ))
    .returning({ id: letters.id, dateRaw: letters.dateRaw });

  const failed = await db
    .update(letters)
    .set({
      entityExtractionStatus: 'FAILED',
      ...clearedEntityExtractionOwnership(),
      entityExtractionError: LEASE_EXPIRED_ERROR,
      updatedAt: new Date(),
    })
    .where(and(
      ...commonConditions,
      eq(letters.entityExtractionClaimKind, 'REQUESTED'),
      ...workerConditions,
    ))
    .returning({ id: letters.id, dateRaw: letters.dateRaw });

  return { requeued, failed };
}

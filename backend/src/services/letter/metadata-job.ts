import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type {
  AiNoteOutput,
  MetadataV2,
  StructuredNote,
} from '../../ai/schemas/metadataV2.js';
import {
  db,
  letters,
  type ContentStatus,
  type EmotionalTone,
  type JobStatus,
  type LetterType,
  type MetadataClaimKind,
  type RelationshipType,
  type WorkflowState,
} from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  withLeaseHeartbeat,
  type LeaseHeartbeat,
} from './lease-heartbeat.js';
import { isMetadataSourceEligible } from '../processing-eligibility.js';
import { activeWorkerExecutionCondition } from '../worker-state.js';

const log = createLogger({ module: 'metadata-job' });
const LEASE_EXPIRED_ERROR = 'Metadata lease expired before the attempt completed';

export interface MetadataStateSource {
  type: LetterType;
  workflow: WorkflowState;
  transcriptionStatus: JobStatus;
  transcriptionText: string | null;
  transcriptConfirmedAt: Date | null;
  extraContentTranscript: string | null;
  extraContentJobStatus: JobStatus;
  extraContentJobRunId: string | null;
  metadataStatus: JobStatus;
  metadataRevision: number;
  metadataRunId: string | null;
  metadataRunRevision: number | null;
  metadataLeaseExpiresAt: Date | null;
  metadataLeaseRunId: string | null;
  metadataClaimKind: MetadataClaimKind | null;
  metadataContentStatus: ContentStatus;
  metadataVerifiedAt: Date | null;
  metadataVerifiedBy: string | null;
  entityExtractionStatus: JobStatus;
  deadLetter: boolean;
}

export interface ObservedMetadataState {
  type: LetterType;
  workflow: WorkflowState;
  transcriptionStatus: JobStatus;
  transcriptionText: string | null;
  transcriptConfirmedAt: Date | null;
  extraContentTranscript: string | null;
  extraContentJobStatus: JobStatus;
  extraContentJobRunId: string | null;
  status: JobStatus;
  revision: number;
  runId: string | null;
  runRevision: number | null;
  leaseExpiresAt: Date | null;
  leaseRunId: string | null;
  claimKind: MetadataClaimKind | null;
  contentStatus: ContentStatus;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  entityExtractionStatus: JobStatus;
  deadLetter: boolean;
}

export interface MetadataClaim {
  runId: string;
  revision: number;
}

export type MetadataHeartbeat = LeaseHeartbeat;

export interface RecoveredMetadataRow {
  id: string;
  dateRaw: string;
}

export interface MetadataRecoveryResult {
  requeued: RecoveredMetadataRow[];
  failed: RecoveredMetadataRow[];
}

export function observeMetadataState(source: MetadataStateSource): ObservedMetadataState {
  return {
    type: source.type,
    workflow: source.workflow,
    transcriptionStatus: source.transcriptionStatus,
    transcriptionText: source.transcriptionText,
    transcriptConfirmedAt: source.transcriptConfirmedAt,
    extraContentTranscript: source.extraContentTranscript,
    extraContentJobStatus: source.extraContentJobStatus,
    extraContentJobRunId: source.extraContentJobRunId,
    status: source.metadataStatus,
    revision: source.metadataRevision,
    runId: source.metadataRunId,
    runRevision: source.metadataRunRevision,
    leaseExpiresAt: source.metadataLeaseExpiresAt,
    leaseRunId: source.metadataLeaseRunId,
    claimKind: source.metadataClaimKind,
    contentStatus: source.metadataContentStatus,
    verifiedAt: source.metadataVerifiedAt,
    verifiedBy: source.metadataVerifiedBy,
    entityExtractionStatus: source.entityExtractionStatus,
    deadLetter: source.deadLetter,
  };
}

export function observedMetadataStateConditions(observed: ObservedMetadataState) {
  return [
    eq(letters.type, observed.type),
    eq(letters.workflow, observed.workflow),
    eq(letters.transcriptionStatus, observed.transcriptionStatus),
    observed.transcriptionText === null
      ? isNull(letters.transcriptionText)
      : eq(letters.transcriptionText, observed.transcriptionText),
    observed.transcriptConfirmedAt === null
      ? isNull(letters.transcriptConfirmedAt)
      : eq(letters.transcriptConfirmedAt, observed.transcriptConfirmedAt),
    observed.extraContentTranscript === null
      ? isNull(letters.extraContentTranscript)
      : eq(letters.extraContentTranscript, observed.extraContentTranscript),
    eq(letters.extraContentJobStatus, observed.extraContentJobStatus),
    observed.extraContentJobRunId === null
      ? isNull(letters.extraContentJobRunId)
      : eq(letters.extraContentJobRunId, observed.extraContentJobRunId),
    eq(letters.metadataStatus, observed.status),
    eq(letters.metadataRevision, observed.revision),
    observed.runId === null
      ? isNull(letters.metadataRunId)
      : eq(letters.metadataRunId, observed.runId),
    observed.runRevision === null
      ? isNull(letters.metadataRunRevision)
      : eq(letters.metadataRunRevision, observed.runRevision),
    observed.leaseExpiresAt === null
      ? isNull(letters.metadataLeaseExpiresAt)
      : eq(letters.metadataLeaseExpiresAt, observed.leaseExpiresAt),
    observed.leaseRunId === null
      ? isNull(letters.metadataLeaseRunId)
      : eq(letters.metadataLeaseRunId, observed.leaseRunId),
    observed.claimKind === null
      ? isNull(letters.metadataClaimKind)
      : eq(letters.metadataClaimKind, observed.claimKind),
    eq(letters.metadataContentStatus, observed.contentStatus),
    observed.verifiedAt === null
      ? isNull(letters.metadataVerifiedAt)
      : eq(letters.metadataVerifiedAt, observed.verifiedAt),
    observed.verifiedBy === null
      ? isNull(letters.metadataVerifiedBy)
      : eq(letters.metadataVerifiedBy, observed.verifiedBy),
    eq(letters.entityExtractionStatus, observed.entityExtractionStatus),
    eq(letters.deadLetter, observed.deadLetter),
  ];
}

/** Exact revision guard for a human read/transform/write mutation. */
export function observedMetadataRevisionConditions(
  letterId: string,
  source: Pick<MetadataStateSource, 'metadataRevision'>,
) {
  return [
    eq(letters.id, letterId),
    eq(letters.metadataRevision, source.metadataRevision),
  ];
}

function databaseNow() {
  return sql<Date>`clock_timestamp()`;
}

function newLeaseDeadline() {
  return sql<Date>`clock_timestamp() + interval '5 minutes'`;
}

function hasEmptyOwnershipTuple(observed: ObservedMetadataState): boolean {
  return observed.runId === null
    && observed.runRevision === null
    && observed.leaseExpiresAt === null
    && observed.leaseRunId === null
    && observed.claimKind === null;
}

function hasClaimableSource(observed: ObservedMetadataState): boolean {
  return isMetadataSourceEligible(observed)
    && hasEmptyOwnershipTuple(observed);
}

async function claimMetadata(
  letterId: string,
  observed: ObservedMetadataState,
  claimKind: MetadataClaimKind,
  updates: Record<string, unknown>,
  workerExecutionToken?: string,
): Promise<MetadataClaim | null> {
  const runId = randomUUID();
  const claimed = await db
    .update(letters)
    .set({
      ...updates,
      metadataStatus: 'RUNNING',
      metadataRunId: runId,
      metadataRunRevision: observed.revision,
      metadataLeaseExpiresAt: newLeaseDeadline(),
      metadataLeaseRunId: runId,
      metadataClaimKind: claimKind,
      metadataError: null,
      workflow: 'METADATA_EXTRACTING',
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      ...observedMetadataStateConditions(observed),
      ...(workerExecutionToken
        ? [activeWorkerExecutionCondition(workerExecutionToken)]
        : []),
    ))
    .returning({ id: letters.id });

  return claimed.length > 0 ? { runId, revision: observed.revision } : null;
}

/** Claims worker/batch work only from the exact queued source revision. */
export async function claimQueuedMetadata(
  letterId: string,
  observed: ObservedMetadataState,
  workerExecutionToken?: string,
): Promise<MetadataClaim | null> {
  if (
    !hasClaimableSource(observed)
    || observed.status !== 'PENDING'
    || observed.workflow !== 'TRANSCRIBED'
    || !observed.transcriptConfirmedAt
    || observed.deadLetter
  ) {
    return null;
  }

  return claimMetadata(letterId, observed, 'QUEUED', {
    // Every replacement metadata result owns a matching entity rebuild. Source
    // invalidation may have left an older entity result FAILED or SUCCESS.
    entityExtractionStatus: 'PENDING',
    entityExtractionRunId: null,
    entityExtractionRunRevision: null,
    entityExtractionError: null,
  }, workerExecutionToken);
}

/**
 * Claims an explicit admin regeneration without discarding committed metadata.
 * Entity work is reset because it derives from the replacement metadata.
 */
export async function claimRequestedMetadata(
  letterId: string,
  observed: ObservedMetadataState,
): Promise<MetadataClaim | null> {
  if (
    !hasClaimableSource(observed)
    || !observed.transcriptConfirmedAt
    || observed.status === 'RUNNING'
  ) {
    return null;
  }

  return claimMetadata(letterId, observed, 'REQUESTED', {
    metadataAttemptCount: 0,
    deadLetter: false,
    entityExtractionStatus: 'PENDING',
    entityExtractionRunId: null,
    entityExtractionRunRevision: null,
    entityExtractionError: null,
  });
}

/** Confirms the reviewed transcript and claims its first metadata attempt atomically. */
export async function claimMetadataAfterTranscriptConfirmation(
  letterId: string,
  observed: ObservedMetadataState,
  confirmedBy: string,
): Promise<MetadataClaim | null> {
  if (
    !hasClaimableSource(observed)
    || observed.workflow !== 'TRANSCRIBED'
    || (observed.status !== 'PENDING' && observed.status !== 'FAILED')
  ) {
    return null;
  }

  return claimMetadata(letterId, observed, 'QUEUED', {
    transcriptConfirmedAt: new Date(),
    transcriptConfirmedBy: confirmedBy,
    metadataAttemptCount: 0,
    deadLetter: false,
    entityExtractionStatus: 'PENDING',
    entityExtractionRunId: null,
    entityExtractionRunRevision: null,
    entityExtractionError: null,
  });
}

function ownedMetadataAttemptConditions(
  letterId: string,
  claim: MetadataClaim,
) {
  return [
    eq(letters.id, letterId),
    eq(letters.metadataStatus, 'RUNNING'),
    eq(letters.metadataRunId, claim.runId),
    eq(letters.metadataRunRevision, claim.revision),
    eq(letters.metadataRevision, claim.revision),
    eq(letters.metadataLeaseRunId, claim.runId),
    isNotNull(letters.metadataLeaseExpiresAt),
  ];
}

function activeMetadataAttemptConditions(
  letterId: string,
  claim: MetadataClaim,
) {
  return [
    ...ownedMetadataAttemptConditions(letterId, claim),
    gt(letters.metadataLeaseExpiresAt, databaseNow()),
  ];
}

function exactOwnedMetadataRunConditions(letterId: string, runId: string) {
  return [
    eq(letters.id, letterId),
    eq(letters.metadataStatus, 'RUNNING'),
    eq(letters.metadataRunId, runId),
    eq(letters.metadataLeaseRunId, runId),
    eq(letters.metadataRunRevision, letters.metadataRevision),
    isNotNull(letters.metadataLeaseExpiresAt),
    isNotNull(letters.metadataClaimKind),
  ];
}

function clearedMetadataOwnership() {
  return {
    metadataRunId: null,
    metadataRunRevision: null,
    metadataLeaseExpiresAt: null,
    metadataLeaseRunId: null,
    metadataClaimKind: null,
  };
}

function restoredWorkflowAfterMetadataAttempt() {
  return sql<WorkflowState>`CASE
    WHEN ${letters.metadataContentStatus} = 'VERIFIED'
      THEN 'REVIEWED'::workflow_state
    WHEN ${letters.metadataContentStatus} = 'EMPTY'
      THEN 'TRANSCRIBED'::workflow_state
    ELSE 'METADATA_DRAFTED'::workflow_state
  END`;
}

/** Extends only the exact revision-bound run's still-live lease. */
export async function renewMetadataLease(
  letterId: string,
  claim: MetadataClaim,
): Promise<boolean> {
  const renewed = await db
    .update(letters)
    .set({ metadataLeaseExpiresAt: newLeaseDeadline() })
    .where(and(...activeMetadataAttemptConditions(letterId, claim)))
    .returning({ id: letters.id });

  return renewed.length > 0;
}

export async function withMetadataHeartbeat<T>(
  letterId: string,
  claim: MetadataClaim,
  operation: (heartbeat: MetadataHeartbeat) => Promise<T>,
): Promise<T> {
  return withLeaseHeartbeat(
    {
      renew: () => renewMetadataLease(letterId, claim),
      onRenewalError: (error: unknown) => {
        log.warn(
          { letterId, runId: claim.runId, revision: claim.revision, err: error },
          'Failed to renew metadata lease; will retry',
        );
      },
    },
    operation,
  );
}

function metadataPublicationPatch(metadata: MetadataV2) {
  const stripRoleTags = (text: string) =>
    text.replace(/«(?:SENDER|RECIPIENT):([^»]*)»/g, '$1');

  const structuredNotes: StructuredNote[] = Array.isArray(metadata.ai_notes)
    ? metadata.ai_notes.map((note: AiNoteOutput) => ({
        id: randomUUID(),
        content: note.content,
        category: note.category,
        priority: note.priority,
        status: 'open' as const,
        resolves_when: note.resolves_when,
        resolved_at: null,
        resolved_by: null,
        source: 'ai' as const,
      }))
    : [];

  return {
    sender: metadata.sender,
    recipient: metadata.recipient,
    locationWritten: metadata.location_written,
    hook: metadata.hook ? stripRoleTags(metadata.hook) : metadata.hook,
    summary: metadata.summary ? stripRoleTags(metadata.summary) : metadata.summary,
    extractedDate: metadata.extracted_date,
    tags: metadata.primary_topics,
    emotionalTone: metadata.emotional_tone as EmotionalTone | null,
    senderRecipientRelationship:
      metadata.sender_recipient_relationship as RelationshipType | null,
    primaryTopics: metadata.primary_topics,
    aiNotes: structuredNotes,
    metadataV2Json: metadata,
    metadataJson: metadata,
  };
}

/** Publishes all derived metadata and its workflow transition in one exact-run write. */
export async function completeMetadata(
  letterId: string,
  claim: MetadataClaim,
  metadata: MetadataV2,
): Promise<boolean> {
  const completed = await db
    .update(letters)
    .set({
      ...metadataPublicationPatch(metadata),
      metadataStatus: 'SUCCESS',
      ...clearedMetadataOwnership(),
      metadataError: null,
      deadLetter: false,
      metadataRevision: sql`${letters.metadataRevision} + 1`,
      metadataContentStatus: 'AI_DRAFT' as ContentStatus,
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      metadataPublished: false,
      workflow: 'METADATA_DRAFTED',
      updatedAt: new Date(),
    })
    .where(and(...activeMetadataAttemptConditions(letterId, claim)))
    .returning({ id: letters.id });

  if (completed.length > 0) return true;

  // A source writer may have superseded this revision while the producer was
  // finishing. Revoke only if this exact run still owns a live lease.
  await failMetadata(letterId, claim, 'Metadata source changed during extraction');
  return false;
}

/** Records failure only while the exact revision-bound run owns a live lease. */
export async function failMetadata(
  letterId: string,
  claim: MetadataClaim,
  error: string,
): Promise<boolean> {
  const failed = await db
    .update(letters)
    .set({
      metadataStatus: 'FAILED',
      ...clearedMetadataOwnership(),
      metadataError: error,
      metadataRevision: sql`${letters.metadataRevision} + 1`,
      workflow: restoredWorkflowAfterMetadataAttempt(),
      updatedAt: new Date(),
    })
    .where(and(...activeMetadataAttemptConditions(letterId, claim)))
    .returning({ id: letters.id });

  return failed.length > 0;
}

/** Cancels an exact fully-owned attempt, including after its lease has expired. */
export async function cancelMetadataAttempt(
  letterId: string,
  runId: string,
  error = 'Cancelled by admin',
): Promise<boolean> {
  const cancelled = await db
    .update(letters)
    .set({
      metadataStatus: 'FAILED',
      ...clearedMetadataOwnership(),
      metadataError: error,
      metadataRevision: sql`${letters.metadataRevision} + 1`,
      workflow: restoredWorkflowAfterMetadataAttempt(),
      updatedAt: new Date(),
    })
    .where(and(...exactOwnedMetadataRunConditions(letterId, runId)))
    .returning({ id: letters.id });

  return cancelled.length > 0;
}

/**
 * Reconciles expired current-version ownership. Queued work remains queued;
 * requested replacement work fails while preserving the last committed
 * metadata. Conditional UPDATE RETURNING makes each result authoritative when
 * multiple reconcilers race.
 */
export async function recoverExpiredMetadataJobs(
  workerExecutionToken?: string,
): Promise<MetadataRecoveryResult> {
  const requeued = await db
    .update(letters)
    .set({
      metadataStatus: 'PENDING',
      ...clearedMetadataOwnership(),
      metadataError: null,
      metadataRevision: sql`${letters.metadataRevision} + 1`,
      workflow: 'TRANSCRIBED',
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.metadataStatus, 'RUNNING'),
      eq(letters.metadataClaimKind, 'QUEUED'),
      isNotNull(letters.metadataRunId),
      isNotNull(letters.metadataRunRevision),
      eq(letters.metadataRunRevision, letters.metadataRevision),
      isNotNull(letters.metadataLeaseExpiresAt),
      isNotNull(letters.metadataLeaseRunId),
      eq(letters.metadataLeaseRunId, letters.metadataRunId),
      lte(letters.metadataLeaseExpiresAt, databaseNow()),
      ...(workerExecutionToken
        ? [activeWorkerExecutionCondition(workerExecutionToken)]
        : []),
    ))
    .returning({ id: letters.id, dateRaw: letters.dateRaw });

  const failed = await db
    .update(letters)
    .set({
      metadataStatus: 'FAILED',
      ...clearedMetadataOwnership(),
      metadataError: LEASE_EXPIRED_ERROR,
      metadataRevision: sql`${letters.metadataRevision} + 1`,
      workflow: restoredWorkflowAfterMetadataAttempt(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.metadataStatus, 'RUNNING'),
      eq(letters.metadataClaimKind, 'REQUESTED'),
      isNotNull(letters.metadataRunId),
      isNotNull(letters.metadataRunRevision),
      eq(letters.metadataRunRevision, letters.metadataRevision),
      isNotNull(letters.metadataLeaseExpiresAt),
      isNotNull(letters.metadataLeaseRunId),
      eq(letters.metadataLeaseRunId, letters.metadataRunId),
      lte(letters.metadataLeaseExpiresAt, databaseNow()),
      ...(workerExecutionToken
        ? [activeWorkerExecutionCondition(workerExecutionToken)]
        : []),
    ))
    .returning({ id: letters.id, dateRaw: letters.dateRaw });

  return { requeued, failed };
}

/** Spread into the same write as authoritative human metadata content. */
export function buildHumanMetadataJobPatch() {
  return {
    metadataStatus: sql<JobStatus>`CASE
      WHEN ${letters.metadataStatus} = 'RUNNING'
        AND ${letters.metadataRunId} IS NULL
        THEN 'FAILED'::job_status
      WHEN ${letters.metadataStatus} = 'RUNNING'
        THEN 'PENDING'::job_status
      ELSE ${letters.metadataStatus}
    END`,
    ...clearedMetadataOwnership(),
    metadataError: sql<string | null>`CASE
      WHEN ${letters.metadataStatus} = 'RUNNING'
        AND ${letters.metadataRunId} IS NULL
        THEN 'Superseded by authoritative human metadata'
      WHEN ${letters.metadataStatus} = 'RUNNING'
        THEN NULL
      ELSE ${letters.metadataError}
    END`,
    metadataRevision: sql<number>`${letters.metadataRevision} + 1`,
    metadataContentStatus: sql<ContentStatus>`CASE
      WHEN ${letters.metadataContentStatus} = 'EMPTY' THEN ${letters.metadataContentStatus}
      ELSE 'EDITED'::content_status
    END`,
    metadataVerifiedAt: null,
    metadataVerifiedBy: null,
    metadataPublished: false,
    workflow: sql<WorkflowState>`CASE
      WHEN ${letters.metadataStatus} = 'RUNNING'
        AND ${letters.metadataRunId} IS NOT NULL
        THEN 'TRANSCRIBED'::workflow_state
      WHEN ${letters.metadataStatus} = 'RUNNING'
        AND ${letters.metadataContentStatus} = 'EMPTY'
        THEN 'TRANSCRIBED'::workflow_state
      WHEN ${letters.metadataStatus} = 'RUNNING'
        THEN 'METADATA_DRAFTED'::workflow_state
      WHEN ${letters.metadataStatus} = 'PENDING'
        AND ${letters.transcriptionText} IS NOT NULL
        AND btrim(${letters.transcriptionText}) <> ''
        THEN 'TRANSCRIBED'::workflow_state
      WHEN ${letters.metadataStatus} = 'SUCCESS'
        AND ${letters.metadataContentStatus} <> 'EMPTY'
        THEN 'METADATA_DRAFTED'::workflow_state
      ELSE ${letters.workflow}
    END`,
    entityExtractionJson: null,
    entityExtractionStatus: sql<JobStatus>`CASE
      WHEN ${letters.entityExtractionStatus} = 'PENDING'
        THEN ${letters.entityExtractionStatus}
      ELSE 'FAILED'::job_status
    END`,
    entityExtractionRunId: null,
    entityExtractionRunRevision: null,
    entityExtractionError: sql<string | null>`CASE
      WHEN ${letters.entityExtractionStatus} = 'PENDING'
        THEN ${letters.entityExtractionError}
      ELSE 'Metadata changed; entity extraction must be run again'
    END`,
  };
}

/**
 * Spread into an AI-note-only write. Notes share the metadata publication race,
 * so the write revokes an active producer and advances the revision, but it does
 * not demote verified primary metadata or invalidate derived entities.
 */
export function buildHumanMetadataNotesPatch() {
  return {
    metadataStatus: sql<JobStatus>`CASE
      WHEN ${letters.metadataStatus} = 'RUNNING'
        AND ${letters.metadataRunId} IS NULL
        THEN 'FAILED'::job_status
      WHEN ${letters.metadataStatus} = 'RUNNING'
        AND ${letters.metadataContentStatus} = 'EMPTY'
        THEN 'PENDING'::job_status
      WHEN ${letters.metadataStatus} = 'RUNNING' THEN 'SUCCESS'::job_status
      ELSE ${letters.metadataStatus}
    END`,
    ...clearedMetadataOwnership(),
    metadataError: sql<string | null>`CASE
      WHEN ${letters.metadataStatus} = 'RUNNING'
        AND ${letters.metadataRunId} IS NULL
        THEN 'Superseded by an AI note update'
      WHEN ${letters.metadataStatus} = 'RUNNING' THEN NULL
      ELSE ${letters.metadataError}
    END`,
    metadataRevision: sql<number>`${letters.metadataRevision} + 1`,
    workflow: sql<WorkflowState>`CASE
      WHEN ${letters.metadataStatus} = 'RUNNING'
        AND ${letters.metadataContentStatus} = 'EMPTY'
        THEN 'TRANSCRIBED'::workflow_state
      WHEN ${letters.metadataStatus} = 'RUNNING'
        AND ${letters.metadataContentStatus} = 'VERIFIED'
        THEN 'REVIEWED'::workflow_state
      WHEN ${letters.metadataStatus} = 'RUNNING'
        THEN 'METADATA_DRAFTED'::workflow_state
      ELSE ${letters.workflow}
    END`,
  };
}

/** Spread into a transcript/source write so an older result cannot publish. */
export function buildMetadataSourceInvalidationPatch() {
  return {
    metadataStatus: sql<JobStatus>`CASE
      WHEN ${letters.metadataStatus} = 'RUNNING'
        AND ${letters.metadataRunId} IS NULL
        THEN 'FAILED'::job_status
      ELSE 'PENDING'::job_status
    END`,
    ...clearedMetadataOwnership(),
    metadataError: sql<string | null>`CASE
      WHEN ${letters.metadataStatus} = 'RUNNING'
        AND ${letters.metadataRunId} IS NULL
        THEN 'Metadata source changed during a legacy metadata attempt'
      ELSE NULL
    END`,
    metadataAttemptCount: 0,
    deadLetter: false,
    metadataRevision: sql<number>`${letters.metadataRevision} + 1`,
    metadataContentStatus: sql<ContentStatus>`CASE
      WHEN ${letters.metadataContentStatus} IN ('EMPTY', 'EDITED')
        THEN ${letters.metadataContentStatus}
      ELSE 'AI_DRAFT'::content_status
    END`,
    metadataVerifiedAt: null,
    metadataVerifiedBy: null,
    metadataPublished: false,
    transcriptPublished: false,
    workflow: sql<WorkflowState>`CASE
      WHEN ${letters.transcriptionText} IS NOT NULL
        AND btrim(${letters.transcriptionText}) <> ''
        THEN 'TRANSCRIBED'::workflow_state
      ELSE ${letters.workflow}
    END`,
    entityExtractionJson: null,
    entityExtractionStatus: sql<JobStatus>`CASE
      WHEN ${letters.entityExtractionStatus} = 'PENDING'
        THEN ${letters.entityExtractionStatus}
      ELSE 'FAILED'::job_status
    END`,
    entityExtractionRunId: null,
    entityExtractionRunRevision: null,
    entityExtractionError: sql<string | null>`CASE
      WHEN ${letters.entityExtractionStatus} = 'PENDING'
        THEN ${letters.entityExtractionError}
      ELSE 'Metadata source changed; entity extraction must be run again'
    END`,
  };
}

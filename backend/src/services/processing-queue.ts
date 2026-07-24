import { eq, and, sql, or, type SQL } from 'drizzle-orm';
import { PAGINATION } from '../constants/pagination.js';
import { TIMING } from '../constants/timing.js';
import { db, letters } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { AppError } from '../utils/response-helpers.js';
import { notify } from './notifications.js';
import { observedTimestampMatches } from './letter/shared.js';
import {
  sourceRevisionChanged,
  SOURCE_REVISION_CHANGED_ERROR_CODE,
} from './letter/source-revision.js';
import {
  cancelTranscriptionAttempt,
  recoverExpiredTranscriptions,
  type TranscriptionRecoveryResult,
} from './letter/transcription-job.js';
import {
  cancelMetadataAttempt,
  recoverExpiredMetadataJobs,
  type MetadataRecoveryResult,
} from './letter/metadata-job.js';
import {
  cancelExtraContentAttempt,
  recoverExpiredExtraContentJobs,
  type ExtraContentRecoveryResult,
} from './letter/extra-content-job.js';
import {
  cancelEntityExtractionAttempt,
  cancelLegacyEntityExtraction,
  clearedEntityExtractionOwnership,
  recoverExpiredEntityExtractionJobs,
  type EntityExtractionRecoveryResult,
} from './letter/entity-extraction-job.js';
import { shouldUseCloudRunWorkerJob, triggerWorkerJob } from './cloud-run-job.js';
import {
  entityExtractionPrerequisiteConditions,
  extraContentPrerequisiteConditions,
  isMetadataStateEligible,
  isTranscriptionStateEligible,
  metadataPrerequisiteConditions,
  queuedEntityExtractionConditions,
  queuedExtraContentConditions,
  queuedMetadataConditions,
  queuedTranscriptionConditions,
  transcriptionPrerequisiteConditions,
} from './processing-eligibility.js';
import {
  processingJobStateToken,
  queueJobTypeSchema,
  type ProcessingJobPhase,
  type ProcessingJobSnapshot,
  type ProcessingJobStateSource,
  type QueueJobType,
} from './processing-queue-snapshot.js';
import { getWorkerState } from './worker-state.js';

export {
  clearProcessingQueueSnapshotSchema,
  processingJobActionSchema,
  processingJobSnapshotSchema,
  queueJobTypeSchema,
} from './processing-queue-snapshot.js';
export type {
  ProcessingJobSnapshot,
  QueueJobType,
} from './processing-queue-snapshot.js';

const log = createLogger({ module: 'processing-queue' });

export async function requestBackgroundWorkerRun(reason: string): Promise<void> {
  if (!shouldUseCloudRunWorkerJob()) {
    return;
  }

  try {
    await triggerWorkerJob(reason);
  } catch {
    // Leave queued work in PENDING state; a later trigger can still pick it up.
  }
}

async function hasQueuedWork(conditions: SQL[]): Promise<boolean> {
  const pending = await db.query.letters.findFirst({
    where: and(...conditions),
    columns: { id: true },
  });
  return Boolean(pending);
}

/** Reports durable queued transcription work using the worker's exact predicate. */
async function hasQueuedTranscriptionWork(): Promise<boolean> {
  return hasQueuedWork(queuedTranscriptionConditions());
}

/** Reports durable queued metadata work using the worker's exact predicate. */
async function hasQueuedMetadataWork(): Promise<boolean> {
  return hasQueuedWork(queuedMetadataConditions());
}

/** Reports durable queued entity work using the worker's exact predicate. */
async function hasQueuedEntityExtractionWork(): Promise<boolean> {
  return hasQueuedWork(queuedEntityExtractionConditions());
}

/** Reports durable queued extra-content work using the worker's exact predicate. */
async function hasQueuedExtraContentWork(): Promise<boolean> {
  return hasQueuedWork(queuedExtraContentConditions());
}

/**
 * A dirty extra-content cancellation commits as PENDING rather than FAILED.
 * Re-derive that durable outcome after cancellation and contain both the
 * observation and worker request so a committed cancellation stays successful.
 */
async function requestWorkerAfterExtraContentCancellation(): Promise<void> {
  try {
    if (await hasQueuedExtraContentWork()) {
      await requestBackgroundWorkerRun('cancel:extra_content');
    }
  } catch (error) {
    log.warn(
      { err: error },
      'Could not request a worker after extra-content cancellation',
    );
  }
}

export async function hasQueuedProcessingWork(): Promise<boolean> {
  const [transcription, metadata, entityExtraction, extraContent] = await Promise.all([
    hasQueuedTranscriptionWork(),
    hasQueuedMetadataWork(),
    hasQueuedEntityExtractionWork(),
    hasQueuedExtraContentWork(),
  ]);
  return transcription || metadata || entityExtraction || extraContent;
}

/** Ensures any durable queued worker stage has a Cloud Run worker wake. */
export async function ensureBackgroundWorkerForQueuedProcessing(
  reason: string,
): Promise<boolean> {
  if (!shouldUseCloudRunWorkerJob() || !await hasQueuedProcessingWork()) {
    return false;
  }

  await triggerWorkerJob(reason);
  return true;
}

export type ProcessingWorkerWakeResult =
  | { requested: true }
  | {
      requested: false;
      reason: 'queue_empty' | 'worker_not_configured';
    };

/**
 * Truthful operator control for the global durable queue. It never suggests
 * that a filter or stage scopes the worker's drain.
 */
export async function wakeBackgroundWorkerForQueuedProcessing(): Promise<ProcessingWorkerWakeResult> {
  if (!shouldUseCloudRunWorkerJob()) {
    return { requested: false, reason: 'worker_not_configured' };
  }
  if (!await hasQueuedProcessingWork()) {
    return { requested: false, reason: 'queue_empty' };
  }

  await triggerWorkerJob('admin-processing-wake');
  return { requested: true };
}

// ============================================================================
// SERVICE FUNCTIONS
// ============================================================================

/**
 * Reconciles only expired, fully-owned leased attempts.
 */
export interface ProcessingLeaseRecoveryResult {
  transcription: TranscriptionRecoveryResult;
  metadata: MetadataRecoveryResult;
  entityExtraction: EntityExtractionRecoveryResult;
  extraContent: ExtraContentRecoveryResult;
}

export async function recoverExpiredProcessingJobs(
  options: { workerExecutionToken?: string } = {},
): Promise<ProcessingLeaseRecoveryResult> {
  let transcription: TranscriptionRecoveryResult = { requeued: [], failed: [] };
  let metadata: MetadataRecoveryResult = { requeued: [], failed: [] };
  let entityExtraction: EntityExtractionRecoveryResult = {
    requeued: [],
    failed: [],
  };
  let extraContent: ExtraContentRecoveryResult = { requeued: [], failed: [] };

  // Keep every stage as a separate failure domain. They update the same table,
  // and one successful recovery must still reach the worker trigger when
  // another stage's recovery fails.
  try {
    transcription = await recoverExpiredTranscriptions(
      options.workerExecutionToken,
    );
  } catch (error) {
    log.error({ err: error }, 'Expired transcription lease recovery failed');
  }

  try {
    metadata = await recoverExpiredMetadataJobs(options.workerExecutionToken);
  } catch (error) {
    log.error({ err: error }, 'Expired metadata lease recovery failed');
  }

  try {
    entityExtraction = await recoverExpiredEntityExtractionJobs(
      options.workerExecutionToken,
    );
  } catch (error) {
    log.error({ err: error }, 'Expired entity extraction lease recovery failed');
  }

  try {
    extraContent = await recoverExpiredExtraContentJobs(
      options.workerExecutionToken,
    );
  } catch (error) {
    log.error({ err: error }, 'Expired extra-content lease recovery failed');
  }

  const recoveredLetterIds = [
    ...transcription.requeued.map(row => row.id),
    ...transcription.failed.map(row => row.id),
    ...metadata.requeued.map(row => row.id),
    ...metadata.failed.map(row => row.id),
    ...entityExtraction.requeued.map(row => row.id),
    ...entityExtraction.failed.map(row => row.id),
    ...extraContent.requeued.map(row => row.id),
    ...extraContent.failed.map(row => row.id),
  ];

  if (recoveredLetterIds.length === 0) {
    log.info('Recovery found no expired leased processing attempts');
    return { transcription, metadata, entityExtraction, extraContent };
  }

  log.info(
    { count: recoveredLetterIds.length },
    'Reconciled expired leased processing attempts',
  );

  void notify({
    type: 'job_orphan_recovered',
    title: `Reconciled ${recoveredLetterIds.length} expired processing attempt${recoveredLetterIds.length === 1 ? '' : 's'}`,
    message: 'Reconciled only attempts whose persisted lease had expired.',
    metadata: {
      count: recoveredLetterIds.length,
      letterIds: recoveredLetterIds,
      transcriptionRequeued: transcription.requeued.length,
      transcriptionFailed: transcription.failed.length,
      metadataRequeued: metadata.requeued.length,
      metadataFailed: metadata.failed.length,
      entityExtractionRequeued: entityExtraction.requeued.length,
      entityExtractionFailed: entityExtraction.failed.length,
      extraContentRequeued: extraContent.requeued.length,
      extraContentFailed: extraContent.failed.length,
    },
    dedupeKey: 'job_orphan_recovered:processing-leases',
    dedupeWindowMinutes: 5,
  });

  return { transcription, metadata, entityExtraction, extraContent };
}

/**
 * Get full queue status with active, queued, and recent jobs.
 */
export async function getQueueStatus() {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - TIMING.JOB_RECOVERY_WINDOW_MS);

  // Active jobs: any status = RUNNING
  const activeLetters = await db.query.letters.findMany({
    where: and(
      or(
        eq(letters.transcriptionStatus, 'RUNNING'),
        eq(letters.metadataStatus, 'RUNNING'),
        eq(letters.entityExtractionStatus, 'RUNNING'),
        eq(letters.extraContentJobStatus, 'RUNNING')
      )
    ),
    with: { collection: true },
  });

  const active = activeLetters.flatMap(l => {
    const jobs: Array<{
      letterId: string;
      letterTitle: string;
      collectionCode: string;
      sender: string | null;
      recipient: string | null;
      type: QueueJobType;
      primarySourceRevision: number;
      jobStateToken: string;
      startedAt: string;
    }> = [];
    if (l.transcriptionStatus === 'RUNNING') {
      jobs.push({
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        sender: l.sender,
        recipient: l.recipient,
        type: 'transcription',
        primarySourceRevision: l.primarySourceRevision,
        jobStateToken: processingJobStateToken(l, 'transcription', 'active'),
        startedAt: l.updatedAt?.toISOString() ?? now.toISOString(),
      });
    }
    if (l.metadataStatus === 'RUNNING') {
      jobs.push({
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        sender: l.sender,
        recipient: l.recipient,
        type: 'metadata',
        primarySourceRevision: l.primarySourceRevision,
        jobStateToken: processingJobStateToken(l, 'metadata', 'active'),
        startedAt: l.updatedAt?.toISOString() ?? now.toISOString(),
      });
    }
    if (l.entityExtractionStatus === 'RUNNING') {
      jobs.push({
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        sender: l.sender,
        recipient: l.recipient,
        type: 'entity_extraction',
        primarySourceRevision: l.primarySourceRevision,
        jobStateToken: processingJobStateToken(
          l,
          'entity_extraction',
          'active',
        ),
        startedAt: l.updatedAt?.toISOString() ?? now.toISOString(),
      });
    }
    if (l.extraContentJobStatus === 'RUNNING') {
      jobs.push({
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        sender: l.sender,
        recipient: l.recipient,
        type: 'extra_content',
        primarySourceRevision: l.primarySourceRevision,
        jobStateToken: processingJobStateToken(l, 'extra_content', 'active'),
        startedAt: l.updatedAt?.toISOString() ?? now.toISOString(),
      });
    }
    return jobs;
  });

  // Queued transcription jobs (all transcribable types, not just 'L')
  const queuedTranscription = await db.query.letters.findMany({
    where: and(...queuedTranscriptionConditions()),
    with: { collection: true },
    orderBy: (l, { asc }) => [asc(l.createdAt)],
    limit: PAGINATION.QUEUE_BATCH_SIZE,
  });

  // Queued metadata jobs
  const queuedMetadata = await db.query.letters.findMany({
    where: and(...queuedMetadataConditions()),
    with: { collection: true },
    orderBy: (l, { asc }) => [asc(l.createdAt)],
    limit: PAGINATION.QUEUE_BATCH_SIZE,
  });

  // Queued entity extraction jobs (only after metadata has succeeded)
  const queuedEntityExtraction = await db.query.letters.findMany({
    where: and(...queuedEntityExtractionConditions()),
    with: { collection: true },
    orderBy: (l, { asc }) => [asc(l.createdAt)],
    limit: PAGINATION.QUEUE_BATCH_SIZE,
  });

  // Queued supplementary-content transcription jobs
  const queuedExtraContent = await db.query.letters.findMany({
    where: and(...queuedExtraContentConditions()),
    with: { collection: true },
    orderBy: (l, { asc }) => [asc(l.createdAt)],
    limit: PAGINATION.QUEUE_BATCH_SIZE,
  });

  // Recent completions/failures (last hour)
  // Fetch extra rows to compensate for admin-cleared items that get filtered out in JS.
  // Without this buffer, clearing a large batch from the queue pushes legitimate
  // history entries (completed/failed) out of the result set.
  const recentLetters = await db.query.letters.findMany({
    where: and(
      sql`${letters.updatedAt} >= ${oneHourAgo.toISOString()}`,
      or(
        eq(letters.transcriptionStatus, 'SUCCESS'),
        eq(letters.transcriptionStatus, 'FAILED'),
        eq(letters.metadataStatus, 'SUCCESS'),
        eq(letters.metadataStatus, 'FAILED'),
        eq(letters.entityExtractionStatus, 'SUCCESS'),
        eq(letters.entityExtractionStatus, 'FAILED')
      )
    ),
    with: { collection: true },
    orderBy: (l, { desc }) => [desc(l.updatedAt)],
    limit: 100,
  });

  const recent: Array<{
    letterId: string;
    letterTitle: string;
    collectionCode: string;
    type: QueueJobType;
    status: string;
    primarySourceRevision: number;
    jobStateToken: string;
    error?: string;
    completedAt: string;
  }> = [];

  // Helper to check if a failure was an admin action (clear/remove/cancel/abort)
  const isAdminCleared = (error: string | null) =>
    error?.includes('from queue by admin') ||
    error === 'Cancelled by admin' ||
    error === 'Aborted by admin';
  // Helper to check if metadata was bulk-cleared by admin
  const isBulkCleared = (error: string | null) => error === 'Cleared by admin';

  for (const l of recentLetters) {
    const letterUpdatedAt = l.updatedAt?.toISOString() ?? now.toISOString();

    // For transcription, use transcribedAt if available -- only show if it's recent
    // This prevents old transcription entries from appearing when metadata updates the letter
    const transcriptionTime = l.transcribedAt?.getTime();
    const transcriptionRecent = transcriptionTime && transcriptionTime >= oneHourAgo.getTime();

    if (transcriptionRecent && (l.transcriptionStatus === 'SUCCESS' || (l.transcriptionStatus === 'FAILED' && !isAdminCleared(l.transcriptionError)))) {
      recent.push({
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        type: 'transcription',
        status: l.transcriptionStatus,
        primarySourceRevision: l.primarySourceRevision,
        jobStateToken: processingJobStateToken(l, 'transcription', 'recent'),
        error: l.transcriptionStatus === 'FAILED' ? (l.transcriptionError ?? undefined) : undefined,
        completedAt: l.transcribedAt!.toISOString(),
      });
    }
    if (l.metadataStatus === 'SUCCESS' || (l.metadataStatus === 'FAILED' && !isAdminCleared(l.metadataError))) {
      recent.push({
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        type: 'metadata',
        status: isBulkCleared(l.metadataError) ? 'CLEARED' : l.metadataStatus,
        primarySourceRevision: l.primarySourceRevision,
        jobStateToken: processingJobStateToken(l, 'metadata', 'recent'),
        error: l.metadataStatus === 'FAILED' && !isBulkCleared(l.metadataError) ? (l.metadataError ?? undefined) : undefined,
        completedAt: letterUpdatedAt,
      });
    }
    if (l.entityExtractionStatus === 'SUCCESS' || (l.entityExtractionStatus === 'FAILED' && !isAdminCleared(l.entityExtractionError))) {
      recent.push({
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        type: 'entity_extraction',
        status: isBulkCleared(l.entityExtractionError) ? 'CLEARED' : l.entityExtractionStatus,
        primarySourceRevision: l.primarySourceRevision,
        jobStateToken: processingJobStateToken(
          l,
          'entity_extraction',
          'recent',
        ),
        error: l.entityExtractionStatus === 'FAILED' && !isBulkCleared(l.entityExtractionError) ? (l.entityExtractionError ?? undefined) : undefined,
        completedAt: letterUpdatedAt,
      });
    }
  }

  // Sort recent by completedAt desc and limit to 20
  recent.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  recent.splice(20);

  const mapQueued = (
    items: typeof queuedTranscription,
    type: QueueJobType,
    queuedAtField?: 'createdAt' | 'transcriptConfirmedAt',
  ) =>
    items.map(l => {
      // Use the specified field, falling back to createdAt
      let queuedAt: string;
      if (queuedAtField === 'transcriptConfirmedAt' && l.transcriptConfirmedAt) {
        queuedAt = l.transcriptConfirmedAt.toISOString();
      } else {
        queuedAt = l.createdAt.toISOString();
      }
      return {
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        sender: l.sender,
        recipient: l.recipient,
        primarySourceRevision: l.primarySourceRevision,
        jobStateToken: processingJobStateToken(l, type, 'queued'),
        queuedAt,
      };
    });

  // Extra-content has no stage-specific queued timestamp yet. Returning null is
  // more truthful than presenting the letter creation or an unrelated update
  // as the enqueue time.
  const mapQueuedExtraContent = () =>
    queuedExtraContent.map(l => ({
      letterId: l.id,
      letterTitle: l.dateRaw,
      collectionCode: l.collection.collectionCode,
      sender: l.sender,
      recipient: l.recipient,
      primarySourceRevision: l.primarySourceRevision,
      jobStateToken: processingJobStateToken(l, 'extra_content', 'queued'),
      queuedAt: null,
    }));

  const worker = await getWorkerState();

  return {
    active,
    queued: {
      transcription: mapQueued(queuedTranscription, 'transcription', 'createdAt'),
      metadata: mapQueued(queuedMetadata, 'metadata', 'transcriptConfirmedAt'),
      entityExtraction: mapQueued(
        queuedEntityExtraction,
        'entity_extraction',
        'createdAt',
      ),
      extraContent: mapQueuedExtraContent(),
    },
    recent,
    worker,
    counts: {
      activeCount: active.length,
      queuedTranscription: queuedTranscription.length,
      queuedMetadata: queuedMetadata.length,
      queuedEntityExtraction: queuedEntityExtraction.length,
      queuedExtraContent: queuedExtraContent.length,
      recentSuccessCount: recent.filter(r => r.status === 'SUCCESS').length,
      recentFailedCount: recent.filter(r => r.status === 'FAILED').length,
      recentClearedCount: recent.filter(r => r.status === 'CLEARED').length,
    },
  };
}

// ============================================================================
// QUEUE MANAGEMENT
// ============================================================================

export const PROCESSING_JOB_CHANGED_ERROR_CODE = 'PROCESSING_JOB_CHANGED';

export type ClearQueueSkipCode =
  | 'NOT_FOUND'
  | typeof SOURCE_REVISION_CHANGED_ERROR_CODE
  | typeof PROCESSING_JOB_CHANGED_ERROR_CODE;

export interface ClearQueueResult {
  message: string;
  requested: number;
  cleared: number;
  skipped: number;
  skipReasons: Array<{
    letterId: string;
    code: ClearQueueSkipCode;
  }>;
}

type ExpectedJobSnapshot = Pick<
  ProcessingJobSnapshot,
  'primarySourceRevision' | 'jobStateToken'
>;

function processingJobChanged(message: string): AppError {
  return new AppError(
    409,
    message,
    undefined,
    PROCESSING_JOB_CHANGED_ERROR_CODE,
  );
}

function clearQueueSkipCode(error: unknown): ClearQueueSkipCode | null {
  if (
    error instanceof AppError
    && error.code === SOURCE_REVISION_CHANGED_ERROR_CODE
  ) {
    return SOURCE_REVISION_CHANGED_ERROR_CODE;
  }
  if (
    error instanceof AppError
    && error.code === PROCESSING_JOB_CHANGED_ERROR_CODE
  ) {
    return PROCESSING_JOB_CHANGED_ERROR_CODE;
  }
  if (error instanceof ProcessingError && error.statusCode === 404) {
    return 'NOT_FOUND';
  }
  return null;
}

function assertObservedJob(
  letter: ProcessingJobStateSource & { primarySourceRevision: number },
  type: QueueJobType,
  phase: ProcessingJobPhase,
  expected: ExpectedJobSnapshot,
): void {
  if (letter.primarySourceRevision !== expected.primarySourceRevision) {
    throw sourceRevisionChanged(
      'Letter source changed after this processing snapshot was loaded; refresh and try again',
    );
  }
  if (
    processingJobStateToken(letter, type, phase) !== expected.jobStateToken
  ) {
    throw processingJobChanged(
      'Processing job changed after this queue snapshot was loaded; refresh and try again',
    );
  }
}

async function throwCurrentJobConflict(
  letterId: string,
  expectedPrimarySourceRevision: number,
): Promise<never> {
  const latest = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });
  if (!latest) {
    throw new ProcessingError('Letter not found', 404);
  }
  if (latest.primarySourceRevision !== expectedPrimarySourceRevision) {
    throw sourceRevisionChanged(
      'Letter source changed while the processing action was being applied; refresh and try again',
    );
  }
  throw processingJobChanged(
    'Processing job changed while the queue action was being applied; refresh and try again',
  );
}

async function transitionQueuedJob(
  letterId: string,
  type: QueueJobType,
  expected: ExpectedJobSnapshot,
  adminReason: string,
): Promise<void> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });
  if (!letter) {
    throw new ProcessingError('Letter not found', 404);
  }
  assertObservedJob(letter, type, 'queued', expected);

  let changed: Array<{ id: string }>;
  if (type === 'transcription') {
    if (letter.transcriptionStatus !== 'PENDING') {
      throw processingJobChanged(
        'Transcription is no longer queued; refresh and try again',
      );
    }
    changed = await db
      .update(letters)
      .set({
        transcriptionStatus: 'FAILED',
        transcriptionRunId: null,
        transcriptionLeaseExpiresAt: null,
        transcriptionLeaseRunId: null,
        transcriptionClaimKind: null,
        transcriptionError: adminReason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.primarySourceRevision, expected.primarySourceRevision),
        ...queuedTranscriptionConditions(),
        observedTimestampMatches(letters.updatedAt, letter.updatedAt),
      ))
      .returning({ id: letters.id });
  } else if (type === 'metadata') {
    if (letter.metadataStatus !== 'PENDING') {
      throw processingJobChanged(
        'Metadata extraction is no longer queued; refresh and try again',
      );
    }
    changed = await db
      .update(letters)
      .set({
        metadataStatus: 'FAILED',
        metadataRunId: null,
        metadataRunRevision: null,
        metadataLeaseExpiresAt: null,
        metadataLeaseRunId: null,
        metadataClaimKind: null,
        metadataRevision: sql`${letters.metadataRevision} + 1`,
        metadataError: adminReason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.primarySourceRevision, expected.primarySourceRevision),
        ...queuedMetadataConditions(),
        eq(letters.metadataRevision, letter.metadataRevision),
        observedTimestampMatches(letters.updatedAt, letter.updatedAt),
      ))
      .returning({ id: letters.id });
  } else if (type === 'entity_extraction') {
    if (letter.entityExtractionStatus !== 'PENDING') {
      throw processingJobChanged(
        'Entity extraction is no longer queued; refresh and try again',
      );
    }
    changed = await db
      .update(letters)
      .set({
        entityExtractionStatus: 'FAILED',
        ...clearedEntityExtractionOwnership(),
        entityExtractionError: adminReason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.primarySourceRevision, expected.primarySourceRevision),
        ...queuedEntityExtractionConditions(),
        eq(
          letters.entityExtractionRevision,
          letter.entityExtractionRevision,
        ),
        observedTimestampMatches(letters.updatedAt, letter.updatedAt),
      ))
      .returning({ id: letters.id });
  } else {
    if (letter.extraContentJobStatus !== 'PENDING') {
      throw processingJobChanged(
        'Extra-content transcription is no longer queued; refresh and try again',
      );
    }
    changed = await db
      .update(letters)
      .set({
        extraContentJobStatus: 'FAILED',
        extraContentJobRunId: null,
        extraContentJobLeaseExpiresAt: null,
        extraContentJobLeaseRunId: null,
        extraContentJobClaimKind: null,
        extraContentJobDirty: false,
        extraContentJobError: adminReason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.primarySourceRevision, expected.primarySourceRevision),
        ...queuedExtraContentConditions(),
        observedTimestampMatches(letters.updatedAt, letter.updatedAt),
      ))
      .returning({ id: letters.id });
  }

  if (changed.length === 0) {
    await throwCurrentJobConflict(
      letterId,
      expected.primarySourceRevision,
    );
  }
}

/**
 * Remove a letter from the processing queue. Only works for PENDING items.
 */
export async function removeFromQueue(
  letterId: string,
  type: QueueJobType,
  expected: ExpectedJobSnapshot,
): Promise<{ message: string }> {
  await transitionQueuedJob(
    letterId,
    type,
    expected,
    'Removed from queue by admin',
  );
  return { message: 'Removed from queue' };
}

/**
 * Clears only the exact rows shown in one queue snapshot. Work queued after
 * that read is not part of the command and cannot be cleared accidentally.
 */
export async function clearQueue(
  type: QueueJobType,
  snapshots: ProcessingJobSnapshot[],
): Promise<ClearQueueResult> {
  const skipReasons: ClearQueueResult['skipReasons'] = [];
  let cleared = 0;

  for (const snapshot of snapshots) {
    try {
      await transitionQueuedJob(
        snapshot.letterId,
        type,
        snapshot,
        'Cleared from queue by admin',
      );
      cleared += 1;
    } catch (error) {
      const code = clearQueueSkipCode(error);
      if (!code) throw error;
      skipReasons.push({ letterId: snapshot.letterId, code });
    }
  }

  return {
    message: `Cleared ${cleared} of ${snapshots.length} displayed ${type} queue items`,
    requested: snapshots.length,
    cleared,
    skipped: skipReasons.length,
    skipReasons,
  };
}

/**
 * Retry a failed job by resetting its status to PENDING.
 */
export async function retryJob(
  letterId: string,
  type: QueueJobType,
  expected: ExpectedJobSnapshot,
): Promise<{ message: string }> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) {
    throw new ProcessingError('Letter not found', 404);
  }
  assertObservedJob(letter, type, 'recent', expected);

  if (type === 'transcription') {
    if (letter.transcriptionStatus !== 'FAILED') {
      throw processingJobChanged(
        'Transcription is no longer retryable; refresh and try again',
      );
    }
    if (!isTranscriptionStateEligible(letter)) {
      throw new ProcessingError('Cannot retry: transcription prerequisites are not satisfied', 400);
    }
    const retried = await db
      .update(letters)
      .set({
        transcriptionStatus: 'PENDING',
        transcriptionRunId: null,
        transcriptionLeaseExpiresAt: null,
        transcriptionLeaseRunId: null,
        transcriptionClaimKind: null,
        transcriptionError: null,
        transcriptionAttemptCount: 0,
        deadLetter: false,
        workflow: 'UPLOADED',
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.primarySourceRevision, expected.primarySourceRevision),
        eq(letters.transcriptionStatus, 'FAILED'),
        ...transcriptionPrerequisiteConditions(),
        observedTimestampMatches(letters.updatedAt, letter.updatedAt),
      ))
      .returning({ id: letters.id });
    if (retried.length === 0) {
      await throwCurrentJobConflict(letterId, expected.primarySourceRevision);
    }
  } else if (type === 'metadata') {
    if (letter.metadataStatus !== 'FAILED') {
      throw processingJobChanged(
        'Metadata extraction is no longer retryable; refresh and try again',
      );
    }
    if (!isMetadataStateEligible(letter)) {
      throw new ProcessingError('Cannot retry: metadata prerequisites are not satisfied', 400);
    }
    const retried = await db
      .update(letters)
      .set({
        metadataStatus: 'PENDING',
        metadataRunId: null,
        metadataRunRevision: null,
        metadataLeaseExpiresAt: null,
        metadataLeaseRunId: null,
        metadataClaimKind: null,
        metadataRevision: sql`${letters.metadataRevision} + 1`,
        metadataError: null,
        metadataAttemptCount: 0,
        deadLetter: false,
        workflow: 'TRANSCRIBED',
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.primarySourceRevision, expected.primarySourceRevision),
        eq(letters.metadataStatus, 'FAILED'),
        ...metadataPrerequisiteConditions(),
        eq(letters.metadataRevision, letter.metadataRevision),
        observedTimestampMatches(letters.updatedAt, letter.updatedAt),
      ))
      .returning({ id: letters.id });
    if (retried.length === 0) {
      await throwCurrentJobConflict(letterId, expected.primarySourceRevision);
    }
  } else if (type === 'entity_extraction') {
    if (letter.entityExtractionStatus !== 'FAILED') {
      throw processingJobChanged(
        'Entity extraction is no longer retryable; refresh and try again',
      );
    }
    if (
      letter.type !== 'L'
      || letter.transcriptionStatus === 'RUNNING'
      || letter.metadataStatus !== 'SUCCESS'
    ) {
      throw new ProcessingError('Cannot retry: entity extraction prerequisites are not satisfied', 400);
    }
    const retried = await db.update(letters).set({
      entityExtractionStatus: 'PENDING',
      ...clearedEntityExtractionOwnership(),
      entityExtractionError: null,
      deadLetter: false,
      updatedAt: new Date(),
    }).where(and(
      eq(letters.id, letterId),
      eq(letters.primarySourceRevision, expected.primarySourceRevision),
      ...entityExtractionPrerequisiteConditions(),
      eq(letters.entityExtractionStatus, 'FAILED'),
      eq(letters.entityExtractionRevision, letter.entityExtractionRevision),
      observedTimestampMatches(letters.updatedAt, letter.updatedAt),
    )).returning({ id: letters.id });
    if (retried.length === 0) {
      await throwCurrentJobConflict(letterId, expected.primarySourceRevision);
    }
  } else if (type === 'extra_content') {
    if (letter.extraContentJobStatus !== 'FAILED') {
      throw processingJobChanged(
        'Extra-content transcription is no longer retryable; refresh and try again',
      );
    }
    if (letter.type !== 'L') {
      throw new ProcessingError('Cannot retry: extra content prerequisites are not satisfied', 400);
    }
    const retried = await db
      .update(letters)
      .set({
        extraContentJobStatus: 'PENDING',
        extraContentJobRunId: null,
        extraContentJobLeaseExpiresAt: null,
        extraContentJobLeaseRunId: null,
        extraContentJobClaimKind: null,
        extraContentJobDirty: false,
        extraContentJobError: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.primarySourceRevision, expected.primarySourceRevision),
        eq(letters.extraContentJobStatus, 'FAILED'),
        ...extraContentPrerequisiteConditions(),
        observedTimestampMatches(letters.updatedAt, letter.updatedAt),
      ))
      .returning({ id: letters.id });
    if (retried.length === 0) {
      await throwCurrentJobConflict(letterId, expected.primarySourceRevision);
    }
  }

  await requestBackgroundWorkerRun(`retry:${type}`);

  return { message: `Retrying ${type} for letter ${letterId}` };
}

/**
 * Cancel an active (RUNNING) job by marking it FAILED with an admin reason.
 */
export async function cancelActiveJob(
  letterId: string,
  type: QueueJobType,
  expected: ExpectedJobSnapshot,
): Promise<{ message: string }> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) {
    throw new ProcessingError('Letter not found', 404);
  }
  assertObservedJob(letter, type, 'active', expected);

  if (type === 'transcription') {
    if (letter.transcriptionStatus !== 'RUNNING') {
      throw processingJobChanged(
        'Transcription is no longer active; refresh and try again',
      );
    }
    if (!letter.transcriptionRunId) {
      throw new ProcessingError('Cannot cancel: transcription job has no active run ID', 409);
    }
    if (!await cancelTranscriptionAttempt(
      letterId,
      letter.transcriptionRunId,
      'Cancelled by admin',
      expected.primarySourceRevision,
    )) {
      await throwCurrentJobConflict(letterId, expected.primarySourceRevision);
    }
  } else if (type === 'metadata') {
    if (letter.metadataStatus !== 'RUNNING') {
      throw processingJobChanged(
        'Metadata extraction is no longer active; refresh and try again',
      );
    }
    if (!letter.metadataRunId) {
      throw new ProcessingError('Cannot cancel: metadata job has no active run ID', 409);
    }
    if (!await cancelMetadataAttempt(
      letterId,
      letter.metadataRunId,
      'Cancelled by admin',
      expected.primarySourceRevision,
    )) {
      await throwCurrentJobConflict(letterId, expected.primarySourceRevision);
    }
  } else if (type === 'entity_extraction') {
    if (letter.entityExtractionStatus !== 'RUNNING') {
      throw processingJobChanged(
        'Entity extraction is no longer active; refresh and try again',
      );
    }
    if (!letter.entityExtractionRunId && letter.entityExtractionRunRevision === null) {
      if (!await cancelLegacyEntityExtraction(
        letterId,
        'Cancelled by admin',
        expected.primarySourceRevision,
      )) {
        await throwCurrentJobConflict(letterId, expected.primarySourceRevision);
      }
    } else if (!letter.entityExtractionRunId || letter.entityExtractionRunRevision === null) {
      throw new ProcessingError('Cannot cancel: entity extraction job has no active run identity', 409);
    } else if (!await cancelEntityExtractionAttempt(
      letterId,
      {
        runId: letter.entityExtractionRunId,
        revision: letter.entityExtractionRunRevision,
      },
      'Cancelled by admin',
      expected.primarySourceRevision,
    )) {
      // If commit held the row lock first, its SUCCESS transition clears this
      // token and the stale cancellation cannot overwrite the new projection.
      await throwCurrentJobConflict(letterId, expected.primarySourceRevision);
    }
  } else if (type === 'extra_content') {
    if (letter.extraContentJobStatus !== 'RUNNING') {
      throw processingJobChanged(
        'Extra-content transcription is no longer active; refresh and try again',
      );
    }
    if (!letter.extraContentJobRunId) {
      throw new ProcessingError('Cannot cancel: extra content job has no active run ID', 409);
    }
    if (!await cancelExtraContentAttempt(
      letterId,
      letter.extraContentJobRunId,
      'Cancelled by admin',
      expected.primarySourceRevision,
    )) {
      await throwCurrentJobConflict(letterId, expected.primarySourceRevision);
    }
    await requestWorkerAfterExtraContentCancellation();
  }

  log.info({ letterId, type }, 'Active job cancelled by admin');

  return { message: 'Job cancelled' };
}

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * Custom error class for processing queue errors with HTTP status codes.
 */
class ProcessingError extends AppError {
  constructor(message: string, statusCode: number) {
    super(statusCode, message);
  }
}

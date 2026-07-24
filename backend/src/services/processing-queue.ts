import { eq, and, inArray, ne, sql, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { PAGINATION } from '../constants/pagination.js';
import { TIMING } from '../constants/timing.js';
import { db, letters } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { notify } from './notifications.js';
import { observedTimestampMatches } from './letter/shared.js';
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
  recoverExpiredExtraContentJobs,
  type ExtraContentRecoveryResult,
} from './letter/extra-content-job.js';
import { shouldUseCloudRunWorkerJob, triggerWorkerJob } from './cloud-run-job.js';
import {
  cancelLegacyEntityExtraction,
  failEntityExtraction,
} from './letters.js';
import {
  clearJobProgress,
  getJobProgress,
} from './processes/runner.js';
import {
  buildProcessingConditions,
  processingFilterSchema,
  type ProcessingFilterOptions,
} from './processes/filter-helpers.js';
import {
  entityExtractionPrerequisiteConditions,
  isMetadataStateEligible,
  isTranscriptionStateEligible,
  metadataPrerequisiteConditions,
  queuedEntityExtractionConditions,
  queuedMetadataConditions,
  queuedTranscriptionConditions,
  transcriptionPrerequisiteConditions,
} from './processing-eligibility.js';

export {
  buildProcessingConditions,
  processingFilterSchema,
};
export type { ProcessingFilterOptions };

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

export async function hasQueuedProcessingWork(): Promise<boolean> {
  const [transcription, metadata, entityExtraction] = await Promise.all([
    hasQueuedTranscriptionWork(),
    hasQueuedMetadataWork(),
    hasQueuedEntityExtractionWork(),
  ]);
  return transcription || metadata || entityExtraction;
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

async function startQueuedProcessing(
  type: 'transcription' | 'metadata' | 'entity_extraction',
): Promise<void> {
  await requestBackgroundWorkerRun(`queue:${type}`);
}

// ============================================================================
// SERVICE FUNCTIONS
// ============================================================================

/**
 * Reconciles only expired, fully-owned leased attempts. Entity extraction is
 * run/revision fenced but unleased, so it is never guessed dead automatically.
 */
export interface ProcessingLeaseRecoveryResult {
  transcription: TranscriptionRecoveryResult;
  metadata: MetadataRecoveryResult;
  extraContent: ExtraContentRecoveryResult;
}

export async function recoverExpiredProcessingJobs(): Promise<ProcessingLeaseRecoveryResult> {
  let transcription: TranscriptionRecoveryResult = { requeued: [], failed: [] };
  let metadata: MetadataRecoveryResult = { requeued: [], failed: [] };
  let extraContent: ExtraContentRecoveryResult = { requeued: [], failed: [] };

  // Keep the two stages as separate failure domains. They update the same table,
  // and a successful main recovery must still reach the API's worker trigger if
  // extra-content recovery fails (or vice versa).
  try {
    transcription = await recoverExpiredTranscriptions();
  } catch (error) {
    log.error({ err: error }, 'Expired transcription lease recovery failed');
  }

  try {
    metadata = await recoverExpiredMetadataJobs();
  } catch (error) {
    log.error({ err: error }, 'Expired metadata lease recovery failed');
  }

  try {
    extraContent = await recoverExpiredExtraContentJobs();
  } catch (error) {
    log.error({ err: error }, 'Expired extra-content lease recovery failed');
  }

  const recoveredLetterIds = [
    ...transcription.requeued.map(row => row.id),
    ...transcription.failed.map(row => row.id),
    ...metadata.requeued.map(row => row.id),
    ...metadata.failed.map(row => row.id),
    ...extraContent.requeued.map(row => row.id),
    ...extraContent.failed.map(row => row.id),
  ];

  if (recoveredLetterIds.length === 0) {
    log.info('Recovery found no expired leased processing attempts');
    return { transcription, metadata, extraContent };
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
      extraContentRequeued: extraContent.requeued.length,
      extraContentFailed: extraContent.failed.length,
    },
    dedupeKey: 'job_orphan_recovered:processing-leases',
    dedupeWindowMinutes: 5,
  });

  return { transcription, metadata, extraContent };
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
        eq(letters.entityExtractionStatus, 'RUNNING')
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
      type: string;
      startedAt: string;
      progress: { step: number; totalSteps: number; stepLabel: string } | null;
    }> = [];
    if (l.transcriptionStatus === 'RUNNING') {
      const prog = getJobProgress(l.id, 'transcription');
      jobs.push({
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        sender: l.sender,
        recipient: l.recipient,
        type: 'transcription',
        startedAt: l.updatedAt?.toISOString() ?? now.toISOString(),
        progress: prog ? { step: prog.step, totalSteps: prog.totalSteps, stepLabel: prog.stepLabel } : null,
      });
    }
    if (l.metadataStatus === 'RUNNING') {
      const prog = getJobProgress(l.id, 'metadata');
      jobs.push({
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        sender: l.sender,
        recipient: l.recipient,
        type: 'metadata',
        startedAt: l.updatedAt?.toISOString() ?? now.toISOString(),
        progress: prog ? { step: prog.step, totalSteps: prog.totalSteps, stepLabel: prog.stepLabel } : null,
      });
    }
    if (l.entityExtractionStatus === 'RUNNING') {
      const prog = getJobProgress(l.id, 'entity_extraction');
      jobs.push({
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        sender: l.sender,
        recipient: l.recipient,
        type: 'entity_extraction',
        startedAt: l.updatedAt?.toISOString() ?? now.toISOString(),
        progress: prog ? { step: prog.step, totalSteps: prog.totalSteps, stepLabel: prog.stepLabel } : null,
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
    type: string;
    status: string;
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
        error: l.entityExtractionStatus === 'FAILED' && !isBulkCleared(l.entityExtractionError) ? (l.entityExtractionError ?? undefined) : undefined,
        completedAt: letterUpdatedAt,
      });
    }
  }

  // Sort recent by completedAt desc and limit to 20
  recent.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  recent.splice(20);

  const mapQueued = (items: typeof queuedTranscription, queuedAtField?: 'createdAt' | 'transcriptConfirmedAt') =>
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
        queuedAt,
      };
    });

  return {
    active,
    queued: {
      transcription: mapQueued(queuedTranscription, 'createdAt'),
      metadata: mapQueued(queuedMetadata, 'transcriptConfirmedAt'),
      entityExtraction: mapQueued(queuedEntityExtraction, 'createdAt'),
    },
    recent,
    counts: {
      activeCount: active.length,
      queuedTranscription: queuedTranscription.length,
      queuedMetadata: queuedMetadata.length,
      queuedEntityExtraction: queuedEntityExtraction.length,
      recentSuccessCount: recent.filter(r => r.status === 'SUCCESS').length,
      recentFailedCount: recent.filter(r => r.status === 'FAILED').length,
      recentClearedCount: recent.filter(r => r.status === 'CLEARED').length,
    },
  };
}

/**
 * Start transcription processing for eligible letters matching the given filter options.
 */
export async function startTranscriptionProcessing(options: ProcessingFilterOptions): Promise<{ message: string; total: number }> {
  const { conditions, collectionNotFound } = await buildProcessingConditions(
    options,
    queuedTranscriptionConditions(),
  );

  if (collectionNotFound) {
    return { message: 'Collection not found', total: 0 };
  }

  const eligible = await db.query.letters.findMany({
    where: and(...conditions),
    columns: { id: true },
  });

  if (eligible.length === 0) {
    return { message: 'No letters to process', total: 0 };
  }

  await startQueuedProcessing('transcription');
  return { message: 'Worker requested; matching letters are already queued', total: eligible.length };
}

/**
 * Start metadata processing for eligible letters matching the given filter options.
 */
export async function startMetadataProcessing(options: ProcessingFilterOptions): Promise<{ message: string; total: number }> {
  const { conditions, collectionNotFound } = await buildProcessingConditions(
    options,
    queuedMetadataConditions(),
  );

  if (collectionNotFound) {
    return { message: 'Collection not found', total: 0 };
  }

  const eligible = await db.query.letters.findMany({
    where: and(...conditions),
    columns: { id: true },
  });

  if (eligible.length === 0) {
    return { message: 'No letters to process', total: 0 };
  }

  await startQueuedProcessing('metadata');
  return { message: 'Worker requested; matching letters are already queued', total: eligible.length };
}

/**
 * Start entity extraction processing for eligible letters (metadata succeeded, entities pending).
 */
export async function startEntityExtractionProcessing(options: ProcessingFilterOptions): Promise<{ message: string; total: number }> {
  const { conditions, collectionNotFound } = await buildProcessingConditions(
    options,
    queuedEntityExtractionConditions(),
  );

  if (collectionNotFound) {
    return { message: 'Collection not found', total: 0 };
  }

  const eligible = await db.query.letters.findMany({
    where: and(...conditions),
    columns: { id: true },
  });

  if (eligible.length === 0) {
    return { message: 'No letters to process', total: 0 };
  }

  await startQueuedProcessing('entity_extraction');
  return { message: 'Worker requested; matching letters are already queued', total: eligible.length };
}

// ============================================================================
// QUEUE MANAGEMENT
// ============================================================================

export const queueJobTypeSchema = z.enum(['transcription', 'metadata', 'entity_extraction']);
export type QueueJobType = z.infer<typeof queueJobTypeSchema>;

/**
 * Remove a letter from the processing queue. Only works for PENDING items.
 */
export async function removeFromQueue(letterId: string, type: QueueJobType): Promise<{ message: string }> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) {
    throw new ProcessingError('Letter not found', 404);
  }

  if (type === 'transcription') {
    if (letter.transcriptionStatus !== 'PENDING') {
      throw new ProcessingError(`Cannot remove: transcription status is ${letter.transcriptionStatus}`, 400);
    }
    const removed = await db
      .update(letters)
      .set({
        transcriptionStatus: 'FAILED',
        transcriptionRunId: null,
        transcriptionLeaseExpiresAt: null,
        transcriptionLeaseRunId: null,
        transcriptionClaimKind: null,
        transcriptionError: 'Removed from queue by admin',
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.transcriptionStatus, 'PENDING'),
      ))
      .returning({ id: letters.id });
    if (removed.length === 0) {
      throw new ProcessingError('Cannot remove: transcription is no longer pending', 409);
    }
  } else if (type === 'metadata') {
    if (letter.metadataStatus !== 'PENDING') {
      throw new ProcessingError(`Cannot remove: metadata status is ${letter.metadataStatus}`, 400);
    }
    const removed = await db
      .update(letters)
      .set({
        metadataStatus: 'FAILED',
        metadataRunId: null,
        metadataRunRevision: null,
        metadataLeaseExpiresAt: null,
        metadataLeaseRunId: null,
        metadataClaimKind: null,
        metadataRevision: sql`${letters.metadataRevision} + 1`,
        metadataError: 'Removed from queue by admin',
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.metadataStatus, 'PENDING'),
        eq(letters.metadataRevision, letter.metadataRevision),
        observedTimestampMatches(letters.updatedAt, letter.updatedAt),
      ))
      .returning({ id: letters.id });
    if (removed.length === 0) {
      throw new ProcessingError('Cannot remove: metadata changed since it was loaded', 409);
    }
  } else if (type === 'entity_extraction') {
    if (letter.entityExtractionStatus !== 'PENDING') {
      throw new ProcessingError(`Cannot remove: entity extraction status is ${letter.entityExtractionStatus}`, 400);
    }
    const removed = await db.update(letters).set({
      entityExtractionStatus: 'FAILED',
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionError: 'Removed from queue by admin',
      updatedAt: new Date(),
    }).where(and(
      eq(letters.id, letterId),
      eq(letters.entityExtractionStatus, 'PENDING'),
    )).returning({ id: letters.id });
    if (removed.length === 0) {
      throw new ProcessingError('Cannot remove: entity extraction is no longer pending', 409);
    }
  }

  return { message: 'Removed from queue' };
}

/**
 * Clear all queued items of a given type.
 */
export async function clearQueue(type: QueueJobType): Promise<{ message: string; cleared: number }> {
  let cleared = 0;

  if (type === 'transcription') {
    const queued = await db.query.letters.findMany({
      where: and(...queuedTranscriptionConditions()),
      columns: { id: true },
    });
    if (queued.length > 0) {
      const clearedRows = await db
        .update(letters)
        .set({
          transcriptionStatus: 'FAILED',
          transcriptionRunId: null,
          transcriptionLeaseExpiresAt: null,
          transcriptionLeaseRunId: null,
          transcriptionClaimKind: null,
          transcriptionError: 'Cleared from queue by admin',
          updatedAt: new Date(),
        })
        .where(and(
          inArray(letters.id, queued.map(l => l.id)),
          ...queuedTranscriptionConditions(),
        ))
        .returning({ id: letters.id });
      cleared = clearedRows.length;
    }
  } else if (type === 'metadata') {
    const queued = await db.query.letters.findMany({
      where: and(...queuedMetadataConditions()),
      columns: { id: true },
    });
    if (queued.length > 0) {
      const clearedRows = await db
        .update(letters)
        .set({
          metadataStatus: 'FAILED',
          metadataRunId: null,
          metadataRunRevision: null,
          metadataLeaseExpiresAt: null,
          metadataLeaseRunId: null,
          metadataClaimKind: null,
          metadataRevision: sql`${letters.metadataRevision} + 1`,
          metadataError: 'Cleared from queue by admin',
          updatedAt: new Date(),
        })
        .where(and(
          inArray(letters.id, queued.map(l => l.id)),
          ...queuedMetadataConditions(),
        ))
        .returning({ id: letters.id });
      cleared = clearedRows.length;
    }
  } else if (type === 'entity_extraction') {
    const queued = await db.query.letters.findMany({
      where: and(...queuedEntityExtractionConditions()),
      columns: { id: true },
    });
    if (queued.length > 0) {
      const clearedRows = await db
        .update(letters)
        .set({
          entityExtractionStatus: 'FAILED',
          entityExtractionRunId: null,
          entityExtractionRunRevision: null,
          entityExtractionError: 'Cleared from queue by admin',
          updatedAt: new Date(),
        })
        .where(and(
          inArray(letters.id, queued.map(l => l.id)),
          ...queuedEntityExtractionConditions(),
        ))
        .returning({ id: letters.id });
      cleared = clearedRows.length;
    }
  }

  return { message: `Cleared ${cleared} items from ${type} queue`, cleared };
}

/**
 * Retry a failed job by resetting its status to PENDING.
 */
export async function retryJob(letterId: string, type: QueueJobType): Promise<{ message: string }> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) {
    throw new ProcessingError('Letter not found', 404);
  }

  if (type === 'transcription') {
    if (letter.transcriptionStatus !== 'FAILED') {
      throw new ProcessingError(`Cannot retry: transcription status is ${letter.transcriptionStatus}`, 400);
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
        eq(letters.transcriptionStatus, 'FAILED'),
        ...transcriptionPrerequisiteConditions(),
        observedTimestampMatches(letters.updatedAt, letter.updatedAt),
      ))
      .returning({ id: letters.id });
    if (retried.length === 0) {
      throw new ProcessingError('Cannot retry: transcription prerequisites changed since it was loaded', 409);
    }
  } else if (type === 'metadata') {
    if (letter.metadataStatus !== 'FAILED') {
      throw new ProcessingError(`Cannot retry: metadata status is ${letter.metadataStatus}`, 400);
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
        eq(letters.metadataStatus, 'FAILED'),
        ...metadataPrerequisiteConditions(),
        eq(letters.metadataRevision, letter.metadataRevision),
        observedTimestampMatches(letters.updatedAt, letter.updatedAt),
      ))
      .returning({ id: letters.id });
    if (retried.length === 0) {
      throw new ProcessingError('Cannot retry: metadata changed since it was loaded', 409);
    }
  } else if (type === 'entity_extraction') {
    if (letter.entityExtractionStatus !== 'FAILED') {
      throw new ProcessingError(`Cannot retry: entity extraction status is ${letter.entityExtractionStatus}`, 400);
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
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionError: null,
      deadLetter: false,
      updatedAt: new Date(),
    }).where(and(
      eq(letters.id, letterId),
      ...entityExtractionPrerequisiteConditions(),
      eq(letters.entityExtractionStatus, 'FAILED'),
      observedTimestampMatches(letters.updatedAt, letter.updatedAt),
    )).returning({ id: letters.id });
    if (retried.length === 0) {
      throw new ProcessingError('Cannot retry: entity extraction changed since it was loaded', 409);
    }
  }

  await requestBackgroundWorkerRun(`retry:${type}`);

  return { message: `Retrying ${type} for letter ${letterId}` };
}

/**
 * Cancel an active (RUNNING) job by marking it FAILED with an admin reason.
 */
export async function cancelActiveJob(letterId: string, type: QueueJobType): Promise<{ message: string }> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) {
    throw new ProcessingError('Letter not found', 404);
  }

  if (type === 'transcription') {
    if (letter.transcriptionStatus !== 'RUNNING') {
      throw new ProcessingError(`Cannot cancel: transcription status is ${letter.transcriptionStatus}`, 400);
    }
    if (!letter.transcriptionRunId) {
      throw new ProcessingError('Cannot cancel: transcription job has no active run ID', 409);
    }
    if (!await cancelTranscriptionAttempt(letterId, letter.transcriptionRunId)) {
      throw new ProcessingError('Cannot cancel: transcription attempt changed since it was loaded', 409);
    }
  } else if (type === 'metadata') {
    if (letter.metadataStatus !== 'RUNNING') {
      throw new ProcessingError(`Cannot cancel: metadata status is ${letter.metadataStatus}`, 400);
    }
    if (!letter.metadataRunId) {
      throw new ProcessingError('Cannot cancel: metadata job has no active run ID', 409);
    }
    if (!await cancelMetadataAttempt(letterId, letter.metadataRunId)) {
      throw new ProcessingError('Cannot cancel: metadata attempt changed since it was loaded', 409);
    }
  } else if (type === 'entity_extraction') {
    if (letter.entityExtractionStatus !== 'RUNNING') {
      throw new ProcessingError(`Cannot cancel: entity extraction status is ${letter.entityExtractionStatus}`, 400);
    }
    if (!letter.entityExtractionRunId && letter.entityExtractionRunRevision === null) {
      if (!await cancelLegacyEntityExtraction(letterId, 'Cancelled by admin')) {
        throw new ProcessingError(
          'Cannot cancel: legacy entity extraction attempt changed since it was loaded',
          409,
        );
      }
    } else if (!letter.entityExtractionRunId || letter.entityExtractionRunRevision === null) {
      throw new ProcessingError('Cannot cancel: entity extraction job has no active run identity', 409);
    } else if (!await failEntityExtraction(
      letterId,
      {
        runId: letter.entityExtractionRunId,
        revision: letter.entityExtractionRunRevision,
      },
      'Cancelled by admin',
    )) {
      // If commit held the row lock first, its SUCCESS transition clears this
      // token and the stale cancellation cannot overwrite the new projection.
      throw new ProcessingError('Cannot cancel: entity extraction attempt changed since it was loaded', 409);
    }
  }

  clearJobProgress(letterId, type);
  log.info({ letterId, type }, 'Active job cancelled by admin');

  return { message: 'Job cancelled' };
}

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * Custom error class for processing queue errors with HTTP status codes.
 */
class ProcessingError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ProcessingError';
    this.statusCode = statusCode;
  }
}

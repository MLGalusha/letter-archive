import { eq, and, isNotNull, inArray, sql, or, ilike, ne } from 'drizzle-orm';
import { z } from 'zod';
import { PAGINATION } from '../constants/pagination.js';
import { TIMING } from '../constants/timing.js';
import { db, letters, letterPages, collections } from '../db/index.js';
import { processLetter, processMetadata } from '../pipeline/processor.js';
import { runEntityExtractionOnly } from '../pipeline/metadataV2.js';
import { createLogger } from '../utils/logger.js';
import { notify } from './notifications.js';
import { observedTimestampMatches, TRANSCRIBABLE_TYPES } from './letter/shared.js';
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
  shouldAbortProcessing as runnerShouldAbort,
  updateJobProgress as runnerUpdateJobProgress,
  clearJobProgress as runnerClearJobProgress,
  getJobProgress as runnerGetJobProgress,
} from './processes/runner.js';

const log = createLogger({ module: 'processing-queue' });

// ============================================================================
// PROCESSING STATE
// ============================================================================

export interface ProcessingState {
  isRunning: boolean;
  isPaused: boolean;
  shouldAbort: boolean;
  currentJob: { letterId: string; type: 'transcription' | 'metadata' | 'entity_extraction' } | null;
  completed: number;
  failed: number;
  skipped: number;
  total: number;
  errors: string[];
  lastCompletedAt: number | null;
}

let processingState: ProcessingState = {
  isRunning: false,
  isPaused: false,
  shouldAbort: false,
  currentJob: null,
  completed: 0,
  failed: 0,
  skipped: 0,
  total: 0,
  errors: [],
  lastCompletedAt: null,
};

function processedJobCount(): number {
  return processingState.completed + processingState.failed + processingState.skipped;
}

// ============================================================================
// JOB PROGRESS TRACKING
// ============================================================================

export interface JobProgress {
  letterId: string;
  type: string;
  step: number;
  totalSteps: number;
  stepLabel: string;
}

// Job progress is now owned by `services/processes/runner.ts` so that the
// legacy processing-queue and the new runner-driven pipeline share a single
// in-memory state. We re-export thin shims here so pipeline modules
// (transcription.ts, metadataV2.ts) can keep importing from the old path.

export function updateJobProgress(
  letterId: string,
  type: string,
  step: number,
  totalSteps: number,
  stepLabel: string
): void {
  runnerUpdateJobProgress(letterId, type, step, totalSteps, stepLabel);
}

export function clearJobProgress(letterId: string, type: string): void {
  runnerClearJobProgress(letterId, type);
}

export function getJobProgress(letterId: string, type: string): JobProgress | undefined {
  return runnerGetJobProgress(letterId, type);
}

/**
 * Reset processing state for a new batch.
 */
export function resetProcessingState(total: number): void {
  processingState = {
    isRunning: true,
    isPaused: false,
    shouldAbort: false,
    currentJob: null,
    completed: 0,
    failed: 0,
    skipped: 0,
    total,
    errors: [],
    lastCompletedAt: null,
  };
}

// ============================================================================
// FILTER SCHEMA AND HELPERS
// ============================================================================

export const processingFilterSchema = z.object({
  collectionCode: z.string().optional(),
  visibility: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  search: z.string().optional(),
  year: z.coerce.number().min(1800).max(2100).optional(),
  month: z.coerce.number().min(1).max(12).optional(),
  day: z.coerce.number().min(1).max(31).optional(),
  dateFrom: z.string().regex(/^\d{8}$/).optional(),
  dateTo: z.string().regex(/^\d{8}$/).optional(),
});

export type ProcessingFilterOptions = z.infer<typeof processingFilterSchema>;

/**
 * Build filter conditions from processing options.
 * Returns { conditions, collectionNotFound } - check collectionNotFound before using conditions.
 */
export async function buildProcessingConditions(
  options: ProcessingFilterOptions,
  baseConditions: ReturnType<typeof eq>[]
): Promise<{ conditions: ReturnType<typeof eq>[]; collectionNotFound: boolean }> {
  const conditions = [...baseConditions];

  // Collection filter (partial matching like GET endpoint)
  if (options.collectionCode) {
    const escapedCode = options.collectionCode.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const matchingCollections = await db.query.collections.findMany({
      where: ilike(collections.collectionCode, `%${escapedCode}`),
    });
    if (matchingCollections.length > 0) {
      const collectionIds = matchingCollections.map(c => c.id);
      conditions.push(inArray(letters.collectionId, collectionIds));
    } else {
      return { conditions: [], collectionNotFound: true };
    }
  }

  // Visibility filter
  if (options.visibility) {
    conditions.push(eq(letters.visibility, options.visibility));
  }

  // Search filter (ILIKE on sender, recipient, summary, hook)
  if (options.search && options.search.trim()) {
    const escaped = options.search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
    const searchTerm = `%${escaped}%`;
    conditions.push(
      or(
        ilike(letters.sender, searchTerm),
        ilike(letters.recipient, searchTerm),
        ilike(letters.summary, searchTerm),
        ilike(letters.hook, searchTerm)
      )!
    );
  }

  // Date filters - individual components
  if (options.year) {
    conditions.push(sql`SUBSTRING(${letters.dateRaw}, 1, 4) = ${options.year.toString()}`);
  }
  if (options.month) {
    const monthStr = options.month.toString().padStart(2, '0');
    conditions.push(sql`SUBSTRING(${letters.dateRaw}, 5, 2) = ${monthStr}`);
  }
  if (options.day) {
    const dayStr = options.day.toString().padStart(2, '0');
    conditions.push(sql`SUBSTRING(${letters.dateRaw}, 7, 2) = ${dayStr}`);
  }

  // Date range filters (only if individual components not set)
  if (options.dateFrom && !options.year && !options.month && !options.day) {
    conditions.push(sql`REPLACE(${letters.dateRaw}, 'X', '0') >= ${options.dateFrom}`);
  }
  if (options.dateTo && !options.year && !options.month && !options.day) {
    conditions.push(sql`REPLACE(${letters.dateRaw}, 'X', '9') <= ${options.dateTo}`);
  }

  return { conditions, collectionNotFound: false };
}

// ============================================================================
// ASYNC PROCESSING
// ============================================================================

/**
 * Async processing function that runs in the background.
 */
export async function processLettersAsync(letterIds: string[], type: 'transcription' | 'metadata' | 'entity_extraction') {
  log.info({ type, letterCount: letterIds.length }, 'Starting async processing batch');
  const batchStart = Date.now();

  for (const letterId of letterIds) {
    // Check for abort
    if (processingState.shouldAbort) {
      log.info({
        type,
        completed: processingState.completed,
        failed: processingState.failed,
        skipped: processingState.skipped,
      }, 'Processing aborted');
      processingState.isRunning = false;
      break;
    }

    // Wait while paused
    if (processingState.isPaused) {
      log.info({ type, letterId }, 'Processing paused');
    }
    while (processingState.isPaused && !processingState.shouldAbort) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (processingState.isPaused === false && processingState.shouldAbort === false) {
      // Resumed
    }

    if (processingState.shouldAbort) {
      log.info({
        type,
        completed: processingState.completed,
        failed: processingState.failed,
        skipped: processingState.skipped,
      }, 'Processing aborted after pause');
      processingState.isRunning = false;
      break;
    }

    processingState.currentJob = { letterId, type };
    const jobStart = Date.now();

    try {
      let skippedReason: string | null = null;
      if (type === 'transcription') {
        const outcome = await processLetter(letterId);
        skippedReason = outcome?.reason ?? null;
      } else if (type === 'metadata') {
        const outcome = await processMetadata(letterId);
        skippedReason = outcome?.reason ?? null;
      } else if (type === 'entity_extraction') {
        await runEntityExtractionOnly(letterId);
      }

      if (skippedReason) {
        processingState.skipped++;
        processingState.lastCompletedAt = Date.now();
        const jobDuration = Date.now() - jobStart;
        log.info(
          {
            letterId,
            type,
            reason: skippedReason,
            duration: jobDuration,
            progress: `${processedJobCount()}/${processingState.total}`,
          },
          'Job skipped',
        );
        continue;
      }

      processingState.completed++;
      processingState.lastCompletedAt = Date.now();
      const jobDuration = Date.now() - jobStart;
      log.debug({
        letterId,
        type,
        duration: jobDuration,
        progress: `${processedJobCount()}/${processingState.total}`,
      }, 'Job completed');
    } catch (error) {
      processingState.failed++;
      processingState.lastCompletedAt = Date.now();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      processingState.errors.push(`${letterId}: ${errorMessage}`);
      log.error({ letterId, type, err: error }, 'Job failed');

      // Notify on individual job failure (only for non-batch single re-runs, but always safe)
      const failType =
        type === 'transcription'
          ? 'transcription_failed'
          : type === 'metadata'
            ? 'metadata_failed'
            : 'entity_failed';
      void notify({
        type: failType,
        title: `${type === 'transcription' ? 'Transcription' : type === 'metadata' ? 'Metadata extraction' : 'Entity extraction'} failed`,
        message: errorMessage,
        link: `/admin/letters/${letterId}`,
        sourceType: 'letter',
        sourceId: letterId,
        metadata: { error: errorMessage, jobType: type },
        dedupeKey: `${failType}:${letterId}`,
      });
    }
  }

  const batchDuration = Date.now() - batchStart;
  log.info(
    {
      type,
      total: processingState.total,
      completed: processingState.completed,
      failed: processingState.failed,
      skipped: processingState.skipped,
      duration: batchDuration,
    },
    'Async processing batch finished'
  );

  // Batch completion notification (one summary instead of per-letter)
  if (letterIds.length > 1) {
    void notify({
      type: 'batch_complete',
      severity: processingState.failed > 0 ? 'warn' : 'info',
      title: 'Batch complete',
      message: `${processingState.completed} succeeded, ${processingState.failed} failed, ${processingState.skipped} skipped (${type})`,
      link: '/admin/processing',
      metadata: {
        succeeded: processingState.completed,
        failed: processingState.failed,
        skipped: processingState.skipped,
        total: processingState.total,
        jobType: type,
        durationMs: batchDuration,
      },
    });
  }

  processingState.isRunning = false;
  processingState.currentJob = null;
}

export async function requestBackgroundWorkerRun(reason: string): Promise<boolean> {
  if (!shouldUseCloudRunWorkerJob()) {
    return false;
  }

  try {
    await triggerWorkerJob(reason);
  } catch {
    // Leave queued work in PENDING state; a later trigger can still pick it up.
  }

  return true;
}

/** One durable definition of queued main-transcription work for worker handoff. */
export async function hasQueuedTranscriptionWork(): Promise<boolean> {
  const pending = await db.query.letters.findFirst({
    where: and(
      inArray(letters.type, [...TRANSCRIBABLE_TYPES]),
      eq(letters.transcriptionStatus, 'PENDING'),
      eq(letters.workflow, 'UPLOADED'),
      eq(letters.deadLetter, false),
    ),
    columns: { id: true },
  });

  return Boolean(pending);
}

/** One durable definition of queued metadata work for worker handoff. */
export async function hasQueuedMetadataWork(): Promise<boolean> {
  const pending = await db.query.letters.findFirst({
    where: and(
      eq(letters.type, 'L'),
      eq(letters.workflow, 'TRANSCRIBED'),
      ne(letters.transcriptionStatus, 'RUNNING'),
      eq(letters.metadataStatus, 'PENDING'),
      ne(letters.entityExtractionStatus, 'RUNNING'),
      ne(letters.extraContentJobStatus, 'RUNNING'),
      isNotNull(letters.transcriptConfirmedAt),
      eq(letters.deadLetter, false),
    ),
    columns: { id: true },
  });

  return Boolean(pending);
}

export async function hasQueuedProcessingWork(): Promise<boolean> {
  const [transcription, metadata] = await Promise.all([
    hasQueuedTranscriptionWork(),
    hasQueuedMetadataWork(),
  ]);
  return transcription || metadata;
}

/**
 * Ensures durable queued transcription work has a Cloud Run worker wake.
 * Unlike request-triggered enqueueing, errors propagate so the periodic lease
 * coordinator retries from the still-PENDING database row on its next pass.
 */
export async function ensureBackgroundWorkerForQueuedTranscription(
  reason: string,
): Promise<boolean> {
  if (!shouldUseCloudRunWorkerJob() || !await hasQueuedTranscriptionWork()) {
    return false;
  }

  await triggerWorkerJob(reason);
  return true;
}

/** Ensures any durable queued main-stage work has a Cloud Run worker wake. */
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
  letterIds: string[],
  type: 'transcription' | 'metadata' | 'entity_extraction',
): Promise<'job' | 'in_process'> {
  if (await requestBackgroundWorkerRun(`queue:${type}`)) {
    return 'job';
  }

  resetProcessingState(letterIds.length);
  void processLettersAsync(letterIds, type);
  return 'in_process';
}

// ============================================================================
// SERVICE FUNCTIONS
// ============================================================================

/**
 * Get current processing status.
 */
export function getProcessingStatus(): ProcessingState {
  return processingState;
}

/**
 * Reconciles only expired, fully-owned processing attempts. Entity extraction
 * remains the sole tokenless stage and is never reset automatically.
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
    where: and(
      inArray(letters.type, [...TRANSCRIBABLE_TYPES]),
      eq(letters.workflow, 'UPLOADED'),
      eq(letters.transcriptionStatus, 'PENDING')
    ),
    with: { collection: true },
    orderBy: (l, { asc }) => [asc(l.createdAt)],
    limit: PAGINATION.QUEUE_BATCH_SIZE,
  });

  // Queued metadata jobs
  const queuedMetadata = await db.query.letters.findMany({
    where: and(
      eq(letters.type, 'L'),
      eq(letters.workflow, 'TRANSCRIBED'),
      eq(letters.metadataStatus, 'PENDING'),
      ne(letters.transcriptionStatus, 'RUNNING'),
      isNotNull(letters.transcriptConfirmedAt)
    ),
    with: { collection: true },
    orderBy: (l, { asc }) => [asc(l.createdAt)],
    limit: PAGINATION.QUEUE_BATCH_SIZE,
  });

  // Queued entity extraction jobs (only after metadata has succeeded)
  const queuedEntityExtraction = await db.query.letters.findMany({
    where: and(
      eq(letters.type, 'L'),
      eq(letters.metadataStatus, 'SUCCESS'),
      eq(letters.entityExtractionStatus, 'PENDING'),
      ne(letters.transcriptionStatus, 'RUNNING')
    ),
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
    onDemandProcessing: processingState,
  };
}

/**
 * Start transcription processing for eligible letters matching the given filter options.
 */
export async function startTranscriptionProcessing(options: ProcessingFilterOptions): Promise<{ message: string; total: number }> {
  if (!shouldUseCloudRunWorkerJob() && processingState.isRunning) {
    throw new ProcessingError('Processing already in progress', 400);
  }

  // Base conditions for transcription: transcribable types, workflow UPLOADED, not deleted
  const baseConditions: ReturnType<typeof eq>[] = [
    inArray(letters.type, [...TRANSCRIBABLE_TYPES]) as unknown as ReturnType<typeof eq>,
    eq(letters.workflow, 'UPLOADED')
  ];

  const { conditions, collectionNotFound } = await buildProcessingConditions(options, baseConditions);

  if (collectionNotFound) {
    return { message: 'Collection not found', total: 0 };
  }

  // Find eligible letters
  const eligible = await db.query.letters.findMany({
    where: and(...conditions),
    with: { pages: true },
  });

  const toProcess = eligible.filter(l => l.pages.length > 0);

  if (toProcess.length === 0) {
    return { message: 'No letters to process', total: 0 };
  }

  const mode = await startQueuedProcessing(toProcess.map(l => l.id), 'transcription');
  return { message: mode === 'job' ? 'Processing queued' : 'Processing started', total: toProcess.length };
}

/**
 * Start metadata processing for eligible letters matching the given filter options.
 */
export async function startMetadataProcessing(options: ProcessingFilterOptions): Promise<{ message: string; total: number }> {
  if (!shouldUseCloudRunWorkerJob() && processingState.isRunning) {
    throw new ProcessingError('Processing already in progress', 400);
  }

  // Base conditions for metadata: type L, workflow TRANSCRIBED, transcript confirmed, metadata pending
  const baseConditions: ReturnType<typeof eq>[] = [
    eq(letters.type, 'L'),
    eq(letters.workflow, 'TRANSCRIBED'),
    isNotNull(letters.transcriptConfirmedAt),
    eq(letters.metadataStatus, 'PENDING'),
    ne(letters.transcriptionStatus, 'RUNNING')
  ];

  const { conditions, collectionNotFound } = await buildProcessingConditions(options, baseConditions);

  if (collectionNotFound) {
    return { message: 'Collection not found', total: 0 };
  }

  // Find eligible letters
  const eligible = await db.query.letters.findMany({
    where: and(...conditions),
  });

  if (eligible.length === 0) {
    return { message: 'No letters to process', total: 0 };
  }

  const mode = await startQueuedProcessing(eligible.map(l => l.id), 'metadata');
  return { message: mode === 'job' ? 'Processing queued' : 'Processing started', total: eligible.length };
}

/**
 * Start entity extraction processing for eligible letters (metadata succeeded, entities pending).
 */
export async function startEntityExtractionProcessing(options: ProcessingFilterOptions): Promise<{ message: string; total: number }> {
  if (!shouldUseCloudRunWorkerJob() && processingState.isRunning) {
    throw new ProcessingError('Processing already in progress', 400);
  }

  // Base conditions: type L, metadata succeeded, entity extraction pending
  const baseConditions: ReturnType<typeof eq>[] = [
    eq(letters.type, 'L'),
    eq(letters.metadataStatus, 'SUCCESS'),
    eq(letters.entityExtractionStatus, 'PENDING'),
    ne(letters.transcriptionStatus, 'RUNNING')
  ];

  const { conditions, collectionNotFound } = await buildProcessingConditions(options, baseConditions);

  if (collectionNotFound) {
    return { message: 'Collection not found', total: 0 };
  }

  const eligible = await db.query.letters.findMany({
    where: and(...conditions),
  });

  if (eligible.length === 0) {
    return { message: 'No letters to process', total: 0 };
  }

  const mode = await startQueuedProcessing(eligible.map(l => l.id), 'entity_extraction');
  return { message: mode === 'job' ? 'Processing queued' : 'Processing started', total: eligible.length };
}

/**
 * Pause the current processing batch.
 */
export function pauseProcessing(): { message: string } {
  if (!processingState.isRunning) {
    throw new ProcessingError('No processing in progress', 400);
  }
  processingState.isPaused = true;
  const processed = processedJobCount();
  log.info({ processed, total: processingState.total }, 'Processing paused');
  void notify({
    type: 'queue_paused',
    title: 'Processing queue paused',
    message: `Paused at ${processed}/${processingState.total}`,
    link: '/admin/processing',
    sourceType: 'admin',
    metadata: {
      completed: processingState.completed,
      failed: processingState.failed,
      skipped: processingState.skipped,
      processed,
      total: processingState.total,
    },
  });
  return { message: 'Processing paused' };
}

/**
 * Resume the current processing batch.
 */
export function resumeProcessing(): { message: string } {
  if (!processingState.isRunning) {
    throw new ProcessingError('No processing in progress', 400);
  }
  processingState.isPaused = false;
  const processed = processedJobCount();
  log.info({ processed, total: processingState.total }, 'Processing resumed');
  void notify({
    type: 'queue_resumed',
    title: 'Processing queue resumed',
    message: `Resumed at ${processed}/${processingState.total}`,
    link: '/admin/processing',
    sourceType: 'admin',
    metadata: {
      completed: processingState.completed,
      failed: processingState.failed,
      skipped: processingState.skipped,
      processed,
      total: processingState.total,
    },
  });
  return { message: 'Processing resumed' };
}

/**
 * Abort the current processing batch. Reverts the in-progress job state if applicable.
 */
export function abortProcessing(): { message: string } {
  if (!processingState.isRunning) {
    throw new ProcessingError('No processing in progress', 400);
  }

  processingState.shouldAbort = true;
  log.info(
    {
      completed: processingState.completed,
      failed: processingState.failed,
      skipped: processingState.skipped,
      total: processingState.total,
    },
    'Processing abort requested'
  );

  // The current job (if any) will finish naturally — abort stops the batch
  // after the current job completes. Use cancelActiveJob() to cancel a specific running job.

  return { message: 'Processing aborted — batch will stop after current job finishes' };
}

/**
 * Check whether the current processing batch should abort.
 * Delegates to the new runner so both legacy and registry-driven batches
 * observe the same abort signal.
 */
export function shouldAbortProcessing(): boolean {
  if (runnerShouldAbort()) return true;
  return processingState.shouldAbort;
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
      where: and(
        inArray(letters.type, [...TRANSCRIBABLE_TYPES]),
        eq(letters.workflow, 'UPLOADED'),
        eq(letters.transcriptionStatus, 'PENDING')
      ),
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
          eq(letters.transcriptionStatus, 'PENDING'),
        ))
        .returning({ id: letters.id });
      cleared = clearedRows.length;
    }
  } else if (type === 'metadata') {
    const queued = await db.query.letters.findMany({
      where: and(
        eq(letters.type, 'L'),
        eq(letters.workflow, 'TRANSCRIBED'),
        eq(letters.metadataStatus, 'PENDING'),
        ne(letters.transcriptionStatus, 'RUNNING'),
        isNotNull(letters.transcriptConfirmedAt)
      ),
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
          eq(letters.metadataStatus, 'PENDING'),
          ne(letters.transcriptionStatus, 'RUNNING'),
        ))
        .returning({ id: letters.id });
      cleared = clearedRows.length;
    }
  } else if (type === 'entity_extraction') {
    const queued = await db.query.letters.findMany({
      where: and(
        eq(letters.type, 'L'),
        eq(letters.metadataStatus, 'SUCCESS'),
        eq(letters.entityExtractionStatus, 'PENDING'),
        ne(letters.transcriptionStatus, 'RUNNING')
      ),
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
          eq(letters.entityExtractionStatus, 'PENDING'),
          ne(letters.transcriptionStatus, 'RUNNING'),
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
      ))
      .returning({ id: letters.id });
    if (retried.length === 0) {
      throw new ProcessingError('Cannot retry: transcription is no longer failed', 409);
    }
  } else if (type === 'metadata') {
    if (letter.metadataStatus !== 'FAILED') {
      throw new ProcessingError(`Cannot retry: metadata status is ${letter.metadataStatus}`, 400);
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
    const retried = await db.update(letters).set({
      entityExtractionStatus: 'PENDING',
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionError: null,
      updatedAt: new Date(),
    }).where(and(
      eq(letters.id, letterId),
      eq(letters.entityExtractionStatus, 'FAILED'),
    )).returning({ id: letters.id });
    if (retried.length === 0) {
      throw new ProcessingError('Cannot retry: entity extraction changed since it was loaded', 409);
    }
  }

  void requestBackgroundWorkerRun(`retry:${type}`);

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
export class ProcessingError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ProcessingError';
    this.statusCode = statusCode;
  }
}

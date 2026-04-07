import { eq, and, isNotNull, inArray, sql, or, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { PAGINATION } from '../constants/pagination.js';
import { TIMING } from '../constants/timing.js';
import { db, letters, letterPages, collections } from '../db/index.js';
import { processLetter, processMetadata } from '../pipeline/processor.js';
import { runEntityExtractionOnly } from '../pipeline/metadataV2.js';
import { createLogger } from '../utils/logger.js';
import { createNotification } from './notifications.js';
import { TRANSCRIBABLE_TYPES } from './letter/shared.js';

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
  total: 0,
  errors: [],
  lastCompletedAt: null,
};

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

// In-memory map of active job progress, keyed by `${letterId}-${type}`
const jobProgressMap = new Map<string, JobProgress>();

export function updateJobProgress(letterId: string, type: string, step: number, totalSteps: number, stepLabel: string): void {
  jobProgressMap.set(`${letterId}-${type}`, { letterId, type, step, totalSteps, stepLabel });
}

export function clearJobProgress(letterId: string, type: string): void {
  jobProgressMap.delete(`${letterId}-${type}`);
}

export function getJobProgress(letterId: string, type: string): JobProgress | undefined {
  return jobProgressMap.get(`${letterId}-${type}`);
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
      log.info({ type, completed: processingState.completed, failed: processingState.failed }, 'Processing aborted');
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
      log.info({ type, completed: processingState.completed, failed: processingState.failed }, 'Processing aborted after pause');
      processingState.isRunning = false;
      break;
    }

    processingState.currentJob = { letterId, type };
    const jobStart = Date.now();

    try {
      if (type === 'transcription') {
        await processLetter(letterId);
      } else if (type === 'metadata') {
        await processMetadata(letterId);
      } else if (type === 'entity_extraction') {
        await runEntityExtractionOnly(letterId);
      }
      processingState.completed++;
      processingState.lastCompletedAt = Date.now();
      const jobDuration = Date.now() - jobStart;
      log.debug({ letterId, type, duration: jobDuration, progress: `${processingState.completed}/${processingState.total}` }, 'Job completed');
    } catch (error) {
      processingState.failed++;
      processingState.lastCompletedAt = Date.now();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      processingState.errors.push(`${letterId}: ${errorMessage}`);
      log.error({ letterId, type, err: error }, 'Job failed');

      // Notify on individual job failure (only for non-batch single re-runs, but always safe)
      createNotification({
        type: 'error',
        title: `${type === 'transcription' ? 'Transcription' : type === 'metadata' ? 'Metadata extraction' : 'Entity extraction'} failed`,
        message: errorMessage,
        link: `/admin/letters/${letterId}`,
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
      duration: batchDuration,
    },
    'Async processing batch finished'
  );

  // Batch completion notification (one summary instead of per-letter)
  if (letterIds.length > 1) {
    createNotification({
      type: 'batch',
      title: 'Batch complete',
      message: `${processingState.completed} succeeded, ${processingState.failed} failed (${type})`,
      link: '/admin/processing',
    });
  }

  processingState.isRunning = false;
  processingState.currentJob = null;
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
 * Recover orphaned jobs stuck in RUNNING status (e.g., after server restart).
 * Resets them back to PENDING so they can be reprocessed.
 */
export async function recoverOrphanedJobs(): Promise<void> {
  const orphanedLetters = await db.query.letters.findMany({
    where: or(
      eq(letters.transcriptionStatus, 'RUNNING'),
      eq(letters.metadataStatus, 'RUNNING'),
      eq(letters.entityExtractionStatus, 'RUNNING')
    ),
    columns: { id: true, dateRaw: true, transcriptionStatus: true, metadataStatus: true, entityExtractionStatus: true, workflow: true },
  });

  if (orphanedLetters.length === 0) return;

  log.warn({ count: orphanedLetters.length }, 'Found orphaned jobs in RUNNING status — resetting to PENDING');

  for (const letter of orphanedLetters) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (letter.transcriptionStatus === 'RUNNING') {
      updates.transcriptionStatus = 'PENDING';
      updates.workflow = 'UPLOADED';
      log.info({ letterId: letter.id, dateRaw: letter.dateRaw }, 'Resetting orphaned transcription job');
    }
    if (letter.metadataStatus === 'RUNNING') {
      updates.metadataStatus = 'PENDING';
      updates.workflow = 'TRANSCRIBED';
      log.info({ letterId: letter.id, dateRaw: letter.dateRaw }, 'Resetting orphaned metadata job');
    }
    if (letter.entityExtractionStatus === 'RUNNING') {
      updates.entityExtractionStatus = 'PENDING';
      log.info({ letterId: letter.id, dateRaw: letter.dateRaw }, 'Resetting orphaned entity extraction job');
    }

    await db.update(letters).set(updates).where(eq(letters.id, letter.id));
  }

  log.info({ count: orphanedLetters.length }, 'Orphaned job recovery complete');
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
      eq(letters.entityExtractionStatus, 'PENDING')
    ),
    with: { collection: true },
    orderBy: (l, { asc }) => [asc(l.createdAt)],
    limit: PAGINATION.QUEUE_BATCH_SIZE,
  });

  // Queued line detection: pages with null lineSegments from transcribed+ letters
  const lineDetectionCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(letterPages)
    .innerJoin(letters, eq(letterPages.letterId, letters.id))
    .where(and(
      sql`(${letterPages.lineSegments} IS NULL OR jsonb_array_length(${letterPages.lineSegments}) = 0)`,
      sql`${letters.workflow} != 'UPLOADED'`
    ));

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
      queuedLineDetection: Number(lineDetectionCount[0]?.count ?? 0),
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
  if (processingState.isRunning) {
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

  // Reset state and start
  processingState = {
    isRunning: true,
    isPaused: false,
    shouldAbort: false,
    currentJob: null,
    completed: 0,
    failed: 0,
    total: toProcess.length,
    errors: [],
    lastCompletedAt: null,
  };

  // Start async processing (don't await - runs in background)
  processLettersAsync(toProcess.map(l => l.id), 'transcription');

  return { message: 'Processing started', total: toProcess.length };
}

/**
 * Start metadata processing for eligible letters matching the given filter options.
 */
export async function startMetadataProcessing(options: ProcessingFilterOptions): Promise<{ message: string; total: number }> {
  if (processingState.isRunning) {
    throw new ProcessingError('Processing already in progress', 400);
  }

  // Base conditions for metadata: type L, workflow TRANSCRIBED, transcript confirmed, metadata pending
  const baseConditions: ReturnType<typeof eq>[] = [
    eq(letters.type, 'L'),
    eq(letters.workflow, 'TRANSCRIBED'),
    isNotNull(letters.transcriptConfirmedAt),
    eq(letters.metadataStatus, 'PENDING')
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

  // Reset state and start
  processingState = {
    isRunning: true,
    isPaused: false,
    shouldAbort: false,
    currentJob: null,
    completed: 0,
    failed: 0,
    total: eligible.length,
    errors: [],
    lastCompletedAt: null,
  };

  // Start async processing (don't await - runs in background)
  processLettersAsync(eligible.map(l => l.id), 'metadata');

  return { message: 'Processing started', total: eligible.length };
}

/**
 * Start entity extraction processing for eligible letters (metadata succeeded, entities pending).
 */
export async function startEntityExtractionProcessing(options: ProcessingFilterOptions): Promise<{ message: string; total: number }> {
  if (processingState.isRunning) {
    throw new ProcessingError('Processing already in progress', 400);
  }

  // Base conditions: type L, metadata succeeded, entity extraction pending
  const baseConditions: ReturnType<typeof eq>[] = [
    eq(letters.type, 'L'),
    eq(letters.metadataStatus, 'SUCCESS'),
    eq(letters.entityExtractionStatus, 'PENDING')
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

  processingState = {
    isRunning: true,
    isPaused: false,
    shouldAbort: false,
    currentJob: null,
    completed: 0,
    failed: 0,
    total: eligible.length,
    errors: [],
    lastCompletedAt: null,
  };

  processLettersAsync(eligible.map(l => l.id), 'entity_extraction');

  return { message: 'Processing started', total: eligible.length };
}

/**
 * Get pages needing line detection (for remote worker script).
 */
export async function getLineDetectionQueue() {
  const pages = await db
    .select({
      pageId: letterPages.id,
      letterId: letterPages.letterId,
      pageNumber: letterPages.pageNumber,
      dateRaw: letters.dateRaw,
    })
    .from(letterPages)
    .innerJoin(letters, eq(letterPages.letterId, letters.id))
    .where(and(
      sql`(${letterPages.lineSegments} IS NULL OR jsonb_array_length(${letterPages.lineSegments}) = 0)`,
      sql`${letters.workflow} != 'UPLOADED'`
    ))
    .orderBy(letters.dateRaw, letterPages.pageNumber);

  return { pages, total: pages.length };
}

export async function resetLineSegments() {
  const result = await db.execute(sql`
    UPDATE letter_pages SET line_segments = NULL
    WHERE letter_id IN (SELECT id FROM letters WHERE workflow != 'UPLOADED')
      AND line_segments IS NOT NULL
  `);
  const reset = Number(result.count ?? 0);
  return { reset };
}

/**
 * Pause the current processing batch.
 */
export function pauseProcessing(): { message: string } {
  if (!processingState.isRunning) {
    throw new ProcessingError('No processing in progress', 400);
  }
  processingState.isPaused = true;
  log.info({ completed: processingState.completed, total: processingState.total }, 'Processing paused');
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
  log.info({ completed: processingState.completed, total: processingState.total }, 'Processing resumed');
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
    { completed: processingState.completed, failed: processingState.failed, total: processingState.total },
    'Processing abort requested'
  );

  // The current job (if any) will finish naturally — abort stops the batch
  // after the current job completes. Use cancelActiveJob() to cancel a specific running job.

  return { message: 'Processing aborted — batch will stop after current job finishes' };
}

/**
 * Check whether the current processing batch should abort.
 * Called by pipeline functions between page batches for responsive abort.
 */
export function shouldAbortProcessing(): boolean {
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
    await db.update(letters).set({
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Removed from queue by admin',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));
  } else if (type === 'metadata') {
    if (letter.metadataStatus !== 'PENDING') {
      throw new ProcessingError(`Cannot remove: metadata status is ${letter.metadataStatus}`, 400);
    }
    await db.update(letters).set({
      metadataStatus: 'FAILED',
      metadataError: 'Removed from queue by admin',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));
  } else if (type === 'entity_extraction') {
    if (letter.entityExtractionStatus !== 'PENDING') {
      throw new ProcessingError(`Cannot remove: entity extraction status is ${letter.entityExtractionStatus}`, 400);
    }
    await db.update(letters).set({
      entityExtractionStatus: 'FAILED',
      entityExtractionError: 'Removed from queue by admin',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));
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
      await db.update(letters).set({
        transcriptionStatus: 'FAILED',
        transcriptionError: 'Cleared from queue by admin',
        updatedAt: new Date(),
      }).where(inArray(letters.id, queued.map(l => l.id)));
      cleared = queued.length;
    }
  } else if (type === 'metadata') {
    const queued = await db.query.letters.findMany({
      where: and(
        eq(letters.type, 'L'),
        eq(letters.workflow, 'TRANSCRIBED'),
        eq(letters.metadataStatus, 'PENDING'),
        isNotNull(letters.transcriptConfirmedAt)
      ),
      columns: { id: true },
    });
    if (queued.length > 0) {
      await db.update(letters).set({
        metadataStatus: 'FAILED',
        metadataError: 'Cleared from queue by admin',
        updatedAt: new Date(),
      }).where(inArray(letters.id, queued.map(l => l.id)));
      cleared = queued.length;
    }
  } else if (type === 'entity_extraction') {
    const queued = await db.query.letters.findMany({
      where: and(
        eq(letters.type, 'L'),
        eq(letters.metadataStatus, 'SUCCESS'),
        eq(letters.entityExtractionStatus, 'PENDING')
      ),
      columns: { id: true },
    });
    if (queued.length > 0) {
      await db.update(letters).set({
        entityExtractionStatus: 'FAILED',
        entityExtractionError: 'Cleared from queue by admin',
        updatedAt: new Date(),
      }).where(inArray(letters.id, queued.map(l => l.id)));
      cleared = queued.length;
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
    await db.update(letters).set({
      transcriptionStatus: 'PENDING',
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      workflow: 'UPLOADED',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));
  } else if (type === 'metadata') {
    if (letter.metadataStatus !== 'FAILED') {
      throw new ProcessingError(`Cannot retry: metadata status is ${letter.metadataStatus}`, 400);
    }
    await db.update(letters).set({
      metadataStatus: 'PENDING',
      metadataError: null,
      metadataAttemptCount: 0,
      workflow: 'TRANSCRIBED',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));
  } else if (type === 'entity_extraction') {
    if (letter.entityExtractionStatus !== 'FAILED') {
      throw new ProcessingError(`Cannot retry: entity extraction status is ${letter.entityExtractionStatus}`, 400);
    }
    await db.update(letters).set({
      entityExtractionStatus: 'PENDING',
      entityExtractionError: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));
  }

  return { message: `Retrying ${type} for letter ${letterId}` };
}

/**
 * Cancel an active (RUNNING) job by resetting its status back to PENDING.
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
    await db.update(letters).set({
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Cancelled by admin',
      workflow: 'UPLOADED',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));
  } else if (type === 'metadata') {
    if (letter.metadataStatus !== 'RUNNING') {
      throw new ProcessingError(`Cannot cancel: metadata status is ${letter.metadataStatus}`, 400);
    }
    await db.update(letters).set({
      metadataStatus: 'FAILED',
      metadataError: 'Cancelled by admin',
      workflow: 'TRANSCRIBED',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));
  } else if (type === 'entity_extraction') {
    if (letter.entityExtractionStatus !== 'RUNNING') {
      throw new ProcessingError(`Cannot cancel: entity extraction status is ${letter.entityExtractionStatus}`, 400);
    }
    await db.update(letters).set({
      entityExtractionStatus: 'FAILED',
      entityExtractionError: 'Cancelled by admin',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));
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

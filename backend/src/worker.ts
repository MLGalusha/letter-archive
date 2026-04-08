import 'dotenv/config';
import { eq, and, isNotNull, inArray } from 'drizzle-orm';
import { db, letters } from './db/index.js';
import { processLetter, processMetadata } from './pipeline/processor.js';
import { createLogger, LOG_DIR, getLogRetentionHours } from './utils/logger.js';
import { TRANSCRIBABLE_TYPES } from './services/letter/shared.js';
import { notify } from './services/notifications.js';
import { setWorkerState } from './services/worker-state.js';

const log = createLogger({ module: 'worker' });

const POLL_INTERVAL = 5000; // 5 seconds
const BATCH_SIZE = 5;

/**
 * Finds letters that need transcription (type='L', status='PENDING', not deleted, not dead-letter).
 */
async function findLettersNeedingTranscription() {
  return db.query.letters.findMany({
    where: and(
      inArray(letters.type, [...TRANSCRIBABLE_TYPES]),
      eq(letters.transcriptionStatus, 'PENDING'),
      eq(letters.workflow, 'UPLOADED'),
      eq(letters.deadLetter, false),
    ),
    limit: BATCH_SIZE,
    orderBy: (l, { asc }) => [asc(l.createdAt)],
  });
}

/**
 * Finds letters that need metadata extraction.
 * Requires: transcribed, metadata pending, transcript confirmed, not deleted, not dead-letter.
 */
async function findLettersNeedingMetadata() {
  return db.query.letters.findMany({
    where: and(
      eq(letters.type, 'L'),
      eq(letters.workflow, 'TRANSCRIBED'),
      eq(letters.metadataStatus, 'PENDING'),
      isNotNull(letters.transcriptConfirmedAt),
      eq(letters.deadLetter, false),
    ),
    limit: BATCH_SIZE,
    orderBy: (l, { asc }) => [asc(l.createdAt)],
  });
}

/**
 * Processes pending jobs.
 */
async function processPendingJobs() {
  const cycleStart = Date.now();

  // Phase 1: Transcription
  const needingTranscription = await findLettersNeedingTranscription();

  // Heartbeat: let the admin API observe us.
  void setWorkerState({
    lastTickAt: new Date(),
    isPolling: true,
    lastError: null,
    currentBatchSize: needingTranscription.length,
  });

  if (needingTranscription.length > 0) {
    log.debug({ count: needingTranscription.length }, 'Found letters needing transcription');
  }

  for (const letter of needingTranscription) {
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting transcription job'
    );
    try {
      await processLetter(letter.id);
      const duration = Date.now() - jobStart;
      log.info({ letterId: letter.id, duration }, 'Transcription job completed');
      void notify({
        type: 'transcription_success',
        title: 'Letter transcribed',
        message: `${letter.dateRaw ?? letter.id.slice(0, 8)} transcribed in ${(duration / 1000).toFixed(1)}s`,
        link: `/admin/letters/${letter.id}`,
        sourceType: 'letter',
        sourceId: letter.id,
        metadata: { durationMs: duration, dateRaw: letter.dateRaw },
      });
    } catch (error) {
      const duration = Date.now() - jobStart;
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error(
        { letterId: letter.id, duration, err: error },
        'Transcription job failed'
      );
      void notify({
        type: 'transcription_failed',
        title: 'Transcription failed',
        message,
        link: `/admin/letters/${letter.id}`,
        sourceType: 'letter',
        sourceId: letter.id,
        metadata: { error: message, durationMs: duration, dateRaw: letter.dateRaw },
        dedupeKey: `transcription_failed:${letter.id}`,
      });
    }
  }

  // Phase 2: Metadata extraction (only for confirmed transcripts)
  const needingMetadata = await findLettersNeedingMetadata();

  if (needingMetadata.length > 0) {
    log.debug({ count: needingMetadata.length }, 'Found letters needing metadata extraction');
  }

  for (const letter of needingMetadata) {
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting metadata extraction job'
    );
    try {
      await processMetadata(letter.id);
      const duration = Date.now() - jobStart;
      log.info({ letterId: letter.id, duration }, 'Metadata extraction job completed');
      // Phase 1 success notification fires from inside metadataV2 — no duplicate here.
    } catch (error) {
      const duration = Date.now() - jobStart;
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error(
        { letterId: letter.id, duration, err: error },
        'Metadata extraction job failed'
      );
      void notify({
        type: 'metadata_failed',
        title: 'Metadata extraction failed',
        message,
        link: `/admin/letters/${letter.id}`,
        sourceType: 'letter',
        sourceId: letter.id,
        metadata: { error: message, durationMs: duration, dateRaw: letter.dateRaw },
        dedupeKey: `metadata_failed:${letter.id}`,
      });
    }
  }

  const totalProcessed = needingTranscription.length + needingMetadata.length;
  if (totalProcessed > 0) {
    const cycleDuration = Date.now() - cycleStart;
    log.info(
      {
        transcriptionCount: needingTranscription.length,
        metadataCount: needingMetadata.length,
        totalProcessed,
        cycleDuration,
      },
      'Processing cycle completed'
    );
  }
}

/**
 * Sleep utility.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main worker loop. Exits cleanly when a shutdown signal is received,
 * finishing the current job before stopping.
 */
let shuttingDown = false;

async function main() {
  log.info(
    {
      pollInterval: POLL_INTERVAL,
      batchSize: BATCH_SIZE,
      logDir: LOG_DIR,
      logRetentionHours: getLogRetentionHours(),
    },
    'Background worker starting'
  );

  void notify({
    type: 'system_worker_started',
    title: 'Worker started',
    message: 'Background processing worker is online.',
    metadata: { pollInterval: POLL_INTERVAL, batchSize: BATCH_SIZE },
    dedupeKey: 'system_worker_started',
    dedupeWindowMinutes: 5,
  });

  while (!shuttingDown) {
    try {
      await processPendingJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ err: error }, 'Error in processing cycle');
      void setWorkerState({ lastError: message });
      void notify({
        type: 'system_worker_error',
        title: 'Worker processing cycle failed',
        message,
        metadata: { error: message },
        dedupeKey: 'system_worker_error',
        dedupeWindowMinutes: 30,
      });
    }

    if (!shuttingDown) {
      await sleep(POLL_INTERVAL);
    }
  }

  log.info('Worker loop exited cleanly');
  process.exit(0);
}

// Handle graceful shutdown — let the current job finish, then exit
function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'Shutdown signal received, finishing current job');
  void setWorkerState({ isPolling: false });

  // Force exit after 25s if a job is stuck (Cloud Run default termination is 30s)
  setTimeout(() => {
    log.warn('Forced worker shutdown after timeout');
    process.exit(1);
  }, 25_000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

main().catch((error) => {
  log.fatal({ err: error }, 'Fatal error in worker');
  process.exit(1);
});

import 'dotenv/config';
import { eq, and, isNotNull, inArray } from 'drizzle-orm';
import { db, letters } from './db/index.js';
import { processLetter, processMetadata } from './pipeline/processor.js';
import { createLogger, LOG_DIR, getLogRetentionHours } from './utils/logger.js';
import { TRANSCRIBABLE_TYPES } from './services/letter/shared.js';

const log = createLogger({ module: 'worker' });

const POLL_INTERVAL = 5000; // 5 seconds
const BATCH_SIZE = 5;

/**
 * Finds letters that need transcription (type='L', status='PENDING', not deleted).
 */
async function findLettersNeedingTranscription() {
  return db.query.letters.findMany({
    where: and(
      inArray(letters.type, [...TRANSCRIBABLE_TYPES]),
      eq(letters.transcriptionStatus, 'PENDING'),
      eq(letters.workflow, 'UPLOADED'),
    ),
    limit: BATCH_SIZE,
    orderBy: (l, { asc }) => [asc(l.createdAt)],
  });
}

/**
 * Finds letters that need metadata extraction.
 * Requires: transcribed, metadata pending, transcript confirmed, not deleted.
 */
async function findLettersNeedingMetadata() {
  return db.query.letters.findMany({
    where: and(
      eq(letters.type, 'L'),
      eq(letters.workflow, 'TRANSCRIBED'),
      eq(letters.metadataStatus, 'PENDING'),
      isNotNull(letters.transcriptConfirmedAt),
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
    } catch (error) {
      const duration = Date.now() - jobStart;
      log.error(
        { letterId: letter.id, duration, err: error },
        'Transcription job failed'
      );
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
    } catch (error) {
      const duration = Date.now() - jobStart;
      log.error(
        { letterId: letter.id, duration, err: error },
        'Metadata extraction job failed'
      );
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

  while (!shuttingDown) {
    try {
      await processPendingJobs();
    } catch (error) {
      log.error({ err: error }, 'Error in processing cycle');
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

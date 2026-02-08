import 'dotenv/config';
import { eq, and, isNull, isNotNull } from 'drizzle-orm';
import { db, letters } from './db/index.js';
import { processLetter, processMetadata } from './pipeline/processor.js';
import { createLogger } from './utils/logger.js';

const log = createLogger({ module: 'worker' });

const POLL_INTERVAL = 5000; // 5 seconds
const BATCH_SIZE = 5;

/**
 * Finds letters that need transcription (type='L', status='PENDING', not deleted).
 */
async function findLettersNeedingTranscription() {
  return db.query.letters.findMany({
    where: and(
      eq(letters.type, 'L'),
      eq(letters.transcriptionStatus, 'PENDING'),
      eq(letters.workflow, 'UPLOADED'),
      isNull(letters.deletedAt)
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
      isNull(letters.deletedAt)
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
 * Main worker loop.
 */
async function main() {
  log.info(
    { pollInterval: POLL_INTERVAL, batchSize: BATCH_SIZE },
    'Background worker starting'
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await processPendingJobs();
    } catch (error) {
      log.error({ err: error }, 'Error in processing cycle');
    }

    await sleep(POLL_INTERVAL);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log.info('Received SIGINT, shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('Received SIGTERM, shutting down');
  process.exit(0);
});

main().catch((error) => {
  log.fatal({ err: error }, 'Fatal error in worker');
  process.exit(1);
});

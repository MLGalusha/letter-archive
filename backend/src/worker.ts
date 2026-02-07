import 'dotenv/config';
import { eq, and, isNull, isNotNull } from 'drizzle-orm';
import { db, letters } from './db/index.js';
import { processLetter, processMetadata } from './pipeline/processor.js';

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
  // Phase 1: Transcription
  const needingTranscription = await findLettersNeedingTranscription();

  for (const letter of needingTranscription) {
    console.log(`[Worker] Processing transcription for letter ${letter.id}`);
    try {
      await processLetter(letter.id);
    } catch (error) {
      console.error(`[Worker] Error processing letter ${letter.id}:`, error);
    }
  }

  // Phase 2: Metadata extraction (only for confirmed transcripts)
  const needingMetadata = await findLettersNeedingMetadata();

  for (const letter of needingMetadata) {
    console.log(`[Worker] Processing metadata for letter ${letter.id}`);
    try {
      await processMetadata(letter.id);
    } catch (error) {
      console.error(`[Worker] Error processing metadata for letter ${letter.id}:`, error);
    }
  }

  const totalProcessed = needingTranscription.length + needingMetadata.length;
  if (totalProcessed > 0) {
    console.log(`[Worker] Processed ${totalProcessed} letters this cycle`);
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
  console.log('[Worker] Starting background worker...');
  console.log(`[Worker] Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`[Worker] Batch size: ${BATCH_SIZE}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await processPendingJobs();
    } catch (error) {
      console.error('[Worker] Error in processing cycle:', error);
    }

    await sleep(POLL_INTERVAL);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[Worker] Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Worker] Received SIGTERM, shutting down...');
  process.exit(0);
});

main().catch((error) => {
  console.error('[Worker] Fatal error:', error);
  process.exit(1);
});

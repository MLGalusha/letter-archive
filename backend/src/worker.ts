import 'dotenv/config';
import { eq, and, isNotNull, inArray } from 'drizzle-orm';
import { db, letters } from './db/index.js';
import { processLetter, processMetadata } from './pipeline/processor.js';
import { runEntityExtractionOnly } from './pipeline/metadataV2.js';
import { createLogger, LOG_DIR, getLogRetentionHours } from './utils/logger.js';
import { TRANSCRIBABLE_TYPES } from './services/letter/shared.js';
import { notify } from './services/notifications.js';
import { recoverOrphanedJobs } from './services/processing-queue.js';
import { setWorkerState, isWorkerPaused } from './services/worker-state.js';

const log = createLogger({ module: 'worker' });

const POLL_INTERVAL = 5000; // 5 seconds
const BATCH_SIZE = 5;

function publishHeartbeat(currentBatchSize: number, lastError: string | null = null): void {
  void setWorkerState({
    lastTickAt: new Date(),
    isPolling: true,
    lastError,
    currentBatchSize,
  });
}

/**
 * When true, the worker drains both queues and then exits cleanly.
 * Used by the Cloud Run Job entry point so the container only lives
 * as long as there is work to do. When false (default), the worker
 * runs as a long-lived polling loop — the local-dev shape.
 */
const EXIT_WHEN_EMPTY = process.env.EXIT_WHEN_EMPTY === 'true';

/**
 * When true, this worker run ignores the worker_state.is_paused flag.
 * Set by the cloud-run-job trigger when an admin explicitly clicks
 * "Process" on a letter — the explicit action overrides the pause.
 */
const BYPASS_PAUSE = process.env.BYPASS_PAUSE === 'true';

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
 * Finds letters that need entity extraction after metadata already succeeded.
 */
async function findLettersNeedingEntityExtraction() {
  return db.query.letters.findMany({
    where: and(
      eq(letters.type, 'L'),
      eq(letters.metadataStatus, 'SUCCESS'),
      eq(letters.entityExtractionStatus, 'PENDING'),
      eq(letters.deadLetter, false),
    ),
    limit: BATCH_SIZE,
    orderBy: (l, { asc }) => [asc(l.createdAt)],
  });
}

/**
 * Returns true when the worker should stop picking up new work because the
 * admin paused processing. Honored between stages and between letters, but
 * never mid-stage — current stage finishes and saves first.
 */
async function shouldStopForPause(): Promise<boolean> {
  if (BYPASS_PAUSE) return false;
  return isWorkerPaused();
}

/**
 * Processes pending jobs. Returns true if any work was found this cycle,
 * false if both queues were empty — the Job-mode main loop uses this
 * signal to decide when to exit.
 */
async function processPendingJobs(): Promise<boolean> {
  const cycleStart = Date.now();

  if (await shouldStopForPause()) {
    log.info('Worker paused — skipping cycle');
    return false;
  }

  // Phase 1: Transcription
  const needingTranscription = await findLettersNeedingTranscription();
  const needingMetadata = await findLettersNeedingMetadata();
  const needingEntityExtraction = await findLettersNeedingEntityExtraction();
  const totalPendingThisCycle =
    needingTranscription.length + needingMetadata.length + needingEntityExtraction.length;

  // Heartbeat: let the admin API observe us.
  publishHeartbeat(totalPendingThisCycle);

  if (needingTranscription.length > 0) {
    log.debug({ count: needingTranscription.length }, 'Found letters needing transcription');
  }

  let pausedMidCycle = false;

  for (const letter of needingTranscription) {
    if (await shouldStopForPause()) { pausedMidCycle = true; break; }
    publishHeartbeat(totalPendingThisCycle);
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting transcription job'
    );
    try {
      await processLetter(letter.id);
      publishHeartbeat(totalPendingThisCycle);
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
      publishHeartbeat(totalPendingThisCycle, message);
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

  if (!pausedMidCycle && (await shouldStopForPause())) {
    pausedMidCycle = true;
  }

  if (needingMetadata.length > 0 && !pausedMidCycle) {
    log.debug({ count: needingMetadata.length }, 'Found letters needing metadata extraction');
  }

  for (const letter of pausedMidCycle ? [] : needingMetadata) {
    if (await shouldStopForPause()) { pausedMidCycle = true; break; }
    publishHeartbeat(totalPendingThisCycle);
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting metadata extraction job'
    );
    try {
      await processMetadata(letter.id);
      publishHeartbeat(totalPendingThisCycle);
      const duration = Date.now() - jobStart;
      log.info({ letterId: letter.id, duration }, 'Metadata extraction job completed');
      // Phase 1 success notification fires from inside metadataV2 — no duplicate here.
    } catch (error) {
      const duration = Date.now() - jobStart;
      const message = error instanceof Error ? error.message : 'Unknown error';
      publishHeartbeat(totalPendingThisCycle, message);
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

  if (needingEntityExtraction.length > 0 && !pausedMidCycle) {
    log.debug({ count: needingEntityExtraction.length }, 'Found letters needing entity extraction');
  }

  for (const letter of pausedMidCycle ? [] : needingEntityExtraction) {
    if (await shouldStopForPause()) { pausedMidCycle = true; break; }
    publishHeartbeat(totalPendingThisCycle);
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting entity extraction job'
    );
    try {
      await runEntityExtractionOnly(letter.id);
      publishHeartbeat(totalPendingThisCycle);
      const duration = Date.now() - jobStart;
      log.info({ letterId: letter.id, duration }, 'Entity extraction job completed');
    } catch (error) {
      const duration = Date.now() - jobStart;
      const message = error instanceof Error ? error.message : 'Unknown error';
      publishHeartbeat(totalPendingThisCycle, message);
      log.error(
        { letterId: letter.id, duration, err: error },
        'Entity extraction job failed'
      );
      void notify({
        type: 'entity_failed',
        title: 'Entity extraction failed',
        message,
        link: `/admin/letters/${letter.id}`,
        sourceType: 'letter',
        sourceId: letter.id,
        metadata: { error: message, durationMs: duration, dateRaw: letter.dateRaw },
        dedupeKey: `entity_failed:${letter.id}`,
      });
    }
  }

  const totalProcessed =
    needingTranscription.length + needingMetadata.length + needingEntityExtraction.length;
  if (totalProcessed > 0) {
    const cycleDuration = Date.now() - cycleStart;
    log.info(
      {
        transcriptionCount: needingTranscription.length,
        metadataCount: needingMetadata.length,
        entityCount: needingEntityExtraction.length,
        totalProcessed,
        cycleDuration,
        pausedMidCycle,
      },
      'Processing cycle completed'
    );
  }

  if (pausedMidCycle) {
    log.info('Worker stopping after current stage — pause flag observed');
    return false;
  }

  return totalProcessed > 0;
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
      mode: EXIT_WHEN_EMPTY ? 'job' : 'poll',
      pollInterval: POLL_INTERVAL,
      batchSize: BATCH_SIZE,
      logDir: LOG_DIR,
      logRetentionHours: getLogRetentionHours(),
    },
    'Background worker starting'
  );

  // Recover any jobs left stuck in RUNNING by a previously-crashed run.
  // Safe to call before processing begins — the compare-and-swap claim
  // still protects against double-processing if another worker is active.
  try {
    await recoverOrphanedJobs();
  } catch (error) {
    log.error({ err: error }, 'Orphan recovery failed; continuing anyway');
  }

  if (!EXIT_WHEN_EMPTY) {
    // Only announce in long-running polling mode — a short-lived Job
    // firing a "started" notification on every run would be noise.
    void notify({
      type: 'system_worker_started',
      title: 'Worker started',
      message: 'Background processing worker is online.',
      metadata: { pollInterval: POLL_INTERVAL, batchSize: BATCH_SIZE },
      dedupeKey: 'system_worker_started',
      dedupeWindowMinutes: 5,
    });
  }

  while (!shuttingDown) {
    let processedAny = false;
    try {
      processedAny = await processPendingJobs();
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
      if (EXIT_WHEN_EMPTY) {
        // In Job mode, surface the failure as a non-zero exit so the
        // Cloud Run Job execution is marked failed and visible.
        process.exit(1);
      }
    }

    if (shuttingDown) break;

    if (EXIT_WHEN_EMPTY) {
      if (!processedAny) {
        log.info('Queues empty, exiting (EXIT_WHEN_EMPTY mode)');
        break;
      }
      // Drain as fast as we can — no poll sleep in Job mode.
      continue;
    }

    await sleep(POLL_INTERVAL);
  }

  void setWorkerState({ isPolling: false });
  log.info({ mode: EXIT_WHEN_EMPTY ? 'job' : 'poll' }, 'Worker loop exited cleanly');
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

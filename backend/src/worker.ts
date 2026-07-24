import 'dotenv/config';
import { eq, and, isNotNull, or } from 'drizzle-orm';
import { db, letters } from './db/index.js';
import { processLetter, processMetadata } from './pipeline/processor.js';
import { runEntityExtractionOnly } from './pipeline/metadataV2.js';
import { tryTranscribeExtras } from './services/letter/extra-content.js';
import { createLogger, LOG_DIR, getLogRetentionHours } from './utils/logger.js';
import { notify } from './services/notifications.js';
import {
  hasQueuedProcessingWork,
  recoverExpiredProcessingJobs,
  requestBackgroundWorkerRun,
} from './services/processing-queue.js';
import {
  createWorkerStatePublisher,
  setWorkerState,
} from './services/worker-state.js';
import {
  createLeaseRecoveryCoordinator,
  decideEmptyWorkerJob,
  decideEmptyWorkerJobWithHandoff,
  projectQueuedRecoveryForWorker,
} from './services/lease-recovery-coordinator.js';
import {
  queuedEntityExtractionConditions,
  queuedExtraContentConditions,
  queuedMetadataConditions,
  queuedTranscriptionConditions,
} from './services/processing-eligibility.js';

const log = createLogger({ module: 'worker' });

const POLL_INTERVAL = 5000; // 5 seconds
const BATCH_SIZE = 5;
const LEASE_RECOVERY_INTERVAL_MS = 60_000;
const workerStatePublisher = createWorkerStatePublisher();

const leaseRecovery = createLeaseRecoveryCoordinator({
  intervalMs: LEASE_RECOVERY_INTERVAL_MS,
  recover: recoverExpiredProcessingJobs,
  onError: (error: unknown) => {
    log.error({ err: error }, 'Expired processing lease recovery failed');
  },
});

async function reconcileQueuedProcessingForExit() {
  const result = await leaseRecovery.reconcile();
  return projectQueuedRecoveryForWorker(result);
}

async function getQueuedProcessingWorkState(): Promise<'pending' | 'leased' | 'none'> {
  if (await hasQueuedProcessingWork()) return 'pending';

  const leased = await db.query.letters.findFirst({
    where: or(
      and(
        eq(letters.transcriptionStatus, 'RUNNING'),
        eq(letters.transcriptionClaimKind, 'QUEUED'),
        isNotNull(letters.transcriptionRunId),
        isNotNull(letters.transcriptionLeaseExpiresAt),
        isNotNull(letters.transcriptionLeaseRunId),
        eq(letters.transcriptionLeaseRunId, letters.transcriptionRunId),
      ),
      and(
        eq(letters.metadataStatus, 'RUNNING'),
        eq(letters.metadataClaimKind, 'QUEUED'),
        isNotNull(letters.metadataRunId),
        isNotNull(letters.metadataRunRevision),
        eq(letters.metadataRunRevision, letters.metadataRevision),
        isNotNull(letters.metadataLeaseExpiresAt),
        isNotNull(letters.metadataLeaseRunId),
        eq(letters.metadataLeaseRunId, letters.metadataRunId),
      ),
      and(
        eq(letters.extraContentJobStatus, 'RUNNING'),
        isNotNull(letters.extraContentJobRunId),
        isNotNull(letters.extraContentJobLeaseExpiresAt),
        isNotNull(letters.extraContentJobLeaseRunId),
        isNotNull(letters.extraContentJobClaimKind),
        eq(letters.extraContentJobLeaseRunId, letters.extraContentJobRunId),
        or(
          eq(letters.extraContentJobClaimKind, 'QUEUED'),
          eq(letters.extraContentJobDirty, true),
        ),
      ),
    ),
    columns: { id: true },
  });
  return leased ? 'leased' : 'none';
}

function publishHeartbeat(currentBatchSize: number, lastError: string | null = null): void {
  workerStatePublisher.publishHeartbeat({
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
 * Finds letters that need transcription (type='L', status='PENDING', not deleted, not dead-letter).
 */
async function findLettersNeedingTranscription() {
  return db.query.letters.findMany({
    where: and(...queuedTranscriptionConditions()),
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
    where: and(...queuedMetadataConditions()),
    limit: BATCH_SIZE,
    orderBy: (l, { asc }) => [asc(l.createdAt)],
  });
}

/**
 * Finds letters that need entity extraction after metadata already succeeded.
 */
async function findLettersNeedingEntityExtraction() {
  return db.query.letters.findMany({
    where: and(...queuedEntityExtractionConditions()),
    limit: BATCH_SIZE,
    orderBy: (l, { asc }) => [asc(l.createdAt)],
  });
}

/**
 * Finds primary letters with queued supplementary-content transcription work.
 */
async function findLettersNeedingExtraContent() {
  return db.query.letters.findMany({
    where: and(...queuedExtraContentConditions()),
    limit: BATCH_SIZE,
    orderBy: (l, { asc }) => [asc(l.createdAt)],
  });
}

/**
 * Processes pending jobs. Returns true if any work was found this cycle,
 * false if both queues were empty — the Job-mode main loop uses this
 * signal to decide when to exit.
 */
async function processPendingJobs(): Promise<boolean> {
  const cycleStart = Date.now();

  // Phase 1: Transcription
  const needingTranscription = await findLettersNeedingTranscription();
  const needingExtraContent = await findLettersNeedingExtraContent();
  const needingMetadata = await findLettersNeedingMetadata();
  const needingEntityExtraction = await findLettersNeedingEntityExtraction();
  const totalPendingThisCycle =
    needingTranscription.length
    + needingExtraContent.length
    + needingMetadata.length
    + needingEntityExtraction.length;

  // Heartbeat: let the admin API observe us.
  publishHeartbeat(totalPendingThisCycle);

  if (needingTranscription.length > 0) {
    log.debug({ count: needingTranscription.length }, 'Found letters needing transcription');
  }

  for (const letter of needingTranscription) {
    publishHeartbeat(totalPendingThisCycle);
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting transcription job'
    );
    try {
      const outcome = await processLetter(letter.id);
      publishHeartbeat(totalPendingThisCycle);
      const duration = Date.now() - jobStart;
      if (outcome) {
        log.info(
          { letterId: letter.id, duration, reason: outcome.reason },
          'Transcription job skipped',
        );
        continue;
      }
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

  if (needingExtraContent.length > 0) {
    log.debug({ count: needingExtraContent.length }, 'Found letters needing extra-content transcription');
  }

  // Process supplementary content before metadata so a metadata claim reloads
  // the latest extra-content transcript and its source revision.
  for (const letter of needingExtraContent) {
    publishHeartbeat(totalPendingThisCycle);
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting extra-content transcription job'
    );
    try {
      const outcome = await tryTranscribeExtras(letter.id, {
        expectedStatus: 'PENDING',
        claimKind: 'QUEUED',
      });
      publishHeartbeat(totalPendingThisCycle);
      const duration = Date.now() - jobStart;
      if (outcome.kind !== 'completed') {
        log.info(
          { letterId: letter.id, duration, reason: outcome.kind },
          'Extra-content transcription job skipped',
        );
        continue;
      }
      log.info({ letterId: letter.id, duration }, 'Extra-content transcription job completed');
    } catch (error) {
      const duration = Date.now() - jobStart;
      const message = error instanceof Error ? error.message : 'Unknown error';
      publishHeartbeat(totalPendingThisCycle, message);
      log.error(
        { letterId: letter.id, duration, err: error },
        'Extra-content transcription job failed'
      );
      void notify({
        type: 'extra_content_failed',
        title: 'Extra-content transcription failed',
        message,
        link: `/admin/letters/${letter.id}`,
        sourceType: 'letter',
        sourceId: letter.id,
        metadata: { error: message, durationMs: duration, dateRaw: letter.dateRaw },
        dedupeKey: `extra_content_failed:${letter.id}`,
      });
    }
  }

  if (needingMetadata.length > 0) {
    log.debug({ count: needingMetadata.length }, 'Found letters needing metadata extraction');
  }

  for (const letter of needingMetadata) {
    publishHeartbeat(totalPendingThisCycle);
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting metadata extraction job'
    );
    try {
      const outcome = await processMetadata(letter.id);
      publishHeartbeat(totalPendingThisCycle);
      const duration = Date.now() - jobStart;
      if (outcome?.kind === 'skipped') {
        log.info(
          { letterId: letter.id, duration, reason: outcome.reason },
          'Metadata extraction job skipped',
        );
        continue;
      }
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

  if (needingEntityExtraction.length > 0) {
    log.debug({ count: needingEntityExtraction.length }, 'Found letters needing entity extraction');
  }

  for (const letter of needingEntityExtraction) {
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
    needingTranscription.length
    + needingExtraContent.length
    + needingMetadata.length
    + needingEntityExtraction.length;
  if (totalProcessed > 0) {
    const cycleDuration = Date.now() - cycleStart;
    log.info(
      {
        transcriptionCount: needingTranscription.length,
        extraContentCount: needingExtraContent.length,
        metadataCount: needingMetadata.length,
        entityCount: needingEntityExtraction.length,
        totalProcessed,
        cycleDuration,
      },
      'Processing cycle completed'
    );
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

  // Only fully-owned leased attempts are safe to recover automatically.
  // Ownerless legacy metadata and entity RUNNING rows remain explicit actions.
  await leaseRecovery.reconcile();
  leaseRecovery.start();

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
        // Cloud Run Job execution is marked failed and retried. Throwing lets
        // the top-level handler settle any active lease recovery before exit.
        throw error;
      }
    }

    if (shuttingDown) break;

    if (EXIT_WHEN_EMPTY) {
      if (!processedAny) {
        // Quiesce the interval before the exit decision so a recovery cannot
        // requeue work between the empty scan and process exit.
        await leaseRecovery.stopAndWait();
        const decision = await decideEmptyWorkerJobWithHandoff({
          decide: () => decideEmptyWorkerJob({
            reconcile: reconcileQueuedProcessingForExit,
            getQueuedWorkState: getQueuedProcessingWorkState,
          }),
          relinquish: () => workerStatePublisher.relinquish({
            lastTickAt: new Date(),
            isPolling: false,
            currentBatchSize: 0,
          }),
        });

        if (decision === 'exit') {
          log.info('Queues empty with no queued processing lease, exiting (EXIT_WHEN_EMPTY mode)');
          break;
        }
        if (shuttingDown) break;
        await workerStatePublisher.resume({
          lastTickAt: new Date(),
          isPolling: true,
          currentBatchSize: 0,
        });
        if (shuttingDown) break;
        leaseRecovery.start();
        if (decision === 'wait') {
          log.info('Queues empty but a queued processing lease remains; waiting for recovery');
          await sleep(POLL_INTERVAL);
        }
      }
      // Drain as fast as we can — no poll sleep in Job mode.
      continue;
    }

    await sleep(POLL_INTERVAL);
  }

  await leaseRecovery.stopAndWait();
  await workerStatePublisher.relinquish({ isPolling: false });
  if (await hasQueuedProcessingWork()) {
    await requestBackgroundWorkerRun('worker-exit-handoff');
  }
  log.info({ mode: EXIT_WHEN_EMPTY ? 'job' : 'poll' }, 'Worker loop exited cleanly');
  process.exit(0);
}

// Handle graceful shutdown — let the current job finish, then exit
function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  void leaseRecovery.stopAndWait();
  log.info({ signal }, 'Shutdown signal received, finishing current job');
  void workerStatePublisher.relinquish({ isPolling: false }).catch((error: unknown) => {
    log.warn({ err: error }, 'Failed to publish worker shutdown state');
  });

  // Force exit after 25s if a job is stuck (Cloud Run default termination is 30s)
  setTimeout(() => {
    log.warn('Forced worker shutdown after timeout');
    process.exit(1);
  }, 25_000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

main().catch(async (error) => {
  await leaseRecovery.stopAndWait();
  try {
    await workerStatePublisher.relinquish({ isPolling: false });
  } catch (stateError) {
    log.error({ err: stateError }, 'Failed to publish worker idle state during fatal exit');
  }
  log.fatal({ err: error }, 'Fatal error in worker');
  process.exit(1);
});

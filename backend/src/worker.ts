import 'dotenv/config';
import { eq, and, isNotNull, or } from 'drizzle-orm';
import { closeDatabase, db, letters } from './db/index.js';
import { processLetter, processMetadata } from './pipeline/processor.js';
import { runEntityExtractionOnly } from './pipeline/metadataV2.js';
import { tryTranscribeExtras } from './services/letter/extra-content.js';
import { createLogger, LOG_DIR, getLogRetentionHours } from './utils/logger.js';
import { notify } from './services/notifications.js';
import {
  ensureBackgroundWorkerForQueuedProcessing,
  hasQueuedProcessingWork,
  recoverExpiredProcessingJobs,
} from './services/processing-queue.js';
import {
  acquireWorkerExecutionLease,
  createWorkerStatePublisher,
  renewWorkerExecutionLease,
  WORKER_EXECUTION_LEASE_MS,
} from './services/worker-state.js';
import {
  createWorkerExecutionHeartbeat,
  type WorkerExecutionHeartbeat,
} from './services/worker-execution-heartbeat.js';
import {
  createLeaseRecoveryCoordinator,
  decideEmptyWorkerJob,
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
const SHUTDOWN_TIMEOUT_MS = 8_000;
type WorkerStatePublisher = ReturnType<typeof createWorkerStatePublisher>;

let shuttingDown = false;
let executionTokenForRecovery: string | null = null;

const leaseRecovery = createLeaseRecoveryCoordinator({
  intervalMs: LEASE_RECOVERY_INTERVAL_MS,
  recover: () => {
    if (!executionTokenForRecovery) {
      throw new Error('Worker recovery requested without execution ownership');
    }
    return recoverExpiredProcessingJobs({
      workerExecutionToken: executionTokenForRecovery,
    });
  },
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

function publishHeartbeat(
  workerStatePublisher: WorkerStatePublisher,
  currentBatchSize: number,
  lastError: string | null = null,
): void {
  workerStatePublisher.publish({
    lastError,
    currentBatchSize,
  });
}

function canStartWorkerOperation(
  executionHeartbeat: WorkerExecutionHeartbeat,
): boolean {
  return !shuttingDown && executionHeartbeat.hasOwnership();
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
async function processPendingJobs(
  executionHeartbeat: WorkerExecutionHeartbeat,
  workerStatePublisher: WorkerStatePublisher,
  executionToken: string,
): Promise<boolean> {
  const cycleStart = Date.now();

  // Queue discovery is deliberately sequential so ownership loss or shutdown
  // can stop later scans before they begin.
  if (!canStartWorkerOperation(executionHeartbeat)) return false;
  const needingTranscription = await findLettersNeedingTranscription();
  if (!canStartWorkerOperation(executionHeartbeat)) return false;
  const needingExtraContent = await findLettersNeedingExtraContent();
  if (!canStartWorkerOperation(executionHeartbeat)) return false;
  const needingMetadata = await findLettersNeedingMetadata();
  if (!canStartWorkerOperation(executionHeartbeat)) return false;
  const needingEntityExtraction = await findLettersNeedingEntityExtraction();
  if (!canStartWorkerOperation(executionHeartbeat)) return false;
  const totalPendingThisCycle =
    needingTranscription.length
    + needingExtraContent.length
    + needingMetadata.length
    + needingEntityExtraction.length;

  // Heartbeat: let the admin API observe us.
  publishHeartbeat(workerStatePublisher, totalPendingThisCycle);

  if (needingTranscription.length > 0) {
    log.debug({ count: needingTranscription.length }, 'Found letters needing transcription');
  }

  for (const letter of needingTranscription) {
    if (!canStartWorkerOperation(executionHeartbeat)) {
      return totalPendingThisCycle > 0;
    }
    publishHeartbeat(workerStatePublisher, totalPendingThisCycle);
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting transcription job'
    );
    try {
      const outcome = await processLetter(letter.id, {
        extraContent: 'skip',
        workerExecutionToken: executionToken,
      });
      publishHeartbeat(workerStatePublisher, totalPendingThisCycle);
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
      publishHeartbeat(workerStatePublisher, totalPendingThisCycle, message);
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
    if (!canStartWorkerOperation(executionHeartbeat)) {
      return totalPendingThisCycle > 0;
    }
    publishHeartbeat(workerStatePublisher, totalPendingThisCycle);
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting extra-content transcription job'
    );
    try {
      const outcome = await tryTranscribeExtras(letter.id, {
        expectedStatus: 'PENDING',
        claimKind: 'QUEUED',
        workerExecutionToken: executionToken,
      });
      publishHeartbeat(workerStatePublisher, totalPendingThisCycle);
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
      publishHeartbeat(workerStatePublisher, totalPendingThisCycle, message);
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
    if (!canStartWorkerOperation(executionHeartbeat)) {
      return totalPendingThisCycle > 0;
    }
    publishHeartbeat(workerStatePublisher, totalPendingThisCycle);
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting metadata extraction job'
    );
    try {
      const outcome = await processMetadata(letter.id, {
        entityExtraction: 'deferred',
        workerExecutionToken: executionToken,
      });
      publishHeartbeat(workerStatePublisher, totalPendingThisCycle);
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
      publishHeartbeat(workerStatePublisher, totalPendingThisCycle, message);
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
    if (!canStartWorkerOperation(executionHeartbeat)) {
      return totalPendingThisCycle > 0;
    }
    publishHeartbeat(workerStatePublisher, totalPendingThisCycle);
    const jobStart = Date.now();
    log.info(
      { letterId: letter.id, collectionId: letter.collectionId, dateRaw: letter.dateRaw },
      'Starting entity extraction job'
    );
    try {
      await runEntityExtractionOnly(letter.id, {
        workerExecutionToken: executionToken,
      });
      publishHeartbeat(workerStatePublisher, totalPendingThisCycle);
      const duration = Date.now() - jobStart;
      log.info({ letterId: letter.id, duration }, 'Entity extraction job completed');
    } catch (error) {
      const duration = Date.now() - jobStart;
      const message = error instanceof Error ? error.message : 'Unknown error';
      publishHeartbeat(workerStatePublisher, totalPendingThisCycle, message);
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

  // Start the local safety window when acquisition begins. A slow database
  // response must shorten—not extend—our belief that the lease remains live.
  const acquisitionStartedAtMs = performance.now();
  const executionLease = await acquireWorkerExecutionLease();
  if (!executionLease) {
    log.info('Another worker execution owns the processing lease; exiting');
    return;
  }
  executionTokenForRecovery = executionLease.token;

  const workerStatePublisher = createWorkerStatePublisher(executionLease.token);
  const executionHeartbeat = createWorkerExecutionHeartbeat({
    renew: () => renewWorkerExecutionLease(executionLease.token),
    onRenewalError: (error: unknown) => {
      log.warn({ err: error }, 'Worker execution lease renewal failed');
    },
    onOwnershipLost: () => {
      log.warn('Worker execution lease lost; stopping future processing work');
      void leaseRecovery.stopAndWait();
    },
    leaseDurationMs: WORKER_EXECUTION_LEASE_MS,
    initialConfirmationStartedAtMs: acquisitionStartedAtMs,
  });
  let completedNormally = false;

  try {
    if (canStartWorkerOperation(executionHeartbeat)) {
      // Only the singleton execution owner may recover or scan durable queues.
      // Ownerless legacy metadata and entity RUNNING rows remain explicit actions.
      await leaseRecovery.reconcile();
      if (canStartWorkerOperation(executionHeartbeat)) {
        leaseRecovery.start();
      }
    }

    if (!EXIT_WHEN_EMPTY && canStartWorkerOperation(executionHeartbeat)) {
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

    while (canStartWorkerOperation(executionHeartbeat)) {
      let processedAny = false;
      try {
        processedAny = await processPendingJobs(
          executionHeartbeat,
          workerStatePublisher,
          executionLease.token,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ err: error }, 'Error in processing cycle');
        workerStatePublisher.publish({ lastError: message });
        void notify({
          type: 'system_worker_error',
          title: 'Worker processing cycle failed',
          message,
          metadata: { error: message },
          dedupeKey: 'system_worker_error',
          dedupeWindowMinutes: 30,
        });
        if (EXIT_WHEN_EMPTY) {
          // Surface the failure so Cloud Run marks the execution failed and
          // applies its configured retry policy.
          throw error;
        }
      }

      if (!canStartWorkerOperation(executionHeartbeat)) break;

      if (EXIT_WHEN_EMPTY) {
        if (!processedAny) {
          // Quiesce periodic recovery while making the final durable decision.
          await leaseRecovery.stopAndWait();
          if (!canStartWorkerOperation(executionHeartbeat)) break;

          const decision = await decideEmptyWorkerJob({
            reconcile: async () => {
              if (!canStartWorkerOperation(executionHeartbeat)) return null;
              return reconcileQueuedProcessingForExit();
            },
            getQueuedWorkState: async () => {
              if (!canStartWorkerOperation(executionHeartbeat)) return 'none';
              return getQueuedProcessingWorkState();
            },
          });

          if (!canStartWorkerOperation(executionHeartbeat)) break;
          if (decision === 'exit') {
            log.info('Queues empty with no queued processing lease, exiting (EXIT_WHEN_EMPTY mode)');
            break;
          }

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

    completedNormally = true;
  } finally {
    // Keep renewal alive until the current fenced stage and recovery call have
    // settled, then quiesce both loops before the exact-token terminal release.
    await leaseRecovery.stopAndWait();
    await executionHeartbeat.stopAndWait();
    const released = await workerStatePublisher.release({
      currentBatchSize: 0,
    });
    executionTokenForRecovery = null;

    if (completedNormally && released) {
      // This required post-release database recheck closes the race with work
      // committed while producers still observed our execution lease.
      await ensureBackgroundWorkerForQueuedProcessing('worker-exit-handoff');
    }
  }

  log.info({ mode: EXIT_WHEN_EMPTY ? 'job' : 'poll' }, 'Worker loop exited cleanly');
}

// Handle graceful shutdown — let the current job finish, then exit
function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  void leaseRecovery.stopAndWait();
  log.info({ signal }, 'Shutdown signal received, finishing current job');

  // Cloud Run can send SIGKILL ten seconds after a task-timeout SIGTERM. Exit
  // nonzero with a small buffer, deliberately leaving the execution token to
  // expire rather than releasing while an AI call may still be active.
  setTimeout(() => {
    log.warn('Forced worker shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

main().then(async () => {
  await closeDatabase();
  process.exit(0);
}).catch(async (error) => {
  log.fatal({ err: error }, 'Fatal error in worker');
  try {
    await closeDatabase();
  } catch (closeError) {
    log.error({ err: closeError }, 'Failed to close database during fatal exit');
  }
  process.exit(1);
});

import 'dotenv/config';
import { eq, and, isNotNull, or } from 'drizzle-orm';
import { closeDatabase, db, letters } from './db/index.js';
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
  processWorkerCycle,
  WORKER_BATCH_SIZE,
} from './services/worker-processing-cycle.js';
import {
  createLeaseRecoveryCoordinator,
  decideEmptyWorkerJob,
  projectQueuedRecoveryForWorker,
} from './services/lease-recovery-coordinator.js';

const log = createLogger({ module: 'worker' });

const POLL_INTERVAL = 5000; // 5 seconds
const LEASE_RECOVERY_INTERVAL_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;

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

function canStartWorkerOperation(
  executionHeartbeat: WorkerExecutionHeartbeat,
): boolean {
  return !shuttingDown && executionHeartbeat.hasOwnership();
}

/**
 * When true, the worker drains the durable stage queues and then exits cleanly.
 * Used by the Cloud Run Job entry point so the container only lives
 * as long as there is work to do. When false (default), the worker
 * runs as a long-lived polling loop — the local-dev shape.
 */
const EXIT_WHEN_EMPTY = process.env.EXIT_WHEN_EMPTY === 'true';

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
      batchSize: WORKER_BATCH_SIZE,
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
        metadata: {
          pollInterval: POLL_INTERVAL,
          batchSize: WORKER_BATCH_SIZE,
        },
        dedupeKey: 'system_worker_started',
        dedupeWindowMinutes: 5,
      });
    }

    while (canStartWorkerOperation(executionHeartbeat)) {
      let discoveredWork = false;
      try {
        discoveredWork = await processWorkerCycle({
          executionToken: executionLease.token,
          canStartOperation: () => canStartWorkerOperation(executionHeartbeat),
          publishState: update => workerStatePublisher.publish(update),
        });
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
        if (!discoveredWork) {
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

import { createLogger } from '../../utils/logger.js';
import { notify } from '../notifications.js';
import type {
  ActiveBatchState,
  BatchContext,
  ProcessConfig,
  ProcessKey,
  ProcessingEvent,
} from './types.js';
import { ProcessingError } from './types.js';

const log = createLogger({ module: 'process-runner' });

// ============================================================================
// Single global batch mutex — one batch across all processes at a time.
// ============================================================================

let activeBatch: ActiveBatchState | null = null;

/**
 * Bounded ring buffer of recent batch errors. Replaces the unbounded
 * `errors[]` array in the legacy processing-queue, which leaked over long
 * uptimes.
 */
const MAX_ERRORS = 100;
const recentErrors: string[] = [];

function pushError(msg: string): void {
  recentErrors.push(msg);
  if (recentErrors.length > MAX_ERRORS) {
    recentErrors.splice(0, recentErrors.length - MAX_ERRORS);
  }
}

export function getRecentErrors(): readonly string[] {
  return recentErrors;
}

export function getActiveBatch(): ActiveBatchState | null {
  return activeBatch;
}

export function isBatchRunning(): boolean {
  return activeBatch !== null;
}

// ============================================================================
// Job progress tracking (shared with pipeline stages via re-export)
// ============================================================================

export interface JobProgress {
  letterId: string;
  type: string;
  step: number;
  totalSteps: number;
  stepLabel: string;
}

const jobProgressMap = new Map<string, JobProgress>();

export function updateJobProgress(
  letterId: string,
  type: string,
  step: number,
  totalSteps: number,
  stepLabel: string
): void {
  jobProgressMap.set(`${letterId}-${type}`, { letterId, type, step, totalSteps, stepLabel });
}

export function clearJobProgress(letterId: string, type: string): void {
  jobProgressMap.delete(`${letterId}-${type}`);
}

export function getJobProgress(letterId: string, type: string): JobProgress | undefined {
  return jobProgressMap.get(`${letterId}-${type}`);
}

// ============================================================================
// Event broadcaster — the SSE route registers its broadcast fn here.
// ============================================================================

type Broadcaster = (event: ProcessingEvent) => void;
const broadcasters = new Set<Broadcaster>();

export function registerBroadcaster(fn: Broadcaster): () => void {
  broadcasters.add(fn);
  return () => {
    broadcasters.delete(fn);
  };
}

export function emitEvent(event: ProcessingEvent): void {
  for (const fn of broadcasters) {
    try {
      fn(event);
    } catch (err) {
      log.warn({ err }, 'Broadcaster threw while emitting processing event');
    }
  }
}

// ============================================================================
// Pipeline cooperation primitives
// ============================================================================

/** Pipeline stages poll this to cooperate with abort requests. */
export function shouldAbortProcessing(): boolean {
  return activeBatch?.shouldAbort === true;
}

/** True if the batch is currently paused. */
export function isBatchPaused(): boolean {
  return activeBatch?.isPaused === true;
}

// ============================================================================
// Batch lifecycle — start / pause / resume / abort
// ============================================================================

export interface StartBatchOptions<Filters extends object> {
  config: ProcessConfig<Filters>;
  letterIds: string[];
}

/**
 * Start a batch for the given process. Throws ProcessingError(409) if a batch
 * is already running. Runs in the background; returns once the batch has been
 * registered (not once it finishes).
 */
export function startBatch<Filters extends object>(
  options: StartBatchOptions<Filters>
): ActiveBatchState {
  if (activeBatch) {
    throw new ProcessingError('A batch is already running', 409);
  }
  if (options.letterIds.length === 0) {
    throw new ProcessingError('No letters match the current filters', 400);
  }

  const startedAt = new Date().toISOString();
  activeBatch = {
    processKey: options.config.key,
    total: options.letterIds.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    isPaused: false,
    shouldAbort: false,
    startedAt,
    lastProgressAt: null,
    currentJob: null,
  };

  emitEvent({
    type: 'batch-started',
    processKey: options.config.key,
    total: options.letterIds.length,
    startedAt,
  });
  emitEvent({ type: 'status-updated' });

  // Fire and forget — the runner loop owns lifecycle.
  void runBatchLoop(options.config, options.letterIds);

  return activeBatch;
}

async function runBatchLoop<Filters extends object>(
  config: ProcessConfig<Filters>,
  letterIds: string[]
): Promise<void> {
  const batchStart = Date.now();
  log.info(
    { processKey: config.key, count: letterIds.length },
    'Batch started'
  );

  const ctx: BatchContext = {
    onProgress: (step, totalSteps, stepLabel) => {
      const current = activeBatch?.currentJob;
      if (!current) return;
      updateJobProgress(current.letterId, config.key, step, totalSteps, stepLabel);
      emitEvent({
        type: 'batch-progress',
        processKey: config.key,
        completed: activeBatch?.completed ?? 0,
        failed: activeBatch?.failed ?? 0,
        skipped: activeBatch?.skipped ?? 0,
        total: activeBatch?.total ?? 0,
        currentLetterId: current.letterId,
        stepLabel,
      });
    },
    shouldAbort: () => shouldAbortProcessing(),
    waitWhilePaused: async () => {
      while (isBatchPaused() && !shouldAbortProcessing()) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    },
    emit: emitEvent,
  };

  try {
    const result = await config.runBatch(letterIds, ctx);
    const durationMs = Date.now() - batchStart;

    if (activeBatch?.shouldAbort) {
      emitEvent({ type: 'batch-aborted', processKey: config.key });
      log.info(
        {
          processKey: config.key,
          completed: result.completed,
          failed: result.failed,
          skipped: result.skipped,
        },
        'Batch aborted'
      );
    } else {
      emitEvent({
        type: 'batch-completed',
        processKey: config.key,
        completed: result.completed,
        failed: result.failed,
        skipped: result.skipped,
        durationMs,
      });
      log.info(
        {
          processKey: config.key,
          completed: result.completed,
          failed: result.failed,
          skipped: result.skipped,
          durationMs,
        },
        'Batch completed'
      );
    }

    // Batch completion notification (only for multi-letter batches)
    if (letterIds.length > 1) {
      void notify({
        type: 'batch_complete',
        severity: result.failed > 0 ? 'warn' : 'info',
        title: 'Batch complete',
        message: `${result.completed} succeeded, ${result.failed} failed, ${result.skipped} skipped (${config.label})`,
        link: '/admin/processing',
        metadata: {
          succeeded: result.completed,
          failed: result.failed,
          skipped: result.skipped,
          total: letterIds.length,
          processKey: config.key,
          durationMs,
        },
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pushError(`batch: ${msg}`);
    log.error({ err, processKey: config.key }, 'Batch loop crashed');
    emitEvent({ type: 'batch-aborted', processKey: config.key });
  } finally {
    activeBatch = null;
    emitEvent({ type: 'status-updated' });
  }
}

/** Pause the currently-running batch. */
export function pauseBatch(): void {
  if (!activeBatch) {
    throw new ProcessingError('No batch is running', 409);
  }
  if (activeBatch.isPaused) return;
  activeBatch.isPaused = true;
  emitEvent({ type: 'batch-paused', processKey: activeBatch.processKey });
  emitEvent({ type: 'status-updated' });
  log.info({ processKey: activeBatch.processKey }, 'Batch paused');
}

/** Resume a paused batch. */
export function resumeBatch(): void {
  if (!activeBatch) {
    throw new ProcessingError('No batch is running', 409);
  }
  if (!activeBatch.isPaused) return;
  activeBatch.isPaused = false;
  emitEvent({ type: 'batch-resumed', processKey: activeBatch.processKey });
  emitEvent({ type: 'status-updated' });
  log.info({ processKey: activeBatch.processKey }, 'Batch resumed');
}

/** Request abort of the currently-running batch. Returns once flag is set. */
export function abortBatch(): void {
  if (!activeBatch) {
    throw new ProcessingError('No batch is running', 409);
  }
  activeBatch.shouldAbort = true;
  // If paused, un-pause so the loop can observe the abort flag.
  activeBatch.isPaused = false;
  emitEvent({ type: 'status-updated' });
  log.info({ processKey: activeBatch.processKey }, 'Batch abort requested');
}

/**
 * Internal hook used by `ProcessConfig.runBatch` implementations to record
 * per-job outcomes against the active batch. Safe to call when no batch is
 * active (no-op).
 */
export function recordJobStart(letterId: string): void {
  if (!activeBatch) return;
  activeBatch.currentJob = { letterId };
  activeBatch.lastProgressAt = new Date().toISOString();
  emitEvent({ type: 'job-started', processKey: activeBatch.processKey, letterId });
}

export function recordJobCompleted(letterId: string, durationMs: number): void {
  if (!activeBatch) return;
  activeBatch.completed += 1;
  activeBatch.lastProgressAt = new Date().toISOString();
  activeBatch.currentJob = null;
  emitEvent({
    type: 'job-completed',
    processKey: activeBatch.processKey,
    letterId,
    durationMs,
  });
  emitEvent({
    type: 'batch-progress',
    processKey: activeBatch.processKey,
    completed: activeBatch.completed,
    failed: activeBatch.failed,
    skipped: activeBatch.skipped,
    total: activeBatch.total,
    currentLetterId: null,
    stepLabel: null,
  });
}

export function recordJobFailed(letterId: string, error: string): void {
  if (!activeBatch) return;
  activeBatch.failed += 1;
  activeBatch.lastProgressAt = new Date().toISOString();
  activeBatch.currentJob = null;
  pushError(`${letterId}: ${error}`);
  emitEvent({
    type: 'job-failed',
    processKey: activeBatch.processKey,
    letterId,
    error,
  });
  emitEvent({
    type: 'batch-progress',
    processKey: activeBatch.processKey,
    completed: activeBatch.completed,
    failed: activeBatch.failed,
    skipped: activeBatch.skipped,
    total: activeBatch.total,
    currentLetterId: null,
    stepLabel: null,
  });
}

export function recordJobSkipped(letterId: string, reason: string): void {
  if (!activeBatch) return;
  activeBatch.skipped += 1;
  activeBatch.lastProgressAt = new Date().toISOString();
  activeBatch.currentJob = null;
  log.info({ letterId, processKey: activeBatch.processKey, reason }, 'Job skipped');
  emitEvent({
    type: 'batch-progress',
    processKey: activeBatch.processKey,
    completed: activeBatch.completed,
    failed: activeBatch.failed,
    skipped: activeBatch.skipped,
    total: activeBatch.total,
    currentLetterId: null,
    stepLabel: null,
  });
}

/** Emit a `queue-changed` event so clients refetch the queue drawer. */
export function notifyQueueChanged(processKey: ProcessKey): void {
  emitEvent({ type: 'queue-changed', processKey });
  emitEvent({ type: 'status-updated' });
}

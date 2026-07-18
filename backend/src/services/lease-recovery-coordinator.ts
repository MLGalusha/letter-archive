export interface WorkerTranscriptionRecoveryResult {
  requeued: readonly unknown[];
  failed: readonly unknown[];
}

export type EmptyWorkerJobDecision = 'drain' | 'wait' | 'exit';
export type QueuedTranscriptionWorkState = 'pending' | 'leased' | 'none';

export function projectTranscriptionRecoveryForWorker<
  T extends { transcription: WorkerTranscriptionRecoveryResult },
>(
  result: T | null,
): WorkerTranscriptionRecoveryResult | null {
  return result?.transcription ?? null;
}

interface RecoveryCoordinatorOptions<T> {
  intervalMs: number;
  recover(): Promise<T>;
  onError(error: unknown): void;
}

/**
 * Serializes startup, periodic, and shutdown reconciliation behind one in-flight
 * promise. It is intentionally unaware of stage-specific recovery policy.
 */
export function createLeaseRecoveryCoordinator<T>(
  options: RecoveryCoordinatorOptions<T>,
) {
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<T | null> | null = null;

  function reconcile(): Promise<T | null> {
    if (inFlight) return inFlight;

    inFlight = Promise.resolve()
      .then(options.recover)
      .catch((error: unknown) => {
        options.onError(error);
        return null;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => {
      void reconcile();
    }, options.intervalMs);
    timer.unref();
  }

  async function stopAndWait(): Promise<void> {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const active = inFlight;
    if (active) await active;
  }

  return { reconcile, start, stopAndWait };
}

/**
 * Requested and extra-content leases deliberately do not keep an
 * EXIT_WHEN_EMPTY worker alive. Only pending or leased queued main transcription
 * is work this worker can drain.
 */
export async function decideEmptyWorkerJob(options: {
  reconcile(): Promise<WorkerTranscriptionRecoveryResult | null>;
  getQueuedWorkState(): Promise<QueuedTranscriptionWorkState>;
}): Promise<EmptyWorkerJobDecision> {
  const recovered = await options.reconcile();
  if ((recovered?.requeued.length ?? 0) > 0) return 'drain';
  const workState = await options.getQueuedWorkState();
  if (workState === 'pending') return 'drain';
  return workState === 'leased' ? 'wait' : 'exit';
}

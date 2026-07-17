export interface WorkerTranscriptionRecoveryResult {
  requeued: readonly unknown[];
  failed: readonly unknown[];
}

export type EmptyWorkerJobDecision = 'drain' | 'wait' | 'exit';
export type QueuedTranscriptionWorkState = 'pending' | 'leased' | 'none';

interface RecoveryCoordinatorOptions<T extends WorkerTranscriptionRecoveryResult> {
  intervalMs: number;
  recover(): Promise<T>;
  onError(error: unknown): void;
}

/**
 * Serializes startup, periodic, and exit-boundary reconciliation behind one
 * in-flight promise. Stopping the timer also waits for a reconciliation that
 * already reached the database.
 */
export function createWorkerTranscriptionRecovery<T extends WorkerTranscriptionRecoveryResult>(
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
 * Decides what an EXIT_WHEN_EMPTY worker should do after an empty queue scan.
 * Requested leases are deliberately absent from getQueuedWorkState(): their
 * caller owns the synchronous contract, so they must not keep a worker Job alive.
 * The pending state also closes the handoff race where another reconciler wins
 * the expired-lease update after this worker's preceding queue snapshot.
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

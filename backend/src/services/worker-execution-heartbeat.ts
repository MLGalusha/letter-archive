const DEFAULT_RENEWAL_INTERVAL_MS = 30_000;
const DEFAULT_STOP_WAIT_MS = 5_000;

export interface WorkerExecutionHeartbeat {
  /**
   * False once the database rejects renewal or the last confirmed lease window
   * has elapsed. The deadline uses a monotonic process clock and is deliberately
   * conservative: it starts when the database request starts, not when it returns.
   */
  hasOwnership(): boolean;
  /** Stops future renewal and settles the currently accepted renewal, if any. */
  stopAndWait(): Promise<void>;
}

interface WorkerExecutionHeartbeatOptions {
  renew(): Promise<boolean>;
  onRenewalError(error: unknown): void;
  onOwnershipLost?(): void;
  leaseDurationMs: number;
  initialConfirmationStartedAtMs: number;
  intervalMs?: number;
  stopWaitMs?: number;
  now?: () => number;
}

/**
 * Maintains the worker-wide execution lease independently of queue scans and
 * long-running AI calls. Renewal requests never overlap.
 *
 * A false renewal is authoritative. Exceptions are retried only while the last
 * confirmed lease window remains locally safe; a hung request cannot make the
 * process believe it owns an already-expired database lease.
 */
export function createWorkerExecutionHeartbeat(
  options: WorkerExecutionHeartbeatOptions,
): WorkerExecutionHeartbeat {
  const now = options.now ?? (() => performance.now());
  const intervalMs = options.intervalMs ?? DEFAULT_RENEWAL_INTERVAL_MS;
  const stopWaitMs = options.stopWaitMs ?? DEFAULT_STOP_WAIT_MS;
  let confirmedUntilMs =
    options.initialConfirmationStartedAtMs + options.leaseDurationMs;
  let stopped = false;
  let ownershipLost = false;
  let inFlight: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;

  const markOwnershipLost = (): void => {
    if (ownershipLost) return;
    ownershipLost = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    options.onOwnershipLost?.();
  };

  const hasOwnership = (): boolean => {
    if (!ownershipLost && now() >= confirmedUntilMs) {
      markOwnershipLost();
    }
    return !ownershipLost;
  };

  const startRenewal = (): void => {
    if (stopped || ownershipLost) return;
    if (!hasOwnership() || inFlight !== null) return;

    const confirmationStartedAtMs = now();
    const renewal = Promise.resolve()
      .then(options.renew)
      .then((renewed) => {
        if (!renewed) {
          markOwnershipLost();
          return;
        }

        // The database extends from its own clock during this request. Starting
        // our local window before the request is conservative under latency.
        confirmedUntilMs =
          confirmationStartedAtMs + options.leaseDurationMs;
        hasOwnership();
      })
      .catch((error: unknown) => {
        options.onRenewalError(error);
        hasOwnership();
      })
      .finally(() => {
        if (inFlight === renewal) inFlight = null;
      });

    inFlight = renewal;
  };

  timer = setInterval(startRenewal, intervalMs);
  timer.unref();

  // Confirm ownership immediately instead of spending one interval blind.
  startRenewal();

  return {
    hasOwnership,
    async stopAndWait(): Promise<void> {
      if (!stopped) {
        stopped = true;
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      }
      const active = inFlight;
      if (active === null) return;

      // A database request can outlive both its client connect timeout and our
      // last confirmed lease window. Cleanup must not wait until the one-hour
      // Cloud Run task timeout before releasing/rechecking durable work.
      const waitMs = Math.max(
        0,
        Math.min(stopWaitMs, confirmedUntilMs - now()),
      );
      if (waitMs === 0) {
        markOwnershipLost();
        return;
      }

      let timeout: NodeJS.Timeout | null = null;
      const timedOut = await Promise.race([
        active.then(() => false),
        new Promise<true>((resolve) => {
          timeout = setTimeout(() => resolve(true), waitMs);
        }),
      ]);
      if (timeout !== null) clearTimeout(timeout);
      if (timedOut) markOwnershipLost();
    },
  };
}

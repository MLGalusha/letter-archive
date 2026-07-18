const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export interface LeaseHeartbeat {
  /** False once a renewal authoritatively says this attempt no longer owns its lease. */
  hasOwnership(): boolean;
}

interface LeaseHeartbeatOptions {
  renew(): Promise<boolean>;
  onRenewalError(error: unknown): void;
  intervalMs?: number;
}

/**
 * Keeps one lease alive without allowing renewal calls to overlap.
 *
 * A false renewal is authoritative and permanently stops the heartbeat. A
 * transient exception leaves ownership unknown and retries on the next tick;
 * stage-specific live-lease predicates remain the terminal authority.
 */
export async function withLeaseHeartbeat<T>(
  options: LeaseHeartbeatOptions,
  operation: (heartbeat: LeaseHeartbeat) => Promise<T>,
): Promise<T> {
  let stopped = false;
  let ownershipLost = false;
  let inFlight: Promise<void> | null = null;

  const timer = setInterval(() => {
    startRenewal();
  }, options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  timer.unref();

  function stop(): void {
    stopped = true;
    clearInterval(timer);
  }

  function startRenewal(): void {
    if (stopped || inFlight !== null) return;

    const renewal = options.renew()
      .then((renewed) => {
        if (!renewed) {
          ownershipLost = true;
          stop();
        }
      })
      .catch((error: unknown) => {
        options.onRenewalError(error);
      })
      .finally(() => {
        if (inFlight === renewal) inFlight = null;
      });

    inFlight = renewal;
  }

  // Confirm ownership immediately instead of spending one full interval blind.
  startRenewal();

  try {
    return await operation({ hasOwnership: () => !ownershipLost });
  } finally {
    stop();
    const pendingRenewal = inFlight;
    if (pendingRenewal !== null) await pendingRenewal;
  }
}

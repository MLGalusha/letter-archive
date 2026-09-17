import { performance } from 'node:perf_hooks';
type ReadinessOutcome = 'connected' | 'unexpected-response' | 'disconnected';

/** Monotonic diagnostics only; never gates readiness or starts work. */
export function createStartupTiming(now: () => number = () => performance.now()) {
  let bootstrapAt: number | undefined;
  let listeningAt: number | undefined;
  let attempts = 0;
  let reportedSuccess = false;
  const snapshot = () => bootstrapAt === undefined ? null : {
    bootstrapElapsedMs: Math.round(now() - bootstrapAt),
    ...(listeningAt === undefined ? {} : { listeningElapsedMs: Math.round(now() - listeningAt) }),
  };
  return {
    markBootstrap() { bootstrapAt ??= now(); },
    markListening() { listeningAt ??= now(); },
    snapshot,
    startReadinessAttempt(): (outcome: ReadinessOutcome) => Record<string, unknown> | null {
      if (bootstrapAt === undefined) return () => null;
      const attempt = ++attempts;
      const startedAt = now();
      let finished = false;
      return (outcome: ReadinessOutcome) => {
        if (finished) return null;
        finished = true;
        const firstSuccess = outcome === 'connected' && !reportedSuccess;
        if (firstSuccess) reportedSuccess = true;
        if (attempt !== 1 && !firstSuccess) return null;
        return { ...snapshot(), readinessAttempt: attempt,
          readinessQueryMs: Math.round(now() - startedAt), readinessOutcome: outcome,
          firstSuccessfulReadiness: firstSuccess };
      };
    },
  };
}
export const startupTiming = createStartupTiming();

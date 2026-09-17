import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getProcessingQueueStatus,
  type ProcessingQueueStatus,
} from '../api/admin/processing';

export const PROCESSING_POLL_INTERVAL_MS = 5_000;
export const PROCESSING_IDLE_INTERVAL_MS = 30_000;

export interface UseProcessingStateResult {
  status: ProcessingQueueStatus | null;
  loading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
}

interface ProcessingRefreshRun {
  promise: Promise<void>;
  invalidated: boolean;
  controller: AbortController;
}

/**
 * Owns the Processing page's durable queue snapshot. Polls only after the
 * previous request settles so slow responses cannot create overlapping reads.
 */
export function useProcessingState(): UseProcessingStateResult {
  const [status, setStatus] = useState<ProcessingQueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const mounted = useRef(true);
  const refreshInFlight = useRef<ProcessingRefreshRun | null>(null);
  const interval = useRef(PROCESSING_POLL_INTERVAL_MS);
  const scheduleNext = useRef<(() => void) | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (!mounted.current) return Promise.resolve();
    if (refreshInFlight.current && !refreshInFlight.current.controller.signal.aborted) {
      refreshInFlight.current.invalidated = true;
      return refreshInFlight.current.promise;
    }

    let resolveRun!: () => void;
    let rejectRun!: (reason: unknown) => void;
    const run: ProcessingRefreshRun = {
      invalidated: false,
      controller: new AbortController(),
      promise: new Promise<void>((resolve, reject) => {
        resolveRun = resolve;
        rejectRun = reject;
      }),
    };
    refreshInFlight.current = run;

    void (async () => {
      if (mounted.current) setLoading(true);
      try {
        do {
          run.invalidated = false;
          try {
            const data = await getProcessingQueueStatus(run.controller.signal);
            if (!mounted.current || run.controller.signal.aborted) return;
            if (run.invalidated) continue;
            const counts = data.counts;
            interval.current = counts.activeCount + counts.queuedTranscription + counts.queuedMetadata
              + counts.queuedEntityExtraction + counts.queuedExtraContent > 0
              ? PROCESSING_POLL_INTERVAL_MS : PROCESSING_IDLE_INTERVAL_MS;
            setStatus(data);
            setError(null);
            setLastUpdatedAt(Date.now());
          } catch (err) {
            if (!mounted.current || run.controller.signal.aborted) return;
            if (run.invalidated) continue;
            interval.current = PROCESSING_IDLE_INTERVAL_MS;
            setError(
              err instanceof Error
                ? err.message
                : 'Failed to load processing status',
            );
          }
        } while (mounted.current && !run.controller.signal.aborted && run.invalidated);
      } finally {
        if (mounted.current && !run.controller.signal.aborted) setLoading(false);
        if (refreshInFlight.current === run) {
          refreshInFlight.current = null;
          scheduleNext.current?.();
        }
      }
    })().then(resolveRun, rejectRun);

    return run.promise;
  }, []);

  useEffect(() => {
    mounted.current = true;
    let timer: number | null = null;
    let wasHidden = document.visibilityState !== 'visible';
    const clearTimer = () => { if (timer !== null) window.clearTimeout(timer); timer = null; };
    scheduleNext.current = () => {
      clearTimer();
      if (document.visibilityState === 'visible') {
        timer = window.setTimeout(() => { void refresh(); }, interval.current);
      }
    };
    const wake = () => {
      const hidden = document.visibilityState !== 'visible';
      clearTimer();
      if (!hidden && (!refreshInFlight.current || refreshInFlight.current.controller.signal.aborted || wasHidden)) void refresh();
      wasHidden = hidden;
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    wake();
    return () => {
      mounted.current = false;
      scheduleNext.current = null;
      clearTimer();
      refreshInFlight.current?.controller.abort();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [refresh]);

  return {
    status,
    loading,
    error,
    lastUpdatedAt,
    refresh,
  };
}

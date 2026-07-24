import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getProcessingQueueStatus,
  type ProcessingQueueStatus,
} from '../api/admin/processing';

export const PROCESSING_POLL_INTERVAL_MS = 5_000;

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

  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlight.current) {
      refreshInFlight.current.invalidated = true;
      return refreshInFlight.current.promise;
    }

    let resolveRun!: () => void;
    let rejectRun!: (reason: unknown) => void;
    const run: ProcessingRefreshRun = {
      invalidated: false,
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
            const data = await getProcessingQueueStatus();
            if (!mounted.current) return;
            setStatus(data);
            setError(null);
            setLastUpdatedAt(Date.now());
          } catch (err) {
            if (!mounted.current) return;
            setError(
              err instanceof Error
                ? err.message
                : 'Failed to load processing status',
            );
          }
        } while (mounted.current && run.invalidated);
      } finally {
        if (mounted.current) setLoading(false);
        if (refreshInFlight.current === run) {
          refreshInFlight.current = null;
        }
      }
    })().then(resolveRun, rejectRun);

    return run.promise;
  }, []);

  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: number | null = null;

    const poll = async () => {
      await refresh();
      if (!stopped) {
        timer = window.setTimeout(() => {
          void poll();
        }, PROCESSING_POLL_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      stopped = true;
      mounted.current = false;
      if (timer !== null) window.clearTimeout(timer);
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

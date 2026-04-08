import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAllProcessesStatus,
  type AllProcessesStatus,
  type ProcessingEvent,
} from '../api/admin/processes';
import { useProcessingEvents } from './useProcessingEvents';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'fallback-polling';

export interface UseProcessingStateResult {
  status: AllProcessesStatus | null;
  loading: boolean;
  error: string | null;
  connectionState: ConnectionState;
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
}

/**
 * Single source of truth for the Processing page. Owns the snapshot,
 * subscribes to the SSE stream, applies in-place patches for fine-grained
 * events, and refetches on structural changes.
 */
export function useProcessingState(): UseProcessingStateResult {
  const [status, setStatus] = useState<AllProcessesStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const data = await getAllProcessesStatus();
      setStatus(data);
      setError(null);
      setLastUpdatedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load processing status');
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Apply SSE events to local state
  const handleEvent = useCallback(
    (event: ProcessingEvent) => {
      setLastUpdatedAt(Date.now());
      switch (event.type) {
        case 'batch-progress': {
          setStatus(prev => {
            if (!prev || !prev.activeBatch) return prev;
            return {
              ...prev,
              activeBatch: {
                ...prev.activeBatch,
                completed: event.completed,
                failed: event.failed,
                total: event.total,
                currentJob: event.currentLetterId ? { letterId: event.currentLetterId } : null,
              },
            };
          });
          return;
        }
        case 'batch-paused':
          setStatus(prev =>
            prev && prev.activeBatch
              ? { ...prev, activeBatch: { ...prev.activeBatch, isPaused: true } }
              : prev
          );
          return;
        case 'batch-resumed':
          setStatus(prev =>
            prev && prev.activeBatch
              ? { ...prev, activeBatch: { ...prev.activeBatch, isPaused: false } }
              : prev
          );
          return;
        case 'batch-started':
        case 'batch-completed':
        case 'batch-aborted':
        case 'queue-changed':
        case 'status-updated':
        case 'job-started':
        case 'job-completed':
        case 'job-failed':
          void refresh();
          return;
        case 'worker-state':
          // Patched via refresh on the next status-updated; cheap.
          void refresh();
          return;
      }
    },
    [refresh]
  );

  useProcessingEvents({
    onEvent: handleEvent,
    onConnected: () => setConnectionState('connected'),
    onFallback: () => setConnectionState('fallback-polling'),
  });

  // Fallback polling when SSE has given up
  useEffect(() => {
    if (connectionState !== 'fallback-polling') return;
    const id = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [connectionState, refresh]);

  return {
    status,
    loading,
    error,
    connectionState,
    lastUpdatedAt,
    refresh,
  };
}

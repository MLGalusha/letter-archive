import { useEffect, useRef } from 'react';
import {
  getProcessingStreamToken,
  type ProcessingEvent,
} from '../api/admin/processes';
import { API_BASE_URL } from '../api/client';

/**
 * Subscribe to the admin processing SSE stream.
 *
 * Mirrors `useNotificationStream`: fetches a one-time token, opens an
 * EventSource, reconnects with exponential backoff, and invokes
 * `onFallback` after `maxReconnectAttempts` failures so the caller can
 * fall back to polling.
 */
export interface UseProcessingEventsOptions {
  enabled?: boolean;
  onEvent: (event: ProcessingEvent) => void;
  onConnected?: () => void;
  onFallback?: () => void;
  maxReconnectAttempts?: number;
}

export function useProcessingEvents(options: UseProcessingEventsOptions): void {
  const {
    enabled = true,
    onEvent,
    onConnected,
    onFallback,
    maxReconnectAttempts = 3,
  } = options;

  const onEventRef = useRef(onEvent);
  const onConnectedRef = useRef(onConnected);
  const onFallbackRef = useRef(onFallback);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);
  useEffect(() => {
    onFallbackRef.current = onFallback;
  }, [onFallback]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let attempts = 0;
    let fallbackFired = false;

    const cleanup = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      attempts += 1;
      if (attempts > maxReconnectAttempts) {
        if (!fallbackFired) {
          fallbackFired = true;
          onFallbackRef.current?.();
        }
        return;
      }
      const delayMs = Math.min(1000 * 2 ** (attempts - 1), 10_000);
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, delayMs);
    };

    const connect = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const { token } = await getProcessingStreamToken();
        if (cancelled) return;

        const url = new URL('/admin/processing/stream', API_BASE_URL);
        url.searchParams.set('token', token);
        eventSource = new EventSource(url.toString());

        eventSource.addEventListener('processing', (evt) => {
          try {
            const data = JSON.parse((evt as MessageEvent).data) as ProcessingEvent;
            onEventRef.current(data);
          } catch {
            // ignore malformed events
          }
        });

        eventSource.addEventListener('connected', () => {
          attempts = 0;
          fallbackFired = false;
          onConnectedRef.current?.();
        });

        eventSource.onerror = () => {
          if (cancelled) return;
          cleanup();
          scheduleReconnect();
        };
      } catch {
        if (cancelled) return;
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [enabled, maxReconnectAttempts]);
}

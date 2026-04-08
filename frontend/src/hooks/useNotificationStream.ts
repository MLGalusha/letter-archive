import { useEffect, useRef } from 'react';
import {
  getStreamToken,
  type AdminNotification,
} from '../api/admin/notifications';
import { API_BASE_URL } from '../api/client';

/**
 * Subscribe to the admin notification SSE stream.
 *
 * Behavior:
 * - Fetches a one-time stream token, opens an EventSource to the backend.
 * - Calls `onNotification` for every notification pushed by the server.
 * - Reconnects on error with exponential backoff (1s → 2s → 4s → ...).
 * - After `maxReconnectAttempts` failed reconnects, falls back to polling via
 *   the `onFallback` callback (caller decides whether to poll).
 *
 * The hook is a no-op if `enabled` is false.
 */
export interface UseNotificationStreamOptions {
  enabled?: boolean;
  onNotification: (notif: AdminNotification) => void;
  onFallback?: () => void;
  maxReconnectAttempts?: number;
}

export function useNotificationStream(options: UseNotificationStreamOptions): void {
  const {
    enabled = true,
    onNotification,
    onFallback,
    maxReconnectAttempts = 3,
  } = options;

  // Keep callbacks in refs so the effect doesn't tear down on every render
  const onNotificationRef = useRef(onNotification);
  const onFallbackRef = useRef(onFallback);
  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);
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

    const connect = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const { token } = await getStreamToken();
        if (cancelled) return;

        const url = new URL('/admin/notifications/stream', API_BASE_URL);
        url.searchParams.set('token', token);
        eventSource = new EventSource(url.toString());

        eventSource.addEventListener('notification', (evt) => {
          try {
            const data = JSON.parse((evt as MessageEvent).data) as AdminNotification;
            onNotificationRef.current(data);
          } catch {
            // ignore malformed events
          }
        });

        eventSource.addEventListener('connected', () => {
          // Reset backoff on successful connection
          attempts = 0;
        });

        eventSource.onerror = () => {
          // EventSource auto-reconnects by default, but browsers can be flaky.
          // We manage reconnects ourselves for predictable backoff.
          if (cancelled) return;
          cleanup();
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
      } catch {
        if (cancelled) return;
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
      }
    };

    void connect();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [enabled, maxReconnectAttempts]);
}

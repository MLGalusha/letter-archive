import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useNotificationStream } from '../useNotificationStream';
import type { AdminNotification } from '../../api/admin/notifications';

// Mock the stream-token endpoint so the hook doesn't hit the network.
vi.mock('../../api/admin/notifications', async () => {
  const actual = await vi.importActual<typeof import('../../api/admin/notifications')>(
    '../../api/admin/notifications',
  );
  return {
    ...actual,
    getStreamToken: vi.fn(() =>
      Promise.resolve({ token: 'test-token', expiresAt: Date.now() + 30_000 }),
    ),
  };
});

// ============================================================================
// Fake EventSource so we can drive reconnect + event flow from the test.
// ============================================================================

interface FakeEventSourceInstance {
  url: string;
  listeners: Record<string, ((evt: unknown) => void)[]>;
  onerror: ((evt: unknown) => void) | null;
  closed: boolean;
  addEventListener: (type: string, cb: (evt: unknown) => void) => void;
  close: () => void;
  // Test helpers
  emit(type: string, data: unknown): void;
  triggerError(): void;
}

const instances: FakeEventSourceInstance[] = [];

class FakeEventSource {
  url: string;
  listeners: Record<string, ((evt: unknown) => void)[]> = {};
  onerror: ((evt: unknown) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    instances.push(this as unknown as FakeEventSourceInstance);
  }

  addEventListener(type: string, cb: (evt: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }

  close(): void {
    this.closed = true;
  }

  // Test helpers
  emit(type: string, data: unknown): void {
    const payload = { data: JSON.stringify(data) };
    for (const cb of this.listeners[type] ?? []) cb(payload);
  }

  triggerError(): void {
    this.onerror?.({});
  }
}

describe('useNotificationStream', () => {
  beforeEach(() => {
    instances.length = 0;
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does nothing when enabled is false', async () => {
    const onNotification = vi.fn();
    renderHook(() =>
      useNotificationStream({ enabled: false, onNotification }),
    );
    // Give any promise microtasks a chance
    await Promise.resolve();
    expect(instances.length).toBe(0);
    expect(onNotification).not.toHaveBeenCalled();
  });

  it('opens an EventSource and forwards notification events', async () => {
    const onNotification = vi.fn();
    renderHook(() => useNotificationStream({ onNotification }));

    await waitFor(() => expect(instances.length).toBe(1));
    const es = instances[0];
    expect(es.url).toContain('token=test-token');

    const notif: Partial<AdminNotification> = { id: 'n-1', title: 'Hi' };
    act(() => {
      es.emit('notification', notif);
    });
    expect(onNotification).toHaveBeenCalledWith(notif);
  });

  it('reconnects with backoff on error, then falls back after maxReconnectAttempts', async () => {
    vi.useFakeTimers();
    const onNotification = vi.fn();
    const onFallback = vi.fn();

    renderHook(() =>
      useNotificationStream({
        onNotification,
        onFallback,
        maxReconnectAttempts: 2,
      }),
    );

    // First connect (async due to getStreamToken) — advance microtasks
    await vi.waitFor(() => expect(instances.length).toBe(1));

    // Attempt 1 → schedules retry at 1s
    act(() => instances[0].triggerError());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await vi.waitFor(() => expect(instances.length).toBe(2));

    // Attempt 2 → schedules retry at 2s
    act(() => instances[1].triggerError());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await vi.waitFor(() => expect(instances.length).toBe(3));

    // Attempt 3 → exceeds maxReconnectAttempts=2 → fallback fires, no new instance
    act(() => instances[2].triggerError());
    await Promise.resolve();
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(instances.length).toBe(3);
  });

  it('closes the EventSource on unmount', async () => {
    const { unmount } = renderHook(() =>
      useNotificationStream({ onNotification: vi.fn() }),
    );
    await waitFor(() => expect(instances.length).toBe(1));
    unmount();
    expect(instances[0].closed).toBe(true);
  });
});

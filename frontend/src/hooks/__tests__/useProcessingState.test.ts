import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllProcessesStatus } from '../../api/admin/processes';
import type { UseProcessingEventsOptions } from '../useProcessingEvents';

const { getAllProcessesStatusMock, useProcessingEventsMock } = vi.hoisted(() => ({
  getAllProcessesStatusMock: vi.fn(),
  useProcessingEventsMock: vi.fn(),
}));

vi.mock('../../api/admin/processes', () => ({
  getAllProcessesStatus: getAllProcessesStatusMock,
}));

vi.mock('../useProcessingEvents', () => ({
  useProcessingEvents: useProcessingEventsMock,
}));

import { useProcessingState } from '../useProcessingState';

const snapshot: AllProcessesStatus = {
  processes: [],
  activeBatch: null,
};

function latestStreamOptions(): UseProcessingEventsOptions {
  const call = useProcessingEventsMock.mock.calls.at(-1);
  if (!call) throw new Error('processing stream hook was not called');
  return call[0] as UseProcessingEventsOptions;
}

async function settleInitialRefresh(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useProcessingState snapshot reconciliation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getAllProcessesStatusMock.mockResolvedValue(snapshot);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes every 15 seconds while SSE is healthy', async () => {
    const { result, unmount } = renderHook(() => useProcessingState());
    await settleInitialRefresh();

    act(() => latestStreamOptions().onConnected?.());
    expect(result.current.connectionState).toBe('connected');
    getAllProcessesStatusMock.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(getAllProcessesStatusMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getAllProcessesStatusMock).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('refreshes every 5 seconds after the stream falls back', async () => {
    const { result, unmount } = renderHook(() => useProcessingState());
    await settleInitialRefresh();

    act(() => latestStreamOptions().onFallback?.());
    expect(result.current.connectionState).toBe('fallback-polling');
    getAllProcessesStatusMock.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(getAllProcessesStatusMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getAllProcessesStatusMock).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('replaces connection-state intervals and clears the final interval on unmount', async () => {
    const { unmount } = renderHook(() => useProcessingState());
    await settleInitialRefresh();
    expect(vi.getTimerCount()).toBe(1);
    getAllProcessesStatusMock.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getAllProcessesStatusMock).not.toHaveBeenCalled();

    act(() => latestStreamOptions().onFallback?.());
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getAllProcessesStatusMock).toHaveBeenCalledTimes(1);

    act(() => latestStreamOptions().onConnected?.());
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getAllProcessesStatusMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getAllProcessesStatusMock).toHaveBeenCalledTimes(2);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getAllProcessesStatusMock).toHaveBeenCalledTimes(2);
  });
});

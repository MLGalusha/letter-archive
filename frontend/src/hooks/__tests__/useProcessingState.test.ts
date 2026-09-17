import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessingQueueStatus } from "../../api/admin/processing";

const { getProcessingQueueStatusMock } = vi.hoisted(() => ({
  getProcessingQueueStatusMock: vi.fn(),
}));

vi.mock("../../api/admin/processing", () => ({
  getProcessingQueueStatus: getProcessingQueueStatusMock,
}));

import {
  PROCESSING_POLL_INTERVAL_MS,
  PROCESSING_IDLE_INTERVAL_MS,
  useProcessingState,
} from "../useProcessingState";

const snapshot: ProcessingQueueStatus = {
  active: [],
  queued: {
    transcription: [],
    metadata: [],
    entityExtraction: [],
    extraContent: [],
  },
  recent: [],
  worker: {
    lastTickAt: null,
    isPolling: false,
    lastError: null,
    currentBatchSize: null,
    updatedAt: null,
  },
  counts: {
    activeCount: 0,
    queuedTranscription: 0,
    queuedMetadata: 0,
    queuedEntityExtraction: 0,
    queuedExtraContent: 0,
    recentSuccessCount: 0,
    recentFailedCount: 0,
    recentClearedCount: 0,
  },
};

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useProcessingState durable polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getProcessingQueueStatusMock.mockResolvedValue(snapshot);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads immediately and backs off an idle queue after the prior read settles", async () => {
    const { result, unmount } = renderHook(() => useProcessingState());
    await settle();

    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toEqual(snapshot);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESSING_IDLE_INTERVAL_MS - 1);
    });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("does not overlap a slow durable read", async () => {
    let resolveFirst!: (value: ProcessingQueueStatus) => void;
    getProcessingQueueStatusMock.mockReturnValueOnce(
      new Promise<ProcessingQueueStatus>((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const { unmount } = renderHook(() => useProcessingState());
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESSING_POLL_INTERVAL_MS * 3);
    });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst(snapshot);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESSING_IDLE_INTERVAL_MS);
    });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("queues one follow-up read when refreshed during an active read", async () => {
    const staleSnapshot = {
      ...snapshot,
      counts: {
        ...snapshot.counts,
        queuedMetadata: 1,
      },
    };
    let resolveFirst!: (value: ProcessingQueueStatus) => void;
    let resolveSecond!: (value: ProcessingQueueStatus) => void;
    getProcessingQueueStatusMock
      .mockReturnValueOnce(
        new Promise<ProcessingQueueStatus>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<ProcessingQueueStatus>((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const { result, unmount } = renderHook(() => useProcessingState());
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(1);

    let refreshAfterMutation!: Promise<void>;
    act(() => {
      refreshAfterMutation = result.current.refresh();
      void result.current.refresh();
    });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst(staleSnapshot);
      await Promise.resolve();
    });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecond(snapshot);
      await refreshAfterMutation;
    });

    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toEqual(snapshot);
    expect(result.current.loading).toBe(false);

    unmount();
  });

  it("does not lose a refresh requested at the read completion boundary", async () => {
    let resolveFirst!: (value: ProcessingQueueStatus) => void;
    getProcessingQueueStatusMock
      .mockReturnValueOnce(
        new Promise<ProcessingQueueStatus>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(snapshot);

    const { result, unmount } = renderHook(() => useProcessingState());
    await settle();
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(1);

    let boundaryRefresh!: Promise<void>;
    await act(async () => {
      resolveFirst(snapshot);
      queueMicrotask(() => {
        boundaryRefresh = result.current.refresh();
      });
      await Promise.resolve();
      await Promise.resolve();
      await boundaryRefresh;
    });

    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toEqual(snapshot);
    expect(result.current.loading).toBe(false);

    unmount();
  });

  it("keeps the last snapshot visible when a later poll fails", async () => {
    const { result, unmount } = renderHook(() => useProcessingState());
    await settle();
    getProcessingQueueStatusMock.mockRejectedValueOnce(
      new Error("Queue unavailable"),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESSING_IDLE_INTERVAL_MS);
    });

    expect(result.current.status).toEqual(snapshot);
    expect(result.current.error).toBe("Queue unavailable");
    expect(result.current.loading).toBe(false);

    unmount();
  });

  it("clears its pending poll on unmount", async () => {
    const { unmount } = renderHook(() => useProcessingState());
    await settle();
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(PROCESSING_POLL_INTERVAL_MS * 2);
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(1);
  });

  it('uses five seconds for active work and refreshes explicit actions even while hidden', async () => {
    const active = { ...snapshot, counts: { ...snapshot.counts, activeCount: 1 } };
    getProcessingQueueStatusMock.mockResolvedValue(active);
    const { result, unmount } = renderHook(() => useProcessingState());
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(PROCESSING_POLL_INTERVAL_MS); });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.refresh(); });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it('pauses hidden polling and coalesces visibility plus focus into one resume read', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const { unmount } = renderHook(() => useProcessingState());
    await settle();
    visibility = 'hidden'; act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(1);
    visibility = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    await settle();
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('switches promptly from idle to active cadence after an action refresh', async () => {
    const { result, unmount } = renderHook(() => useProcessingState());
    await settle();
    getProcessingQueueStatusMock.mockResolvedValue({ ...snapshot, counts: { ...snapshot.counts, queuedMetadata: 1 } });
    await act(async () => { await result.current.refresh(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PROCESSING_POLL_INTERVAL_MS); });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('aborts unused reads and ignores their late completions after unmount', async () => {
    let resolve!: (value: ProcessingQueueStatus) => void;
    getProcessingQueueStatusMock.mockReturnValueOnce(new Promise<ProcessingQueueStatus>(done => { resolve = done; }));
    const { unmount } = renderHook(() => useProcessingState());
    const signal = getProcessingQueueStatusMock.mock.calls[0][0] as AbortSignal;
    unmount(); expect(signal.aborted).toBe(true);
    await act(async () => { resolve(snapshot); });
    expect(vi.getTimerCount()).toBe(0);
  });


  it('starts a fresh read after StrictMode cleanup and ignores the aborted lifetime', async () => {
    let resolveOld!: (value: ProcessingQueueStatus) => void;
    getProcessingQueueStatusMock.mockReturnValueOnce(new Promise<ProcessingQueueStatus>(resolve => { resolveOld = resolve; }));
    const { result, unmount } = renderHook(() => useProcessingState(), { wrapper: StrictMode });
    await settle();
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(2);
    expect((getProcessingQueueStatusMock.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
    expect(result.current.status).toEqual(snapshot);
    await act(async () => { resolveOld({ ...snapshot, counts: { ...snapshot.counts, activeCount: 99 } }); });
    expect(result.current.status).toEqual(snapshot);
    unmount();
  });

  it.each(['unknown', 'active', 'idle'] as const)('preserves the %s queue retry cadence after an error', async (previous) => {
    const active = { ...snapshot, counts: { ...snapshot.counts, activeCount: 1 } };
    if (previous === 'unknown') getProcessingQueueStatusMock.mockRejectedValueOnce(new Error('Unavailable'));
    else getProcessingQueueStatusMock.mockResolvedValueOnce(previous === 'active' ? active : snapshot);
    const { unmount } = renderHook(() => useProcessingState());
    await settle();
    const cadence = previous === 'idle' ? PROCESSING_IDLE_INTERVAL_MS : PROCESSING_POLL_INTERVAL_MS;
    if (previous !== 'unknown') {
      getProcessingQueueStatusMock.mockRejectedValueOnce(new Error('Unavailable'));
      await act(async () => { await vi.advanceTimersByTimeAsync(cadence); });
    }
    const calls = getProcessingQueueStatusMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(cadence - 1); });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(calls);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(calls + 1);
    unmount();
  });

});

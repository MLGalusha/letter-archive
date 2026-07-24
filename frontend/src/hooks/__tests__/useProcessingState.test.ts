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
  });

  it("loads immediately and polls five seconds after the prior read settles", async () => {
    const { result, unmount } = renderHook(() => useProcessingState());
    await settle();

    expect(getProcessingQueueStatusMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toEqual(snapshot);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESSING_POLL_INTERVAL_MS - 1);
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
      await vi.advanceTimersByTimeAsync(PROCESSING_POLL_INTERVAL_MS);
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
      await vi.advanceTimersByTimeAsync(PROCESSING_POLL_INTERVAL_MS);
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
});

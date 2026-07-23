import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionInfo } from "../../../api/collections";

const listCollectionsMock = vi.fn();

vi.mock("../../../api/collections", () => ({
  listCollections: (...args: unknown[]) => listCollectionsMock(...args),
}));

import useCollectionNavigation from "../useCollectionNavigation";

function collection(collectionCode: string): CollectionInfo {
  return {
    id: `collection-${collectionCode}`,
    collectionCode,
    title: `Collection ${collectionCode}`,
    description: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    letterCount: 1,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useCollectionNavigation", () => {
  beforeEach(() => {
    listCollectionsMock.mockReset();
  });

  it("loads once per route key and never reuses old neighbors after a failed route change", async () => {
    listCollectionsMock.mockResolvedValueOnce([
      collection("008"),
      collection("009"),
      collection("010"),
    ]);

    const pendingNextRoute = deferred<CollectionInfo[]>();
    listCollectionsMock.mockReturnValueOnce(pendingNextRoute.promise);

    const { result, rerender } = renderHook(
      ({ collectionCode }) => useCollectionNavigation(collectionCode),
      {
        initialProps: { collectionCode: "009" },
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.adjacent.prev?.collectionCode).toBe("008");
      expect(result.current.adjacent.next?.collectionCode).toBe("010");
    });
    expect(result.current.scrubberProps).toMatchObject({
      position: 2,
      total: 3,
    });
    expect(listCollectionsMock).toHaveBeenCalledTimes(1);

    rerender({ collectionCode: "010" });

    expect(result.current.adjacent).toEqual({ prev: null, next: null });
    expect(result.current.scrubberProps).toBeNull();
    expect(listCollectionsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingNextRoute.reject(new Error("request failed"));
      await pendingNextRoute.promise.catch(() => {});
    });

    expect(result.current.adjacent).toEqual({ prev: null, next: null });
    expect(result.current.scrubberProps).toBeNull();
    expect(listCollectionsMock).toHaveBeenCalledTimes(2);
  });

  it("does not revive an earlier route result after A to B to A when the fresh A request fails", async () => {
    listCollectionsMock.mockResolvedValueOnce([
      collection("008"),
      collection("009"),
      collection("010"),
    ]);
    const pendingB = deferred<CollectionInfo[]>();
    const freshA = deferred<CollectionInfo[]>();
    listCollectionsMock
      .mockReturnValueOnce(pendingB.promise)
      .mockReturnValueOnce(freshA.promise);

    const { result, rerender } = renderHook(
      ({ collectionCode }) => useCollectionNavigation(collectionCode),
      {
        initialProps: { collectionCode: "009" },
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.adjacent.prev?.collectionCode).toBe("008");
      expect(result.current.adjacent.next?.collectionCode).toBe("010");
    });

    rerender({ collectionCode: "010" });
    rerender({ collectionCode: "009" });

    expect(result.current.adjacent).toEqual({ prev: null, next: null });
    expect(result.current.scrubberProps).toBeNull();
    expect(listCollectionsMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      freshA.reject(new Error("fresh A request failed"));
      await freshA.promise.catch(() => {});
      pendingB.resolve([
        collection("009"),
        collection("010"),
        collection("011"),
      ]);
      await pendingB.promise;
    });

    expect(result.current.adjacent).toEqual({ prev: null, next: null });
    expect(result.current.scrubberProps).toBeNull();
  });
});

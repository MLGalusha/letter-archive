import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LetterReviewVisit } from '../useLetterReviewVisit';
import {
  useLetterReviewAutosaveCoordinator,
  type LetterReviewAutosaveLane,
} from '../useLetterReviewAutosaveCoordinator';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function visit(letterId: string) {
  let active = true;
  const value: LetterReviewVisit = {
    letterId,
    isActive: () => active,
  };
  return {
    value,
    deactivate: () => {
      active = false;
    },
  };
}

function options(
  owner: LetterReviewVisit,
  targetKey: string | null,
  overrides: {
    blocked?: boolean;
    mutationsBlocked?: boolean;
    handleMutationError?: (error: unknown, fallback: string) => boolean;
  } = {},
) {
  return {
    visit: owner,
    targetKey,
    isMutationBlocked: () => overrides.blocked ?? false,
    mutationsBlocked: overrides.mutationsBlocked ?? false,
    handleMutationError:
      overrides.handleMutationError ?? vi.fn(() => false),
  };
}

const saveOptions = (
  lane: LetterReviewAutosaveLane,
  overrides: {
    delayMs?: number;
    onError?: (error: unknown) => void;
  } = {},
) => ({
  lane,
  delayMs: overrides.delayMs,
  errorMessage: `Failed to save ${lane}`,
  onError: overrides.onError,
});

describe('useLetterReviewAutosaveCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces to the latest queued job for one target lane', async () => {
    const owner = visit('letter-a');
    const first = vi.fn(async () => {});
    const secondResult = deferred();
    const second = vi.fn(() => secondResult.promise);
    const { result } = renderHook(() =>
      useLetterReviewAutosaveCoordinator(options(owner.value, 'letter-a')),
    );

    act(() => {
      result.current.scheduleDebouncedSave(
        first,
        saveOptions('letter-fields'),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => {
      result.current.scheduleDebouncedSave(
        second,
        saveOptions('letter-fields'),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_499);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(result.current.autoSaveStatus).toBe('idle');
    expect(result.current.busyLanes).toEqual(new Set(['letter-fields']));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.current.autoSaveStatus).toBe('saving');

    await act(async () => {
      secondResult.resolve();
      await secondResult.promise;
    });
    expect(result.current.autoSaveStatus).toBe('saved');
    expect(result.current.busyLanes.size).toBe(0);

    act(() => {
      result.current.scheduleDebouncedSave(
        vi.fn(async () => {}),
        saveOptions('letter-fields'),
      );
    });
    expect(result.current.autoSaveStatus).toBe('idle');
    expect(result.current.busyLanes).toEqual(new Set(['letter-fields']));
    act(() => {
      result.current.cancelDebouncedSaves(['letter-fields']);
    });
  });

  it('runs independent lanes once through one target-wide serial pump', async () => {
    const owner = visit('letter-a');
    const firstResult = deferred();
    const secondResult = deferred();
    const first = vi.fn(() => firstResult.promise);
    const second = vi.fn(() => secondResult.promise);
    const { result } = renderHook(() =>
      useLetterReviewAutosaveCoordinator(options(owner.value, 'letter-a')),
    );

    act(() => {
      result.current.scheduleDebouncedSave(
        first,
        saveOptions('letter-fields', { delayMs: 0 }),
      );
      result.current.scheduleDebouncedSave(
        second,
        saveOptions('extra-content', { delayMs: 0 }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(result.current.busyLanes).toEqual(
      new Set(['letter-fields', 'extra-content']),
    );

    await act(async () => {
      firstResult.resolve();
      await firstResult.promise;
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.current.autoSaveStatus).toBe('saving');

    await act(async () => {
      secondResult.resolve();
      await secondResult.promise;
    });
    expect(result.current.autoSaveStatus).toBe('saved');
    expect(result.current.busyLanes.size).toBe(0);
  });

  it('keeps a newer same-lane job behind the in-flight job', async () => {
    const owner = visit('letter-a');
    const firstResult = deferred();
    const secondResult = deferred();
    const first = vi.fn(() => firstResult.promise);
    const second = vi.fn(() => secondResult.promise);
    const { result } = renderHook(() =>
      useLetterReviewAutosaveCoordinator(options(owner.value, 'letter-a')),
    );

    act(() => {
      result.current.scheduleDebouncedSave(
        first,
        saveOptions('photo-description', { delayMs: 0 }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      result.current.scheduleDebouncedSave(
        second,
        saveOptions('photo-description', { delayMs: 0 }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(second).not.toHaveBeenCalled();

    await act(async () => {
      firstResult.resolve();
      await firstResult.promise;
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.current.autoSaveStatus).toBe('saving');

    await act(async () => {
      secondResult.resolve();
      await secondResult.promise;
    });
    expect(result.current.autoSaveStatus).toBe('saved');
  });

  it('lets queued work survive a visit change and runs different targets independently', async () => {
    let staleBlocked = false;
    const visitA = visit('letter-a');
    const visitB = visit('letter-b');
    visitB.deactivate();
    const resultA = deferred();
    const resultB = deferred();
    const taskA = vi.fn(() => resultA.promise);
    const taskB = vi.fn(() => resultB.promise);
    const { result, rerender } = renderHook(
      ({ hookOptions }) =>
        useLetterReviewAutosaveCoordinator(hookOptions),
      {
        initialProps: {
          hookOptions: {
            ...options(visitA.value, 'letter-a'),
            isMutationBlocked: () => staleBlocked,
          },
        },
      },
    );

    act(() => {
      result.current.scheduleDebouncedSave(
        taskA,
        saveOptions('letter-fields'),
      );
    });
    visitA.deactivate();
    staleBlocked = true;
    const activeB = visit('letter-b');
    rerender({ hookOptions: options(activeB.value, 'letter-b') });
    act(() => {
      result.current.scheduleDebouncedSave(
        taskB,
        saveOptions('extra-content'),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(taskA).toHaveBeenCalledTimes(1);
    expect(taskB).toHaveBeenCalledTimes(1);
    expect(result.current.autoSaveStatus).toBe('saving');
    expect(result.current.busyLanes).toEqual(new Set(['extra-content']));

    await act(async () => {
      resultA.resolve();
      await resultA.promise;
    });
    expect(result.current.autoSaveStatus).toBe('saving');

    await act(async () => {
      resultB.resolve();
      await resultB.promise;
    });
    expect(result.current.autoSaveStatus).toBe('saved');
  });

  it('lets a fresh A visit supersede queued work from the first A visit', async () => {
    const firstA = visit('letter-a');
    const firstTask = vi.fn(async () => {});
    const freshTask = vi.fn(async () => {});
    const { result, rerender } = renderHook(
      ({ hookOptions }) =>
        useLetterReviewAutosaveCoordinator(hookOptions),
      {
        initialProps: {
          hookOptions: options(firstA.value, 'letter-a'),
        },
      },
    );

    act(() => {
      result.current.scheduleDebouncedSave(
        firstTask,
        saveOptions('photo-description'),
      );
    });
    firstA.deactivate();
    const visitB = visit('letter-b');
    rerender({ hookOptions: options(visitB.value, 'letter-b') });
    visitB.deactivate();
    const freshA = visit('letter-a');
    rerender({ hookOptions: options(freshA.value, 'letter-a') });
    act(() => {
      result.current.scheduleDebouncedSave(
        freshTask,
        saveOptions('photo-description'),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(firstTask).not.toHaveBeenCalled();
    expect(freshTask).toHaveBeenCalledTimes(1);
  });

  it('suppresses stale status and mutation errors while retaining onError logging', async () => {
    const visitA = visit('letter-a');
    const visitB = visit('letter-b');
    visitB.deactivate();
    const pending = deferred();
    const error = new Error('late A failure');
    const onError = vi.fn();
    const handleMutationError = vi.fn(() => false);
    const { result, rerender } = renderHook(
      ({ hookOptions }) =>
        useLetterReviewAutosaveCoordinator(hookOptions),
      {
        initialProps: {
          hookOptions: options(visitA.value, 'letter-a', {
            handleMutationError,
          }),
        },
      },
    );

    act(() => {
      result.current.scheduleDebouncedSave(
        () => pending.promise,
        saveOptions('extra-content', { delayMs: 0, onError }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    visitA.deactivate();
    const activeB = visit('letter-b');
    rerender({ hookOptions: options(activeB.value, 'letter-b') });

    await act(async () => {
      pending.reject(error);
      await expect(pending.promise).rejects.toBe(error);
    });
    expect(onError).toHaveBeenCalledWith(error);
    expect(handleMutationError).not.toHaveBeenCalled();
    expect(result.current.autoSaveStatus).toBe('idle');
    expect(result.current.busyLanes.size).toBe(0);
  });

  it('reports an unobserved stale failure when a fresh visit flushes that target', async () => {
    const firstA = visit('letter-a');
    const visitB = visit('letter-b');
    const freshA = visit('letter-a');
    const pending = deferred();
    const error = new Error('first A failed');
    const firstHandler = vi.fn(() => false);
    const freshHandler = vi.fn(() => false);
    const { result, rerender } = renderHook(
      ({ hookOptions }) =>
        useLetterReviewAutosaveCoordinator(hookOptions),
      {
        initialProps: {
          hookOptions: options(firstA.value, 'letter-a:3', {
            handleMutationError: firstHandler,
          }),
        },
      },
    );

    act(() => {
      result.current.scheduleDebouncedSave(
        () => pending.promise,
        saveOptions('letter-fields', { delayMs: 0 }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    firstA.deactivate();
    rerender({
      hookOptions: options(visitB.value, 'letter-b:2'),
    });
    visitB.deactivate();
    rerender({
      hookOptions: options(freshA.value, 'letter-a:3', {
        handleMutationError: freshHandler,
      }),
    });
    await act(async () => {
      pending.reject(error);
      await expect(pending.promise).rejects.toBe(error);
    });

    let freshFlush!: Promise<boolean>;
    act(() => {
      freshFlush = result.current.flushDebouncedSaves([
        'letter-fields',
      ]);
    });
    await act(async () => {
      await expect(freshFlush).resolves.toBe(false);
    });
    expect(firstHandler).not.toHaveBeenCalled();
    expect(freshHandler).toHaveBeenCalledWith(
      error,
      'Failed to save letter-fields',
    );
  });

  it('fails a flush closed when its visit becomes stale while draining', async () => {
    const firstA = visit('letter-a');
    const pending = deferred();
    const firstHandler = vi.fn(() => false);
    const freshHandler = vi.fn(() => false);
    const { result, rerender } = renderHook(
      ({ hookOptions }) =>
        useLetterReviewAutosaveCoordinator(hookOptions),
      {
        initialProps: {
          hookOptions: options(firstA.value, 'letter-a:3', {
            handleMutationError: firstHandler,
          }),
        },
      },
    );

    act(() => {
      result.current.scheduleDebouncedSave(
        () => pending.promise,
        saveOptions('letter-fields', { delayMs: 0 }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    let flushed!: Promise<boolean>;
    act(() => {
      flushed = result.current.flushDebouncedSaves([
        'letter-fields',
      ]);
    });

    firstA.deactivate();
    const visitB = visit('letter-b');
    rerender({
      hookOptions: options(visitB.value, 'letter-b:2'),
    });
    visitB.deactivate();
    const freshA = visit('letter-a');
    rerender({
      hookOptions: options(freshA.value, 'letter-a:3', {
        handleMutationError: freshHandler,
      }),
    });

    await act(async () => {
      pending.resolve();
      await pending.promise;
      await expect(flushed).resolves.toBe(false);
    });
    expect(result.current.autoSaveStatus).toBe('idle');
    expect(firstHandler).not.toHaveBeenCalled();
    expect(freshHandler).not.toHaveBeenCalled();
  });

  it('carries a failure forward when its visible error handler throws', async () => {
    const firstA = visit('letter-a');
    const pending = deferred();
    const error = new Error('save failed');
    const firstHandler = vi.fn(() => {
      throw new Error('toast failed');
    });
    const freshHandler = vi.fn(() => false);
    const { result, rerender } = renderHook(
      ({ hookOptions }) =>
        useLetterReviewAutosaveCoordinator(hookOptions),
      {
        initialProps: {
          hookOptions: options(firstA.value, 'letter-a:3', {
            handleMutationError: firstHandler,
          }),
        },
      },
    );

    act(() => {
      result.current.scheduleDebouncedSave(
        () => pending.promise,
        saveOptions('letter-fields', { delayMs: 10_000 }),
      );
    });
    let firstFlush!: Promise<boolean>;
    act(() => {
      firstFlush = result.current.flushDebouncedSaves([
        'letter-fields',
      ]);
    });
    await act(async () => {
      pending.reject(error);
      await expect(pending.promise).rejects.toBe(error);
      await expect(firstFlush).resolves.toBe(false);
    });

    firstA.deactivate();
    const visitB = visit('letter-b');
    rerender({
      hookOptions: options(visitB.value, 'letter-b:2'),
    });
    visitB.deactivate();
    const freshA = visit('letter-a');
    rerender({
      hookOptions: options(freshA.value, 'letter-a:3', {
        handleMutationError: freshHandler,
      }),
    });

    await act(async () => {
      await expect(
        result.current.flushDebouncedSaves(['letter-fields']),
      ).resolves.toBe(false);
    });
    expect(freshHandler).toHaveBeenCalledWith(
      error,
      'Failed to save letter-fields',
    );
  });

  it('cancels queued work on unmount and suppresses UI errors from started work', async () => {
    const owner = visit('letter-a');
    const running = deferred();
    const runningTask = vi.fn(() => running.promise);
    const queuedTask = vi.fn(async () => {});
    const onError = vi.fn();
    const handleMutationError = vi.fn(() => false);
    const { result, unmount } = renderHook(() =>
      useLetterReviewAutosaveCoordinator(
        options(owner.value, 'letter-a', { handleMutationError }),
      ),
    );

    act(() => {
      result.current.scheduleDebouncedSave(
        runningTask,
        saveOptions('letter-fields', { delayMs: 0, onError }),
      );
      result.current.scheduleDebouncedSave(
        queuedTask,
        saveOptions('extra-content'),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(runningTask).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(queuedTask).not.toHaveBeenCalled();

    const error = new Error('failed after unmount');
    await act(async () => {
      running.reject(error);
      await expect(running.promise).rejects.toBe(error);
    });
    expect(onError).toHaveBeenCalledWith(error);
    expect(handleMutationError).not.toHaveBeenCalled();
  });

  it('cancels the active target queue when mutations become blocked', async () => {
    const owner = visit('letter-a');
    const task = vi.fn(async () => {});
    const { result, rerender } = renderHook(
      ({ hookOptions }) =>
        useLetterReviewAutosaveCoordinator(hookOptions),
      {
        initialProps: {
          hookOptions: options(owner.value, 'letter-a'),
        },
      },
    );
    act(() => {
      result.current.scheduleDebouncedSave(
        task,
        saveOptions('extra-content'),
      );
    });

    act(() => {
      rerender({
        hookOptions: options(owner.value, 'letter-a', {
          blocked: true,
          mutationsBlocked: true,
        }),
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(task).not.toHaveBeenCalled();
    expect(result.current.busyLanes.size).toBe(0);
    let blockedFlush!: Promise<boolean>;
    act(() => {
      blockedFlush = result.current.flushDebouncedSaves([
        'extra-content',
      ]);
    });
    await expect(blockedFlush).resolves.toBe(false);
  });

  it('cancels selected queued lanes for the active target', async () => {
    const owner = visit('letter-a');
    const task = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useLetterReviewAutosaveCoordinator(options(owner.value, 'letter-a')),
    );
    act(() => {
      result.current.scheduleDebouncedSave(
        task,
        saveOptions('identity'),
      );
      result.current.cancelDebouncedSaves(['identity']);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(task).not.toHaveBeenCalled();
    expect(result.current.busyLanes.size).toBe(0);
    expect(result.current.autoSaveStatus).toBe('idle');
  });

  it('flushes requested lanes through the target pump and waits for them to drain', async () => {
    const owner = visit('letter-a');
    const firstResult = deferred();
    const secondResult = deferred();
    const first = vi.fn(() => firstResult.promise);
    const second = vi.fn(() => secondResult.promise);
    const { result } = renderHook(() =>
      useLetterReviewAutosaveCoordinator(options(owner.value, 'letter-a')),
    );
    act(() => {
      result.current.scheduleDebouncedSave(
        first,
        saveOptions('letter-fields', { delayMs: 10_000 }),
      );
      result.current.scheduleDebouncedSave(
        second,
        saveOptions('identity', { delayMs: 10_000 }),
      );
    });

    let flushed!: Promise<boolean>;
    act(() => {
      flushed = result.current.flushDebouncedSaves([
        'letter-fields',
        'identity',
      ]);
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    await act(async () => {
      firstResult.resolve();
      await firstResult.promise;
    });
    expect(second).toHaveBeenCalledTimes(1);

    await act(async () => {
      secondResult.resolve();
      await secondResult.promise;
    });
    await expect(flushed).resolves.toBe(true);
    expect(result.current.autoSaveStatus).toBe('saved');
  });

  it('returns false when flushed work fails', async () => {
    const owner = visit('letter-a');
    const pending = deferred();
    const error = new Error('save failed');
    const handleMutationError = vi.fn(() => false);
    const { result } = renderHook(() =>
      useLetterReviewAutosaveCoordinator(
        options(owner.value, 'letter-a', { handleMutationError }),
      ),
    );
    act(() => {
      result.current.scheduleDebouncedSave(
        () => pending.promise,
        saveOptions('photo-description', { delayMs: 10_000 }),
      );
    });

    let flushed!: Promise<boolean>;
    act(() => {
      flushed = result.current.flushDebouncedSaves([
        'photo-description',
      ]);
    });
    await act(async () => {
      pending.reject(error);
      await expect(pending.promise).rejects.toBe(error);
    });

    await expect(flushed).resolves.toBe(false);
    expect(handleMutationError).toHaveBeenCalledWith(
      error,
      'Failed to save photo-description',
    );
    expect(result.current.autoSaveStatus).toBe('error');
  });

  it('resolves a lane failure only after that lane succeeds', async () => {
    const owner = visit('letter-a');
    const error = new Error('first save failed');
    const handleMutationError = vi.fn(() => false);
    const { result } = renderHook(() =>
      useLetterReviewAutosaveCoordinator(
        options(owner.value, 'letter-a', { handleMutationError }),
      ),
    );
    act(() => {
      result.current.scheduleDebouncedSave(
        async () => {
          throw error;
        },
        saveOptions('identity', { delayMs: 10_000 }),
      );
    });
    let failedFlush!: Promise<boolean>;
    act(() => {
      failedFlush = result.current.flushDebouncedSaves(['identity']);
    });
    await act(async () => {
      await expect(failedFlush).resolves.toBe(false);
    });

    act(() => {
      result.current.scheduleDebouncedSave(
        async () => {},
        saveOptions('identity', { delayMs: 10_000 }),
      );
    });
    let repairedFlush!: Promise<boolean>;
    act(() => {
      repairedFlush = result.current.flushDebouncedSaves(['identity']);
    });
    await act(async () => {
      await expect(repairedFlush).resolves.toBe(true);
    });
    expect(result.current.autoSaveStatus).toBe('saved');
  });

  it('does not let unrelated success erase an unresolved lane failure', async () => {
    const owner = visit('letter-a');
    const { result } = renderHook(() =>
      useLetterReviewAutosaveCoordinator(
        options(owner.value, 'letter-a'),
      ),
    );
    act(() => {
      result.current.scheduleDebouncedSave(
        async () => {
          throw new Error('letter fields failed');
        },
        saveOptions('letter-fields', { delayMs: 10_000 }),
      );
    });
    let failedFlush!: Promise<boolean>;
    act(() => {
      failedFlush = result.current.flushDebouncedSaves([
        'letter-fields',
      ]);
    });
    await act(async () => {
      await expect(failedFlush).resolves.toBe(false);
    });

    act(() => {
      result.current.scheduleDebouncedSave(
        async () => {},
        saveOptions('extra-content', { delayMs: 10_000 }),
      );
    });
    let unrelatedFlush!: Promise<boolean>;
    act(() => {
      unrelatedFlush = result.current.flushDebouncedSaves([
        'extra-content',
      ]);
    });
    await act(async () => {
      await expect(unrelatedFlush).resolves.toBe(false);
    });
    expect(result.current.autoSaveStatus).toBe('error');
  });
});

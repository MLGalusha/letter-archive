import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Letter } from '../../../../types/Letter';
import { useGuardedLetterState } from '../useGuardedLetterState';
import { useLetterReviewMutationExecutor } from '../useLetterReviewMutationExecutor';
import type { LetterReviewVisit } from '../useLetterReviewVisit';
import { useLetterReviewVisit } from '../useLetterReviewVisit';
import { useLetterSavingState } from '../useLetterSavingState';
import { useLetterSourceConflict } from '../useLetterSourceConflict';

function makeLetter(
  id = 'letter-a',
  overrides: Partial<Letter> = {},
): Letter {
  return {
    id,
    title: `Letter ${id}`,
    primarySourceRevision: 3,
    images: [],
    transcript: { pages: [], fullText: '', verified: false },
    metadata: { verified: false },
    status: 'needs_review',
    workflowState: 'TRANSCRIBED',
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'EDITED',
    metadataContentStatus: 'EDITED',
    extraContentStatus: 'EMPTY',
    createdAt: '2026-07-24T12:00:00.000Z',
    flagged: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function activeVisit(letterId = 'letter-a'): LetterReviewVisit {
  return {
    letterId,
    isActive: () => true,
  };
}

describe('useLetterReviewMutationExecutor', () => {
  it('owns the successful lease, flush, request, and adoption order', async () => {
    const events: string[] = [];
    const letter = makeLetter();
    const release = vi.fn(() => events.push('release'));
    const beginSaving = vi.fn(() => {
      events.push('begin');
      return release;
    });
    const flushPendingSaves = vi.fn(async () => {
      events.push('flush');
      return true;
    });
    const tryAdoptLetter = vi.fn(() => {
      events.push('adopt');
      return true;
    });
    const hydrateAdoptedLetter = vi.fn(() => {
      events.push('hydrate');
    });
    const handleMutationError = vi.fn();
    const request = vi.fn(async () => {
      events.push('request');
      return letter;
    });
    const afterAdopt = vi.fn(() => {
      events.push('after-adopt');
    });
    const { result } = renderHook(() =>
      useLetterReviewMutationExecutor({
        visit: activeVisit(),
        beginSaving,
        flushPendingSaves,
        tryAdoptLetter,
        hydrateAdoptedLetter,
        handleMutationError,
      }),
    );

    await result.current({
      request,
      failureMessage: 'Mutation failed',
      afterAdopt,
    });

    expect(events).toEqual([
      'begin',
      'flush',
      'request',
      'adopt',
      'hydrate',
      'after-adopt',
      'release',
    ]);
    expect(handleMutationError).not.toHaveBeenCalled();
    expect(afterAdopt).toHaveBeenCalledWith(letter);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not start a request when pending saves cannot flush', async () => {
    const release = vi.fn();
    const request = vi.fn();
    const handleMutationError = vi.fn();
    const hydrateAdoptedLetter = vi.fn();
    const { result } = renderHook(() =>
      useLetterReviewMutationExecutor({
        visit: activeVisit(),
        beginSaving: () => release,
        flushPendingSaves: async () => false,
        tryAdoptLetter: vi.fn(),
        hydrateAdoptedLetter,
        handleMutationError,
      }),
    );

    await result.current({
      request,
      failureMessage: 'Mutation failed',
    });

    expect(request).not.toHaveBeenCalled();
    expect(hydrateAdoptedLetter).not.toHaveBeenCalled();
    expect(handleMutationError).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reports request failure once and releases its lease', async () => {
    const error = new Error('network failed');
    const release = vi.fn();
    const handleMutationError = vi.fn();
    const hydrateAdoptedLetter = vi.fn();
    const { result } = renderHook(() =>
      useLetterReviewMutationExecutor({
        visit: activeVisit(),
        beginSaving: () => release,
        flushPendingSaves: async () => true,
        tryAdoptLetter: vi.fn(),
        hydrateAdoptedLetter,
        handleMutationError,
      }),
    );

    await result.current({
      request: async () => {
        throw error;
      },
      failureMessage: 'Mutation failed',
    });

    expect(handleMutationError).toHaveBeenCalledTimes(1);
    expect(handleMutationError).toHaveBeenCalledWith(
      error,
      'Mutation failed',
    );
    expect(hydrateAdoptedLetter).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not report a DTO that guarded adoption rejects as success', async () => {
    const letter = makeLetter();
    const release = vi.fn();
    const handleMutationError = vi.fn();
    const hydrateAdoptedLetter = vi.fn();
    const afterAdopt = vi.fn();
    const { result } = renderHook(() =>
      useLetterReviewMutationExecutor({
        visit: activeVisit(),
        beginSaving: () => release,
        flushPendingSaves: async () => true,
        tryAdoptLetter: () => false,
        hydrateAdoptedLetter,
        handleMutationError,
      }),
    );

    await result.current({
      request: async () => letter,
      failureMessage: 'Mutation failed',
      afterAdopt,
    });

    expect(hydrateAdoptedLetter).not.toHaveBeenCalled();
    expect(afterAdopt).not.toHaveBeenCalled();
    expect(handleMutationError).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not flush or request for an inactive visit', async () => {
    const release = vi.fn();
    const flushPendingSaves = vi.fn();
    const request = vi.fn();
    const hydrateAdoptedLetter = vi.fn();
    const { result } = renderHook(() =>
      useLetterReviewMutationExecutor({
        visit: {
          letterId: 'letter-a',
          isActive: () => false,
        },
        beginSaving: () => release,
        flushPendingSaves,
        tryAdoptLetter: vi.fn(),
        hydrateAdoptedLetter,
        handleMutationError: vi.fn(),
      }),
    );

    await result.current({
      request,
      failureMessage: 'Mutation failed',
    });

    expect(flushPendingSaves).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(hydrateAdoptedLetter).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('serializes overlapping executions and keeps the saving lock until both settle', async () => {
    const first = deferred<Letter>();
    const second = deferred<Letter>();
    const letter = makeLetter();
    const events: string[] = [];
    const hydrateAdoptedLetter = vi.fn();
    const { result } = renderHook(() => {
      const visit = useLetterReviewVisit(letter.id);
      const { saving, beginSaving } = useLetterSavingState(visit);
      const execute = useLetterReviewMutationExecutor({
        visit,
        beginSaving,
        flushPendingSaves: async () => true,
        tryAdoptLetter: () => true,
        hydrateAdoptedLetter,
        handleMutationError: vi.fn(),
      });
      return { execute, saving };
    });

    let firstExecution!: ReturnType<typeof result.current.execute>;
    let secondExecution!: ReturnType<typeof result.current.execute>;
    await act(async () => {
      firstExecution = result.current.execute({
        request: () => {
          events.push('request-first');
          return first.promise;
        },
        failureMessage: 'First failed',
        afterAdopt: () => events.push('adopt-first'),
      });
      secondExecution = result.current.execute({
        request: () => {
          events.push('request-second');
          return second.promise;
        },
        failureMessage: 'Second failed',
        afterAdopt: () => events.push('adopt-second'),
      });
      await Promise.resolve();
    });
    expect(result.current.saving).toBe(true);
    expect(events).toEqual(['request-first']);

    await act(async () => {
      first.resolve(letter);
      await firstExecution;
    });
    expect(result.current.saving).toBe(true);
    expect(events).toEqual([
      'request-first',
      'adopt-first',
      'request-second',
    ]);

    await act(async () => {
      second.resolve(letter);
      await secondExecution;
    });
    expect(result.current.saving).toBe(false);
    expect(events).toEqual([
      'request-first',
      'adopt-first',
      'request-second',
      'adopt-second',
    ]);
    expect(hydrateAdoptedLetter).toHaveBeenCalledTimes(2);
  });

  it('does not misreport a post-adoption programming error as a failed request', async () => {
    const error = new Error('local hydration failed');
    const letter = makeLetter();
    const release = vi.fn();
    const handleMutationError = vi.fn();
    const { result } = renderHook(() =>
      useLetterReviewMutationExecutor({
        visit: activeVisit(),
        beginSaving: () => release,
        flushPendingSaves: async () => true,
        tryAdoptLetter: () => true,
        hydrateAdoptedLetter: () => {
          throw error;
        },
        handleMutationError,
      }),
    );

    await expect(result.current({
      request: async () => letter,
      failureMessage: 'Mutation failed',
    })).rejects.toBe(error);

    expect(handleMutationError).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects an in-flight first-A response after A to B to A', async () => {
    const firstAResponse = deferred<Letter>();
    const firstA = makeLetter('letter-a', { flagged: false });
    const letterB = makeLetter('letter-b');
    const freshA = makeLetter('letter-a', { flagged: false });
    const showToast = vi.fn();
    const hydrateAdoptedLetter = vi.fn();
    const { result, rerender } = renderHook(
      ({ letterId }) => {
        const visit = useLetterReviewVisit(letterId);
        const conflict = useLetterSourceConflict(showToast, visit);
        const guarded = useGuardedLetterState(
          conflict.markSourceConflict,
          visit,
        );
        const { beginSaving } = useLetterSavingState(visit);
        const execute = useLetterReviewMutationExecutor({
          visit,
          beginSaving,
          flushPendingSaves: async () => true,
          tryAdoptLetter: guarded.tryAdoptLetter,
          hydrateAdoptedLetter,
          handleMutationError: conflict.handleMutationError,
        });
        return { ...guarded, execute };
      },
      { initialProps: { letterId: 'letter-a' } },
    );

    act(() => {
      result.current.setAuthoritativeLetter(firstA);
    });
    let staleExecution!: ReturnType<typeof result.current.execute>;
    act(() => {
      staleExecution = result.current.execute({
        request: () => firstAResponse.promise,
        failureMessage: 'Flag failed',
      });
    });

    rerender({ letterId: 'letter-b' });
    act(() => {
      result.current.setAuthoritativeLetter(letterB);
    });
    rerender({ letterId: 'letter-a' });
    act(() => {
      result.current.setAuthoritativeLetter(freshA);
    });

    await act(async () => {
      firstAResponse.resolve({ ...firstA, flagged: true });
      await staleExecution;
    });

    expect(result.current.letter).toBe(freshA);
    expect(result.current.letter?.flagged).toBe(false);
    expect(hydrateAdoptedLetter).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});

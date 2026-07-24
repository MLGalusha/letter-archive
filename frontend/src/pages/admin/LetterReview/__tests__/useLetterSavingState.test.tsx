import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLetterReviewVisit } from '../useLetterReviewVisit';
import { useLetterSavingState } from '../useLetterSavingState';

function useSavingOwner(letterId: string) {
  const visit = useLetterReviewVisit(letterId);
  return useLetterSavingState(visit);
}

describe('useLetterSavingState', () => {
  it('stays locked until every overlapping same-visit lease is released', () => {
    const { result } = renderHook(() => useSavingOwner('letter-a'));
    let releaseFirst = () => {};
    let releaseSecond = () => {};

    act(() => {
      releaseFirst = result.current.beginSaving();
      releaseSecond = result.current.beginSaving();
    });
    expect(result.current.saving).toBe(true);

    act(() => {
      releaseFirst();
    });
    expect(result.current.saving).toBe(true);

    act(() => {
      releaseFirst();
    });
    expect(result.current.saving).toBe(true);

    act(() => {
      releaseSecond();
    });
    expect(result.current.saving).toBe(false);
  });

  it('does not let a late route A release unlock route B', () => {
    const { result, rerender } = renderHook(
      ({ letterId }) => useSavingOwner(letterId),
      { initialProps: { letterId: 'letter-a' } },
    );
    let releaseA = () => {};
    act(() => {
      releaseA = result.current.beginSaving();
    });
    expect(result.current.saving).toBe(true);

    rerender({ letterId: 'letter-b' });
    let releaseB = () => {};
    act(() => {
      releaseB = result.current.beginSaving();
      releaseA();
    });
    expect(result.current.saving).toBe(true);

    act(() => {
      releaseB();
    });
    expect(result.current.saving).toBe(false);
  });

  it('starts fresh and rejects an earlier owner after A -> B -> A', () => {
    const { result, rerender } = renderHook(
      ({ letterId }) => useSavingOwner(letterId),
      { initialProps: { letterId: 'letter-a' } },
    );
    const staleBeginA = result.current.beginSaving;
    let releaseOldA = () => {};
    act(() => {
      releaseOldA = staleBeginA();
    });
    expect(result.current.saving).toBe(true);

    rerender({ letterId: 'letter-b' });
    rerender({ letterId: 'letter-a' });
    expect(result.current.saving).toBe(false);

    act(() => {
      const releaseStaleAttempt = staleBeginA();
      releaseStaleAttempt();
      releaseOldA();
    });
    expect(result.current.saving).toBe(false);

    let releaseFreshA = () => {};
    act(() => {
      releaseFreshA = result.current.beginSaving();
      releaseOldA();
    });
    expect(result.current.saving).toBe(true);

    act(() => {
      releaseFreshA();
    });
    expect(result.current.saving).toBe(false);
  });
});

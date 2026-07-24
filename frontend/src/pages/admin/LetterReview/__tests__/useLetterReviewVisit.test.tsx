import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLetterReviewVisit } from '../useLetterReviewVisit';

describe('useLetterReviewVisit', () => {
  it('keeps one owner for a visit and creates a fresh owner for A -> B -> A', () => {
    const { result, rerender } = renderHook(
      ({ letterId }) => useLetterReviewVisit(letterId),
      { initialProps: { letterId: 'letter-a' } },
    );

    const firstA = result.current;
    expect(firstA.isActive()).toBe(true);

    rerender({ letterId: 'letter-a' });
    expect(result.current).toBe(firstA);

    rerender({ letterId: 'letter-b' });
    const letterB = result.current;
    expect(letterB).not.toBe(firstA);
    expect(firstA.isActive()).toBe(false);
    expect(letterB.isActive()).toBe(true);

    rerender({ letterId: 'letter-a' });
    const freshA = result.current;
    expect(freshA).not.toBe(firstA);
    expect(freshA).not.toBe(letterB);
    expect(firstA.isActive()).toBe(false);
    expect(letterB.isActive()).toBe(false);
    expect(freshA.isActive()).toBe(true);
  });

  it('deactivates the visit when its owner unmounts', () => {
    const { result, unmount } = renderHook(() =>
      useLetterReviewVisit('letter-a'),
    );
    const visit = result.current;

    unmount();

    expect(visit.isActive()).toBe(false);
  });
});

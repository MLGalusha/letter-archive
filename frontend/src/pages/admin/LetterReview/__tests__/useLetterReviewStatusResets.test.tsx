import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLetterReviewStatusResets } from '../useLetterReviewStatusResets';
import { useLetterReviewVisit } from '../useLetterReviewVisit';

describe('useLetterReviewStatusResets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets unrelated status lanes reset independently', () => {
    const transcriptionReset = vi.fn();
    const metadataReset = vi.fn();
    const { result } = renderHook(() => {
      const visit = useLetterReviewVisit('letter-a');
      return useLetterReviewStatusResets(visit);
    });

    act(() => {
      result.current('transcription', transcriptionReset, 1_000);
      result.current('metadata-regeneration', metadataReset, 2_000);
      vi.advanceTimersByTime(1_000);
    });
    expect(transcriptionReset).toHaveBeenCalledTimes(1);
    expect(metadataReset).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(metadataReset).toHaveBeenCalledTimes(1);
  });

  it('replaces only the prior reset in the same lane', () => {
    const replaced = vi.fn();
    const latest = vi.fn();
    const { result } = renderHook(() => {
      const visit = useLetterReviewVisit('letter-a');
      return useLetterReviewStatusResets(visit);
    });

    act(() => {
      result.current('transcription', replaced, 1_000);
      result.current('transcription', latest, 1_000);
      vi.advanceTimersByTime(1_000);
    });

    expect(replaced).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('cancels callbacks owned by an earlier route visit', () => {
    const staleReset = vi.fn();
    const { result, rerender } = renderHook(
      ({ letterId }) => {
        const visit = useLetterReviewVisit(letterId);
        return useLetterReviewStatusResets(visit);
      },
      { initialProps: { letterId: 'letter-a' } },
    );

    act(() => {
      result.current('transcription', staleReset, 1_000);
    });
    rerender({ letterId: 'letter-b' });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(staleReset).not.toHaveBeenCalled();
  });

  it('cancels pending callbacks on unmount', () => {
    const reset = vi.fn();
    const { result, unmount } = renderHook(() => {
      const visit = useLetterReviewVisit('letter-a');
      return useLetterReviewStatusResets(visit);
    });

    act(() => {
      result.current('transcription', reset, 1_000);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(reset).not.toHaveBeenCalled();
  });
});

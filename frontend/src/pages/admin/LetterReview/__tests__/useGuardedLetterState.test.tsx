import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Letter } from '../../../../types/Letter';
import { useGuardedLetterState } from '../useGuardedLetterState';
import { useLetterSourceConflict } from '../useLetterSourceConflict';

function letterAtRevision(
  primarySourceRevision: number,
  overrides: Partial<Letter> = {},
): Letter {
  return {
    id: 'letter-1',
    primarySourceRevision,
    flagged: false,
    ...overrides,
  } as Letter;
}

describe('useGuardedLetterState', () => {
  it.each([
    'source-blind flag response',
    'line-review background refetch',
  ])(
    'rejects a newer same-letter revision from a %s and blocks rev-1 drafts',
    () => {
      const showToast = vi.fn();
      const rev1 = letterAtRevision(1);
      const rev2 = letterAtRevision(2, { flagged: true });
      const saveDraft = vi.fn();
      const { result } = renderHook(() => {
        const conflict = useLetterSourceConflict(showToast, {
          letterId: 'letter-1',
        });
        const state = useGuardedLetterState(
          conflict.markSourceConflict,
          'letter-1',
        );
        return { ...conflict, ...state };
      });

      act(() => {
        result.current.setAuthoritativeLetter(rev1);
      });

      act(() => {
        result.current.setLetter(rev2);

        // Blocking is synchronous, so a queued writer cannot run in the gap
        // before React renders the terminal-conflict banner.
        if (!result.current.isMutationBlocked()) {
          saveDraft(result.current.letter?.primarySourceRevision);
        }
      });

      expect(result.current.letter).toBe(rev1);
      expect(result.current.letter?.primarySourceRevision).toBe(1);
      expect(result.current.letter?.flagged).toBe(false);
      expect(result.current.mutationsBlocked).toBe(true);
      expect(result.current.isMutationBlocked()).toBe(true);
      expect(saveDraft).not.toHaveBeenCalled();
    },
  );

  it('preserves React Dispatch behavior for same-revision updates', () => {
    const markSourceConflict = vi.fn();
    const rev1 = letterAtRevision(1);
    const { result } = renderHook(() =>
      useGuardedLetterState(markSourceConflict, 'letter-1'),
    );

    act(() => {
      result.current.setAuthoritativeLetter(rev1);
    });
    act(() => {
      result.current.setLetter((current) => (
        current ? { ...current, flagged: true } : current
      ));
    });

    expect(result.current.letter).toEqual({
      ...rev1,
      flagged: true,
    });
    expect(markSourceConflict).not.toHaveBeenCalled();
  });

  it('masks the previous DTO synchronously when route ownership changes', () => {
    const markSourceConflict = vi.fn();
    const letterA = letterAtRevision(1, { id: 'letter-a' });
    const letterB = letterAtRevision(1, { id: 'letter-b' });
    const { result, rerender } = renderHook(
      ({ activeLetterId }) =>
        useGuardedLetterState(markSourceConflict, activeLetterId),
      { initialProps: { activeLetterId: 'letter-a' } },
    );

    act(() => {
      result.current.setAuthoritativeLetter(letterA);
    });
    const staleAuthoritativeA = result.current.setAuthoritativeLetter;
    const staleIncrementalA = result.current.setLetter;
    expect(result.current.letter).toBe(letterA);

    act(() => {
      rerender({ activeLetterId: 'letter-b' });
    });

    // No effect is required to hide A from hooks rendering under route B.
    expect(result.current.letter).toBeNull();

    act(() => {
      staleAuthoritativeA(letterA);
      result.current.setAuthoritativeLetter(letterB);
    });
    expect(result.current.letter).toBe(letterB);

    act(() => {
      staleAuthoritativeA(letterA);
      staleIncrementalA({ ...letterA, flagged: true });
    });
    expect(result.current.letter).toBe(letterB);
    expect(markSourceConflict).not.toHaveBeenCalled();
  });
});

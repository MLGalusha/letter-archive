import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLetterSavingState } from '../useLetterSavingState';

describe('useLetterSavingState', () => {
  it('does not let a late route A completion clear route B saving', () => {
    const { result, rerender } = renderHook(
      ({ letterId }) => useLetterSavingState(letterId),
      { initialProps: { letterId: 'letter-a' } },
    );

    const setSavingForA = result.current[1];
    act(() => {
      setSavingForA(true);
    });
    expect(result.current[0]).toBe(true);

    rerender({ letterId: 'letter-b' });
    const setSavingForB = result.current[1];
    expect(result.current[0]).toBe(false);

    act(() => {
      setSavingForB(true);
      setSavingForA(false);
    });
    expect(result.current[0]).toBe(true);

    act(() => {
      setSavingForB(false);
    });
    expect(result.current[0]).toBe(false);
  });

  it('supports functional updates for the active route', () => {
    const { result } = renderHook(() =>
      useLetterSavingState('letter-a'),
    );

    act(() => {
      result.current[1]((current) => !current);
    });
    expect(result.current[0]).toBe(true);
  });

  it('starts a fresh saving session when returning to a letter', () => {
    const { result, rerender } = renderHook(
      ({ letterId }) => useLetterSavingState(letterId),
      { initialProps: { letterId: 'letter-a' } },
    );

    act(() => {
      result.current[1](true);
    });
    rerender({ letterId: 'letter-b' });
    rerender({ letterId: 'letter-a' });

    expect(result.current[0]).toBe(false);
  });
});

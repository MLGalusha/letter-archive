import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useIsMobile from '../useIsMobile';
import useIsTouchDevice from '../useIsTouchDevice';

function installMatchMedia(initialMatches: Record<string, boolean>) {
  const queries = new Map<string, MediaQueryList>();

  const matchMedia = vi.fn((query: string) => {
    const existing = queries.get(query);
    if (existing) return existing;

    const target = new EventTarget();
    const mediaQuery = {
      matches: initialMatches[query] ?? false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    } as MediaQueryList;
    queries.set(query, mediaQuery);
    return mediaQuery;
  });

  vi.stubGlobal('matchMedia', matchMedia);

  return {
    setMatches(query: string, matches: boolean) {
      const mediaQuery = matchMedia(query);
      Object.defineProperty(mediaQuery, 'matches', { configurable: true, value: matches });
      act(() => mediaQuery.dispatchEvent(new Event('change')));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('responsive media hooks', () => {
  it('reads a changed breakpoint immediately and follows later media updates', () => {
    const media = installMatchMedia({
      '(max-width: 640px)': false,
      '(max-width: 900px)': true,
    });
    const { result, rerender } = renderHook(
      ({ breakpoint }) => useIsMobile(breakpoint),
      { initialProps: { breakpoint: 640 } },
    );

    expect(result.current).toBe(false);
    rerender({ breakpoint: 900 });
    expect(result.current).toBe(true);

    media.setMatches('(max-width: 900px)', false);
    expect(result.current).toBe(false);
  });

  it('subscribes to changes in the primary pointer type', () => {
    const media = installMatchMedia({ '(pointer: coarse)': false });
    const { result } = renderHook(() => useIsTouchDevice());

    expect(result.current).toBe(false);
    media.setMatches('(pointer: coarse)', true);
    expect(result.current).toBe(true);
  });
});

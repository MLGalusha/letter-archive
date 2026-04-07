import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import useStickyDock from '../useStickyDock';

// ── Helpers ─────────────────────────────────────────────────────────────────

type IOCallback = IntersectionObserverCallback;

let observerCallback: IOCallback;
let observerInstance: { observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
let mockIOConstructor: ReturnType<typeof vi.fn>;

function makeMockIntersectionObserver() {
  mockIOConstructor = vi.fn(function (this: unknown, callback: IOCallback) {
    observerCallback = callback;
    observerInstance = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    };
    Object.assign(this as object, observerInstance);
  }) as unknown as ReturnType<typeof vi.fn>;
  // Vitest needs the mock to look like a constructor (has prototype)
  mockIOConstructor.prototype = {};
  return mockIOConstructor;
}

function fireEntry(isIntersecting: boolean, bottomY: number) {
  const entry = {
    isIntersecting,
    boundingClientRect: { bottom: bottomY } as DOMRectReadOnly,
  } as IntersectionObserverEntry;

  act(() => {
    observerCallback([entry], observerInstance as unknown as IntersectionObserver);
  });
}

function makeRefs(): {
  triggerRef: RefObject<HTMLDivElement | null>;
  sectionRef: RefObject<HTMLElement | null>;
} {
  const triggerRef = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
  triggerRef.current = document.createElement('div');
  const sectionRef = createRef<HTMLElement>() as { current: HTMLElement | null };
  sectionRef.current = document.createElement('section');
  return { triggerRef, sectionRef };
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  // setup.ts defines IntersectionObserver with writable: true, so assign directly
  globalThis.IntersectionObserver = makeMockIntersectionObserver() as unknown as typeof IntersectionObserver;

  // Mock document.querySelector('.header') to return element with offsetHeight
  const headerEl = document.createElement('header');
  Object.defineProperty(headerEl, 'offsetHeight', { value: 80, configurable: true });
  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === '.header') return headerEl;
    return null;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useStickyDock', () => {
  it('returns stickyDockActive: false initially', () => {
    const { triggerRef, sectionRef } = makeRefs();
    const { result } = renderHook(() => useStickyDock({ triggerRef, sectionRef }));

    expect(result.current.stickyDockActive).toBe(false);
  });

  it('initializes all dropdown state pairs correctly', () => {
    const { triggerRef, sectionRef } = makeRefs();
    const { result } = renderHook(() => useStickyDock({ triggerRef, sectionRef }));

    expect(result.current.pageRefineOpen).toBe(false);
    expect(result.current.compactRefineOpen).toBe(false);
    expect(result.current.pageSortOpen).toBeUndefined();
    expect(result.current.compactSortOpen).toBeUndefined();
  });

  it('setPageRefineOpen updates pageRefineOpen', () => {
    const { triggerRef, sectionRef } = makeRefs();
    const { result } = renderHook(() => useStickyDock({ triggerRef, sectionRef }));

    act(() => result.current.setPageRefineOpen(true));
    expect(result.current.pageRefineOpen).toBe(true);

    act(() => result.current.setPageRefineOpen(false));
    expect(result.current.pageRefineOpen).toBe(false);
  });

  it('setCompactRefineOpen updates compactRefineOpen', () => {
    const { triggerRef, sectionRef } = makeRefs();
    const { result } = renderHook(() => useStickyDock({ triggerRef, sectionRef }));

    act(() => result.current.setCompactRefineOpen(true));
    expect(result.current.compactRefineOpen).toBe(true);
  });

  it('setPageSortOpen and setCompactSortOpen update their respective states', () => {
    const { triggerRef, sectionRef } = makeRefs();
    const { result } = renderHook(() => useStickyDock({ triggerRef, sectionRef }));

    act(() => result.current.setPageSortOpen(true));
    expect(result.current.pageSortOpen).toBe(true);

    act(() => result.current.setCompactSortOpen(true));
    expect(result.current.compactSortOpen).toBe(true);
  });

  it('clears compact dropdown state when stickyDockActive transitions to false', () => {
    const { triggerRef, sectionRef } = makeRefs();
    const { result } = renderHook(() => useStickyDock({ triggerRef, sectionRef }));

    // Activate sticky dock
    fireEntry(false, 10);
    expect(result.current.stickyDockActive).toBe(true);

    // Open compact dropdowns while docked
    act(() => {
      result.current.setCompactRefineOpen(true);
      result.current.setCompactSortOpen(true);
    });
    expect(result.current.compactRefineOpen).toBe(true);

    // Deactivate with no dropdown open (close first, observer fires second).
    // Close compact dropdowns:
    act(() => {
      result.current.setCompactRefineOpen(false);
      result.current.setCompactSortOpen(undefined);
    });

    // Now observer can deactivate (no dropdown blocking)
    fireEntry(true, 200);
    expect(result.current.stickyDockActive).toBe(false);

    // Transfer effect resets compact state
    expect(result.current.compactRefineOpen).toBe(false);
    expect(result.current.compactSortOpen).toBeUndefined();
  });

  it('does not attach observer when enabled is false', () => {
    const { triggerRef, sectionRef } = makeRefs();
    mockIOConstructor.mockClear();

    renderHook(() => useStickyDock({ triggerRef, sectionRef, enabled: false }));

    expect(mockIOConstructor).not.toHaveBeenCalled();
  });
});

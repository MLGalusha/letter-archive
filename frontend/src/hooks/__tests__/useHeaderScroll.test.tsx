import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useHeaderScroll from "../useHeaderScroll";

function mockMatchMedia(matches: Record<string, boolean>) {
  const listeners = new Map<string, Set<(e: MediaQueryListEvent) => void>>();
  const impl = (query: string) => {
    if (!listeners.has(query)) listeners.set(query, new Set());
    return {
      matches: matches[query] ?? false,
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
        listeners.get(query)!.add(cb);
      },
      removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
        listeners.get(query)!.delete(cb);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
  Object.defineProperty(window, "matchMedia", {
    value: impl,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  mockMatchMedia({
    "(max-width: 900px)": true,
    "(prefers-reduced-motion: reduce)": false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("ordinary scrolling", () => {
  it.each([false, true])("keeps the header visible with reduced motion %s, while the dock collapses", (reduced) => {
    mockMatchMedia({ "(max-width: 900px)": true, "(prefers-reduced-motion: reduce)": reduced });
    vi.stubGlobal("scrollY", 0);
    let frame: FrameRequestCallback = () => {};
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    const { result } = renderHook(() => useHeaderScroll());
    const scroll = (y: number) => act(() => {
      vi.stubGlobal("scrollY", y);
      window.dispatchEvent(new Event("scroll"));
      frame(0);
    });
    expect(result.current.atTop).toBe(true);
    for (const y of [100, 1000, 900, 1200]) {
      scroll(y);
      expect(result.current.visible).toBe(true);
      expect(result.current.atTop).toBe(false);
    }
    scroll(8);
    expect(result.current.atTop).toBe(false);
    scroll(0);
    expect(result.current.atTop).toBe(true);
  });
});

it("hides for the keyboard and restores on dismissal even while input stays focused", () => {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", viewport);
  const input = document.createElement("input");
  document.body.append(input);
  const { result, unmount } = renderHook(() => useHeaderScroll());
  act(() => input.focus());
  act(() => {
    viewport.height = 480;
    viewport.offsetTop = 80;
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(result.current.visible).toBe(false);
  act(() => {
    viewport.height = 844;
    viewport.offsetTop = 24;
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(result.current.visible).toBe(true);
  act(() => {
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event("scroll"));
  });
  expect(result.current.visible).toBe(true);
  unmount();
  vi.unstubAllGlobals();
});

it("does not confuse pinch zoom with opening the keyboard", () => {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", viewport);
  const input = document.createElement("input");
  document.body.append(input);
  const { result, unmount } = renderHook(() => useHeaderScroll());
  act(() => input.focus());
  act(() => {
    viewport.height = 422;
    viewport.scale = 2;
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(result.current.visible).toBe(true);
  unmount();
  vi.unstubAllGlobals();
});

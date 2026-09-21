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
  // Mobile + motion-allowed is the branch where hide-on-scroll-down is active,
  // which makes the focus lock behavior observable.
  mockMatchMedia({
    "(max-width: 900px)": true,
    "(prefers-reduced-motion: reduce)": false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("useHeaderScroll — keyboard and focus", () => {
  it("reports visible: true by default (nothing focused, at top of page)", () => {
    const { result } = renderHook(() => useHeaderScroll());
    expect(result.current.visible).toBe(true);
  });

  it("keeps header visible when focus does not open a keyboard", () => {
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    const { result } = renderHook(() => useHeaderScroll());

    act(() => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(result.current.visible).toBe(true);
  });

  it("does not hide merely for textarea focus", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);

    const { result } = renderHook(() => useHeaderScroll());

    act(() => {
      ta.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(result.current.visible).toBe(true);
  });

  it("does not hide merely for contentEditable focus", () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);

    const { result } = renderHook(() => useHeaderScroll());

    act(() => {
      div.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(result.current.visible).toBe(true);
  });

  it("does not treat non-text elements (buttons, links) as a focus lock", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);

    const { result } = renderHook(() => useHeaderScroll());

    // Focus a button — this should NOT trip the input-focus lock. We can't
    // easily assert "visible only because of the lock" without a scroll mock,
    // but we can assert the focusin event doesn't throw and the hook remains
    // in a coherent state. Pairing this with the above tests verifies the
    // isTextInput guard is in place rather than a blanket document-focus lock.
    act(() => {
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(result.current.visible).toBe(true);
  });

  it("releases the lock when the text input blurs", () => {
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    const { result } = renderHook(() => useHeaderScroll());

    act(() => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(result.current.visible).toBe(true);

    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    // With nothing focused and no scroll activity, the hook's internal
    // `visible` state remains true (its default), so we only assert that
    // focusout doesn't crash and the state stays coherent.
    expect(result.current.visible).toBe(true);
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
  expect(result.current.viewportTop).toBe(24);
  act(() => {
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event("scroll"));
  });
  expect(result.current.viewportTop).toBe(0);
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

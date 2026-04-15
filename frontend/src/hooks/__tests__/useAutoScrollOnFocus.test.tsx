import { fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoScrollOnFocus } from "../useAutoScrollOnFocus";

function TestHarness() {
  const ref = createRef<HTMLDivElement>();
  useAutoScrollOnFocus(ref);

  return (
    <div ref={ref}>
      <input type="search" aria-label="Archive search" />
    </div>
  );
}

describe("useAutoScrollOnFocus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("smooth-scrolls the container under the header when an input receives focus", () => {
    const scrollToMock = vi.fn();
    const header = document.createElement("div");
    header.className = "header";
    Object.defineProperty(header, "offsetHeight", {
      configurable: true,
      value: 88,
    });
    document.body.appendChild(header);

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      writable: true,
      value: 300,
    });
    vi.spyOn(window, "scrollTo").mockImplementation(scrollToMock);
    // smoothScrollToY drives its animation via RAF; fire synchronously and push
    // performance.now() past any reasonable duration so the animation resolves
    // to its final position on the first tick.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(performance.now() + 10_000);
      return 0;
    });

    const { container } = render(<TestHarness />);
    const wrapper = container.firstElementChild as HTMLDivElement;
    const input = container.querySelector("input") as HTMLInputElement;
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 240,
      top: 240,
      bottom: 300,
      left: 0,
      right: 600,
      width: 600,
      height: 60,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.focusIn(input);

    // RAF-driven smoothScrollToY → window.scrollTo(0, targetY) (positional).
    expect(scrollToMock).toHaveBeenLastCalledWith(0, 440);
  });

  it("re-pins the container after input-driven layout shifts", async () => {
    const scrollToMock = vi.fn();
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      writable: true,
      value: 120,
    });
    vi.spyOn(window, "scrollTo").mockImplementation(scrollToMock);

    const { container } = render(<TestHarness />);
    const wrapper = container.firstElementChild as HTMLDivElement;
    const input = container.querySelector("input") as HTMLInputElement;
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 220,
      top: 220,
      bottom: 280,
      left: 0,
      right: 600,
      width: 600,
      height: 60,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.input(input, { target: { value: "mol" } });
    await vi.advanceTimersByTimeAsync(320);

    // Input settle uses appScrollTo → window.scrollTo(0, y) when no container registered.
    expect(scrollToMock).toHaveBeenCalledWith(0, 328);
  });

  it("does not scroll when the container is already within the threshold", () => {
    const scrollToMock = vi.fn();
    vi.spyOn(window, "scrollTo").mockImplementation(scrollToMock);

    const { container } = render(<TestHarness />);
    const wrapper = container.firstElementChild as HTMLDivElement;
    const input = container.querySelector("input") as HTMLInputElement;
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 14,
      top: 14,
      bottom: 74,
      left: 0,
      right: 600,
      width: 600,
      height: 60,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.focusIn(input);

    expect(scrollToMock).not.toHaveBeenCalled();
  });
});

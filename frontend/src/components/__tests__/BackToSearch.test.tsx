import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackToSearch from "../BackToSearch";

function mockMatchMedia(matchesByQuery: Record<string, boolean> = {}) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matchesByQuery[query] ?? false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("BackToSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMatchMedia();
    // The component uses a RAF-driven smooth scroll. Make RAF fire synchronously
    // with a timestamp far past the animation duration so the easing loop
    // terminates on the first tick and lands exactly on the destination.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(
      (cb: FrameRequestCallback) => {
        cb(performance.now() + 10_000);
        return 0;
      },
    );
  });

  afterEach(() => {
    // Unmount portaled component before clearing DOM — otherwise React's
    // portal cleanup throws NotFoundError trying to remove a node that was
    // already wiped by innerHTML = "".
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("scrolls to the target and focuses the search input on desktop", async () => {
    const scrollToMock = vi.fn();
    const targetRef = { current: document.createElement("div") };
    const input = document.createElement("input");
    input.type = "search";
    targetRef.current.appendChild(input);
    document.body.appendChild(targetRef.current);

    const header = document.createElement("div");
    header.className = "header";
    Object.defineProperty(header, "offsetHeight", {
      configurable: true,
      value: 96,
    });
    document.body.appendChild(header);

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      writable: true,
      value: 220,
    });
    vi.spyOn(window, "scrollTo").mockImplementation(scrollToMock);
    vi.spyOn(targetRef.current, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 640,
      top: 640,
      bottom: 820,
      left: 0,
      right: 900,
      width: 900,
      height: 180,
      toJSON: () => ({}),
    } as DOMRect);

    render(<BackToSearch visible targetRef={targetRef} />);

    fireEvent.click(screen.getByRole("button", { name: "Jump to search" }));

    expect(scrollToMock).toHaveBeenLastCalledWith(0, 752);

    await vi.advanceTimersByTimeAsync(160);
    expect(input).toHaveFocus();
  });

  it("uses the slash shortcut when focus is not already inside an editable field", () => {
    const jumpTarget = document.createElement("div");
    const input = document.createElement("input");
    jumpTarget.appendChild(input);
    document.body.appendChild(jumpTarget);
    const targetRef = { current: jumpTarget };
    const scrollToMock = vi.fn();

    vi.spyOn(window, "scrollTo").mockImplementation(scrollToMock);
    vi.spyOn(jumpTarget, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 200,
      top: 200,
      bottom: 260,
      left: 0,
      right: 400,
      width: 400,
      height: 60,
      toJSON: () => ({}),
    } as DOMRect);

    render(<BackToSearch visible targetRef={targetRef} />);

    fireEvent.keyDown(window, { key: "/" });

    expect(scrollToMock).toHaveBeenCalledTimes(1);
  });

  it("does not steal focus on touch devices", async () => {
    mockMatchMedia({
      "(hover: none)": true,
    });

    const scrollToMock = vi.fn();
    const targetRef = { current: document.createElement("div") };
    const input = document.createElement("input");
    targetRef.current.appendChild(input);
    document.body.appendChild(targetRef.current);

    vi.spyOn(window, "scrollTo").mockImplementation(scrollToMock);
    vi.spyOn(targetRef.current, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 120,
      top: 120,
      bottom: 180,
      left: 0,
      right: 400,
      width: 400,
      height: 60,
      toJSON: () => ({}),
    } as DOMRect);

    render(<BackToSearch visible targetRef={targetRef} />);

    fireEvent.click(screen.getByRole("button", { name: "Jump to search" }));

    expect(scrollToMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(160);
    expect(input).not.toHaveFocus();
  });
});

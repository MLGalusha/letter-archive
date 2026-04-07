import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InfiniteCarousel from "../InfiniteCarousel";

function mockMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
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

describe("InfiniteCarousel", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders children as slides", () => {
    const { container } = render(
      <InfiniteCarousel>
        {[
          <div key="a">Slide A</div>,
          <div key="b">Slide B</div>,
          <div key="c">Slide C</div>,
        ]}
      </InfiniteCarousel>,
    );

    // Slide A and C appear twice (once real + once as clone)
    expect(screen.getAllByText("Slide A").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Slide B")).toBeInTheDocument();
    expect(screen.getAllByText("Slide C").length).toBeGreaterThanOrEqual(1);

    // Track should contain real slides + 2 clones = 5 total slide wrappers
    const slides = container.querySelectorAll(".carousel-slide");
    expect(slides).toHaveLength(5);
  });

  it("dot navigation exists with correct count", () => {
    render(
      <InfiniteCarousel>
        {[
          <div key="a">Slide A</div>,
          <div key="b">Slide B</div>,
          <div key="c">Slide C</div>,
        ]}
      </InfiniteCarousel>,
    );

    // One dot per real slide (not clones)
    const dots = screen.getAllByRole("tab");
    expect(dots).toHaveLength(3);
  });

  it("dots have role tab and aria-selected attributes", () => {
    render(
      <InfiniteCarousel>
        {[
          <div key="a">Slide A</div>,
          <div key="b">Slide B</div>,
        ]}
      </InfiniteCarousel>,
    );

    const dots = screen.getAllByRole("tab");
    expect(dots).toHaveLength(2);

    // First dot should be selected (initial pos=1 means realIndex=0)
    expect(dots[0]).toHaveAttribute("aria-selected", "true");
    expect(dots[1]).toHaveAttribute("aria-selected", "false");

    // Dots should have aria-label
    expect(dots[0]).toHaveAttribute("aria-label", "Slide 1");
    expect(dots[1]).toHaveAttribute("aria-label", "Slide 2");
  });

  it("prefers-reduced-motion: reduce prevents auto-advance", () => {
    vi.useFakeTimers();
    mockMatchMedia(true);

    render(
      <InfiniteCarousel>
        {[
          <div key="a">Slide A</div>,
          <div key="b">Slide B</div>,
          <div key="c">Slide C</div>,
        ]}
      </InfiniteCarousel>,
    );

    const dots = screen.getAllByRole("tab");
    // Initially first slide is selected
    expect(dots[0]).toHaveAttribute("aria-selected", "true");

    // Advance well past the auto-interval (5000ms)
    act(() => {
      vi.advanceTimersByTime(15000);
    });

    // Should still be on the first slide — no auto-advance
    expect(dots[0]).toHaveAttribute("aria-selected", "true");
  });

  it("auto-advance works when reduced-motion is not set", () => {
    vi.useFakeTimers();
    mockMatchMedia(false);

    render(
      <InfiniteCarousel>
        {[
          <div key="a">Slide A</div>,
          <div key="b">Slide B</div>,
          <div key="c">Slide C</div>,
        ]}
      </InfiniteCarousel>,
    );

    const dots = screen.getAllByRole("tab");
    expect(dots[0]).toHaveAttribute("aria-selected", "true");

    // Advance past the auto-interval (5000ms)
    act(() => {
      vi.advanceTimersByTime(5100);
    });

    // Should have advanced to the second slide
    expect(dots[1]).toHaveAttribute("aria-selected", "true");
  });
});

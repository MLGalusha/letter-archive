import { render, screen, act, fireEvent, createEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InfiniteCarousel from "../InfiniteCarousel";
import ShowcaseCard from "../ShowcaseCard";
import useSwipeNavigation from "../../hooks/useSwipeNavigation";

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

  it("renders no wrapper for zero effective slides", () => {
    const { container } = render(<InfiniteCarousel>{[null, false, undefined]}</InfiniteCarousel>);
    expect(container).toBeEmptyDOMElement();
  });

  it("leaves singleton gestures available to the collection page navigation", () => {
    vi.useFakeTimers();
    const nextCollection = vi.fn();
    function CollectionPage() {
      const { ref } = useSwipeNavigation({ onSwipeLeft: nextCollection });
      return <div ref={ref}><InfiniteCarousel>{[<div key="one">Static highlight</div>]}</InfiniteCarousel></div>;
    }
    const { container } = render(<CollectionPage />);
    Object.defineProperty(container.firstElementChild, 'clientWidth', { value: 390 });
    const highlight = screen.getByText('Static highlight');
    fireEvent.touchStart(highlight, { touches: [{ clientX: 300, clientY: 100 }] });
    expect(touchMove(highlight, 80, 100).defaultPrevented).toBe(true);
    fireEvent.touchEnd(highlight, { touches: [] });
    act(() => vi.advanceTimersByTime(500));
    expect(nextCollection).toHaveBeenCalledOnce();
    expect(container.querySelector('.carousel-track')).toBeNull();
  });

  it("renders one linked slide once without intercepting touch, wheel or mouse", () => {
    vi.useFakeTimers();
    const navigate = vi.fn((event) => event.preventDefault());
    const { container } = render(<InfiniteCarousel classPrefix="cd-highlights" suppressClickAfterDrag>{[
      false, <a key="one" href="/letter/one" data-carousel-drag onClick={navigate}>Only highlight</a>, null,
    ]}</InfiniteCarousel>);
    const link = screen.getByRole('link', { name: 'Only highlight' });
    expect(container.querySelectorAll('.cd-highlights-slide')).toHaveLength(1);
    expect(container.querySelector('.cd-highlights-track')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.touchStart(link, { touches: [{ clientX: 300, clientY: 100 }] });
    expect(touchMove(link, 100, 100).defaultPrevented).toBe(false);
    fireEvent.touchEnd(link, { touches: [] });
    const wheel = createEvent.wheel(link, { deltaX: 100, deltaY: 0, cancelable: true });
    fireEvent(link, wheel); expect(wheel.defaultPrevented).toBe(false);
    fireEvent.mouseDown(link, { button: 0, clientX: 300, clientY: 100 });
    fireEvent.mouseMove(link, { clientX: 100, clientY: 100 }); fireEvent.mouseUp(link);
    fireEvent.click(link, { detail: 1 }); expect(navigate).toHaveBeenCalledOnce();
  });

  it("mounts working interactions after one becomes many and cleans them up when returning to one", () => {
    vi.useFakeTimers();
    const pauseRef = { current: vi.fn() };
    const one = [<div key="a">A</div>];
    const many = [...one, <div key="b">B</div>];
    const view = render(<InfiniteCarousel pauseRef={pauseRef}>{one}</InfiniteCarousel>);
    view.rerender(<InfiniteCarousel pauseRef={pauseRef}>{many}</InfiniteCarousel>);
    const track = view.container.querySelector('.carousel-track')!;
    fireEvent.touchStart(track, { touches: [{ clientX: 300, clientY: 100 }] });
    expect(touchMove(track, 100, 100).defaultPrevented).toBe(true);
    fireEvent.touchEnd(track, { touches: [] });
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    const activePause = pauseRef.current;
    view.rerender(<InfiniteCarousel pauseRef={pauseRef}>{one}</InfiniteCarousel>);
    expect(view.container.querySelector('.carousel-track')).toBeNull();
    expect(touchMove(track, 50, 100).defaultPrevented).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(pauseRef.current).not.toBe(activePause);
    view.rerender(<InfiniteCarousel pauseRef={pauseRef}>{many}</InfiniteCarousel>);
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it("keeps a singleton gallery card's own image navigation and native destination", () => {
    const onNavigate = vi.fn();
    const gallery = ['one', 'two'].map(id => ({ letterId: `letter-${id}`, imageId: `image-${id}`,
      imageUrl: '', label: 'Photograph', peopleLine: '', date: '', hook: `Photo ${id}`, mediaType: 'photo' as const }));
    const { container } = render(<InfiniteCarousel>{[
      <ShowcaseCard key="gallery" items={gallery} onNavigate={onNavigate} />,
    ]}</InfiniteCarousel>);
    expect(container.querySelector('.carousel-track')).toBeNull();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Photograph, Photo two' });
    expect(link).toHaveAttribute('href', '/letter/letter-two?from=highlight&image=image-two');
    fireEvent.click(link); expect(onNavigate).toHaveBeenCalledWith('letter-two', 'image-two');
  });

  it("allows opted-in links to drag without navigating, while ordinary clicks still work", () => {
    const onClick = vi.fn((event) => event.preventDefault());
    const { container } = render(<InfiniteCarousel suppressClickAfterDrag>{[
      <a key="a" href="/letter/one" data-carousel-drag draggable={false} onClick={onClick}>Open scan</a>,
      <div key="b">Other slide</div>,
    ]}</InfiniteCarousel>);
    const link = screen.getAllByText("Open scan")[0];
    fireEvent.mouseDown(link, { button: 0, clientX: 300, clientY: 100 });
    fireEvent.mouseMove(link, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(link);
    fireEvent.click(link, { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[role="tab"]')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(link, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a CTA click after a drag leaves the track", () => {
    const onClick = vi.fn((event) => event.preventDefault());
    const { container } = render(<InfiniteCarousel suppressClickAfterDrag>{[
      <div key="a">Drag surface</div>,
      <a key="b" href="/collections" onClick={onClick}>Browse collections</a>,
    ]}</InfiniteCarousel>);
    const track = container.querySelector('.carousel-track')!;
    fireEvent.mouseDown(track, { button: 0, clientX: 300, clientY: 100 });
    fireEvent.mouseMove(track, { clientX: 100, clientY: 100 });
    fireEvent.mouseLeave(track);
    const link = screen.getAllByText('Browse collections')[0];
    fireEvent.mouseDown(link, { button: 0 });
    fireEvent.mouseUp(link);
    fireEvent.click(link, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not apply pointer drag suppression to keyboard activation", () => {
    const onClick = vi.fn((event) => event.preventDefault());
    const { container } = render(<InfiniteCarousel suppressClickAfterDrag>{[
      <div key="a">Drag surface</div>,
      <a key="b" href="/collections" onClick={onClick}>Browse collections</a>,
    ]}</InfiniteCarousel>);
    const track = container.querySelector('.carousel-track')!;
    fireEvent.mouseDown(track, { button: 0, clientX: 300, clientY: 100 });
    fireEvent.mouseMove(track, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(track);
    fireEvent.click(screen.getAllByText('Browse collections')[0], { detail: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("suppresses the same drag click after leaving and re-entering the track", () => {
    const onClick = vi.fn((event) => event.preventDefault());
    const { container } = render(<InfiniteCarousel suppressClickAfterDrag>{[
      <a key="a" href="/letter/one" data-carousel-drag onClick={onClick}>Open scan</a>,
      <div key="b">Other slide</div>,
    ]}</InfiniteCarousel>);
    const link = screen.getAllByText('Open scan')[0];
    const track = container.querySelector('.carousel-track')!;
    fireEvent.mouseDown(link, { button: 0, clientX: 300, clientY: 100 });
    fireEvent.mouseMove(link, { clientX: 100, clientY: 100 });
    fireEvent.mouseLeave(track);
    fireEvent.mouseEnter(track);
    fireEvent.mouseUp(link);
    fireEvent.click(link, { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.mouseDown(link, { button: 0 });
    fireEvent.mouseUp(link);
    fireEvent.click(link, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  function touchMove(track: Element, x: number, y: number, fingers = 1) {
    const touches = Array.from({ length: fingers }, (_, index) => ({ identifier: index, clientX: x + index * 20, clientY: y }));
    const event = createEvent.touchMove(track, { touches, cancelable: true });
    fireEvent(track, event);
    return event;
  }

  it("leaves undecided and diagonal vertical gestures to page scrolling", () => {
    const { container } = render(<InfiniteCarousel>{[<div key="a">A</div>, <div key="b">B</div>]}</InfiniteCarousel>);
    const track = container.querySelector('.carousel-track')!;
    fireEvent.touchStart(track, { touches: [{ clientX: 100, clientY: 100 }] });
    expect(touchMove(track, 106, 105).defaultPrevented).toBe(false);
    expect(touchMove(track, 130, 125).defaultPrevented).toBe(false);
    expect(touchMove(track, 280, 130).defaultPrevented).toBe(false);
    fireEvent.touchEnd(track, { touches: [] });
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    expect(track).toHaveStyle({ transform: 'translateX(-100%)' });
  });

  it("keeps intentional horizontal touch swipes and ordinary tap activation", () => {
    const onClick = vi.fn((event) => event.preventDefault());
    const { container } = render(<InfiniteCarousel suppressClickAfterDrag>{[<a key="a" href="/letter/one" onClick={onClick}>Open touch scan</a>, <div key="b">B</div>]}</InfiniteCarousel>);
    const track = container.querySelector('.carousel-track')!;
    const link = screen.getAllByText('Open touch scan')[0];
    fireEvent.touchStart(link, { touches: [{ clientX: 300, clientY: 100 }] });
    expect(touchMove(track, 250, 110).defaultPrevented).toBe(true);
    expect(touchMove(track, 100, 220).defaultPrevented).toBe(true);
    fireEvent.touchEnd(track, { touches: [] });
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(link, { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.touchStart(link, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(link, { touches: [] });
    fireEvent.click(link, { detail: 1 });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'pinch'])("cancels a horizontal gesture on %s without changing slides", (reason) => {
    const { container } = render(<InfiniteCarousel>{[<div key="a">A</div>, <div key="b">B</div>]}</InfiniteCarousel>);
    const track = container.querySelector('.carousel-track')!;
    fireEvent.touchStart(track, { touches: [{ clientX: 300, clientY: 100 }] });
    expect(touchMove(track, 100, 105).defaultPrevented).toBe(true);
    if (reason === 'cancel') fireEvent.touchCancel(track, { touches: [] });
    else {
      fireEvent.touchStart(track, { touches: [{ clientX: 100, clientY: 105 }, { clientX: 150, clientY: 105 }] });
      expect(touchMove(track, 90, 100, 2).defaultPrevented).toBe(false);
    }
    fireEvent.touchEnd(track, { touches: reason === 'pinch' ? [{ clientX: 90, clientY: 100 }] : [] });
    expect(touchMove(track, 50, 100).defaultPrevented).toBe(false);
    fireEvent.touchEnd(track, { touches: [] });
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    expect(track).toHaveStyle({ transform: 'translateX(-100%)' });
  });

  it("does not turn trackpad pinch zoom into a carousel wheel swipe", () => {
    const { container } = render(<InfiniteCarousel>{[<div key="a">A</div>, <div key="b">B</div>]}</InfiniteCarousel>);
    const track = container.querySelector('.carousel-track')!;
    const event = createEvent.wheel(track, { deltaX: 100, deltaY: 0, ctrlKey: true, cancelable: true });
    fireEvent(track, event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
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

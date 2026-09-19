import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useCarouselDrag, { type UseCarouselDragReturn } from '../useCarouselDrag';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let resize: ResizeObserverCallback;
const OriginalResizeObserver = globalThis.ResizeObserver;
const disconnect = vi.fn();
const opened = vi.fn();
let motion: UseCarouselDragReturn['pageMotion'];
function flush(now = 0) {
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); });
}
function Harness({ loaded = true, identity = 'a' }: { loaded?: boolean; identity?: string }) {
  const { attachCarousel, activeIndex, carouselDraggedRef, scrollToSlide, pageMotion } = useCarouselDrag();
  motion = pageMotion;
  return <>
    {loaded && <div key={identity} ref={attachCarousel} data-testid="carousel">
      {[0, 1, 2].map(index => <div key={index} data-testid={`slide-${index}`}
        onClick={() => { if (!carouselDraggedRef.current) opened(index); }} />)}
    </div>}
    <output data-testid="active">{activeIndex}</output>
    <button onClick={() => scrollToSlide(2)}>Third</button>
    <button onClick={() => scrollToSlide(1, 'smooth', 240)}>Timed second</button>
  </>;
}
function geometry() {
  const carousel = screen.getByTestId('carousel');
  Object.defineProperty(carousel, 'clientWidth', { configurable: true, value: 200 });
  // The carousel is displaced from the document origin; offsets are unrelated.
  vi.spyOn(carousel, 'getBoundingClientRect').mockReturnValue({ left: 500, width: 200 } as DOMRect);
  [600, 820, 1040].forEach((center, index) => vi.spyOn(screen.getByTestId(`slide-${index}`), 'getBoundingClientRect')
    .mockImplementation(() => ({ left: center - carousel.scrollLeft - 90, width: 180 }) as DOMRect));
  return carousel;
}
beforeEach(() => {
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe = vi.fn(); unobserve = vi.fn(); disconnect = disconnect;
  };
  opened.mockClear(); disconnect.mockClear();
});
afterEach(() => { globalThis.ResizeObserver = OriginalResizeObserver; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('scan carousel lifecycle and position', () => {
  it('finishes the timed return slide within its budget and cancels it for gestures or newer choices', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const view = render(<Harness />); const carousel = geometry(); flush();
    carousel.scrollTo = vi.fn((options?: ScrollToOptions | number, _y?: number) => {
      carousel.scrollLeft = typeof options === 'number' ? options : options?.left ?? carousel.scrollLeft;
    });
    fireEvent.click(screen.getByText('Timed second'));
    flush(120);
    expect(carousel.scrollLeft).toBeGreaterThan(0);
    expect(carousel.scrollLeft).toBeLessThan(220);
    flush(240);
    expect(carousel.scrollLeft).toBe(220);
    expect(carousel.style.scrollSnapType).toBe('');
    for (const interrupt of ['gesture', 'selection', 'unmount']) {
      carousel.scrollLeft = 0;
      fireEvent.click(screen.getByText('Timed second'));
      flush(60);
      if (interrupt === 'gesture') fireEvent.wheel(carousel);
      else if (interrupt === 'selection') fireEvent.click(screen.getByText('Third'));
      else view.unmount();
      const stopped = carousel.scrollLeft;
      flush(240);
      expect(carousel.scrollLeft).toBe(stopped);
    }
  });
  it('does not restart thumbnail following after scrollend flushes a queued frame', () => {
    render(<Harness />); const carousel = geometry(); flush();
    carousel.scrollLeft = 160; fireEvent.scroll(carousel); flush();
    expect(motion.get()).toBeCloseTo(160 / 220);
    carousel.scrollLeft = 220; fireEvent.scroll(carousel);
    expect(frames.size).toBe(1);
    fireEvent(carousel, new Event('scrollend'));
    expect(screen.getByTestId('active')).toHaveTextContent('1');
    expect(motion.get()).toBeNull();
    flush();
    expect(motion.get()).toBeNull();
    expect(frames.size).toBe(0);
  });
  it('releases drag progress when a selection interrupts settling before scrollend', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    render(<Harness />); const carousel = geometry(); flush();
    carousel.scrollTo = vi.fn();
    carousel.scrollLeft = 160; fireEvent.scroll(carousel); flush();
    expect(motion.get()).toBeCloseTo(160 / 220);
    fireEvent.scroll(carousel);
    fireEvent.click(screen.getByText('Third'));
    expect(motion.get()).toBeNull();
    flush();
    expect(motion.get()).toBeNull();
    expect(screen.getByTestId('active')).toHaveTextContent('2');
  });
  it('attaches after initial loading and uses one coordinate system for the closest slide', () => {
    const view = render(<Harness loaded={false} />); view.rerender(<Harness />);
    const carousel = geometry(); flush();
    expect(screen.getByTestId('active')).toHaveTextContent('0');
    carousel.scrollLeft = 220; fireEvent.scroll(carousel); fireEvent.scroll(carousel);
    expect(frames.size).toBe(1); flush();
    expect(screen.getByTestId('active')).toHaveTextContent('1');
    carousel.scrollLeft = 440; fireEvent.scroll(carousel); flush();
    expect(screen.getByTestId('active')).toHaveTextContent('2');
  });
  it('recalculates on slide/container resize and window resize', () => {
    render(<Harness />); const carousel = geometry(); flush();
    carousel.scrollLeft = 220; act(() => resize([], {} as ResizeObserver)); flush();
    expect(screen.getByTestId('active')).toHaveTextContent('1');
    carousel.scrollLeft = 440; fireEvent(window, new Event('resize')); flush();
    expect(screen.getByTestId('active')).toHaveTextContent('2');
  });
  it('rebinds on letter replacement and cancels pending work on removal', () => {
    const view = render(<Harness />); const old = geometry(); flush();
    old.scrollLeft = 440; fireEvent.scroll(old); flush();
    view.rerender(<Harness identity="b" />); const current = geometry(); flush();
    expect(screen.getByTestId('active')).toHaveTextContent('0');
    fireEvent.scroll(old); expect(frames.size).toBe(0);
    current.scrollLeft = 220; fireEvent.scroll(current); flush();
    expect(screen.getByTestId('active')).toHaveTextContent('1');
    fireEvent.scroll(current); view.unmount();
    expect(frames.size).toBe(0); expect(disconnect).toHaveBeenCalled();
  });
  it('keeps mouse dragging, suppresses its click and permits the next simple click', () => {
    const view = render(<Harness loaded={false} />); view.rerender(<Harness />);
    const carousel = geometry(); flush();
    fireEvent.mouseDown(carousel, { clientX: 300 }); fireEvent.mouseMove(document, { clientX: 100 });
    expect(carousel.scrollLeft).toBe(200); expect(carousel.style.scrollSnapType).toBe('none');
    fireEvent.mouseUp(document); fireEvent.click(screen.getByTestId('slide-1'));
    expect(opened).not.toHaveBeenCalled(); expect(carousel.style.scrollSnapType).toBe('');
    fireEvent.mouseDown(carousel, { clientX: 100 }); fireEvent.mouseUp(document);
    fireEvent.click(screen.getByTestId('slide-1')); expect(opened).toHaveBeenCalledWith(1);
  });
  it('does not let a stale scrollend steal the requested target and returns snapping to gestures', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    render(<Harness />); const carousel = geometry();
    carousel.scrollTo = vi.fn();
    fireEvent.click(screen.getByText('Third'));
    expect(carousel.style.scrollSnapType).toBe('none');
    fireEvent(carousel, new Event('scrollend'));
    expect(carousel.style.scrollSnapType).toBe('none');
    carousel.scrollLeft = 440;
    fireEvent(carousel, new Event('scrollend'));
    expect(carousel.style.scrollSnapType).toBe('');
    fireEvent.click(screen.getByText('Third'));
    fireEvent.touchStart(carousel);
    expect(carousel.style.scrollSnapType).toBe('');
  });
  it.each([false, true])('pages only the carousel using viewport geometry (reduced motion=%s)', (reducedMotion) => {
    vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
    render(<Harness />); const carousel = geometry();
    carousel.scrollLeft = 220;
    const scrollTo = vi.fn(); carousel.scrollTo = scrollTo;
    const scrollIntoView = vi.fn(); screen.getByTestId('slide-2').scrollIntoView = scrollIntoView;
    fireEvent.click(screen.getByText('Third'));
    expect(scrollTo).toHaveBeenCalledWith({ left: 440, behavior: reducedMotion ? 'instant' : 'smooth' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
  it('keeps the clicked page selected during smooth travel and yields to a new gesture', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    render(<Harness />); const carousel = geometry(); flush();
    carousel.scrollTo = vi.fn();
    fireEvent.click(screen.getByText('Third'));
    expect(screen.getByTestId('active')).toHaveTextContent('2');
    carousel.scrollLeft = 220;
    fireEvent.scroll(carousel); flush();
    expect(screen.getByTestId('active')).toHaveTextContent('2');
    fireEvent.touchStart(carousel);
    fireEvent.scroll(carousel); flush();
    expect(screen.getByTestId('active')).toHaveTextContent('1');
  });
});

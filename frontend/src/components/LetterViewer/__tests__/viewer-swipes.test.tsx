import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LetterViewer from '../LetterViewer';
import type { LetterImage } from '../../../types/Letter';

vi.mock('../../../hooks/useProgressiveImage', () => ({ useProgressiveImage: () => ({ fullLoaded: true, midLoaded: true, fullAdmitted: true, onFullLoad: vi.fn(), onFullError: vi.fn() }) }));
vi.mock('../useScanDisplayWidth', () => ({ useScanDisplayWidth: () => 400 }));
const images: LetterImage[] = [1, 2, 3].map(pageNumber => ({
  id: `page-${pageNumber}`, type: 'letter', pageNumber, imageUrl: `/images/page-${pageNumber}`, width: 1200, height: 1600,
}));
const originalScrollTo = HTMLElement.prototype.scrollTo;
let frames: Map<number, FrameRequestCallback>;
let id: number;
const frame = () => act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(0)); });
function touch(node: Element, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: number[][]) {
  const event = createEvent[type](node, { touches: points.map(([clientX, clientY]) => ({ clientX, clientY })), cancelable: true });
  fireEvent(node, event);
  return event;
}
function finish(carriage: Element) {
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: 'transform' });
  fireEvent(carriage, event);
}
function setup() {
  const view = render(<LetterViewer images={images} variant="lightbox" />);
  return { ...view, target: view.container.querySelector('.viewer-container')!, carriage: view.container.querySelector('.viewer-carriage')!, image: () => view.container.querySelector('.viewer-image')! };
}
function swipe(target: Element, distance = 100) {
  touch(target, 'touchStart', [[300, 300]]);
  touch(target, 'touchMove', [[300 - distance, 302]]); frame();
  touch(target, 'touchEnd', []); frame();
}
beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.useFakeTimers(); localStorage.clear(); frames = new Map(); id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.tagName === 'IMG' ? 300 : 390; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.tagName === 'IMG' ? 400 : 600; });
});
afterEach(() => { HTMLElement.prototype.scrollTo = originalScrollTo; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('fullscreen fit-view swipes', () => {
  it('animates a responsive fit swipe and commits only when its carriage finishes', () => {
    const { target, carriage, image, container } = setup();
    swipe(target, 60); // 15% of390px, below the former78px threshold.
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(carriage).toHaveStyle({ transform: 'translate3d(-390px, 0, 0)' });
    expect((carriage as HTMLElement).style.transition).toMatch(/transform (1\d\d|2[0-3]\d)ms/);
    expect([...container.querySelectorAll('.viewer-swipe-neighbor img')].every(img => img.getAttribute('src')?.includes('w=480'))).toBe(true);
    finish(carriage);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(carriage).toHaveStyle({ transform: 'translate3d(0px, 0, 0)', transition: 'none' });
    expect(image().getAttribute('src')).toContain('page-2');
    expect(image().getAttribute('src')).toContain('w=');
  });
  it('animates an under-threshold release back to zero without changing pages', () => {
    const { target, carriage } = setup(); swipe(target, 25);
    expect(carriage).toHaveStyle({ transform: 'translate3d(0px, 0, 0)' });
    expect((carriage as HTMLElement).style.transition).toMatch(/transform (1\d\d|2[0-3]\d)ms/);
    finish(carriage);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
  it('locks diagonal intent and leaves a vertical gesture out of navigation', () => {
    const { target, carriage } = setup();
    touch(target, 'touchStart', [[300, 300]]);
    expect(touch(target, 'touchMove', [[270, 275]]).defaultPrevented).toBe(false);
    touch(target, 'touchMove', [[100, 270]]); frame(); touch(target, 'touchEnd', []); frame();
    expect(carriage).toHaveStyle({ transform: 'translate3d(0px, 0, 0)' });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
  it('keeps the scan under a translating two-finger midpoint', () => {
    const { target, container } = setup();
    fireEvent.doubleClick(target);
    touch(target, 'touchStart', [[100, 250], [200, 250]]);
    touch(target, 'touchMove', [[140, 250], [240, 250]]);
    expect(container.querySelector('.viewer-transform')?.getAttribute('style')).toContain('translate3d(40px');
    expect(screen.getByText('250%')).toBeInTheDocument();
    touch(target, 'touchMove', [[160, 250], [260, 250]]);
    expect(container.querySelector('.viewer-transform')?.getAttribute('style')).toContain('translate3d(60px');
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
  it('pans while zoomed without navigating and still supports double-tap zoom out', () => {
    const { target, carriage, container } = setup(); fireEvent.doubleClick(target);
    expect(screen.getByText('250%')).toBeInTheDocument();
    touch(target, 'touchStart', [[300, 300]]); touch(target, 'touchMove', [[200, 300]]); touch(target, 'touchEnd', []);
    expect(container.querySelector('.viewer-transform')?.getAttribute('style')).toContain('translate3d(-100px');
    expect(carriage).toHaveStyle({ transform: 'translate3d(0px, 0, 0)' });
    act(() => vi.advanceTimersByTime(350));
    touch(target, 'touchStart', [[200, 200]]); touch(target, 'touchEnd', []);
    act(() => vi.advanceTimersByTime(100));
    touch(target, 'touchStart', [[200, 200]]); touch(target, 'touchEnd', []);
    expect(screen.getByText('100%')).toBeInTheDocument(); expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
  it('does not mistake the preceding pan for the first half of a double-tap', () => {
    const { target } = setup(); fireEvent.doubleClick(target);
    touch(target, 'touchStart', [[300, 300]]); touch(target, 'touchMove', [[200, 300]]); touch(target, 'touchEnd', []);
    fireEvent.doubleClick(target); expect(screen.getByText('100%')).toBeInTheDocument();
    touch(target, 'touchStart', [[300, 300]]);
    expect(screen.getByText('100%')).toBeInTheDocument();
    touch(target, 'touchEnd', []);
  });
  it('cancels a partial swipe when pinch takes over and never commits after pinch', () => {
    const { target, carriage } = setup();
    touch(target, 'touchStart', [[300, 300]]); touch(target, 'touchMove', [[180, 300]]); frame();
    touch(target, 'touchStart', [[100, 300], [200, 300]]);
    touch(target, 'touchMove', [[50, 300], [250, 300]]);
    touch(target, 'touchEnd', [[50, 300]]); touch(target, 'touchEnd', []); frame();
    expect(screen.getByText('200%')).toBeInTheDocument();
    expect(carriage).toHaveStyle({ transform: 'translate3d(0px, 0, 0)' });
    act(() => vi.advanceTimersByTime(500)); expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
  it('cancels on touchcancel and on navigation buttons, ignoring stale animation completion', () => {
    const { target, carriage } = setup();
    touch(target, 'touchStart', [[300, 300]]); touch(target, 'touchMove', [[100, 300]]); frame();
    touch(target, 'touchCancel', []); touch(target, 'touchEnd', []); frame();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    swipe(target); fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    finish(carriage); act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText('2 / 3')).toBeInTheDocument(); expect(carriage).toHaveStyle({ transition: 'none' });
  });
  it('completes the latest settling target through the fallback exactly once', () => {
    const { target, carriage } = setup(); swipe(target); swipe(target);
    act(() => vi.advanceTimersByTime(310)); expect(screen.getByText('2 / 3')).toBeInTheDocument();
    finish(carriage); expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });
  it('cancels pending commit if images change or the viewer unmounts', () => {
    const view = setup(); swipe(view.target);
    view.rerender(<LetterViewer images={images.map(img => ({ ...img, id: `new-${img.id}` }))} variant="lightbox" />);
    act(() => vi.advanceTimersByTime(500)); expect(screen.getByText('1 / 3')).toBeInTheDocument();
    swipe(view.target); view.unmount(); expect(frames.size).toBe(0);
    act(() => vi.advanceTimersByTime(500));
  });
  it('preserves bounded displayed-image retry after a swipe commits', () => {
    const { target, carriage, image } = setup(); swipe(target); finish(carriage);
    const failed = image(); const source = failed.getAttribute('src');
    fireEvent.error(failed); act(() => vi.advanceTimersByTime(1000));
    expect(image()).not.toBe(failed); expect(image().getAttribute('src')).toBe(source);
    expect(source).toContain('page-2'); expect(source).toContain('w=');
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });
  it('hides failed neighboring previews, retries their bounded URL, and cancels when the gesture ends', () => {
    const { target, carriage, container } = setup();
    touch(target, 'touchStart', [[300, 300]]);
    touch(target, 'touchMove', [[200, 302]]); frame();
    const neighbor = () => container.querySelector('.viewer-swipe-neighbor img')!;
    const first = neighbor(); const source = first.getAttribute('src');
    expect(source).toContain('w=480');
    fireEvent.error(first);
    expect(first).not.toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    const replacement = neighbor();
    expect(replacement).not.toBe(first);
    expect(replacement.getAttribute('src')).toBe(source);
    fireEvent.load(replacement);
    expect(replacement).toBeVisible();
    fireEvent.error(replacement);
    touch(target, 'touchEnd', []); frame(); finish(carriage);
    expect(container.querySelector('.viewer-swipe-neighbor')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(500)); // Existing zoom/persistence timers finish before the 2s retry.
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });
  it('lets a fresh touch take over an unfinished slide without committing the old target', () => {
    const { target, carriage } = setup(); swipe(target);
    // The CSS transition is halfway to page 2 when the next gesture starts.
    const original = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => element === carriage
      ? { transform: 'matrix(1, 0, 0, 1, -150, 0)' } as CSSStyleDeclaration : original(element));
    touch(target, 'touchStart', [[160, 300]]);
    touch(target, 'touchMove', [[310, 300]]); frame();
    expect((carriage as HTMLElement).style.transform).toBe('translate3d(0px, 0, 0)');
    touch(target, 'touchCancel', []);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
  it('responds after eight pixels and distinguishes a short flick from a paused drag', () => {
    const { target, carriage } = setup();
    touch(target, 'touchStart', [[300, 300]]);
    act(() => vi.advanceTimersByTime(20));
    touch(target, 'touchMove', [[290, 300]]); frame();
    expect(carriage).toHaveStyle({ transform: 'translate3d(-10px, 0, 0)' });
    act(() => vi.advanceTimersByTime(20));
    touch(target, 'touchMove', [[270, 300]]); frame();
    touch(target, 'touchEnd', []); frame(); finish(carriage);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(400));
    touch(target, 'touchStart', [[300, 300]]);
    act(() => vi.advanceTimersByTime(40));
    touch(target, 'touchMove', [[270, 300]]); frame();
    act(() => vi.advanceTimersByTime(300));
    touch(target, 'touchEnd', []); frame(); finish(carriage);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });
  it('selects a drawer page at Fit while retaining the drawer and its selected state', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    const choice = screen.getByRole('button', { name: 'Go to scan 3: letter' });
    fireEvent.click(choice);
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(choice).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Pages' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    expect(screen.queryByRole('region', { name: 'Scan pages' })).not.toBeInTheDocument();
  });
  it('keeps the transform surface while a higher resolution replaces the image', () => {
    const { target, container, image } = setup();
    const surface = container.querySelector('.viewer-transform');
    const before = image();
    fireEvent.doubleClick(target);
    expect(container.querySelector('.viewer-transform')).toBe(surface);
    expect(image()).not.toBe(before);
    expect(surface).toHaveClass('animating');
    expect(surface?.getAttribute('style')).toContain('scale(2.5)');
  });
  it('honors reduced motion for zoom as well as page changes', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { target, container } = setup();
    fireEvent.doubleClick(target);
    expect(container.querySelector('.viewer-transform')).not.toHaveClass('animating');
    expect(screen.getByText('250%')).toBeInTheDocument();
  });
  it('does not overwrite the admin panel saved view when fullscreen is used', () => {
    const saved = JSON.stringify({ letterId: 'same', images: { 'page-1': { scale: 3, position: { x: 12, y: 15 } } } });
    localStorage.setItem('letterViewerState', saved);
    const view = render(<LetterViewer images={images} letterId="same" variant="lightbox" />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    act(() => vi.advanceTimersByTime(500));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    view.unmount();
    expect(localStorage.getItem('letterViewerState')).toBe(saved);
  });
  it('honors reduced motion with immediate fit navigation', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { target, carriage } = setup(); swipe(target);
    expect(screen.getByText('2 / 3')).toBeInTheDocument(); expect(carriage).toHaveStyle({ transition: 'none' });
  });
});

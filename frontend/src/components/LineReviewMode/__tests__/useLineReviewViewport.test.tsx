// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLineReviewViewport } from '../useLineReviewViewport';

const originalResizeObserver = globalThis.ResizeObserver;
const observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
function Harness({ page = 'page-1', panEnabled = true }: { page?: string; panEnabled?: boolean }) {
  const { containerRef, imageRef, handlePanMouseDown, handlePanMouseMove, handlePanMouseUp, handleImageLoad, handleMinimapPointerDown, handleMinimapPointerMove, handleMinimapPointerEnd, toggleFit, fitZoom, fitPan, isPanning, imageNaturalSize, imageDisplaySize, minimap } = useLineReviewViewport({ pageIdentity: page, initiallyFit: true, panEnabled });
  return <div ref={containerRef} data-testid="viewport" onMouseDown={handlePanMouseDown}
    onMouseMove={handlePanMouseMove} onMouseUp={handlePanMouseUp}>
    <img ref={imageRef} alt="scan" onLoad={handleImageLoad} />
    <div data-testid="minimap" onPointerDown={handleMinimapPointerDown} onPointerMove={handleMinimapPointerMove}
      onPointerUp={handleMinimapPointerEnd} onPointerCancel={handleMinimapPointerEnd} onLostPointerCapture={handleMinimapPointerEnd} />
    <button onClick={toggleFit}>Fit</button>
    <output>{JSON.stringify({ zoom: fitZoom, pan: fitPan, panning: isPanning,
      natural: imageNaturalSize, display: imageDisplaySize, minimap: minimap })}</output>
  </div>;
}
function state() { return JSON.parse(screen.getByRole('status').textContent!); }
function measure() {
  const image = screen.getByAltText('scan');
  Object.defineProperties(image, {
    naturalWidth: { value: 1000 }, naturalHeight: { value: 1400 },
    clientWidth: { value: 500 }, clientHeight: { value: 700 },
  });
  fireEvent.load(image);
  act(() => observers.at(-1)!.callback([
    { target: screen.getByTestId('viewport'), contentRect: { width: 400, height: 600 } },
  ] as unknown as ResizeObserverEntry[], {} as ResizeObserver));
}
function pointer(element: HTMLElement, type: string, clientX = 80, clientY = 100) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerId: 12, clientX, clientY });
  fireEvent(element, event);
}
function zoom() { fireEvent.wheel(screen.getByTestId('viewport'), { ctrlKey: true, deltaY: -100 }); }

describe('line review viewport owner', () => {
  beforeEach(() => {
    observers.length = 0;
    globalThis.ResizeObserver = class {
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();
      constructor(callback: ResizeObserverCallback) { observers.push({ callback, disconnect: this.disconnect }); }
    };
  });
  afterEach(() => { globalThis.ResizeObserver = originalResizeObserver; });

  it('resets geometry by page identity and ignores disconnected observer callbacks', () => {
    const { rerender, unmount } = render(<Harness />);
    measure(); zoom();
    expect(state().zoom).toBeGreaterThan(1);
    const previous = observers.at(-1)!;
    rerender(<Harness page="replacement-at-same-index" />);
    expect(previous.disconnect).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ zoom: 1, pan: { x: 0, y: 0 }, natural: { width: 0, height: 0 }, display: { width: 0, height: 0 } });
    act(() => previous.callback([{ contentRect: { width: 999, height: 999 } }] as unknown as ResizeObserverEntry[], {} as ResizeObserver));
    expect(state().display.width).toBe(0);
    const current = observers.at(-1)!;
    unmount();
    expect(current.disconnect).toHaveBeenCalledTimes(1);
  });

  it('clamps zoom and pan, updates minimap on container resize, and ends pan outside the image', () => {
    render(<Harness />); measure();
    const viewport = screen.getByTestId('viewport');
    fireEvent.wheel(viewport, { deltaY: -100 });
    expect(state().zoom).toBe(1);
    zoom();
    fireEvent.mouseDown(viewport, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(viewport, { clientX: 10000, clientY: 10000 });
    const panned = state();
    expect(panned.pan.x).toBeCloseTo((panned.zoom * 500 - 400) / 2);
    expect(panned.pan.y).toBeCloseTo((panned.zoom * 700 - 600) / 2);
    expect(parseFloat(panned.minimap.width)).toBeCloseTo(400 / (panned.zoom * 500) * 100);
    act(() => observers.at(-1)!.callback([{ target: viewport, contentRect: { width: 300, height: 500 } }] as unknown as ResizeObserverEntry[], {} as ResizeObserver));
    expect(parseFloat(state().minimap.width)).toBeCloseTo(300 / (panned.zoom * 500) * 100);
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(viewport, { clientX: -10000, clientY: -10000 });
    expect(state().panning).toBe(false);
    expect(state().pan).toEqual(panned.pan);
    fireEvent.wheel(viewport, { metaKey: true, deltaY: 10000 });
    expect(state()).toMatchObject({ zoom: 1, pan: { x: 0, y: 0 }, minimap: null });
  });

  it.each(['cancel', 'lostcapture', 'page', 'unmount'] as const)('releases minimap capture on %s and ignores late pointer movement', outcome => {
    const { rerender, unmount } = render(<Harness />); measure(); zoom();
    const minimap = screen.getByTestId('minimap');
    const release = vi.fn();
    minimap.setPointerCapture = vi.fn();
    minimap.hasPointerCapture = vi.fn(() => true);
    minimap.releasePointerCapture = release;
    minimap.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 140 } as DOMRect);
    pointer(minimap, 'pointerdown');
    if (outcome === 'cancel') pointer(minimap, 'pointercancel');
    else if (outcome === 'lostcapture') pointer(minimap, 'lostpointercapture');
    else if (outcome === 'page') rerender(<Harness page="page-2" />);
    else unmount();
    expect(release).toHaveBeenCalledExactlyOnceWith(12);
    if (outcome !== 'unmount') {
      const previous = state().pan;
      pointer(minimap, 'pointermove', 0, 0);
      expect(state().pan).toEqual(previous);
    }
  });

  it('stops active pan when a drawing tool takes over', () => {
    const { rerender } = render(<Harness />); measure(); zoom();
    const viewport = screen.getByTestId('viewport');
    fireEvent.mouseDown(viewport, { clientX: 10, clientY: 10 });
    expect(state().panning).toBe(true);
    rerender(<Harness panEnabled={false} />);
    fireEvent.mouseMove(viewport, { clientX: 100, clientY: 100 });
    expect(state()).toMatchObject({ panning: false, pan: { x: 0, y: 0 } });
    rerender(<Harness />);
    fireEvent.mouseMove(viewport, { clientX: 100, clientY: 100 });
    expect(state().pan).toEqual({ x: 0, y: 0 });
  });
});

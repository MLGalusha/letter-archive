import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageMotion } from '../pageMotion';
import { usePageStripMotion } from '../usePageStripMotion';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const motion = createPageMotion();
const originalResizeObserver = globalThis.ResizeObserver;
function Harness({ selected }: { selected: number }) {
  const { root } = usePageStripMotion(selected, () => {}, motion, 2);
  return <div ref={root} data-testid="strip"><button /><button /></div>;
}
function frameAt(time: number) {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(time));
  });
}
beforeEach(() => {
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback); return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(performance, 'now').mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'BUTTON') {
      const index = Array.from(this.parentElement!.children).indexOf(this);
      return { left: index * 64 - this.parentElement!.scrollLeft, width: 56 } as DOMRect;
    }
    return { left: 0, width: 56 } as DOMRect;
  });
});
afterEach(() => { globalThis.ResizeObserver = originalResizeObserver; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('thumbnail centering', () => {
  it.each([0, 1])('does not reverse at a main-image handoff to page %s when the frame predates the animation', selected => {
    render(<Harness selected={selected} />);
    const strip = screen.getByTestId('strip');
    act(() => { motion.publish(0.5); motion.publish(null); });
    expect(strip.scrollLeft).toBe(32);
    // rAF timestamps mark the frame, not the callback's invocation time.
    // Scroll events can start centering later within that same frame.
    frameAt(90);
    expect(strip.scrollLeft).toBe(32);
    frameAt(160);
    expect(strip.scrollLeft).toBeGreaterThanOrEqual(selected ? 32 : 0);
    expect(strip.scrollLeft).toBeLessThanOrEqual(selected ? 64 : 32);
    frameAt(280);
    expect(strip.scrollLeft).toBe(selected * 64);
    expect(strip.style.scrollSnapType).toBe('');
    expect(frames.size).toBe(0);
  });
});

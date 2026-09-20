import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useCarouselMotion from '../useCarouselMotion';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([0, 300])('never moves backward when the first frame predates settling toward %s', target => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(performance, 'now').mockReturnValue(100);
  const element = document.createElement('div');
  element.scrollLeft = 150;
  element.scrollTo = vi.fn(options => { element.scrollLeft = (options as ScrollToOptions).left ?? 0; });
  const { result } = renderHook(useCarouselMotion);
  const frameAt = (time: number) => act(() => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(time));
  });
  act(() => result.current.move(element, target));
  frameAt(90);
  expect(element.scrollLeft).toBe(150);
  frameAt(180);
  expect(element.scrollLeft).toBeGreaterThanOrEqual(Math.min(150, target));
  expect(element.scrollLeft).toBeLessThanOrEqual(Math.max(150, target));
  frameAt(260);
  expect(element.scrollLeft).toBe(target);
  expect(element.style.scrollSnapType).toBe('');
  expect(frames.size).toBe(0);
});

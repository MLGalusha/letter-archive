import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProgressiveImage } from '../useProgressiveImage';
vi.mock('../../utils/imagePerformance', () => ({ recordImageLoad: vi.fn() }));
vi.mock('../../services/imagePreloadService', () => ({ imagePreloadService: { isPreloaded: () => false } }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('progressive image recovery', () => {
  it('retries failed tiers twice at their original width, stops, and cancels on replacement/unmount', () => {
    vi.useFakeTimers();
    const requested: string[] = [];
    const images: Array<{ url: string; onload: (() => void) | null; onerror: (() => void) | null }> = [];
    const latest = (url: string) => images.filter((img) => img.url === url).at(-1)!;
    vi.stubGlobal('Image', class {
      url = ''; complete = false; naturalWidth = 480; naturalHeight = 640;
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor() { images.push(this); }
      set src(value: string) { this.url = value; requested.push(value); }
    });
    const { result, rerender, unmount } = renderHook(({ id }) => useProgressiveImage({ thumbSrc: `/${id}?w=32`, fullSrc: `/${id}?w=480` }), { initialProps: { id: 'old' } });
    act(() => { images[0].onerror?.(); images[1].onerror?.(); vi.advanceTimersByTime(1000); });
    expect(requested).toEqual(['/old?w=32', '/old?w=480', '/old?w=32', '/old?w=480']);
    act(() => latest('/old?w=480').onload?.());
    expect(result.current.currentSrc).toBe('/old?w=480');
    act(() => { latest('/old?w=32').onerror?.(); vi.advanceTimersByTime(2000); latest('/old?w=32').onerror?.(); vi.advanceTimersByTime(60000); });
    expect(requested.filter((url) => url === '/old?w=32')).toHaveLength(3);
    rerender({ id: 'new' });
    act(() => latest('/new?w=32').onerror?.());
    rerender({ id: 'replacement' });
    act(() => vi.advanceTimersByTime(10000));
    expect(requested.filter((url) => url === '/new?w=32')).toHaveLength(1);
    expect(result.current.currentSrc).toBe('');
    act(() => latest('/replacement?w=32').onerror?.());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(images.every((img) => img.onload === null && img.onerror === null)).toBe(true);
    expect(requested.every((url) => url.includes('?w='))).toBe(true);
  });
});

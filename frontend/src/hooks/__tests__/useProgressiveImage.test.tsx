import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProgressiveImage } from '../useProgressiveImage';
import { imagePreloadService } from '../../services/imagePreloadService';
vi.mock('../../utils/imagePerformance', () => ({ recordImageLoad: vi.fn() }));
vi.mock('../../services/imagePreloadService', () => ({ imagePreloadService: { isPreloaded: () => false, getDimensions: () => null, recordLoaded: vi.fn() } }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
      removeAttribute() { this.url = ''; }
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
  it('releases only its unfinished loads and assigns priority before starting a request', () => {
    const images: Array<{ complete: boolean; onload: (() => void) | null; removeAttribute: ReturnType<typeof vi.fn>; priorityAtStart: string }> = [];
    vi.stubGlobal('Image', class {
      complete = false; naturalWidth = 480; naturalHeight = 640;
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      fetchPriority = 'auto'; priorityAtStart = '';
      removeAttribute = vi.fn();
      constructor() { images.push(this); }
      set src(_value: string) { this.priorityAtStart = this.fetchPriority; }
    });
    const { unmount } = renderHook(() => useProgressiveImage({
      thumbSrc: '/thumb', fullSrc: '/full', fetchPriority: 'high',
    }));
    act(() => { images[0].complete = true; images[0].onload?.(); });
    unmount();
    expect(images.map((image) => image.priorityAtStart)).toEqual(['high', 'high']);
    expect(images[0].removeAttribute).not.toHaveBeenCalled();
    expect(images[1].removeAttribute).toHaveBeenCalledWith('src');
  });

  it('updates pending and loaded priorities without restarting requests or readiness', () => {
    const images: Array<{ url: string; complete: boolean; onload: (() => void) | null; fetchPriority: string; removeAttribute: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal('Image', class {
      url = ''; complete = false; naturalWidth = 480; naturalHeight = 640;
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      fetchPriority = 'auto'; removeAttribute = vi.fn();
      constructor() { images.push(this); }
      set src(value: string) { this.url = value; }
    });
    const { result, rerender } = renderHook(({ fetchPriority }) => useProgressiveImage({
      thumbSrc: '/thumb', fullSrc: '/full', fetchPriority,
    }), { initialProps: { fetchPriority: 'auto' as 'auto' | 'high' | 'low' } });
    act(() => { images[0].complete = true; images[0].onload?.(); });
    rerender({ fetchPriority: 'high' });
    expect(images).toHaveLength(2);
    expect(images.every((img) => img.fetchPriority === 'high' && img.removeAttribute.mock.calls.length === 0)).toBe(true);
    expect(result.current.currentSrc).toBe('/thumb');
    act(() => { images[1].complete = true; images[1].onload?.(); });
    rerender({ fetchPriority: 'low' });
    expect(images).toHaveLength(2);
    expect(result.current).toMatchObject({ fullLoaded: true, currentSrc: '/full', naturalWidth: 480, naturalHeight: 640 });
  });

  it('keeps the queued deadline and uses current priority for delayed loads and retries', () => {
    vi.useFakeTimers();
    const starts: Array<{ url: string; priority: string }> = [];
    const images: Array<{ onerror: (() => void) | null }> = [];
    vi.stubGlobal('Image', class {
      complete = false; naturalWidth = 480; naturalHeight = 640;
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      fetchPriority = 'auto'; removeAttribute = vi.fn();
      constructor() { images.push(this); }
      set src(value: string) { starts.push({ url: value, priority: this.fetchPriority }); }
    });
    const { rerender } = renderHook(({ fetchPriority }) => useProgressiveImage({
      thumbSrc: '/thumb', fullSrc: '/full', fullDelay: 1000, fetchPriority,
    }), { initialProps: { fetchPriority: 'auto' as 'auto' | 'high' | 'low' } });
    act(() => vi.advanceTimersByTime(400));
    rerender({ fetchPriority: 'high' });
    act(() => vi.advanceTimersByTime(600));
    expect(starts).toEqual([{ url: '/thumb', priority: 'auto' }, { url: '/full', priority: 'high' }]);
    act(() => images[1].onerror?.());
    rerender({ fetchPriority: 'low' });
    act(() => vi.advanceTimersByTime(1000));
    expect(starts).toEqual([{ url: '/thumb', priority: 'auto' }, { url: '/full', priority: 'high' }, { url: '/full', priority: 'low' }]);
  });

  it('admits a DOM-owned full tier without fetching it and ignores obsolete DOM completion', () => {
    vi.useFakeTimers();
    const requested: string[] = [];
    vi.stubGlobal('Image', class {
      complete = true; naturalWidth = 32; naturalHeight = 48;
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { requested.push(value); }
    });
    const { result, rerender } = renderHook(({ id }) => useProgressiveImage({
      thumbSrc: `/${id}-thumb`, fullSrc: `/${id}-full`, fullLoadMode: 'dom', fullDelay: 1000,
    }), { initialProps: { id: 'first' } });
    expect(result.current).toMatchObject({ fullAdmitted: false, fullLoaded: false });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toMatchObject({ fullAdmitted: true, fullLoaded: false });
    expect(requested).toEqual(['/first-thumb']);
    const obsoleteLoad = result.current.onFullLoad;
    rerender({ id: 'second' });
    act(() => obsoleteLoad({ naturalWidth: 480, naturalHeight: 640 } as HTMLImageElement));
    expect(result.current).toMatchObject({ fullAdmitted: false, fullLoaded: false, currentSrc: '/second-thumb' });
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.onFullLoad({ naturalWidth: 480, naturalHeight: 640 } as HTMLImageElement));
    expect(result.current).toMatchObject({ fullAdmitted: true, fullLoaded: true, currentSrc: '/second-full' });
    expect(requested).toEqual(['/first-thumb', '/second-thumb']);
  });

  it('never fetches the DOM full URL through an identical lower-tier alias', () => {
    vi.stubGlobal('Image', class { constructor() { throw new Error('Unexpected background request'); } });
    const { result } = renderHook(() => useProgressiveImage({
      thumbSrc: '/same', midSrc: '/same', fullSrc: '/same', fullLoadMode: 'dom',
    }));
    expect(result.current).toMatchObject({ fullAdmitted: true, fullLoaded: false });
  });

  it('admits a previously preloaded DOM image but waits for that DOM owner to load', () => {
    vi.spyOn(imagePreloadService, 'isPreloaded').mockReturnValue(true);
    vi.stubGlobal('Image', class { constructor() { throw new Error('Unexpected background request'); } });
    const { result } = renderHook(() => useProgressiveImage({
      thumbSrc: '/same', fullSrc: '/same', fullLoadMode: 'dom', fullDelay: 1000,
    }));
    expect(result.current).toMatchObject({ fullAdmitted: true, fullLoaded: false });
    act(() => result.current.onFullLoad({ naturalWidth: 480, naturalHeight: 640 } as HTMLImageElement));
    expect(result.current).toMatchObject({ fullLoaded: true, naturalWidth: 480, naturalHeight: 640 });
  });

});

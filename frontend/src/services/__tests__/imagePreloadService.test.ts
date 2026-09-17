import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImagePreloadService } from '../imagePreloadService';

vi.mock('../../api/client', () => ({
  getImageUrl: (url: string, options: { width: number }) => `${url}&width=${options.width}`,
}));
class TestImage {
  static requests: TestImage[] = [];
  onload: (() => void) | null = null;
  naturalWidth = 1200; naturalHeight = 1600; complete = false;
  fetchPriority = ''; src = ''; removed = false;
  constructor() { TestImage.requests.push(this); }
  removeAttribute() { this.removed = true; }
}
describe('bounded rendition handoff', () => {
  let service: ImagePreloadService;
  beforeEach(() => { TestImage.requests = []; vi.stubGlobal('Image', TestImage); service = new ImagePreloadService(); });
  afterEach(() => { service.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('reuses a loaded versioned preview without starting another tier', () => {
    service.recordLoaded('/scan?v=one&width=480', { naturalWidth: 480, naturalHeight: 640 });
    expect(service.availablePreview('/scan?v=one', 1200)).toBe('/scan?v=one&width=480');
    expect(service.availablePreview('/scan?v=two', 1200)).toBeUndefined();
    expect(service.availablePreview('/scan?v=one', 480)).toBeUndefined();
    expect(TestImage.requests).toHaveLength(0);
  });
  it('starts at most two exact low-priority neighbors and cancels only their owner', () => {
    const cancelFirst = service.preloadNeighbors(['/first?w=1200', '/second?w=1200', '/distant?w=1200']);
    expect(TestImage.requests).toHaveLength(2);
    expect(TestImage.requests.every(image => image.fetchPriority === 'low')).toBe(true);
    const late = TestImage.requests[0].onload!;
    const cancelOther = service.preloadNeighbors(['/other?w=480']);
    cancelFirst(); late();
    expect(service.isPreloaded('/first?w=1200')).toBe(false);
    expect(TestImage.requests[2].removed).toBe(false);
    TestImage.requests[2].onload?.();
    expect(service.isPreloaded('/other?w=480')).toBe(true);
    cancelOther();
  });
  it('does not cache failed/empty images and skips successful known variants', () => {
    service.recordLoaded('/failed', { naturalWidth: 0, naturalHeight: 0 });
    service.recordLoaded('/loaded', { naturalWidth: 480, naturalHeight: 640 });
    service.preloadNeighbors(['/failed', '/loaded', '/failed']);
    expect(TestImage.requests.map(image => image.src)).toEqual(['/failed']);
    expect(service.isPreloaded('/failed')).toBe(false);
  });
  it.each([{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }])('respects reduced data %j', connection => {
    vi.spyOn(window, 'navigator', 'get').mockReturnValue({ connection } as unknown as Navigator);
    service.preloadNeighbors(['/a?w=1200', '/b?w=1200']);
    expect(TestImage.requests).toHaveLength(0);
  });
  it('bounds readiness metadata to 128 entries', () => {
    for (let index = 0; index < 150; index++) service.recordLoaded(`/scan-${index}`, { naturalWidth: 480, naturalHeight: 640 });
    expect(service.isPreloaded('/scan-0')).toBe(false);
    expect(service.getDimensions('/scan-149')).toEqual({ width: 480, height: 640 });
  });
});

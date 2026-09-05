import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImagePreloadService } from '../imagePreloadService';

vi.mock('../../api/client', () => ({
  getImageUrl: (url: string, options: { width: number }) => `${url}?width=${options.width}`,
}));

class TestImage {
  static requests: TestImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 800;
  naturalHeight = 1200;
  complete = false;
  fetchPriority = '';
  src = '';
  removed = false;
  constructor() { TestImage.requests.push(this); }
  removeAttribute() { this.removed = true; }
}

function collection(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `letter-${index}`,
    images: Array.from({ length: 4 }, (_, page) => ({ imageUrl: `/image-${index}-${page}` })),
  }));
}

function finishAll() {
  for (let i = 0; i < TestImage.requests.length; i++) TestImage.requests[i].onload?.();
}

describe('bounded image preloading', () => {
  let service: ImagePreloadService;
  beforeEach(() => {
    vi.useFakeTimers();
    TestImage.requests = [];
    vi.stubGlobal('Image', TestImage);
    service = new ImagePreloadService();
  });
  afterEach(() => { service.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('requests only six previews even for a thousand four-page letters', () => {
    service.preloadCollection(collection(1000));
    expect(TestImage.requests).toHaveLength(0);
    vi.advanceTimersByTime(600);
    expect(TestImage.requests).toHaveLength(4);
    finishAll();
    expect(TestImage.requests).toHaveLength(6);
  });

  it('cancels obsolete work and focuses only current pages and immediate neighbors', () => {
    service.preloadCollection(collection(1000));
    vi.advanceTimersByTime(600);
    const obsolete = [...TestImage.requests];
    const lateCallback = obsolete[0].onload!;
    service.focusLetter('letter-500');
    expect(obsolete.every((image) => image.removed)).toBe(true);
    lateCallback();
    finishAll();
    const focused = TestImage.requests.slice(obsolete.length);
    expect(focused).toHaveLength(10);
    expect(focused.every((image) => /image-(499|500|501)-/.test(image.src))).toBe(true);
    expect(service.isPreloaded(obsolete[0].src)).toBe(false);
  });

  it('does not mark failures as cached and permits a later retry', () => {
    service.preloadCollection(collection(1));
    vi.advanceTimersByTime(600);
    const failed = TestImage.requests[0];
    failed.onerror?.();
    expect(service.isPreloaded(failed.src)).toBe(false);
    service.focusLetter('letter-0');
    finishAll();
    expect(TestImage.requests.filter((image) => image.src === failed.src)).toHaveLength(2);
    expect(service.getDimensions(failed.src)).toEqual({ width: 800, height: 1200 });
  });

  it('bounds cached metadata over a long navigation session', () => {
    service.preloadCollection(collection(100));
    for (let index = 0; index < 100; index++) {
      service.focusLetter(`letter-${index}`);
      finishAll();
    }
    expect(service.isPreloaded('/image-0-0?width=800')).toBe(false);
    expect(service.isPreloaded('/image-99-0?width=800')).toBe(true);
  });
});

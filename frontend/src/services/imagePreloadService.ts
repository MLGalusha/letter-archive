import { getImageUrl } from '../api/client';

const MAX_CACHED_URLS = 128;
type Dimensions = { width: number; height: number };

export function allowImageSpeculation(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '');
}

/** Small, versioned readiness index; browser HTTP caching still owns the bytes. */
export class ImagePreloadService {
  private loaded = new Map<string, Dimensions>();

  isPreloaded(url: string): boolean { return this.loaded.has(url); }
  getDimensions(url: string): Dimensions | null { return this.loaded.get(url) ?? null; }
  recordLoaded(url: string, image: { naturalWidth: number; naturalHeight: number }) {
    if (!image.naturalWidth || !image.naturalHeight) return;
    this.loaded.delete(url);
    this.loaded.set(url, { width: image.naturalWidth, height: image.naturalHeight });
    if (this.loaded.size > MAX_CACHED_URLS) this.loaded.delete(this.loaded.keys().next().value!);
  }

  /** Reuse only an exact URL already loaded in this session; never fetch a new tier. */
  availablePreview(imageUrl: string, targetWidth: number): string | undefined {
    for (const width of [1600, 1200, 800, 640, 480]) {
      if (width >= targetWidth) continue;
      const url = getImageUrl(imageUrl, { width });
      if (this.isPreloaded(url)) return url;
    }
    return undefined;
  }

  /** At most two neighbors, after the visible scan is ready. Ownership is local. */
  preloadNeighbors(urls: string[]): () => void {
    if (!allowImageSpeculation()) return () => {};
    const images: HTMLImageElement[] = [];
    let cancelled = false;
    for (const url of [...new Set(urls)].slice(0, 2)) {
      if (this.isPreloaded(url)) continue;
      const image = new Image();
      images.push(image);
      image.onload = () => { if (!cancelled) this.recordLoaded(url, image); };
      image.fetchPriority = 'low';
      image.src = url;
      if (image.complete && image.naturalWidth) this.recordLoaded(url, image);
    }
    return () => {
      cancelled = true;
      for (const image of images) {
        image.onload = null;
        if (!image.complete) image.removeAttribute('src');
      }
    };
  }

  clear() { this.loaded.clear(); }
}

export const imagePreloadService = new ImagePreloadService();

import { getImageUrl } from '../api/client';

const MAX_CONCURRENT = 4;
const MAX_CACHED_URLS = 128;
const MAX_PAGES_PER_LETTER = 3;
type LetterImages = { id: string; images: { imageUrl: string }[] };
type Dimensions = { width: number; height: number };

/** Speculative loading stays near the reader, never across an entire collection. */
export class ImagePreloadService {
  private loaded = new Map<string, Dimensions | null>();
  private queue: string[] = [];
  private inflight = new Map<string, HTMLImageElement>();
  private letters: LetterImages[] = [];
  private startupTimer: ReturnType<typeof setTimeout> | null = null;

  preloadCollection(letters: LetterImages[]) {
    this.cancelPending();
    this.letters = letters.map(({ id, images }) => ({
      id, images: images.slice(0, MAX_PAGES_PER_LETTER),
    }));
    for (const letter of this.letters.slice(0, 3)) this.enqueueImages(letter, 1);
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      this.processQueue();
    }, 600);
  }

  focusLetter(letterId: string) {
    this.cancelPending();
    const index = this.letters.findIndex((letter) => letter.id === letterId);
    if (index < 0) return;
    this.enqueueImages(this.letters[index], MAX_PAGES_PER_LETTER);
    for (const neighbor of [this.letters[index - 1], this.letters[index + 1]]) {
      if (neighbor) this.enqueueImages(neighbor, 1);
    }
    this.processQueue();
  }

  isPreloaded(url: string): boolean { return this.loaded.has(url); }
  getDimensions(url: string): Dimensions | null { return this.loaded.get(url) ?? null; }

  /** Stop obsolete requests but keep the small navigation image index. */
  cancelPending() {
    if (this.startupTimer !== null) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    this.queue = [];
    for (const img of this.inflight.values()) {
      img.onload = null;
      img.onerror = null;
      img.removeAttribute('src');
    }
    this.inflight.clear();
  }

  clear() {
    this.cancelPending();
    this.letters = [];
    this.loaded.clear();
  }

  private enqueueImages(letter: LetterImages, limit: number) {
    for (const image of letter.images.slice(0, limit)) {
      for (const width of [800, 32]) {
        const url = getImageUrl(image.imageUrl, { width });
        if (!this.loaded.has(url) && !this.queue.includes(url)) this.queue.push(url);
      }
    }
  }

  private processQueue() {
    while (this.inflight.size < MAX_CONCURRENT && this.queue.length > 0) {
      const url = this.queue.shift()!;
      if (this.loaded.has(url) || this.inflight.has(url)) continue;
      const img = new Image();
      this.inflight.set(url, img);
      const done = (success: boolean) => {
        // Ignore duplicate cached-image events and callbacks from cancelled work.
        if (this.inflight.get(url) !== img) return;
        img.onload = null;
        img.onerror = null;
        this.inflight.delete(url);
        if (success) {
          this.loaded.set(url, img.naturalWidth && img.naturalHeight
            ? { width: img.naturalWidth, height: img.naturalHeight } : null);
          if (this.loaded.size > MAX_CACHED_URLS) {
            this.loaded.delete(this.loaded.keys().next().value!);
          }
        }
        this.processQueue();
      };
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.fetchPriority = 'low';
      img.src = url;
      if (img.complete) done(img.naturalWidth > 0);
    }
  }
}

export const imagePreloadService = new ImagePreloadService();

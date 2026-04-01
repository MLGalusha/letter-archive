import { getImageUrl } from '../api/client';

const CAROUSEL_WIDTH = 800;
const THUMB_WIDTH = 32;
const MAX_CONCURRENT = 4;

type Priority = 'critical' | 'high' | 'normal' | 'low';
const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

interface QueueEntry {
  url: string;
  priority: Priority;
  letterId: string;
}

interface LetterImageInfo {
  imageUrl: string;
}

const scheduleIdle: (cb: () => void) => number =
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb) => setTimeout(cb, 200) as unknown as number;

class ImagePreloadService {
  private preloaded = new Set<string>();
  private dimensions = new Map<string, { width: number; height: number }>();
  private queue: QueueEntry[] = [];
  private active = 0;
  private inflight = new Map<string, HTMLImageElement>();
  private collectionLetterIds: string[] = [];
  private currentLetterId: string | null = null;
  private idleHandle: number | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Called from collection page after data loads.
   * Enqueues first image of each letter at carousel width (high priority),
   * then remaining images at low priority.
   */
  preloadCollection(letters: { id: string; images: LetterImageInfo[] }[]) {
    this.collectionLetterIds = letters.map((l) => l.id);

    // Phase 1: First image of each letter — enqueue but delay start
    // so the collection page can finish rendering before we compete for network
    for (const letter of letters) {
      if (letter.images[0]) {
        this.enqueue({
          url: getImageUrl(letter.images[0].imageUrl, { width: CAROUSEL_WIDTH }),
          priority: 'normal',
          letterId: letter.id,
        });
        // Also preload the tiny thumb for instant blur-up
        this.enqueue({
          url: getImageUrl(letter.images[0].imageUrl, { width: THUMB_WIDTH }),
          priority: 'high',
          letterId: letter.id,
        });
      }
    }

    // Phase 2: Remaining images (deferred via idle callback)
    this.idleHandle = scheduleIdle(() => {
      for (const letter of letters) {
        for (let i = 1; i < letter.images.length; i++) {
          this.enqueue({
            url: getImageUrl(letter.images[i].imageUrl, { width: CAROUSEL_WIDTH }),
            priority: 'low',
            letterId: letter.id,
          });
        }
      }
      this.processQueue();
    });

    // Delay the initial batch so the page renders smoothly first
    if (this.startupTimer !== null) clearTimeout(this.startupTimer);
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      this.processQueue();
    }, 600);
  }

  /**
   * Called from letter detail page after letter data loads.
   * Promotes current + adjacent letter images to critical/high priority.
   */
  focusLetter(letterId: string) {
    this.currentLetterId = letterId;

    const idx = this.collectionLetterIds.indexOf(letterId);
    if (idx === -1) return; // Not in a known collection

    // Re-prioritize existing queue entries by proximity to current letter
    for (const entry of this.queue) {
      const entryIdx = this.collectionLetterIds.indexOf(entry.letterId);
      if (entryIdx === -1) continue;

      const distance = Math.abs(entryIdx - idx);
      if (distance === 0) {
        entry.priority = 'critical';
      } else if (distance <= 2) {
        entry.priority = 'high';
      } else if (distance <= 5) {
        entry.priority = 'normal';
      }
      // else stays at its current priority
    }

    this.sortQueue();
    this.processQueue();
  }

  /**
   * Check if a URL has been preloaded (is in browser cache).
   */
  isPreloaded(url: string): boolean {
    return this.preloaded.has(url);
  }

  /**
   * Get stored dimensions for a preloaded image.
   * Returns null if the image hasn't been preloaded or dimensions aren't available.
   */
  getDimensions(url: string): { width: number; height: number } | null {
    return this.dimensions.get(url) ?? null;
  }

  /**
   * Reset the service (e.g., when leaving a collection).
   */
  clear() {
    // Cancel in-flight loads
    for (const img of this.inflight.values()) {
      img.onload = null;
      img.onerror = null;
    }
    this.inflight.clear();
    this.queue = [];
    this.active = 0;
    this.collectionLetterIds = [];
    this.currentLetterId = null;
    if (this.idleHandle !== null) {
      (typeof cancelIdleCallback === 'function' ? cancelIdleCallback : clearTimeout)(this.idleHandle);
      this.idleHandle = null;
    }
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    // Keep preloaded set and dimensions — those URLs are still in browser cache
  }

  private enqueue(entry: QueueEntry) {
    if (this.preloaded.has(entry.url)) return;
    if (this.inflight.has(entry.url)) return;
    // Check for duplicate in queue
    const existing = this.queue.find((e) => e.url === entry.url);
    if (existing) {
      // Upgrade priority if needed
      if (PRIORITY_ORDER[entry.priority] < PRIORITY_ORDER[existing.priority]) {
        existing.priority = entry.priority;
        this.sortQueue();
      }
      return;
    }
    this.queue.push(entry);
    this.sortQueue();
  }

  private sortQueue() {
    const idx = this.currentLetterId
      ? this.collectionLetterIds.indexOf(this.currentLetterId)
      : -1;

    this.queue.sort((a, b) => {
      // Primary: priority level
      const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pDiff !== 0) return pDiff;
      // Secondary: proximity to current letter
      if (idx !== -1) {
        const distA = Math.abs(this.collectionLetterIds.indexOf(a.letterId) - idx);
        const distB = Math.abs(this.collectionLetterIds.indexOf(b.letterId) - idx);
        return distA - distB;
      }
      return 0;
    });
  }

  private processQueue() {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      if (this.preloaded.has(entry.url) || this.inflight.has(entry.url)) continue;

      this.active++;
      const img = new Image();
      this.inflight.set(entry.url, img);

      const done = () => {
        this.active--;
        this.preloaded.add(entry.url);
        if (img.naturalWidth && img.naturalHeight) {
          this.dimensions.set(entry.url, { width: img.naturalWidth, height: img.naturalHeight });
        }
        this.inflight.delete(entry.url);
        this.processQueue();
      };

      img.onload = done;
      img.onerror = () => {
        this.active--;
        this.preloaded.add(entry.url); // Mark as attempted to avoid retrying
        this.inflight.delete(entry.url);
        this.processQueue();
      };
      img.src = entry.url;

      // Handle synchronously cached images
      if (img.complete) {
        img.onload = null;
        img.onerror = null;
        done();
      }
    }
  }
}

export const imagePreloadService = new ImagePreloadService();

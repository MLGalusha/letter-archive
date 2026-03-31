import { useState, useEffect, useRef } from 'react';
import { recordImageLoad } from '../utils/imagePerformance';

export interface ProgressiveImageOptions {
  thumbSrc: string;
  midSrc?: string;
  fullSrc: string;
  idleUpgrade?: boolean;
  context?: string;
}

export interface UseProgressiveImageResult {
  thumbLoaded: boolean;
  midLoaded: boolean;
  fullLoaded: boolean;
  /** Best available src (full > mid > thumb > '') */
  currentSrc: string;
}

const scheduleIdle: (cb: () => void) => number =
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb) => setTimeout(cb, 200) as unknown as number;

const cancelIdle: (id: number) => void =
  typeof cancelIdleCallback === 'function'
    ? cancelIdleCallback
    : (id) => clearTimeout(id);

function loadImage(
  src: string,
  tier: string,
  context: string,
  cancelled: { current: boolean },
  onLoad: () => void,
): HTMLImageElement {
  const start = performance.now();
  const img = new Image();
  img.onload = () => {
    if (cancelled.current) return;
    const durationMs = performance.now() - start;
    recordImageLoad({
      url: src,
      tier: tier as 'thumb' | 'mid' | 'full',
      context,
      durationMs,
      cached: durationMs < 15,
    });
    onLoad();
  };
  img.src = src;
  if (img.complete) {
    if (!cancelled.current) {
      recordImageLoad({
        url: src,
        tier: tier as 'thumb' | 'mid' | 'full',
        context,
        durationMs: 0,
        cached: true,
      });
      onLoad();
    }
  }
  return img;
}

// Overload: 2-arg legacy signature
export function useProgressiveImage(thumbSrc: string, fullSrc: string): UseProgressiveImageResult;
// Overload: options object
export function useProgressiveImage(options: ProgressiveImageOptions): UseProgressiveImageResult;
// Implementation
export function useProgressiveImage(
  thumbSrcOrOpts: string | ProgressiveImageOptions,
  fullSrcArg?: string,
): UseProgressiveImageResult {
  const opts: ProgressiveImageOptions =
    typeof thumbSrcOrOpts === 'string'
      ? { thumbSrc: thumbSrcOrOpts, fullSrc: fullSrcArg! }
      : thumbSrcOrOpts;

  const { thumbSrc, midSrc, fullSrc, idleUpgrade = false, context = 'unknown' } = opts;

  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [midLoaded, setMidLoaded] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);
  const imgsRef = useRef<HTMLImageElement[]>([]);
  const idleRef = useRef<number | null>(null);

  useEffect(() => {
    setThumbLoaded(false);
    setMidLoaded(false);
    setFullLoaded(false);

    const cancelled = { current: false };
    const imgs: HTMLImageElement[] = [];

    // 1. Load thumbnail immediately
    imgs.push(loadImage(thumbSrc, 'thumb', context, cancelled, () => setThumbLoaded(true)));

    // 2. Load mid-quality immediately (if provided)
    if (midSrc) {
      imgs.push(loadImage(midSrc, 'mid', context, cancelled, () => setMidLoaded(true)));
    }

    // 3. Load full — either immediately or deferred via idle callback
    const startFull = () => {
      imgs.push(loadImage(fullSrc, 'full', context, cancelled, () => setFullLoaded(true)));
    };

    if (idleUpgrade && midSrc) {
      // Defer full-quality load until browser is idle
      idleRef.current = scheduleIdle(startFull);
    } else {
      // No idle deferral — load full immediately
      startFull();
    }

    imgsRef.current = imgs;

    return () => {
      cancelled.current = true;
      for (const img of imgs) img.onload = null;
      if (idleRef.current !== null) {
        cancelIdle(idleRef.current);
        idleRef.current = null;
      }
      imgsRef.current = [];
    };
  }, [thumbSrc, midSrc, fullSrc, idleUpgrade, context]);

  const currentSrc = fullLoaded ? fullSrc : midLoaded && midSrc ? midSrc : thumbLoaded ? thumbSrc : '';

  return { thumbLoaded, midLoaded, fullLoaded, currentSrc };
}

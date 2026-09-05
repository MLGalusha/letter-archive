import { useState, useEffect, useRef } from 'react';
import { recordImageLoad } from '../utils/imagePerformance';
import { imagePreloadService } from '../services/imagePreloadService';

export interface ProgressiveImageOptions {
  enabled?: boolean;
  thumbSrc: string;
  midSrc?: string;
  fullSrc: string;
  idleUpgrade?: boolean;
  deferFullUntilVisible?: boolean;
  context?: string;
  /** Delay in ms before starting the full-quality load (gives priority images a head start) */
  fullDelay?: number;
}

export interface UseProgressiveImageResult {
  thumbLoaded: boolean;
  midLoaded: boolean;
  fullLoaded: boolean;
  /** Best available src (full > mid > thumb > '') */
  currentSrc: string;
  /** Natural width from the first loaded tier (for aspect ratio) */
  naturalWidth: number | null;
  /** Natural height from the first loaded tier (for aspect ratio) */
  naturalHeight: number | null;
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
  onLoad: (img: HTMLImageElement) => void,
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
    onLoad(img);
  };
  img.onerror = () => {
    // Silently skip this resolution tier so the hook doesn't hang
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
      onLoad(img);
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

  const {
    thumbSrc,
    midSrc,
    fullSrc,
    enabled = true,
    idleUpgrade = false,
    deferFullUntilVisible = false,
    context = 'unknown',
    fullDelay = 0,
  } = opts;

  // If the preload service already has this image, start as loaded with known dimensions
  const preloaded = imagePreloadService.isPreloaded(fullSrc);
  const preloadedDims = preloaded ? imagePreloadService.getDimensions(fullSrc) : null;
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [midLoaded, setMidLoaded] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(preloaded);
  const [naturalWidth, setNaturalWidth] = useState<number | null>(preloadedDims?.width ?? null);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(preloadedDims?.height ?? null);
  const imgsRef = useRef<HTMLImageElement[]>([]);
  const idleRef = useRef<number | null>(null);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dimsSetRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const alreadyPreloaded = imagePreloadService.isPreloaded(fullSrc);
    const dims = alreadyPreloaded ? imagePreloadService.getDimensions(fullSrc) : null;
    setThumbLoaded(false);
    setMidLoaded(false);
    setFullLoaded(alreadyPreloaded);
    setNaturalWidth(dims?.width ?? null);
    setNaturalHeight(dims?.height ?? null);
    dimsSetRef.current = !!dims;

    const cancelled = { current: false };
    const imgs: HTMLImageElement[] = [];

    const captureDims = (img: HTMLImageElement) => {
      if (!dimsSetRef.current && img.naturalWidth && img.naturalHeight) {
        dimsSetRef.current = true;
        setNaturalWidth(img.naturalWidth);
        setNaturalHeight(img.naturalHeight);
      }
    };

    // 1. Load thumbnail immediately (even for deferred images — it's tiny)
    imgs.push(loadImage(thumbSrc, 'thumb', context, cancelled, (img) => {
      setThumbLoaded(true);
      captureDims(img);
    }));

    // 2. Load mid-quality immediately (if provided)
    if (midSrc) {
      imgs.push(loadImage(midSrc, 'mid', context, cancelled, (img) => {
        setMidLoaded(true);
        captureDims(img);
      }));
    }

    // 3. Load full — skip if preload service already has it, otherwise load
    if (!alreadyPreloaded && !deferFullUntilVisible) {
      const startFull = () => {
        if (cancelled.current) return;
        imgs.push(loadImage(fullSrc, 'full', context, cancelled, (img) => {
          setFullLoaded(true);
          captureDims(img);
        }));
      };

      if (idleUpgrade && midSrc) {
        idleRef.current = scheduleIdle(startFull);
      } else if (fullDelay > 0) {
        // Delay full-quality load to give priority images a head start
        delayRef.current = setTimeout(startFull, fullDelay);
      } else {
        startFull();
      }
    }

    imgsRef.current = imgs;

    return () => {
      cancelled.current = true;
      for (const img of imgs) { img.onload = null; img.onerror = null; }
      if (idleRef.current !== null) {
        cancelIdle(idleRef.current);
        idleRef.current = null;
      }
      if (delayRef.current !== null) {
        clearTimeout(delayRef.current);
        delayRef.current = null;
      }
      imgsRef.current = [];
    };
  }, [enabled, thumbSrc, midSrc, fullSrc, idleUpgrade, deferFullUntilVisible, context, fullDelay]);

  const currentSrc = fullLoaded ? fullSrc : midLoaded && midSrc ? midSrc : thumbLoaded ? thumbSrc : '';

  return { thumbLoaded, midLoaded, fullLoaded, currentSrc, naturalWidth, naturalHeight };
}

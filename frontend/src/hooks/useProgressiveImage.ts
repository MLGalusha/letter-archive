import { useState, useEffect, useRef } from 'react';
import { recordImageLoad } from '../utils/imagePerformance';
import { imagePreloadService } from '../services/imagePreloadService';

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

  const { thumbSrc, midSrc, fullSrc, idleUpgrade = false, context = 'unknown' } = opts;

  // If the preload service already has this image, start as loaded
  const preloaded = imagePreloadService.isPreloaded(fullSrc);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [midLoaded, setMidLoaded] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(preloaded);
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);
  const imgsRef = useRef<HTMLImageElement[]>([]);
  const idleRef = useRef<number | null>(null);
  const dimsSetRef = useRef(false);

  useEffect(() => {
    const alreadyPreloaded = imagePreloadService.isPreloaded(fullSrc);
    setThumbLoaded(false);
    setMidLoaded(false);
    setFullLoaded(alreadyPreloaded);
    setNaturalWidth(null);
    setNaturalHeight(null);
    dimsSetRef.current = false;

    const cancelled = { current: false };
    const imgs: HTMLImageElement[] = [];

    const captureDims = (img: HTMLImageElement) => {
      if (!dimsSetRef.current && img.naturalWidth && img.naturalHeight) {
        dimsSetRef.current = true;
        setNaturalWidth(img.naturalWidth);
        setNaturalHeight(img.naturalHeight);
      }
    };

    // 1. Load thumbnail immediately
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
    if (!alreadyPreloaded) {
      const startFull = () => {
        imgs.push(loadImage(fullSrc, 'full', context, cancelled, (img) => {
          setFullLoaded(true);
          captureDims(img);
        }));
      };

      if (idleUpgrade && midSrc) {
        idleRef.current = scheduleIdle(startFull);
      } else {
        startFull();
      }
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

  return { thumbLoaded, midLoaded, fullLoaded, currentSrc, naturalWidth, naturalHeight };
}

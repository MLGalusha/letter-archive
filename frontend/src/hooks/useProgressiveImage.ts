import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { recordImageLoad } from '../utils/imagePerformance';
import { imagePreloadService } from '../services/imagePreloadService';
import { IMAGE_RETRY_DELAYS_MS } from '../utils/imageRetry';

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
  fetchPriority?: 'high' | 'low' | 'auto';
  /** Let the rendered image own the full request; the hook only admits it. */
  fullLoadMode?: 'background' | 'dom';
}

export interface UseProgressiveImageResult {
  thumbLoaded: boolean;
  midLoaded: boolean;
  fullLoaded: boolean;
  fullFailed: boolean;
  fullAdmitted: boolean;
  onFullLoad: (image: HTMLImageElement) => void;
  onFullError: () => void;
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
  tier: 'thumb' | 'mid' | 'full',
  context: string,
  cancelled: { current: boolean },
  onLoad: (img: HTMLImageElement) => void,
  imgs: HTMLImageElement[],
  cleanups: Array<() => void>,
  priority: { current: 'high' | 'low' | 'auto' },
  onFailure: () => void = () => {},
): void {
  const start = performance.now();
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  cleanups.push(() => clearTimeout(retry));
  const request = () => {
    if (cancelled.current) return;
    // WebKit can keep an errored Image failed when its identical src is reassigned.
    const img = new Image();
    imgs.push(img);
    img.fetchPriority = priority.current;
    let settled = false;
    img.onload = () => {
      if (cancelled.current || settled) return;
      settled = true;
      const durationMs = performance.now() - start;
      recordImageLoad({ url: src, tier, context, durationMs, cached: attempt === 0 && durationMs < 15 });
      imagePreloadService.recordLoaded(src, img);
      onLoad(img);
    };
    img.onerror = () => {
      if (cancelled.current || settled) return;
      settled = true;
      img.onload = null;
      img.onerror = null;
      const delay = IMAGE_RETRY_DELAYS_MS[attempt++];
      if (delay === undefined) { onFailure(); return; }
      retry = setTimeout(request, delay);
    };
    img.src = src;
    if (img.complete && img.naturalWidth > 0) img.onload(new Event('load'));
  };
  request();
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
    fetchPriority = 'auto',
    fullLoadMode = 'background',
  } = opts;

  const priority = useRef(fetchPriority);
  const ownedImages = useRef<HTMLImageElement[]>([]);
  // Priority is a hint on existing requests, not a new loading lifecycle.
  // Queued loads and retries read the latest hint when they actually start.
  useLayoutEffect(() => {
    priority.current = fetchPriority;
    for (const img of ownedImages.current) img.fetchPriority = fetchPriority;
  }, [fetchPriority]);

  // Readiness belongs to these exact URLs, including the render before effects run.
  // Otherwise a previously loaded full tier can start a replacement URL too early.
  const sourceKey = JSON.stringify([thumbSrc, midSrc, fullSrc, fullLoadMode]);
  const fullTiming = useRef<{ sourceKey: string; start: number; reported?: boolean } | null>(null);
  const preloaded = imagePreloadService.isPreloaded(fullSrc);
  const cachedMid = !!midSrc && imagePreloadService.isPreloaded(midSrc);
  const preloadedDims = preloaded ? imagePreloadService.getDimensions(fullSrc)
    : cachedMid && midSrc ? imagePreloadService.getDimensions(midSrc) : null;
  const initial = {
    sourceKey, thumbLoaded: false, midLoaded: cachedMid, fullLoaded: fullLoadMode === 'background' && preloaded, fullFailed: false,
    fullAdmitted: fullLoadMode === 'background' && preloaded,
    naturalWidth: preloadedDims?.width ?? null, naturalHeight: preloadedDims?.height ?? null,
  };
  const [state, setState] = useState(initial);
  const current = state.sourceKey === sourceKey ? state : initial;
  if (state.sourceKey !== sourceKey) setState(current);

  useEffect(() => {
    if (!enabled) return;
    const alreadyPreloaded = imagePreloadService.isPreloaded(fullSrc);
    const alreadyMid = !!midSrc && imagePreloadService.isPreloaded(midSrc);
    const dims = alreadyPreloaded ? imagePreloadService.getDimensions(fullSrc)
      : alreadyMid && midSrc ? imagePreloadService.getDimensions(midSrc) : null;
    fullTiming.current = { sourceKey, start: performance.now() };
    setState({ sourceKey, thumbLoaded: false, midLoaded: alreadyMid, fullLoaded: fullLoadMode === 'background' && alreadyPreloaded,
      fullAdmitted: alreadyPreloaded, fullFailed: false, naturalWidth: dims?.width ?? null, naturalHeight: dims?.height ?? null });
    let dimsSet = !!dims;
    let idle: number | null = null;
    let delay: ReturnType<typeof setTimeout> | null = null;
    const cancelled = { current: false };
    const imgs: HTMLImageElement[] = [];
    ownedImages.current = imgs;
    const cleanups: Array<() => void> = [];

    const captureDims = (img: HTMLImageElement) => {
      if (!dimsSet && img.naturalWidth && img.naturalHeight) {
        dimsSet = true;
        setState((value) => ({ ...value, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }));
      }
    };

    // 1. Load thumbnail immediately (even for deferred images — it's tiny)
    if (!alreadyPreloaded && !alreadyMid && (fullLoadMode !== 'dom' || thumbSrc !== fullSrc)) loadImage(thumbSrc, 'thumb', context, cancelled, (img) => {
      setState((value) => ({ ...value, thumbLoaded: true }));
      captureDims(img);
    }, imgs, cleanups, priority);

    // 2. Load mid-quality immediately (if provided)
    if (midSrc && !alreadyMid && !alreadyPreloaded && (fullLoadMode !== 'dom' || midSrc !== fullSrc)) {
      loadImage(midSrc, 'mid', context, cancelled, (img) => {
        setState((value) => ({ ...value, midLoaded: true }));
        captureDims(img);
      }, imgs, cleanups, priority);
    }

    // 3. Load full — skip if preload service already has it, otherwise load
    if (!alreadyPreloaded && !deferFullUntilVisible) {
      const startFull = () => {
        if (cancelled.current) return;
        fullTiming.current = { sourceKey, start: performance.now() };
        if (fullLoadMode === 'dom') {
          setState((value) => ({ ...value, fullAdmitted: true }));
          return;
        }
        loadImage(fullSrc, 'full', context, cancelled, (img) => {
          setState((value) => ({ ...value, fullLoaded: true }));
          captureDims(img);
        }, imgs, cleanups, priority, () => setState((value) => ({ ...value, fullFailed: true })));
      };

      if (idleUpgrade && midSrc) {
        idle = scheduleIdle(startFull);
      } else if (fullDelay > 0) {
        // Delay full-quality load to give priority images a head start
        delay = setTimeout(startFull, fullDelay);
      } else {
        startFull();
      }
    }


    return () => {
      cancelled.current = true;
      fullTiming.current = null;
      ownedImages.current = [];
      for (const cleanup of cleanups) cleanup();
      for (const img of imgs) {
        img.onload = null;
        img.onerror = null;
        // Release only this owner's unfinished Image; other DOM/preload consumers
        // retain their own references. Browser/server cancellation is best effort.
        if (!img.complete) img.removeAttribute('src');
      }
      if (idle !== null) cancelIdle(idle);
      if (delay !== null) clearTimeout(delay);
    };
  }, [enabled, thumbSrc, midSrc, fullSrc, idleUpgrade, deferFullUntilVisible, context, fullDelay, sourceKey, fullLoadMode]);

  const onFullLoad = (image: HTMLImageElement) => {
    const timing = fullTiming.current;
    if (fullLoadMode !== 'dom' || timing?.sourceKey !== sourceKey) return;
    const durationMs = performance.now() - timing.start;
    if (!timing.reported) {
      timing.reported = true;
      recordImageLoad({ url: fullSrc, tier: 'full', context, durationMs, cached: durationMs < 15 });
    }
    setState((value) => value.sourceKey !== sourceKey || value.fullLoaded ? value : ({ ...value,
      fullLoaded: true, fullFailed: false,
      naturalWidth: value.naturalWidth ?? image.naturalWidth,
      naturalHeight: value.naturalHeight ?? image.naturalHeight,
    }));
  };
  const onFullError = () => {
    if (fullLoadMode !== 'dom' || fullTiming.current?.sourceKey !== sourceKey) return;
    fullTiming.current.reported = false;
    setState((value) => value.sourceKey !== sourceKey ? value : ({ ...value, fullLoaded: false }));
  };
  const { thumbLoaded, midLoaded, fullLoaded, fullFailed, fullAdmitted, naturalWidth, naturalHeight } = current;
  const currentSrc = fullLoaded ? fullSrc : midLoaded && midSrc ? midSrc : thumbLoaded ? thumbSrc : '';

  return { thumbLoaded, midLoaded, fullLoaded, fullFailed, fullAdmitted, onFullLoad, onFullError, currentSrc, naturalWidth, naturalHeight };
}

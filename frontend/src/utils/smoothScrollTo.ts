import { appScrollTo, getAppScrollY } from "./appScroll";

/**
 * Smoothly scroll the app scroller to a target Y using requestAnimationFrame.
 *
 * Why a custom RAF loop instead of `{ behavior: 'smooth' }`? iOS Safari has
 * historically silently fallen back to instant scroll in several edge cases
 * (body overflow, address-bar transitions, container scrollers with
 * momentum). Driving the animation ourselves guarantees the same behavior
 * across browsers and across document/container scroll.
 *
 * Returns a function that can be called to cancel the in-flight animation.
 */
export interface SmoothScrollOptions {
  /** Called on each frame with the running position. */
  onStep?: (y: number) => void;
  /** Called when the animation lands on the destination or is cancelled. */
  onFinish?: (cancelled: boolean) => void;
  /** Override the easing duration calculation. */
  duration?: number;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function smoothScrollToY(destination: number, options: SmoothScrollOptions = {}): () => void {
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const target = Math.max(0, destination);
  const start = getAppScrollY();
  const distance = target - start;

  if (prefersReducedMotion || Math.abs(distance) < 1) {
    appScrollTo(target);
    options.onStep?.(target);
    options.onFinish?.(false);
    return () => {};
  }

  const duration = options.duration ?? Math.min(700, Math.max(300, Math.abs(distance) * 0.6));
  const startTime = performance.now();
  let rafId = 0;
  let cancelled = false;

  const step = (now: number) => {
    if (cancelled) return;
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    const y = start + distance * easeOutCubic(t);
    appScrollTo(y);
    options.onStep?.(y);
    if (t < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      options.onFinish?.(false);
    }
  };
  rafId = requestAnimationFrame(step);

  return () => {
    if (cancelled) return;
    cancelled = true;
    cancelAnimationFrame(rafId);
    options.onFinish?.(true);
  };
}

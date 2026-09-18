import { appScrollTo, getAppScrollY } from "./appScroll";

export interface SmoothScrollOptions {
  /** Called on each frame with the running position. */
  onStep?: (y: number) => void;
  /** Called exactly once: false on arrival, true on interruption. */
  onFinish?: (cancelled: boolean) => void;
  duration?: number;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
let cancelActive: (() => void) | undefined;

/** Route restoration must own document scrolling as soon as navigation starts. */
export function cancelSmoothScroll(): void {
  cancelActive?.();
}

/** One interruptible document animation, shared by search, archive and top links. */
export function smoothScrollToY(destination: number, options: SmoothScrollOptions = {}): () => void {
  cancelSmoothScroll();
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const target = Math.min(Math.max(0, destination), Math.max(0, root.scrollHeight - root.clientHeight));
  const start = getAppScrollY();
  const distance = target - start;
  const duration = options.duration ?? Math.min(700, Math.max(300, Math.abs(distance) * 0.6));

  if (prefersReducedMotion || Math.abs(distance) < 1 || duration <= 0) {
    appScrollTo(target);
    options.onStep?.(target);
    options.onFinish?.(false);
    return () => {};
  }

  const startTime = performance.now();
  let rafId = 0;
  let finished = false;
  const finish = (cancelled: boolean) => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'pagehide']) window.removeEventListener(type, cancel, true);
    window.removeEventListener('keydown', onKeyDown, true);
    if (cancelActive === cancel) cancelActive = undefined;
    options.onFinish?.(cancelled);
  };
  const cancel = () => finish(true);
  const onKeyDown = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Tab', 'Escape'].includes(event.key)) cancel();
  };
  cancelActive = cancel;
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'pagehide']) {
    window.addEventListener(type, cancel, { passive: true, capture: true });
  }
  window.addEventListener('keydown', onKeyDown, true);

  const step = (now: number) => {
    if (finished) return;
    const t = Math.min(1, Math.max(0, (now - startTime) / duration));
    const y = start + distance * easeOutCubic(t);
    appScrollTo(y);
    options.onStep?.(y);
    if (finished) return;
    if (t < 1) rafId = requestAnimationFrame(step);
    else finish(false);
  };
  rafId = requestAnimationFrame(step);
  return cancel;
}

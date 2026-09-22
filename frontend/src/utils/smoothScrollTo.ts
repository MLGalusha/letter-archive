import { appScrollTo, getAppScrollY } from "./appScroll";

export interface SmoothScrollOptions {
  /** Called on each frame with the running position. */
  onStep?: (y: number) => void;
  /** Called exactly once: false on arrival, true on interruption. */
  onFinish?: (cancelled: boolean) => void;
  duration?: number;
  takeOverMomentum?: boolean;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
let lastWheelTime = -Infinity;
let lastWheelDelta = 0;
if (typeof window !== "undefined") {
  window.addEventListener("wheel", (event) => {
    lastWheelTime = performance.now();
    lastWheelDelta = event.deltaY;
  }, { passive: true });
}
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
  let momentumTime = lastWheelTime;
  let momentumDelta = lastWheelDelta;
  let takingMomentum = options.takeOverMomentum && startTime - momentumTime < 160;
  const onWheel = (event: WheelEvent) => {
    const now = performance.now();
    const continuation = takingMomentum && now - momentumTime < 160
      && Math.sign(event.deltaY) === Math.sign(momentumDelta)
      && Math.abs(event.deltaY) <= Math.abs(momentumDelta) * 1.25 + 1;
    if (continuation) {
      if (event.cancelable) event.preventDefault();
      momentumTime = now;
      momentumDelta = event.deltaY;
    } else {
      takingMomentum = false;
      cancel();
    }
  };
  let rafId = 0;
  let finished = false;
  const finish = (cancelled: boolean) => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    for (const type of ['touchstart', 'pointerdown', 'pagehide']) window.removeEventListener(type, cancel, true);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('keydown', onKeyDown, true);
    if (cancelActive === cancel) cancelActive = undefined;
    options.onFinish?.(cancelled);
  };
  const cancel = () => finish(true);
  const onKeyDown = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Tab', 'Escape'].includes(event.key)) cancel();
  };
  cancelActive = cancel;
  for (const type of ['touchstart', 'pointerdown', 'pagehide']) {
    window.addEventListener(type, cancel, { passive: true, capture: true });
  }
  window.addEventListener('wheel', onWheel, { passive: false, capture: true });
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

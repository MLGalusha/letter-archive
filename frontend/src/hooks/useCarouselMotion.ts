import { useEffect, useRef } from 'react';

/** One bounded settle animation for dragging and explicit navigation. */
export default function useCarouselMotion() {
  const pending = useRef<{ frame: number; element: HTMLDivElement; left: number } | null>(null);
  const finish = () => {
    const motion = pending.current;
    if (!motion) return;
    cancelAnimationFrame(motion.frame);
    pending.current = null;
    motion.element.scrollTo({ left: motion.left, behavior: 'instant' });
    motion.element.style.scrollSnapType = '';
    motion.element.dispatchEvent(new Event('scrollend'));
  };
  useEffect(() => () => {
    if (pending.current) cancelAnimationFrame(pending.current.frame);
  }, []);
  const move = (element: HTMLDivElement, left: number) => {
    if (pending.current) cancelAnimationFrame(pending.current.frame);
    const from = element.scrollLeft;
    element.style.scrollSnapType = 'none';
    const motion = { frame: 0, element, left };
    pending.current = motion;
    if (Math.abs(from - left) < 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      if (pending.current !== motion) return;
      const progress = Math.min(1, (now - started) / 160);
      // A short quadratic ease-out, with a firm endpoint rather than a long tail.
      element.scrollTo({ left: from + (left - from) * (1 - (1 - progress) ** 2), behavior: 'instant' });
      if (progress === 1) finish();
      else motion.frame = requestAnimationFrame(tick);
    };
    motion.frame = requestAnimationFrame(tick);
  };
  return { move, finish };
}

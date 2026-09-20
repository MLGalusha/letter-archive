import { useLayoutEffect, useRef } from 'react';
import type { PageMotion } from './pageMotion';

/** Native touch scrolling, explicit centering, or main-image progress owns the strip. */
export function usePageStripMotion(selected: number,
  onSelect: (index: number) => void | boolean, motion?: PageMotion, count = 0) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef({ selected, onSelect });
  const choose = useRef<(index: number) => void>(() => {});
  const selectionChanged = useRef<() => void>(() => {});
  const suppressClick = useRef(false);
  useLayoutEffect(() => { current.current = { selected, onSelect }; });

  useLayoutEffect(() => {
    const list = root.current;
    if (!list) return;
    let frame = 0, idle: ReturnType<typeof setTimeout> | undefined;
    let points: number[] = [], following = false, browsing = false, touching = false;
    let resumeSelection = false, touchOrigin: { x: number; y: number } | null = null;
    let drag: { id: number; x: number; start: number } | null = null;
    const measure = () => {
      const box = list.getBoundingClientRect();
      points = [...list.querySelectorAll('button')].map(item => {
        const b = item.getBoundingClientRect();
        return list.scrollLeft + b.left + b.width / 2 - box.left - box.width / 2;
      });
    };
    const clamp = (x: number) => Math.max(points[0] ?? 0, Math.min(points.at(-1) ?? 0, x));
    const nearest = () => points.reduce((best, point, i) => Math.abs(point - list.scrollLeft) < Math.abs(points[best] - list.scrollLeft) ? i : best, 0);
    const stop = () => { cancelAnimationFrame(frame); frame = 0; clearTimeout(idle); };
    const write = (x: number) => { list.scrollLeft = clamp(x); };
    const finish = (index: number, commit: boolean) => {
      write(points[index] ?? 0);
      list.style.scrollSnapType = '';
      browsing = false;
      if (commit && index !== current.current.selected) current.current.onSelect(index);
    };
    const settle = (index: number, commit: boolean) => {
      stop();
      list.style.scrollSnapType = 'none';
      const from = list.scrollLeft, to = points[index] ?? from;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || Math.abs(to - from) < 0.5) {
        finish(index, commit); return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        // A scroll event can start this animation after the current frame's
        // timestamp. Negative progress would briefly move away from the target.
        const t = Math.max(0, Math.min(1, (now - start) / 180));
        write(from + (to - from) * (1 - (1 - t) ** 3));
        if (t < 1) frame = requestAnimationFrame(tick);
        else { frame = 0; finish(index, commit); }
      };
      frame = requestAnimationFrame(tick);
    };
    choose.current = index => {
      stop(); following = false; browsing = false; drag = null; resumeSelection = false;
      // A focus-mode choice is deferred until the current scan has zoomed out.
      if (current.current.onSelect(index) !== false) settle(index, false);
    };
    const beginBrowsing = () => {
      stop(); following = false; browsing = true;
      list.style.scrollSnapType = '';
    };
    const nativeEnd = () => {
      if (!browsing || touching || drag || frame) return;
      clearTimeout(idle);
      if (resumeSelection) {
        resumeSelection = false; browsing = false;
        settle(current.current.selected, false);
        return;
      }
      // Native momentum and CSS snapping have finished. Do not write scrollLeft
      // or run a second settling animation over the browser's result.
      browsing = false;
      const index = nearest();
      if (index !== current.current.selected) current.current.onSelect(index);
    };
    const scheduleEnd = () => { clearTimeout(idle); idle = setTimeout(nativeEnd, 180); };
    const touchStart = (event: TouchEvent) => {
      // Holding or vertically scrolling over an interrupted explicit animation
      // must not select the thumbnail it happened to pass on the way.
      resumeSelection ||= !!frame && !browsing;
      const touch = event.touches[0];
      touchOrigin = touch ? { x: touch.clientX, y: touch.clientY } : null;
      touching = true; suppressClick.current = false; beginBrowsing();
    };
    const touchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touchOrigin || !touch) return;
      const dx = Math.abs(touch.clientX - touchOrigin.x), dy = Math.abs(touch.clientY - touchOrigin.y);
      // This only abandons the interrupted target. It never gates native input
      // or freezes a direction decision after the first small movement.
      if (dx > 8 && dx > dy) resumeSelection = false;
    };
    const touchEnd = (event: TouchEvent) => {
      touching = event.touches.length > 0;
      if (!touching) { touchOrigin = null; scheduleEnd(); }
    };
    // Touch stays entirely native. Pointer cancellation means the browser took
    // ownership, not that it should be interrupted by our centering code.
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !event.isPrimary || event.button !== 0) return;
      beginBrowsing(); suppressClick.current = false;
      list.style.scrollSnapType = 'none';
      drag = { id: event.pointerId, x: event.clientX, start: list.scrollLeft };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (Math.abs(event.clientX - drag.x) < 3 && !suppressClick.current) return;
      event.preventDefault(); suppressClick.current = true;
      if (!list.hasPointerCapture(event.pointerId)) list.setPointerCapture(event.pointerId);
      write(drag.start + drag.x - event.clientX);
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      if (list.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId);
      settle(nearest(), true);
    };
    const wheel = (event: WheelEvent) => {
      if (!event.shiftKey && event.deltaX === 0) return;
      resumeSelection = false; beginBrowsing(); scheduleEnd();
    };
    const scroll = () => {
      if (browsing && touching) suppressClick.current = true;
      if (browsing && !touching && !drag && !frame) scheduleEnd();
    };
    measure(); finish(current.current.selected, false);
    const unsubscribe = motion?.subscribe(position => {
      if (browsing) return;
      if (position === null) {
        // Handoffs may happen mid-drag. Resume selection from the current
        // position rather than jumping to the previous page's center first.
        if (following) { following = false; settle(current.current.selected, false); }
        return;
      }
      stop(); drag = null; following = true;
      list.style.scrollSnapType = 'none';
      const bounded = Math.max(0, Math.min(points.length - 1, position));
      const low = Math.floor(bounded), high = Math.ceil(bounded);
      write((points[low] ?? 0) + ((points[high] ?? 0) - (points[low] ?? 0)) * (bounded - low));
    });
    let width = list.clientWidth;
    const resize = new ResizeObserver(() => {
      if (list.clientWidth === width) return;
      width = list.clientWidth; stop(); drag = null; following = false; touching = false; resumeSelection = false;
      measure(); finish(current.current.selected, false);
    });
    resize.observe(list);
    selectionChanged.current = () => {
      if (touching || drag || (browsing && motion?.get() != null)) return;
      if (!following) { browsing = false; settle(current.current.selected, false); }
    };
    list.addEventListener('pointerdown', down);
    list.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    list.addEventListener('touchstart', touchStart, { passive: true });
    list.addEventListener('touchmove', touchMove, { passive: true });
    window.addEventListener('touchend', touchEnd, { passive: true });
    window.addEventListener('touchcancel', touchEnd, { passive: true });
    list.addEventListener('wheel', wheel, { passive: true });
    list.addEventListener('scroll', scroll, { passive: true });
    list.addEventListener('scrollend', nativeEnd);
    return () => {
      stop(); resize.disconnect(); unsubscribe?.();
      list.removeEventListener('pointerdown', down); list.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      list.removeEventListener('touchstart', touchStart); list.removeEventListener('touchmove', touchMove);
      window.removeEventListener('touchend', touchEnd); window.removeEventListener('touchcancel', touchEnd);
      list.removeEventListener('wheel', wheel); list.removeEventListener('scroll', scroll); list.removeEventListener('scrollend', nativeEnd);
    };
  }, [motion, count]);

  useLayoutEffect(() => { selectionChanged.current(); }, [selected]);
  return { root, choose, suppressClick };
}

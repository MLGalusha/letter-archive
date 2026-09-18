import { useLayoutEffect, useRef } from 'react';
import { decideGestureAxis, type GestureAxis } from '../../utils/directionalGesture';
import type { PageMotion } from './pageMotion';

/** One horizontal motion owner: pointer inertia, or main-image progress. */
export function usePageStripMotion(selected: number,
  onSelect: (index: number) => void, motion?: PageMotion, count = 0) {
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
    let points: number[] = [], following = false, browsing = false;
    let drag: { id: number; x: number; y: number; start: number; lastX: number; time: number; velocity: number; axis: GestureAxis } | null = null;
    const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const measure = () => {
      const box = list.getBoundingClientRect();
      points = [...list.querySelectorAll('button')].map(item => {
        const b = item.getBoundingClientRect();
        return list.scrollLeft + b.left + b.width / 2 - box.left - box.width / 2;
      });
    };
    const clamp = (x: number) => Math.max(points[0] ?? 0, Math.min(points.at(-1) ?? 0, x));
    const nearest = (x: number) => points.reduce((best, point, i) => Math.abs(point - x) < Math.abs(points[best] - x) ? i : best, 0);
    const stop = () => { cancelAnimationFrame(frame); frame = 0; clearTimeout(idle); };
    const write = (x: number) => { list.scrollLeft = clamp(x); };
    const finish = (index: number, commit: boolean) => {
      write(points[index] ?? 0);
      list.style.scrollSnapType = '';
      browsing = false;
      if (commit && index !== current.current.selected) current.current.onSelect(index);
    };
    // Damped travel to a page center; all inputs can interrupt from its visible position.
    const settle = (index: number, commit: boolean) => {
      stop();
      list.style.scrollSnapType = 'none';
      if (reduced()) { finish(index, commit); return; }
      const from = list.scrollLeft, to = points[index] ?? from;
      if (Math.abs(to - from) < 0.5) { finish(index, commit); return; }
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 180);
        write(from + (to - from) * (1 - (1 - t) ** 3));
        if (t < 1) frame = requestAnimationFrame(tick);
        else { frame = 0; finish(index, commit); }
      };
      frame = requestAnimationFrame(tick);
    };
    const coast = (velocity: number) => {
      stop();
      if (reduced()) { finish(nearest(list.scrollLeft), true); return; }
      let x = list.scrollLeft, v = Math.max(-1.5, Math.min(1.5, velocity)), previous = performance.now();
      const pitch = Math.abs((points[1] ?? 64) - (points[0] ?? 0)) || 64;
      const tick = (now: number) => {
        const dt = Math.min(32, now - previous); previous = now;
        // A soft detent increases damping near each center without hard stops.
        const phase = (x - (points[0] ?? 0)) / pitch;
        const catchStrength = (1 + Math.cos(phase * Math.PI * 2)) / 2;
        v *= Math.exp(-dt * (0.009 + 0.009 * catchStrength));
        x = clamp(x + v * dt); write(x);
        if (Math.abs(v) < 0.06 || x === points[0] || x === points.at(-1)) {
          frame = 0; settle(nearest(x), true);
        } else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    choose.current = index => {
      stop(); following = false; browsing = false; drag = null;
      current.current.onSelect(index);
      settle(index, false);
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      stop(); following = false; browsing = true; suppressClick.current = false;
      list.style.scrollSnapType = 'none';
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: list.scrollLeft,
        lastX: event.clientX, time: performance.now(), velocity: 0, axis: 'undecided' };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.axis === 'undecided') drag.axis = decideGestureAxis(event.clientX - drag.x, event.clientY - drag.y, 6, 1.2);
      if (drag.axis !== 'horizontal') return;
      event.preventDefault(); suppressClick.current = true;
      if (!list.hasPointerCapture(event.pointerId)) list.setPointerCapture(event.pointerId);
      const now = performance.now(), dt = now - drag.time;
      if (dt > 0) drag.velocity = (drag.lastX - event.clientX) / dt;
      drag.lastX = event.clientX; drag.time = now;
      write(drag.start + drag.x - event.clientX);
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const active = drag; drag = null;
      if (list.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId);
      if (active.axis === 'horizontal' && event.type !== 'pointercancel') coast(performance.now() - active.time > 80 ? 0 : active.velocity);
      else settle(nearest(list.scrollLeft), true);
    };
    const wheel = () => { stop(); following = false; browsing = true; list.style.scrollSnapType = ''; };
    const nativeEnd = () => { if (browsing && !drag && !frame) settle(nearest(list.scrollLeft), true); };
    const scroll = () => {
      if (browsing && !drag && !frame) { clearTimeout(idle); idle = setTimeout(nativeEnd, 160); }
    };
    measure(); finish(current.current.selected, false);
    const unsubscribe = motion?.subscribe(position => {
      if (position === null) {
        if (following) {
          following = false;
          finish(current.current.selected, false);
        }
        return;
      }
      stop(); drag = null; following = true; browsing = false;
      list.style.scrollSnapType = 'none';
      // At a wrap boundary, hold the endpoint and relocate on commit instead
      // of animating a distracting rewind across a long document.
      const bounded = Math.max(0, Math.min(points.length - 1, position));
      const low = Math.floor(bounded), high = Math.ceil(bounded);
      write((points[low] ?? 0) + ((points[high] ?? 0) - (points[low] ?? 0)) * (bounded - low));
    });
    let width = list.clientWidth;
    const resize = new ResizeObserver(() => {
      if (list.clientWidth === width) return;
      width = list.clientWidth; stop(); drag = null; following = false;
      measure(); finish(current.current.selected, false);
    });
    resize.observe(list);
    const selectedEvent = () => {
      if (!following && !browsing) settle(current.current.selected, false);
    };
    selectionChanged.current = selectedEvent;
    list.addEventListener('pointerdown', down);
    list.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    list.addEventListener('wheel', wheel, { passive: true });
    list.addEventListener('scroll', scroll, { passive: true });
    list.addEventListener('scrollend', nativeEnd);
    return () => {
      stop(); resize.disconnect(); unsubscribe?.();

      list.removeEventListener('pointerdown', down); list.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      list.removeEventListener('wheel', wheel); list.removeEventListener('scroll', scroll); list.removeEventListener('scrollend', nativeEnd);
    };
  }, [root, motion, count]);

  useLayoutEffect(() => { selectionChanged.current(); }, [selected]);
  return { root, choose, suppressClick };
}

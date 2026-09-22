import { useLayoutEffect, useRef } from 'react';

/** Browsing never selects. Activation is the only way this control changes pages. */
export function usePageStripMotion(selected: number, onSelect: (index: number) => void, count: number) {
  const root = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const choose = useRef(onSelect);
  useLayoutEffect(() => { choose.current = onSelect; }, [onSelect]);
  useLayoutEffect(() => {
    const list = root.current;
    if (!list) return;
    let drag: { id: number; x: number; left: number } | null = null;
    let touch: { x: number; y: number } | null = null;
    const start = (event: TouchEvent) => {
      suppressClick.current = false;
      const point = event.touches?.[0];
      touch = point ? { x: point.clientX, y: point.clientY } : null;
    };
    const track = (event: TouchEvent) => {
      const point = event.touches?.[0];
      if (touch && point && Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > 8) suppressClick.current = true;
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      drag = { id: event.pointerId, x: event.clientX, left: list.scrollLeft };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (!suppressClick.current && Math.abs(event.clientX - drag.x) < 4) return;
      event.preventDefault(); suppressClick.current = true;
      if (!list.hasPointerCapture(event.pointerId)) list.setPointerCapture(event.pointerId);
      list.scrollLeft = drag.left + drag.x - event.clientX;
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      if (list.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId);
    };
    list.addEventListener('touchstart', start, { passive: true });
    list.addEventListener('touchmove', track, { passive: true });
    list.addEventListener('pointerdown', down); list.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => {
      list.removeEventListener('touchstart', start); list.removeEventListener('touchmove', track);
      list.removeEventListener('pointerdown', down); list.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    };
  }, []);
  useLayoutEffect(() => {
    const list = root.current;
    if (!list) return;
    const reveal = () => {
      const item = list.querySelectorAll('button')[selected];
      if (!item) return;
      const bounds = list.getBoundingClientRect(), box = item.getBoundingClientRect();
      // Reveal only when necessary; no competing animation or document scroll.
      if (box.left < bounds.left + 4) list.scrollLeft += box.left - bounds.left - 4;
      else if (box.right > bounds.right - 4) list.scrollLeft += box.right - bounds.right + 4;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [selected, count]);
  return { root, choose, suppressClick };
}

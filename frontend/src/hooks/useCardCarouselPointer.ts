import { useLayoutEffect, useRef, type RefObject, type PointerEvent, type MouseEvent, type DragEvent } from 'react';
type Gesture = { id: number; x: number; y: number; left: number; dragging: boolean; vertical: boolean; time: number; lastX: number; velocity: number };

/** Share drag geometry; leave vertical touch gestures and pinch to the browser. */
export default function useCardCarouselPointer(enabled: boolean, viewport: RefObject<HTMLDivElement | null>, surface: RefObject<HTMLDivElement | null>, settle: (element: HTMLDivElement, index: number) => void, finish: () => void) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const callbacks = useRef({ settle, finish });
  useLayoutEffect(() => { callbacks.current = { settle, finish }; }, [settle, finish]);
  const begin = (element: HTMLDivElement, id: number, x: number, y: number) => {
    callbacks.current.finish();
    suppressClick.current = false;
    gesture.current = { id, x, y, left: element.scrollLeft, dragging: false, vertical: false, time: performance.now(), lastX: x, velocity: 0 };
  };
  const move = (element: HTMLDivElement, x: number, y: number) => {
    const start = gesture.current;
    if (!start || start.vertical) return false;
    const dx = x - start.x, dy = y - start.y;
    if (!start.dragging) {
      if (Math.hypot(dx, dy) <= 8) return false;
      if (Math.abs(dy) > Math.abs(dx)) { start.vertical = true; return false; }
      start.dragging = true;
      suppressClick.current = true;
      element.style.scrollSnapType = 'none';
      element.dataset.dragging = 'true';
    }
    const now = performance.now();
    if (now > start.time) start.velocity = (x - start.lastX) / (now - start.time);
    start.time = now;
    start.lastX = x;
    element.scrollLeft = start.left - dx;
    return true;
  };
  const release = (element: HTMLDivElement, canceled = false) => {
    const start = gesture.current;
    gesture.current = null;
    if (canceled) suppressClick.current = false;
    if (!start?.dragging) return;
    element.removeAttribute('data-dragging');
    const width = element.clientWidth || 1;
    const projection = !canceled && performance.now() - start.time < 100 ? Math.max(-width / 2, Math.min(width / 2, start.velocity * 100)) : 0;
    const index = Math.max(0, Math.min(element.children.length - 1, Math.round((element.scrollLeft - projection) / width)));
    callbacks.current.settle(element, index);
  };
  // A non-passive touchmove lets horizontal intent win before native scrolling
  // cancels pointer delivery. Vertical intent is never prevented; no global lock.
  useLayoutEffect(() => {
    const element = viewport.current;
    const target = surface.current;
    if (!enabled || !element || !target) return;
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { release(element, true); return; }
      const touch = event.touches[0];
      begin(element, touch.identifier, touch.clientX, touch.clientY);
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !event.cancelable) { release(element, true); return; }
      const touch = event.touches[0];
      if (move(element, touch.clientX, touch.clientY)) event.preventDefault();
    };
    const onEnd = (event: TouchEvent) => {
      const dragged = gesture.current?.dragging;
      release(element, event.type === 'touchcancel');
      // Consume only the click belonging to this drag, never a later tap.
      if (dragged && event.cancelable) event.preventDefault();
      suppressClick.current = false;
    };
    target.addEventListener('touchstart', onStart, { passive: true });
    target.addEventListener('touchmove', onMove, { passive: false });
    target.addEventListener('touchend', onEnd, { passive: false });
    target.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      target.removeEventListener('touchstart', onStart);
      target.removeEventListener('touchmove', onMove);
      target.removeEventListener('touchend', onEnd);
      target.removeEventListener('touchcancel', onEnd);
      gesture.current = null;
    };
  // Geometry helpers use refs; selection renders must not reset a live gesture.
  }, [enabled, viewport, surface]);
  const releaseMouse = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || gesture.current?.id !== event.pointerId) return;
    const dragged = gesture.current.dragging;
    release(event.currentTarget, event.type === 'pointercancel');
    if (dragged && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'mouse') return;
      callbacks.current.finish();
      suppressClick.current = false;
      if (!enabled || !event.isPrimary || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if ((event.target as HTMLElement).closest('button, a:not([data-carousel-drag]), input, textarea, select, [contenteditable=true]')) return;
      begin(event.currentTarget, event.pointerId, event.clientX, event.clientY);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'mouse' || gesture.current?.id !== event.pointerId) return;
      if (!(event.buttons & 1)) { releaseMouse(event); return; }
      if (move(event.currentTarget, event.clientX, event.clientY)) {
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    },
    onPointerUp: releaseMouse,
    onPointerCancel: releaseMouse,
    onLostPointerCapture: releaseMouse,
    onDragStart: (event: DragEvent<HTMLDivElement>) => { if (enabled) event.preventDefault(); },
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      if (event.detail > 0 && suppressClick.current) { event.preventDefault(); event.stopPropagation(); }
      suppressClick.current = false;
    },
  };
}

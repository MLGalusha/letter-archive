import { useRef, type PointerEvent, type MouseEvent, type DragEvent } from 'react';
type Gesture = { id: number; x: number; y: number; left: number; mouse: boolean; dragging: boolean };

/** Only mouse dragging is simulated. Touch, wheel, and pinch remain browser-owned. */
export default function useCardCarouselPointer(enabled: boolean) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const release = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    gesture.current = null;
    const element = event.currentTarget;
    if (!element || !start.mouse || !start.dragging) return;
    const index = Math.round(element.scrollLeft / (element.clientWidth || 1));
    element.style.scrollSnapType = '';
    element.removeAttribute('data-dragging');
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    element.scrollTo({ left: index * element.clientWidth,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      suppressClick.current = false;
      if (!enabled || !event.isPrimary || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const mouse = event.pointerType === 'mouse';
      if (mouse && (event.target as HTMLElement).closest('button, a:not([data-carousel-drag]), input, textarea, select, [contenteditable=true]')) return;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
        left: event.currentTarget.scrollLeft, mouse, dragging: false };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const start = gesture.current;
      if (!start || start.id !== event.pointerId) return;
      // An uncaptured press can be released outside the viewport.
      if (start.mouse && !(event.buttons & 1)) { release(event); return; }
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) > 8) suppressClick.current = true;
      if (!start.mouse) return;
      if (!start.dragging) {
        if (Math.abs(dx) <= 8 || Math.abs(dx) < Math.abs(dy)) return;
        start.dragging = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.style.scrollSnapType = 'none';
        event.currentTarget.dataset.dragging = 'true';
        event.currentTarget.scrollTo({ left: event.currentTarget.scrollLeft, behavior: 'instant' });
      }
      event.preventDefault();
      event.currentTarget.scrollLeft = start.left - dx;
    },
    onPointerUp: release,
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => { suppressClick.current = true; release(event); },
    onLostPointerCapture: release,
    onDragStart: (event: DragEvent<HTMLDivElement>) => { if (enabled) event.preventDefault(); },
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      if (event.detail > 0 && suppressClick.current) { event.preventDefault(); event.stopPropagation(); }
      suppressClick.current = false;
    },
  };
}

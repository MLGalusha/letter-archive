import { useEffect, useRef } from 'react';

const TAP_SLOP = 10;

/** Complete touch taps without waiting for a synthesized click. Starting a
 * swipe over a floating control must still scroll the document normally.
 */
export default function useTouchScrollAction(action: () => void) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = ref.current;
    if (!button) return;
    let start: { id: number; x: number; y: number } | null = null;
    const cancel = () => { start = null; };
    const withinTap = (touch: Touch) => start !== null
      && touch.identifier === start.id
      && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) <= TAP_SLOP;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start = event.touches.length === 1
        ? { id: touch.identifier, x: touch.clientX, y: touch.clientY } : null;
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !withinTap(event.touches[0])) cancel();
    };
    const onEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const activate = event.touches.length === 0 && touch && withinTap(touch);
      cancel();
      if (!activate || !event.cancelable) return;
      // Prevent only the completed tap's synthesized click, not native panning.
      event.preventDefault();
      action();
    };
    button.addEventListener('touchstart', onStart, { passive: true });
    button.addEventListener('touchmove', onMove, { passive: true });
    button.addEventListener('touchend', onEnd, { passive: false });
    button.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      button.removeEventListener('touchstart', onStart);
      button.removeEventListener('touchmove', onMove);
      button.removeEventListener('touchend', onEnd);
      button.removeEventListener('touchcancel', cancel);
    };
  }, [action]);
  return ref;
}

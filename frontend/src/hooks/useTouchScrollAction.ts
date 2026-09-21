import { useEffect, useLayoutEffect, useRef } from 'react';

const TAP_SLOP = 10;

/** Complete touch taps without waiting for a synthesized click. The small floating
 * button owns its touch sequence; dragging cancels rather than navigating.
 */
export default function useTouchScrollAction(action: () => void) {
  const ref = useRef<HTMLButtonElement>(null);
  const actionRef = useRef(action);
  useLayoutEffect(() => { actionRef.current = action; }, [action]);
  useEffect(() => {
    const button = ref.current;
    if (!button) return;
    const previousTouchAction = button.style.touchAction;
    button.style.touchAction = "none";
    let start: { id: number; x: number; y: number } | null = null;
    let suppressClickUntil = 0;
    const cancel = () => { start = null; };
    const withinTap = (touch: Touch) => start !== null
      && touch.identifier === start.id
      && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) <= TAP_SLOP;
    const onStart = (event: TouchEvent) => {
      suppressClickUntil = 0;
      const touch = event.touches[0];
      // Reserve this control contact before native momentum handling. Do not
      // activate until release: moving away or cancellation must remain safe.
      if (event.touches.length === 1 && event.cancelable) event.preventDefault();
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
      if (!activate) return;
      // Suppress the compatibility click so this release activates only once.
      if (event.cancelable) event.preventDefault();
      suppressClickUntil = performance.now() + 700;
      actionRef.current();
    };
    const onClick = (event: MouseEvent) => {
      if (event.detail !== 0 && performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClickUntil = 0;
      }
    };
    button.addEventListener('click', onClick, true);
    button.addEventListener('touchstart', onStart, { passive: false });
    button.addEventListener('touchmove', onMove, { passive: true });
    button.addEventListener('touchend', onEnd, { passive: false });
    button.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      button.style.touchAction = previousTouchAction;
      button.removeEventListener('click', onClick, true);
      button.removeEventListener('touchstart', onStart);
      button.removeEventListener('touchmove', onMove);
      button.removeEventListener('touchend', onEnd);
      button.removeEventListener('touchcancel', cancel);
    };
  }, []);
  return ref;
}

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { decideGestureAxis, type GestureAxis } from '../../utils/directionalGesture';

export const VIEWER_SWIPE_MS = 230;

/** Fit-view swipe only. Zoom and pan remain owned by LetterViewer. */
export function useViewerSwipe(
  containerRef: RefObject<HTMLDivElement | null>,
  onCommit: (direction: -1 | 1) => void,
  contentKey: string,
) {
  const [view, setView] = useState({ offset: 0, settling: false });
  const gesture = useRef<{ x: number; y: number; axis: GestureAxis; offset: number } | null>(null);
  const frame = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settling = useRef(false);
  const direction = useRef<-1 | 0 | 1>(0);

  const clearWork = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (timer.current !== null) clearTimeout(timer.current);
    frame.current = null;
    timer.current = null;
  }, []);

  const cancel = useCallback(() => {
    clearWork();
    gesture.current = null;
    settling.current = false;
    direction.current = 0;
    setView({ offset: 0, settling: false });
  }, [clearWork]);

  const finish = useCallback(() => {
    if (!settling.current) return;
    const committed = direction.current;
    cancel();
    if (committed) onCommit(committed);
  }, [cancel, onCommit]);

  const begin = useCallback((x: number, y: number) => {
    if (settling.current) return false;
    gesture.current = { x, y, axis: 'undecided', offset: 0 };
    return true;
  }, []);

  const move = useCallback((x: number, y: number) => {
    const active = gesture.current;
    if (!active) return false;
    const dx = x - active.x;
    if (active.axis === 'undecided') active.axis = decideGestureAxis(dx, y - active.y);
    if (active.axis !== 'horizontal') return false;
    const width = containerRef.current?.clientWidth || window.innerWidth;
    active.offset = Math.max(-width, Math.min(width, dx));
    if (frame.current === null) frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (gesture.current) setView({ offset: gesture.current.offset, settling: false });
    });
    return true;
  }, [containerRef]);

  const release = useCallback(() => {
    const active = gesture.current;
    if (!active || active.axis !== 'horizontal') { cancel(); return; }
    clearWork();
    gesture.current = null;
    const width = containerRef.current?.clientWidth || window.innerWidth;
    const committed = Math.abs(active.offset) >= Math.min(72, width * 0.15);
    direction.current = committed ? (active.offset < 0 ? 1 : -1) : 0;
    settling.current = true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    setView({ offset: active.offset, settling: false });
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setView({ offset: direction.current ? -direction.current * width : 0, settling: true });
      // A fallback covers interrupted/missing transitionend without leaving the viewer locked.
      timer.current = setTimeout(finish, VIEWER_SWIPE_MS + 80);
    });
  }, [cancel, clearWork, containerRef, finish]);

  useEffect(() => () => cancel(), [cancel, contentKey]);

  return { ...view, begin, move, release, cancel, finish, settlingRef: settling };
}

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { decideGestureAxis, type GestureAxis } from '../../utils/directionalGesture';

export const VIEWER_SWIPE_MS = 230;

/** Fit-view paging owns one carriage; zoom/pan remain owned by LetterViewer. */
export function useViewerSwipe(
  containerRef: RefObject<HTMLDivElement | null>,
  onCommit: (direction: -1 | 1) => void,
  contentKey: string,
) {
  const [view, setView] = useState({ offset: 0, settling: false, duration: VIEWER_SWIPE_MS });
  const gesture = useRef<{
    x: number; y: number; axis: GestureAxis; offset: number;
    samples: Array<{ x: number; time: number }>;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settling = useRef(false);
  const direction = useRef<-1 | 0 | 1>(0);
  const destination = useRef(0);

  const clearWork = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (timer.current !== null) clearTimeout(timer.current);
    frame.current = null;
    timer.current = null;
  }, []);

  const readOffset = useCallback(() => {
    const carriage = containerRef.current?.querySelector('.viewer-carriage');
    if (!carriage) return 0;
    const transform = getComputedStyle(carriage).transform;
    if (!transform || transform === 'none') return 0;
    // Computed browser styles are matrices; the direct form also supports DOM tests.
    if (typeof DOMMatrixReadOnly !== 'undefined') return new DOMMatrixReadOnly(transform).m41;
    const values = transform.slice(transform.indexOf('(') + 1).split(',').map(parseFloat);
    return transform.startsWith('matrix3d') ? values[12] : transform.startsWith('matrix') ? values[4] : values[0];
  }, [containerRef]);

  const cancel = useCallback(() => {
    clearWork();
    gesture.current = null;
    settling.current = false;
    direction.current = 0;
    destination.current = 0;
    setView({ offset: 0, settling: false, duration: VIEWER_SWIPE_MS });
  }, [clearWork]);

  const finish = useCallback((fallback = false) => {
    if (!settling.current) return;
    // A queued event from an interrupted transition cannot commit its replacement.
    if (!fallback && Math.abs(readOffset() - destination.current) > 1) return;
    const committed = direction.current;
    cancel();
    if (committed) onCommit(committed);
  }, [cancel, onCommit, readOffset]);

  const begin = useCallback((x: number, y: number) => {
    // Take over the *visible* position, not the unfinished CSS destination.
    const offset = settling.current ? readOffset() : 0;
    clearWork();
    settling.current = false;
    direction.current = 0;
    gesture.current = { x: x - offset, y, axis: offset ? 'horizontal' : 'undecided', offset,
      samples: [{ x, time: performance.now() }] };
    setView({ offset, settling: false, duration: VIEWER_SWIPE_MS });
    return true;
  }, [clearWork, readOffset]);

  const move = useCallback((x: number, y: number) => {
    const active = gesture.current;
    if (!active) return false;
    const dx = x - active.x;
    if (active.axis === 'undecided') active.axis = decideGestureAxis(dx, y - active.y, 8, 1.2);
    if (active.axis !== 'horizontal') return false;
    const width = containerRef.current?.clientWidth || window.innerWidth;
    active.offset = Math.max(-width, Math.min(width, dx));
    const time = performance.now();
    active.samples = [...active.samples.filter(sample => time - sample.time <= 80), { x, time }];
    if (frame.current === null) frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (gesture.current) setView({ offset: gesture.current.offset, settling: false, duration: VIEWER_SWIPE_MS });
    });
    return true;
  }, [containerRef]);

  const release = useCallback(() => {
    const active = gesture.current;
    if (!active || active.axis !== 'horizontal') { cancel(); return; }
    clearWork();
    gesture.current = null;
    const width = containerRef.current?.clientWidth || window.innerWidth;
    const first = active.samples[0];
    const last = active.samples.at(-1)!;
    const elapsed = last.time - first.time;
    const velocity = performance.now() - last.time <= 80 && elapsed > 0
      ? Math.max(-2, Math.min(2, (last.x - first.x) / elapsed)) : 0;
    // Recent intent matters: a short flick can advance, a reversal can return.
    const projected = active.offset + velocity * 160;
    const committed = Math.abs(active.offset) >= 12 && Math.abs(projected) >= Math.min(72, width * 0.15)
      && Math.sign(projected) === Math.sign(active.offset);
    direction.current = committed ? (active.offset < 0 ? 1 : -1) : 0;
    destination.current = direction.current ? -direction.current * width : 0;
    settling.current = true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finish(true);
      return;
    }
    const duration = Math.round(Math.max(120, Math.min(VIEWER_SWIPE_MS,
      Math.abs(destination.current - active.offset) / width * VIEWER_SWIPE_MS)));
    setView({ offset: active.offset, settling: false, duration });
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setView({ offset: destination.current, settling: true, duration });
      timer.current = setTimeout(() => finish(true), duration + 80);
    });
  }, [cancel, clearWork, containerRef, finish]);

  useEffect(() => () => cancel(), [cancel, contentKey]);

  return { ...view, begin, move, release, cancel, finish, settlingRef: settling };
}

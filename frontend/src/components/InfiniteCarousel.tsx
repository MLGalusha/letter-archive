import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import './InfiniteCarousel.css';

const AUTO_INTERVAL = 5000;
const PAUSE_AFTER_INTERACTION = 30000;

interface InfiniteCarouselProps {
  children: ReactNode[];
  /** CSS class on the outermost wrapper */
  className?: string;
  /** CSS class prefix for BEM-style naming (default: "carousel") */
  classPrefix?: string;
  /** Expose pause function to parent (e.g. for child interaction) */
  pauseRef?: React.MutableRefObject<() => void>;
  /** Suppress click-through after drag (for cards that navigate on click) */
  suppressClickAfterDrag?: boolean;
}

export default function InfiniteCarousel({
  children,
  className,
  classPrefix = 'carousel',
  pauseRef,
  suppressClickAfterDrag = false,
}: InfiniteCarouselProps) {
  const slideCount = children.length;

  // pos includes clone slots: [cloneLast, ...real, cloneFirst]
  // Real slide 0 → pos 1, real slide 1 → pos 2, etc.
  const [pos, setPos] = useState(1);
  const [animated, setAnimated] = useState(true);
  const [dragOffset, setDragOffset] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ x: number; y: number; decided: boolean; isVertical: boolean } | null>(null);
  const draggedRef = useRef(false);
  const pauseUntilRef = useRef(0);

  const realIndex = pos <= 0 ? slideCount - 1
    : pos >= slideCount + 1 ? 0
    : pos - 1;

  // ── Clone snap ──
  const snapIfClone = useCallback(() => {
    setPos((p) => {
      if (p <= 0) { setAnimated(false); return slideCount; }
      if (p >= slideCount + 1) { setAnimated(false); return 1; }
      return p;
    });
  }, [slideCount]);

  const handleTransitionEnd = useCallback(() => snapIfClone(), [snapIfClone]);

  // Re-enable animation after instant snap (double rAF for robust paint)
  useEffect(() => {
    if (!animated) {
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
      return () => cancelAnimationFrame(id);
    }
  }, [animated]);

  // Fallback: snap if transitionEnd doesn't fire
  useEffect(() => {
    if (!animated) return;
    if (pos <= 0 || pos >= slideCount + 1) {
      const id = setTimeout(snapIfClone, 500);
      return () => clearTimeout(id);
    }
  }, [pos, animated, slideCount, snapIfClone]);

  // ── Auto-advance ──
  const pauseAutoScroll = useCallback(() => {
    pauseUntilRef.current = Date.now() + PAUSE_AFTER_INTERACTION;
  }, []);

  useEffect(() => {
    if (pauseRef) pauseRef.current = pauseAutoScroll;
  }, [pauseRef, pauseAutoScroll]);

  useEffect(() => {
    if (slideCount <= 1) return;
    const prefersReducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReducedMotion) return;
    const id = setInterval(() => {
      if (Date.now() < pauseUntilRef.current) return;
      setAnimated(true);
      setPos((p) => p + 1);
    }, AUTO_INTERVAL);
    return () => clearInterval(id);
  }, [slideCount]);

  // ── Visibility change ──
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') snapIfClone();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [snapIfClone]);

  // ── Drag helpers ──
  const startDrag = useCallback((x: number, y: number) => {
    setAnimated(false);
    draggedRef.current = false;
    touchRef.current = { x, y, decided: false, isVertical: false };
  }, []);

  const moveDrag = useCallback((x: number, y: number, preventDefault?: () => void) => {
    const start = touchRef.current;
    if (!start) return;
    const dx = x - start.x;
    const dy = y - start.y;
    if (!start.decided) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        start.decided = true;
        start.isVertical = true;
        return;
      }
      if (Math.abs(dx) > 8) {
        start.decided = true;
        start.isVertical = false;
      }
    }
    if (start.isVertical) return;
    if (Math.abs(dx) > 5) draggedRef.current = true;
    preventDefault?.();
    setDragOffset(dx);
  }, []);

  const endDrag = useCallback(() => {
    const start = touchRef.current;
    touchRef.current = null;
    setAnimated(true);
    const width = containerRef.current?.offsetWidth || 1;
    const threshold = width * 0.2;
    if (start && !start.isVertical && Math.abs(dragOffset) > threshold) {
      if (dragOffset < 0) setPos((p) => p + 1);
      else setPos((p) => p - 1);
    }
    setDragOffset(0);
    pauseAutoScroll();
  }, [dragOffset, pauseAutoScroll]);

  // ── Native touch/wheel listeners (non-passive for preventDefault) ──
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => startDrag(e.touches[0].clientX, e.touches[0].clientY);
    const onTouchMove = (e: TouchEvent) => moveDrag(e.touches[0].clientX, e.touches[0].clientY, () => e.preventDefault());
    const onTouchEnd = () => endDrag();

    let wheelCooldown = false;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (wheelCooldown || Math.abs(e.deltaX) < 30) return;
      e.preventDefault();
      wheelCooldown = true;
      setTimeout(() => { wheelCooldown = false; }, 600);
      if (e.deltaX > 0) setPos((p) => p + 1);
      else setPos((p) => p - 1);
      pauseAutoScroll();
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, [startDrag, moveDrag, endDrag, pauseAutoScroll]);

  // ── Mouse drag ──
  const mouseDownRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // A new gesture must never inherit click suppression from an earlier drag.
    draggedRef.current = false;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((e.target as HTMLElement).closest('button, a:not([data-carousel-drag])')) return;
    mouseDownRef.current = true;
    startDrag(e.clientX, e.clientY);
  }, [startDrag]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!mouseDownRef.current) return;
    moveDrag(e.clientX, e.clientY, () => e.preventDefault());
  }, [moveDrag]);

  const handleMouseUp = useCallback(() => {
    if (!mouseDownRef.current) return;
    mouseDownRef.current = false;
    endDrag();
  }, [endDrag]);

  const handleMouseLeave = useCallback(() => {
    if (!mouseDownRef.current) return;
    mouseDownRef.current = false;
    endDrag();
  }, [endDrag]);

  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (e.detail === 0) {
      draggedRef.current = false;
      return;
    }
    if (suppressClickAfterDrag && draggedRef.current) {
      e.stopPropagation();
      e.preventDefault();
      draggedRef.current = false;
    }
  }, [suppressClickAfterDrag]);

  // ── Render ──
  const trackItems = [
    children[slideCount - 1],
    ...children,
    children[0],
  ];

  const translateX = -(pos * 100) + (dragOffset / (containerRef.current?.offsetWidth || 1)) * 100;

  return (
    <div className={`${classPrefix}-wrap${className ? ` ${className}` : ''}`} ref={containerRef} data-swipe-ignore>
      <div className={`${classPrefix}-viewport`}>
        <div
          ref={trackRef}
          className={`${classPrefix}-track${animated ? ` ${classPrefix}-track--animated` : ''}`}
          style={{ transform: `translateX(${translateX}%)` }}
          onTransitionEnd={handleTransitionEnd}
          onClickCapture={handleClickCapture}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          {trackItems.map((child, i) => (
            <div className={`${classPrefix}-slide`} key={i}>{child}</div>
          ))}
        </div>
      </div>
      {slideCount > 1 && (
        <div className={`${classPrefix}-dots`} role="tablist">
          {Array.from({ length: slideCount }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              className={`${classPrefix}-dot${i === realIndex ? ' active' : ''}`}
              aria-selected={i === realIndex}
              aria-label={`Slide ${i + 1}`}
              onClick={() => {
                pauseAutoScroll();
                setAnimated(true);
                setPos(i + 1);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

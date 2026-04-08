import { useEffect, useRef, useState } from 'react';

/**
 * Horizontal swipe gesture hook with direction locking.
 *
 * Returns a ref to attach to the swipeable container, the current
 * horizontal offset (for follow-the-finger animation), and whether
 * a swipe is actively in progress.
 *
 * Direction locking: if the first 10px of movement is more vertical
 * than horizontal the gesture is abandoned and normal scroll proceeds.
 */

const DIRECTION_LOCK_PX = 10;

interface UseSwipeNavigationOptions {
  onSwipeLeft?: () => void;   // finger moved left → "next"
  onSwipeRight?: () => void;  // finger moved right → "prev"
  enabled?: boolean;
  threshold?: number;         // fraction of container width to commit (default 0.2)
}

interface UseSwipeNavigationReturn {
  ref: React.RefObject<HTMLDivElement | null>;
  /** Live horizontal pixel delta while swiping. */
  offset: number;
  /** True while a horizontal swipe is in progress. */
  isSwiping: boolean;
}

export default function useSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
  threshold = 0.2,
}: UseSwipeNavigationOptions): UseSwipeNavigationReturn {
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  // Mutable refs to avoid stale closures in native listeners
  const offsetRef = useRef(0);
  const callbacksRef = useRef({ onSwipeLeft, onSwipeRight, threshold });
  callbacksRef.current = { onSwipeLeft, onSwipeRight, threshold };

  const touchRef = useRef({
    startX: 0,
    startY: 0,
    decided: false,
    isHorizontal: false,
    active: false,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setOffset(0);
      setIsSwiping(false);
      return;
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        decided: false,
        isHorizontal: false,
        active: true,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      const ts = touchRef.current;
      if (!ts.active || e.touches.length !== 1) return;

      const touch = e.touches[0];
      const dx = touch.clientX - ts.startX;
      const dy = touch.clientY - ts.startY;

      if (!ts.decided) {
        if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
        ts.decided = true;
        ts.isHorizontal = Math.abs(dx) > Math.abs(dy);
        if (ts.isHorizontal) setIsSwiping(true);
      }

      if (!ts.isHorizontal) return;

      e.preventDefault();

      const { onSwipeLeft: sl, onSwipeRight: sr } = callbacksRef.current;
      let adj = dx;
      // Rubber-band resistance when there's no destination
      if (dx > 0 && !sr) adj = dx * 0.3;
      else if (dx < 0 && !sl) adj = dx * 0.3;

      offsetRef.current = adj;
      setOffset(adj);
    };

    const onTouchEnd = () => {
      const ts = touchRef.current;
      if (!ts.active) return;

      const width = el.clientWidth;
      const { onSwipeLeft: sl, onSwipeRight: sr, threshold: th } = callbacksRef.current;
      const off = offsetRef.current;
      const committed = Math.abs(off) > width * th;

      if (ts.isHorizontal && committed) {
        if (off < 0 && sl) sl();
        else if (off > 0 && sr) sr();
        // Committed — reset immediately (page will change)
        offsetRef.current = 0;
        setOffset(0);
        setIsSwiping(false);
      } else {
        // Not committed — animate back to 0.
        // Keep offset at last value, disable isSwiping (enables CSS transition),
        // then set offset to 0 on next frame so the transition animates.
        setIsSwiping(false);
        requestAnimationFrame(() => {
          offsetRef.current = 0;
          setOffset(0);
        });
      }

      touchRef.current = {
        startX: 0,
        startY: 0,
        decided: false,
        isHorizontal: false,
        active: false,
      };
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled]);

  return { ref, offset, isSwiping };
}

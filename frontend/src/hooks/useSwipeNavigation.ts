import { useEffect, useRef, useState } from 'react';

/**
 * Horizontal swipe gesture hook with direction locking.
 *
 * Features:
 * - Direction locking after 10px of movement (horizontal wins → swipe; vertical wins → scroll)
 * - Rubber-band resistance when swiping toward a non-existent destination
 * - Smooth exit animation: content slides off-screen before navigation
 * - Ignores touches originating inside [data-swipe-ignore] elements (carousels, etc.)
 */

const DIRECTION_LOCK_PX = 20;
const HORIZONTAL_RATIO = 1.8; // horizontal delta must exceed vertical by this factor
const TRANSITION_MS = 280;

// Text-like input types where horizontal drag is used for text selection, not swiping.
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'url', 'tel', 'password', 'number',
]);

/**
 * Returns true if the currently focused element is a text-editable control
 * (text input, textarea, or contenteditable). Used to suppress page swipes
 * while the user is interacting with text — horizontal drags there are
 * text selection, not navigation.
 */
function isEditableElementFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

interface UseSwipeNavigationOptions {
  onSwipeLeft?: () => void;   // finger moved left → "next"
  onSwipeRight?: () => void;  // finger moved right → "prev"
  enabled?: boolean;
  threshold?: number;         // fraction of container width to commit (default 0.2)
}

interface UseSwipeNavigationReturn {
  ref: React.RefObject<HTMLDivElement | null>;
  /** Live horizontal pixel delta (follows finger, then exit/snap target). */
  offset: number;
  /** True while finger is down and swiping horizontally. */
  isSwiping: boolean;
  /** True while the exit or snap-back animation is playing. */
  isAnimating: boolean;
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
  const [isAnimating, setIsAnimating] = useState(false);

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

  // Track pending timers for cleanup
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setOffset(0);
      setIsSwiping(false);
      setIsAnimating(false);
      return;
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;

      // If a text input / textarea / contenteditable is focused, horizontal
      // drags are text selection — don't hijack them for page navigation.
      if (isEditableElementFocused()) return;

      // Ignore touches inside child elements that handle their own gestures
      const target = e.target as HTMLElement;
      if (target.closest('[data-swipe-ignore]')) return;

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
        // Require a strongly horizontal gesture — dx must exceed dy by HORIZONTAL_RATIO
        ts.isHorizontal = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO;
        if (ts.isHorizontal) {
          setIsSwiping(true);
          setIsAnimating(false);
        }
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
      const committed = ts.isHorizontal && Math.abs(off) > width * th;

      ts.active = false;
      ts.decided = false;
      ts.isHorizontal = false;

      if (committed) {
        const callback = off < 0 ? sl : sr;
        if (!callback) {
          // No destination — snap back
          setIsSwiping(false);
          setIsAnimating(true);
          requestAnimationFrame(() => {
            offsetRef.current = 0;
            setOffset(0);
            const t = window.setTimeout(() => setIsAnimating(false), TRANSITION_MS);
            timersRef.current.push(t);
          });
          return;
        }

        // Slide off-screen, then navigate
        setIsSwiping(false);
        setIsAnimating(true);
        const exitOffset = off < 0 ? -width : width;
        requestAnimationFrame(() => {
          offsetRef.current = exitOffset;
          setOffset(exitOffset);
          const t = window.setTimeout(() => {
            callback();
            offsetRef.current = 0;
            setOffset(0);
            setIsAnimating(false);
          }, TRANSITION_MS);
          timersRef.current.push(t);
        });
      } else if (off !== 0) {
        // Below threshold — snap back
        setIsSwiping(false);
        setIsAnimating(true);
        requestAnimationFrame(() => {
          offsetRef.current = 0;
          setOffset(0);
          const t = window.setTimeout(() => setIsAnimating(false), TRANSITION_MS);
          timersRef.current.push(t);
        });
      } else {
        setIsSwiping(false);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [enabled]);

  return { ref, offset, isSwiping, isAnimating };
}

import { useState, useEffect, useRef } from "react";

/**
 * Returns `true` when the header should be visible (scrolling up or near top),
 * `false` when it should hide (scrolling down).
 *
 * Pass `enabled = false` to skip attaching the scroll listener (always returns true).
 */
export default function useScrollDirection(enabled = true): boolean {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < 80 || y < lastY.current - 4) {
          setVisible(true);
        } else if (y > lastY.current + 4) {
          setVisible(false);
        }
        lastY.current = y;
        ticking.current = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled]);

  // When disabled, always report visible
  if (!enabled) return true;
  return visible;
}

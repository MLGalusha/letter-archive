import { useState, useEffect, useCallback, useRef } from "react";
import "./BackToTop.css";

const SCROLL_THRESHOLD = 600;
const SCROLL_UP_DELTA = 30;

export default function BackToTop() {
  const [visible, setVisible] = useState(false);
  const lastY = useRef(0);
  const suppressed = useRef(false);

  useEffect(() => {
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        // Clear suppression once we've reached the top
        if (suppressed.current && y < 10) {
          suppressed.current = false;
        }
        if (suppressed.current) {
          // Don't re-show while smooth-scrolling to top
          lastY.current = y;
          ticking = false;
          return;
        }
        if (y < SCROLL_THRESHOLD) {
          setVisible(false);
        } else if (y < lastY.current - SCROLL_UP_DELTA) {
          setVisible(true);
        } else if (y > lastY.current + 10) {
          setVisible(false);
        }
        lastY.current = y;
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    // Prevent default so the browser doesn't swallow the tap as a
    // momentum-scroll stop gesture — fires the action on first touch.
    e.preventDefault();
    suppressed.current = true;
    setVisible(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <button
      type="button"
      className={`back-to-top${visible ? " back-to-top--visible" : ""}`}
      onPointerDown={scrollToTop}
      aria-label="Back to top"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 2.5L2.5 7.5M7 2.5L11.5 7.5M7 2.5V12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Top</span>
    </button>
  );
}

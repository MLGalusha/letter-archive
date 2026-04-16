import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { smoothScrollToY } from "../utils/smoothScrollTo";
import { addAppScrollListener, getAppScrollY } from "../utils/appScroll";
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
        const y = getAppScrollY();
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

    return addAppScrollListener(onScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    suppressed.current = true;
    setVisible(false);
    smoothScrollToY(0);
  }, []);

  // Floating button is portaled to document.body so it sits OUTSIDE the
  // #app-scroll container (see #35). This is what makes taps during momentum
  // scroll actually fire the action on iOS: the button is no longer a
  // descendant of the scroller, so iOS's "tap to stop fling" gesture doesn't
  // consume touches that land on it.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      scrollToTop();
    },
    [scrollToTop],
  );

  return createPortal(
    <button
      type="button"
      className={`back-to-top${visible ? " back-to-top--visible" : ""}`}
      onClick={handleClick}
      aria-label="Back to top"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 2.5L2.5 7.5M7 2.5L11.5 7.5M7 2.5V12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Top</span>
    </button>,
    document.body,
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import useSmoothScroll from "../hooks/useSmoothScroll";
import { addAppScrollListener, getAppScrollY } from "../utils/appScroll";
import "./BackToTop.css";
import useTouchScrollAction from "../hooks/useTouchScrollAction";

const SCROLL_THRESHOLD = 600;
const SCROLL_UP_DELTA = 30;

export default function BackToTop() {
  const [visible, setVisible] = useState(false);
  const lastY = useRef(0);
  const suppressed = useRef(false);
  const scrollTo = useSmoothScroll();

  useEffect(() => {
    let ticking = false;
    let frame = 0;
    lastY.current = getAppScrollY();

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      frame = requestAnimationFrame(() => {
        const y = getAppScrollY();
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
        // Accumulate small movements instead of requiring a 30px frame.
        if (y < SCROLL_THRESHOLD || y < lastY.current - SCROLL_UP_DELTA || y > lastY.current + 10) lastY.current = y;
        ticking = false;
      });
    };

    const remove = addAppScrollListener(onScroll);
    return () => { remove(); cancelAnimationFrame(frame); };
  }, []);

  const scrollToTop = useCallback(() => {
    setVisible(false);
    scrollTo(0, {
      onStep: () => { suppressed.current = true; },
      onFinish: () => { suppressed.current = false; lastY.current = getAppScrollY(); },
    });
  }, [scrollTo]);

  const buttonRef = useTouchScrollAction(scrollToTop);

  // Portal keeps fixed controls outside page swipe transforms.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      scrollToTop();
    },
    [scrollToTop],
  );

  return createPortal(
    <button
      ref={buttonRef}
      type="button"
      className={`back-to-top${visible ? " back-to-top--visible" : ""}`}
      onClick={handleClick}
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 2.5L2.5 7.5M7 2.5L11.5 7.5M7 2.5V12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Top</span>
    </button>,
    document.body,
  );
}

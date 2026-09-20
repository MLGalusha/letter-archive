import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import useSmoothScroll from "../hooks/useSmoothScroll";
import { addAppScrollListener, getAppScrollY } from "../utils/appScroll";
import "./BackToSearch.css";
import useTouchScrollAction from "../hooks/useTouchScrollAction";

interface BackToSearchProps {
  /** When true, the button is shown. Drive this from useStickyDock.stickyDockActive. */
  visible: boolean;
  /** Ref to the element containing the search bar. We scroll to its top and focus an input inside it. */
  targetRef: RefObject<HTMLElement | null> | RefObject<HTMLDivElement | null>;
  /** Override label (default: "Search"). */
  label?: string;
  /** Enable the `/` keyboard shortcut on desktop (default: true). */
  enableKeyboardShortcut?: boolean;
}

const SCROLL_GAP = 12;

export default function BackToSearch({
  visible,
  targetRef,
  label = "Search",
  enableKeyboardShortcut = true,
}: BackToSearchProps) {
  // Only reveal the button when the user is scrolling back up. Scrolling down
  // hides it so it doesn't linger while the user is reading forward.
  const [scrollingUp, setScrollingUp] = useState(false);
  const lastScrollYRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const scrollTo = useSmoothScroll();

  useEffect(() => {
    if (!visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Ending the scroll-listener session clears direction so a later session starts hidden.
      setScrollingUp(false);
      return;
    }
    lastScrollYRef.current = getAppScrollY();
    // A small threshold avoids flipping state on sub-pixel/inertial jitter.
    const DIRECTION_THRESHOLD = 6;
    const onScroll = () => {
      const y = getAppScrollY();
      const delta = y - lastScrollYRef.current;
      if (Math.abs(delta) < DIRECTION_THRESHOLD) return;
      // Ignore our own programmatic scroll-to-search animation.
      if (programmaticScrollRef.current) {
        lastScrollYRef.current = y;
        return;
      }
      setScrollingUp(delta < 0);
      lastScrollYRef.current = y;
    };
    return addAppScrollListener(onScroll);
  }, [visible]);

  const jumpToSearch = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;

    const isTouch = typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches;
    const header = document.querySelector(".header") as HTMLElement | null;
    const headerHeight = header?.offsetHeight ?? 0;
    const targetTop = getAppScrollY() + target.getBoundingClientRect().top - headerHeight - SCROLL_GAP;
    const input = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="search"], input[type="text"], input:not([type]), textarea',
    );
    // Cancel the previous action before it can reset this action's suppression.
    scrollTo(targetTop, {
      onStep: () => { programmaticScrollRef.current = true; },
      onFinish: (cancelled) => {
        programmaticScrollRef.current = false;
        if (!cancelled && !isTouch && input?.isConnected) input.focus({ preventScroll: true });
      },
    });
  }, [targetRef, scrollTo]);

  // Desktop keyboard shortcut: `/` jumps to search (unless user is already typing).
  useEffect(() => {
    if (!enableKeyboardShortcut) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || active?.isContentEditable) return;
      event.preventDefault();
      jumpToSearch();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enableKeyboardShortcut, jumpToSearch]);

  const buttonRef = useTouchScrollAction(jumpToSearch);

  // Portal keeps fixed controls outside page swipe transforms.
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      jumpToSearch();
    },
    [jumpToSearch],
  );

  return createPortal(
    <button
      ref={buttonRef}
      type="button"
      className={`back-to-search${visible && scrollingUp ? " back-to-search--visible" : ""}`}
      onClick={handleClick}
      aria-label={`Jump to ${label.toLowerCase()}`}
      tabIndex={visible && scrollingUp ? 0 : -1}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>{label}</span>
    </button>,
    document.body,
  );
}

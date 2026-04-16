import { useEffect, useState } from "react";
import { addAppScrollListener, getAppScrollY } from "../utils/appScroll";

/**
 * Single source of truth for header visibility and "at top of page" state.
 *
 * - `visible`: the header itself. false while the user is scrolling down.
 * - `atTop`: the scrubber / dock region. only true when very near scrollY=0.
 *
 * Hysteresis thresholds are intentionally asymmetric so the scrubber doesn't
 * bounce back into view just because the header slid back in after a small
 * scroll-up. The header uses a 4/80 threshold pair; the scrubber uses 4/16.
 *
 * Disabled on desktop (>= 900px) and when `prefers-reduced-motion` is on;
 * both simply return `{ visible: true, atTop: y <= 4 }` so behaviors that key
 * off `atTop` (dock collapse) still work but the header never hides.
 *
 * Also force-pinned visible while any input/textarea/contentEditable has
 * focus. The user isn't manually scrolling while typing, and any browser-
 * level scroll-into-view adjustments (iOS keyboard reflow, etc.) would
 * otherwise race against the hide-on-scroll-down logic.
 */

export interface HeaderScrollState {
  visible: boolean;
  atTop: boolean;
}

const MOBILE_MAX_WIDTH = 900;
const HEADER_NEAR_TOP = 80; // below this, header is always visible
const HEADER_HYSTERESIS = 4; // px of scroll required to flip header direction
const ATTOP_EXPAND = 4; // y <= 4 → atTop becomes true
const ATTOP_COLLAPSE = 16; // y > 16 → atTop becomes false (while currently true)

function readIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
}

function readReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function useHeaderScroll(): HeaderScrollState {
  const [isMobile, setIsMobile] = useState<boolean>(() => readIsMobile());
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => readReducedMotion());
  const [visible, setVisible] = useState<boolean>(true);
  const [inputFocused, setInputFocused] = useState<boolean>(false);
  const [atTop, setAtTop] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return getAppScrollY() <= ATTOP_EXPAND;
  });

  // Track viewport width changes so the hook flips between mobile/desktop modes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // addEventListener is the modern API; Safari < 14 needed addListener.
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Track prefers-reduced-motion so the hide-on-scroll branch can opt out.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Scroll listener: drives both `visible` and `atTop`.
  useEffect(() => {
    if (typeof window === "undefined") return;

    let lastY = getAppScrollY();
    let ticking = false;

    const update = () => {
      const y = getAppScrollY();

      // atTop — always tracked, even on desktop, because dock collapse keys off it.
      setAtTop((prev) => (prev ? y <= ATTOP_COLLAPSE : y <= ATTOP_EXPAND));

      // visible — only on mobile, and only when the user hasn't opted out of
      // motion. Desktop and reduced-motion users keep the header pinned so it
      // never slides in and out on scroll.
      if (isMobile && !reducedMotion) {
        if (y < HEADER_NEAR_TOP || y < lastY - HEADER_HYSTERESIS) {
          setVisible(true);
        } else if (y > lastY + HEADER_HYSTERESIS) {
          setVisible(false);
        }
      } else {
        setVisible(true);
      }

      lastY = y;
      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    // Prime state on mount.
    update();
    return addAppScrollListener(onScroll);
  }, [isMobile, reducedMotion]);

  // Track whether any text input has focus. While focused we force the
  // header visible so auto-scroll-on-focus can reposition the search panel
  // without the hide-on-scroll-down logic racing against it.
  useEffect(() => {
    if (typeof document === "undefined") return;

    const isTextInput = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };

    const onFocusIn = (e: FocusEvent) => {
      if (isTextInput(e.target)) setInputFocused(true);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (isTextInput(e.target)) setInputFocused(false);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return {
    visible: isMobile ? visible || inputFocused : true,
    atTop,
  };
}

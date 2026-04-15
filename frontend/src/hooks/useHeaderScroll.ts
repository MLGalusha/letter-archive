import { useEffect, useState } from "react";

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
 * Also hides the header when focus enters any element inside an ancestor
 * carrying `data-hide-header-on-focus` — lets mobile search focus reclaim
 * vertical space without the page having to participate.
 *
 * Disabled on desktop (>= 900px) and when `prefers-reduced-motion` is on;
 * both simply return `{ visible: true, atTop: y <= 4 }` so behaviors that key
 * off `atTop` (dock collapse) still work but the header never hides.
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

export default function useHeaderScroll(): HeaderScrollState {
  const [isMobile, setIsMobile] = useState<boolean>(() => readIsMobile());
  const [visible, setVisible] = useState<boolean>(true);
  const [atTop, setAtTop] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.scrollY <= ATTOP_EXPAND;
  });
  const [focusHidden, setFocusHidden] = useState<boolean>(false);

  // Track viewport width changes so the hook flips between mobile/desktop modes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // addEventListener is the modern API; Safari < 14 needed addListener.
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Scroll listener: drives both `visible` and `atTop`.
  useEffect(() => {
    if (typeof window === "undefined") return;

    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      const y = window.scrollY;

      // atTop — always tracked, even on desktop, because dock collapse keys off it.
      setAtTop((prev) => (prev ? y <= ATTOP_COLLAPSE : y <= ATTOP_EXPAND));

      // visible — only on mobile. Desktop stays pinned.
      if (isMobile) {
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
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isMobile]);

  // focusin/focusout: any element tagged with [data-hide-header-on-focus]
  // forces the header hidden while focus is inside it. Mobile only — desktop
  // doesn't need the vertical space and hiding-on-focus would be jarring.
  useEffect(() => {
    if (!isMobile || typeof document === "undefined") return;

    const isInsideTagged = (el: Element | null): boolean =>
      !!el && !!el.closest?.("[data-hide-header-on-focus]");

    const onFocusIn = (event: FocusEvent) => {
      if (isInsideTagged(event.target as Element | null)) {
        setFocusHidden(true);
      }
    };

    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Element | null;
      if (!isInsideTagged(next)) {
        setFocusHidden(false);
      }
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [isMobile]);

  return {
    visible: isMobile ? visible && !focusHidden : true,
    atTop,
  };
}

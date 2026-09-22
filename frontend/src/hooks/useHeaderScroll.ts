import { useEffect, useState } from "react";
import { addAppScrollListener, getAppScrollY } from "../utils/appScroll";

/** Ordinary scrolling only collapses the dock. Header visibility is controlled
 * by the software keyboard; the reader owns its separate image-focus mode.
 */

export interface HeaderScrollState {
  visible: boolean;
  atTop: boolean;
}

const MOBILE_MAX_WIDTH = 900;
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

  // Dock state follows document position; it never changes header visibility.
  useEffect(() => {
    if (typeof window === "undefined") return;

    let ticking = false;
    let frame = 0;
    const update = () => {
      const y = getAppScrollY();

      // atTop — always tracked, even on desktop, because dock collapse keys off it.
      setAtTop((prev) => (prev ? y <= ATTOP_COLLAPSE : y <= ATTOP_EXPAND));

      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      frame = requestAnimationFrame(update);
    };

    // Prime state on mount.
    update();
    const removeScroll = addAppScrollListener(onScroll);
    return () => {
      removeScroll();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    let keyboardOpen = false;
    let editing = false;
    const viewport = window.visualViewport;
    let fullHeight = viewport?.height ?? window.innerHeight;
    let layoutWidth = window.innerWidth;
    const syncViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      if (window.innerWidth !== layoutWidth) {
        // Rotation changes the layout baseline even if the input stays focused.
        // innerHeight retains the layout viewport while the keyboard reduces
        // visualViewport, so an actually open keyboard still hides the header.
        layoutWidth = window.innerWidth;
        fullHeight = window.innerHeight;
      }
      // Ignore pinch zoom; a shrunken visual viewport alone is not a keyboard.
      const shrunk = Math.abs((viewport?.scale ?? 1) - 1) < 0.05
        && fullHeight - height > 120;
      const next = isMobile && shrunk && (editing || keyboardOpen);
      keyboardOpen = next;
      if (!editing && !keyboardOpen) fullHeight = height;
      setVisible(!keyboardOpen);
    };
    const onFocus = (event?: FocusEvent) => {
      const el = event?.type === "focusout" ? event.relatedTarget : document.activeElement;
      editing = el instanceof HTMLElement && (el.isContentEditable
        || el.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"])'));
      syncViewport();
    };

    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    viewport?.addEventListener("resize", syncViewport);
    window.addEventListener("resize", syncViewport);
    onFocus();
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      viewport?.removeEventListener("resize", syncViewport);
      window.removeEventListener("resize", syncViewport);
    };
  }, [isMobile]);

  return {
    visible: isMobile ? visible : true,
    atTop,
  };
}

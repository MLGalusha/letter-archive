import { useEffect, useRef, useState, type RefObject } from 'react';
import { addAppScrollListener, getAppScrollRootForIO } from '../utils/appScroll';

export interface UseStickyDockConfig {
  /** Ref to the element that triggers sticky mode (e.g. dock trigger inside search bar) */
  triggerRef: RefObject<HTMLDivElement | null>;
  /** Fallback ref when triggerRef is not mounted (e.g. the archive search section) */
  sectionRef: RefObject<HTMLElement | null>;
  /** Re-run observer setup when this changes (e.g. pass loading state if trigger renders conditionally) */
  enabled?: boolean;
}

export interface UseStickyDockReturn {
  stickyDockActive: boolean;
  pageRefineOpen: boolean;
  setPageRefineOpen: (open: boolean) => void;
  compactRefineOpen: boolean;
  setCompactRefineOpen: (open: boolean) => void;
  pageSortOpen: boolean | undefined;
  setPageSortOpen: (open: boolean | undefined) => void;
  compactSortOpen: boolean | undefined;
  setCompactSortOpen: (open: boolean | undefined) => void;
}

// Extra pixels the user must scroll back before the dock deactivates.
// Prevents flickering when the dock itself changes the header height (mobile).
const HYSTERESIS_PX = 50;

export default function useStickyDock(config: UseStickyDockConfig): UseStickyDockReturn {
  const { triggerRef, sectionRef, enabled = true } = config;

  const [stickyDockActive, setStickyDockActive] = useState(false);
  const [pageRefineOpen, setPageRefineOpen] = useState(false);
  const [compactRefineOpen, setCompactRefineOpen] = useState(false);
  const [pageSortOpen, setPageSortOpen] = useState<boolean | undefined>(undefined);
  const [compactSortOpen, setCompactSortOpen] = useState<boolean | undefined>(undefined);
  const headerDropdownOpenRef = useRef(false);
  const stickyDockActiveRef = useRef(false);

  headerDropdownOpenRef.current = compactRefineOpen || compactSortOpen === true;
  stickyDockActiveRef.current = stickyDockActive;

  // ── IntersectionObserver: detect when search bar scrolls past header ──
  useEffect(() => {
    if (!enabled) return;
    const trigger = triggerRef.current || sectionRef.current;
    if (!trigger) return;

    const header = document.querySelector('.header') as HTMLElement | null;
    const headerHeight = header?.offsetHeight || 80;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!headerDropdownOpenRef.current) {
            // Hysteresis: require trigger to be well past the header before deactivating
            // This prevents the flicker loop when dock height changes header size
            const clearance = entry.boundingClientRect.bottom - headerHeight;
            if (!stickyDockActiveRef.current || clearance > HYSTERESIS_PX) {
              setStickyDockActive(false);
            }
          }
        } else {
          setStickyDockActive(entry.boundingClientRect.bottom <= headerHeight);
        }
      },
      { root: getAppScrollRootForIO(), rootMargin: `-${headerHeight}px 0px 0px 0px`, threshold: 0 },
    );

    observer.observe(trigger);
    return () => observer.disconnect();
  }, [enabled, triggerRef, sectionRef]);

  // ── Scroll listener: deactivate dock when trigger scrolls back below header ──
  // The IntersectionObserver only fires on boundary crossings. When it fires
  // isIntersecting=true the clearance is ~0, which the hysteresis rejects.
  // This scroll listener supplements the observer to handle the scroll-up case.
  useEffect(() => {
    if (!stickyDockActive || !enabled) return;

    const onScroll = () => {
      if (headerDropdownOpenRef.current) return;
      const trigger = triggerRef.current || sectionRef.current;
      if (!trigger) return;
      const header = document.querySelector('.header') as HTMLElement | null;
      const headerHeight = header?.offsetHeight || 80;
      const triggerBottom = trigger.getBoundingClientRect().bottom;
      if (triggerBottom > headerHeight + HYSTERESIS_PX) {
        setStickyDockActive(false);
      }
    };

    return addAppScrollListener(onScroll);
  }, [stickyDockActive, enabled, triggerRef, sectionRef]);

  // ── Re-evaluate dock when dropdown closes ──
  useEffect(() => {
    const isHeaderDropdown = compactRefineOpen || compactSortOpen === true;
    if (isHeaderDropdown || !stickyDockActive) return;

    const trigger = triggerRef.current || sectionRef.current;
    if (!trigger) return;
    const header = document.querySelector('.header') as HTMLElement | null;
    const headerHeight = header?.offsetHeight || 80;

    // Use hysteresis for deactivation here too
    if (trigger.getBoundingClientRect().bottom > headerHeight + HYSTERESIS_PX) {
      setStickyDockActive(false);
    }
  }, [compactRefineOpen, compactSortOpen, stickyDockActive, triggerRef, sectionRef]);

  // ── Transfer dropdown state when sticky mode deactivates ──
  useEffect(() => {
    if (!stickyDockActive) {
      if (compactRefineOpen) {
        setPageRefineOpen(true);
      }
      if (compactSortOpen === true) {
        setPageSortOpen(true);
      }
      setCompactRefineOpen(false);
      setCompactSortOpen(undefined);
    }
  }, [stickyDockActive]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    stickyDockActive,
    pageRefineOpen,
    setPageRefineOpen,
    compactRefineOpen,
    setCompactRefineOpen,
    pageSortOpen,
    setPageSortOpen,
    compactSortOpen,
    setCompactSortOpen,
  };
}

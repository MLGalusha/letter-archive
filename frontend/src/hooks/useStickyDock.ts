import { useEffect, useRef, useState, type RefObject } from 'react';

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

export default function useStickyDock(config: UseStickyDockConfig): UseStickyDockReturn {
  const { triggerRef, sectionRef, enabled = true } = config;

  const [stickyDockActive, setStickyDockActive] = useState(false);
  const [pageRefineOpen, setPageRefineOpen] = useState(false);
  const [compactRefineOpen, setCompactRefineOpen] = useState(false);
  const [pageSortOpen, setPageSortOpen] = useState<boolean | undefined>(undefined);
  const [compactSortOpen, setCompactSortOpen] = useState<boolean | undefined>(undefined);
  const headerDropdownOpenRef = useRef(false);

  headerDropdownOpenRef.current = compactRefineOpen || compactSortOpen === true;

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
            setStickyDockActive(false);
          }
        } else {
          setStickyDockActive(entry.boundingClientRect.bottom <= headerHeight);
        }
      },
      { rootMargin: `-${headerHeight}px 0px 0px 0px`, threshold: 0 },
    );

    observer.observe(trigger);
    return () => observer.disconnect();
  }, [enabled, triggerRef, sectionRef]);

  // ── Re-evaluate dock when dropdown closes ──
  useEffect(() => {
    const isHeaderDropdown = compactRefineOpen || compactSortOpen === true;
    if (isHeaderDropdown || !stickyDockActive) return;

    const trigger = triggerRef.current || sectionRef.current;
    if (!trigger) return;
    const header = document.querySelector('.header') as HTMLElement | null;
    const headerHeight = header?.offsetHeight || 80;

    if (trigger.getBoundingClientRect().bottom > headerHeight) {
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

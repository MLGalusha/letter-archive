import { useCallback, useEffect, useRef, useState, useMemo, type RefObject } from 'react';

import { createPageMotion, type PageMotion } from '../components/LetterViewer/pageMotion';

export interface UseCarouselDragReturn {
  carouselRef: RefObject<HTMLDivElement | null>;
  /** Attach when the carousel appears after loading or changes letters. */
  attachCarousel: (node: HTMLDivElement | null) => void;
  activeIndex: number;
  transitionFromIndex: number | null;
  pageMotion: PageMotion;
  /** True when a drag gesture occurred (suppresses click handler) */
  carouselDraggedRef: RefObject<boolean>;
  /** Smoothly scroll to a slide by index */
  scrollToSlide: (index: number, behavior?: ScrollBehavior, durationMs?: number) => void;
}

/**
 * Lightweight carousel hook using CSS scroll-snap.
 * Touch/trackpad scrolling is native. Mouse drag-to-scroll for desktop.
 * Reports the slide closest to the viewport center for React-rendered dots.
 */
export default function useCarouselDrag(): UseCarouselDragReturn {
  const pageMotion = useMemo(() => createPageMotion(), []);
  const carouselRef = useRef<HTMLDivElement>(null);
  const carouselDraggedRef = useRef(false);
  const explicitSelection = useRef(false);
  const navigationTargetRef = useRef<number | null>(null);
  const pagingFrame = useRef<number | null>(null);
  const cancelPaging = useCallback(() => {
    if (pagingFrame.current !== null) cancelAnimationFrame(pagingFrame.current);
    pagingFrame.current = null;
  }, []);
  const [carousel, setCarousel] = useState<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [transitionFromIndex, setTransitionFromIndex] = useState<number | null>(null);
  const attachCarousel = useCallback((node: HTMLDivElement | null) => {
    cancelPaging();
    carouselRef.current = node;
    navigationTargetRef.current = null;
    carouselDraggedRef.current = false;
    setCarousel(node);
    setActiveIndex(0);
    setTransitionFromIndex(null);
  }, [cancelPaging]);

  // Observe the mounted node, including when initial loading renders no carousel.
  useEffect(() => {
    if (!carousel) return;

    let rafId: number | null = null;
    let queuedExplicit = false;
    const updateActiveDot = () => {
      rafId = null;
      const suppressProgress = queuedExplicit || explicitSelection.current;
      queuedExplicit = false;
      const slides = carousel.children;
      if (slides.length === 0) return;

      // Both centers use viewport coordinates; offsetLeft can use a different
      // offset parent from the scrolling element (especially inside a figure).
      const bounds = carousel.getBoundingClientRect();
      const center = bounds.left + carousel.clientLeft + carousel.clientWidth / 2;
      let closestIdx = 0;
      let closestDist = Infinity;

      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i] as HTMLElement;
        const slideBounds = slide.getBoundingClientRect();
        const slideCenter = slideBounds.left + slideBounds.width / 2;
        const dist = Math.abs(center - slideCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }

      const first = (slides[0] as HTMLElement).getBoundingClientRect();
      const second = slides[1]?.getBoundingClientRect();
      const pitch = second ? second.left - first.left : first.width;
      if (pitch > 0 && !suppressProgress) pageMotion.publish((center - first.left - first.width / 2) / pitch);
      if (!suppressProgress || navigationTargetRef.current === null) setActiveIndex(closestIdx);
    };

    // Keep the event origin even if scrollend clears the flag before this frame.
    const onScroll = () => {
      queuedExplicit ||= explicitSelection.current;
      if (rafId == null) rafId = requestAnimationFrame(updateActiveDot);
    };

    const restoreSnap = () => {
      cancelPaging();
      explicitSelection.current = false;
      navigationTargetRef.current = null;
      setTransitionFromIndex(null);
      carousel.style.scrollSnapType = '';
    };
    const onScrollEnd = () => {
      // An interrupted animation can emit its own late scrollend. It must not
      // restore snapping over a newer target that has not arrived yet.
      const target = navigationTargetRef.current;
      if (target === null || Math.abs(carousel.scrollLeft - target) <= 1) {
        const wasExplicit = explicitSelection.current;
        // Do not let a queued scroll frame re-publish drag progress after the
        // strip has been released at scrollend.
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
        // Publish the final position before releasing synchronization.
        if (!wasExplicit) updateActiveDot();
        pageMotion.publish(null);
        restoreSnap();
      }
    };
    carousel.addEventListener('scrollend', onScrollEnd);
    carousel.addEventListener('touchstart', restoreSnap, { passive: true });
    carousel.addEventListener('wheel', restoreSnap, { passive: true });
    carousel.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onScroll);
    observer?.observe(carousel);
    Array.from(carousel.children).forEach((slide) => observer?.observe(slide));
    window.addEventListener('resize', onScroll);
    onScroll();

    return () => {
      carousel.removeEventListener('scroll', onScroll);
      carousel.removeEventListener('scrollend', onScrollEnd);
      carousel.removeEventListener('touchstart', restoreSnap);
      carousel.removeEventListener('wheel', restoreSnap);
      restoreSnap();
      window.removeEventListener('resize', onScroll);
      observer?.disconnect();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [carousel, pageMotion, cancelPaging]);

  // Mouse drag-to-scroll (desktop only — touch uses native scroll)
  useEffect(() => {
    if (!carousel) return;

    let isDragging = false;
    let startX = 0;
    let scrollStart = 0;

    const onMouseDown = (e: MouseEvent) => {
      cancelPaging();
      explicitSelection.current = false;
      navigationTargetRef.current = null;
      setTransitionFromIndex(null);
      isDragging = true;
      carouselDraggedRef.current = false;
      startX = e.clientX;
      scrollStart = carousel.scrollLeft;
      carousel.style.cursor = 'grabbing';
      // Disable scroll-snap during drag for smooth feel
      carousel.style.scrollSnapType = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) carouselDraggedRef.current = true;
      carousel.scrollLeft = scrollStart - dx;
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      carousel.style.cursor = '';
      // Re-enable snap — browser animates to nearest snap point
      carousel.style.scrollSnapType = '';
    };

    carousel.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      carousel.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      onMouseUp();
    };
  }, [carousel, cancelPaging]);

  const scrollToSlide = useCallback((index: number, behavior: ScrollBehavior = 'smooth', durationMs?: number) => {
    cancelPaging();
    const carousel = carouselRef.current;
    if (!carousel) return;
    const slide = carousel.children[index] as HTMLElement | undefined;
    if (!slide) return;
    const bounds = carousel.getBoundingClientRect();
    const slideBounds = slide.getBoundingClientRect();
    const center = bounds.left + carousel.clientLeft + carousel.clientWidth / 2;
    const slideCenter = slideBounds.left + slideBounds.width / 2;
    const targetLeft = carousel.scrollLeft + slideCenter - center;
    // Native snapping can retain its previous target during a rapid reversal
    // in WebKit. Explicit paging owns the target until it settles or the user
    // starts a gesture; those events restore native touch/trackpad snapping.
    explicitSelection.current = true;
    // The clicked page owns selection while the image travels. Intermediate
    // slides must not pull the thumbnail animation back toward older pages.
    // A click can interrupt native settling before scrollend arrives (or on a
    // browser without scrollend). Explicit selection now owns strip motion.
    pageMotion.publish(null);
    setActiveIndex(index);
    carousel.style.scrollSnapType = 'none';
    navigationTargetRef.current = targetLeft;
    const resolvedBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior;
    // Keep the visible scan admitted while the destination loads and travels
    // into place. Measure the departure so rapid reversals work mid-animation.
    let departure: number | null = null;
    if (resolvedBehavior === 'smooth' && Math.abs(targetLeft - carousel.scrollLeft) > 1) {
      let nearestDistance = Infinity;
      Array.from(carousel.children).forEach((child, childIndex) => {
        const rect = child.getBoundingClientRect();
        const distance = Math.abs(rect.left + rect.width / 2 - center);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          departure = childIndex;
        }
      });
    }
    setTransitionFromIndex(departure);
    if (resolvedBehavior === 'smooth' && durationMs && departure !== null) {
      const from = carousel.scrollLeft;
      // The focus return has a bounded second stage instead of adding a full
      // browser-defined scroll duration. Gestures/new choices cancel this RAF.
      carousel.scrollTo({ left: from, behavior: 'instant' });
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / durationMs);
        carousel.scrollTo({ left: from + (targetLeft - from) * (1 - (1 - progress) ** 3), behavior: 'instant' });
        if (progress < 1) pagingFrame.current = requestAnimationFrame(tick);
        else {
          pagingFrame.current = null;
          explicitSelection.current = false;
          navigationTargetRef.current = null;
          setTransitionFromIndex(null);
          carousel.style.scrollSnapType = '';
          pageMotion.publish(null);
        }
      };
      pagingFrame.current = requestAnimationFrame(tick);
      return;
    }
    carousel.scrollTo({
      left: targetLeft,
      behavior: resolvedBehavior,
    });
    if (resolvedBehavior === 'instant') {
      // Direct selection need not traverse/admit the intervening scans. Update
      // the control and image admission in the same click, then restore touch snap.
      navigationTargetRef.current = null;
      carousel.style.scrollSnapType = '';
    }
  }, [pageMotion, cancelPaging]);

  return { carouselRef, attachCarousel, activeIndex, transitionFromIndex, pageMotion, carouselDraggedRef, scrollToSlide };
}

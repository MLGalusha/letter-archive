import { useCallback, useEffect, useRef, useState, useMemo, type RefObject } from 'react';

import { createPageMotion, type PageMotion } from '../components/LetterViewer/pageMotion';

export interface UseCarouselDragReturn {
  carouselRef: RefObject<HTMLDivElement | null>;
  /** Attach when the carousel appears after loading or changes letters. */
  attachCarousel: (node: HTMLDivElement | null) => void;
  activeIndex: number;
  pageMotion: PageMotion;
  /** True when a drag gesture occurred (suppresses click handler) */
  carouselDraggedRef: RefObject<boolean>;
  /** Smoothly scroll to a slide by index */
  scrollToSlide: (index: number, behavior?: ScrollBehavior) => void;
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
  const [carousel, setCarousel] = useState<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const attachCarousel = useCallback((node: HTMLDivElement | null) => {
    carouselRef.current = node;
    navigationTargetRef.current = null;
    carouselDraggedRef.current = false;
    setCarousel(node);
    setActiveIndex(0);
  }, []);

  // Observe the mounted node, including when initial loading renders no carousel.
  useEffect(() => {
    if (!carousel) return;

    let rafId: number | null = null;
    const updateActiveDot = () => {
      rafId = null;
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
      if (pitch > 0 && !explicitSelection.current) pageMotion.publish((center - first.left - first.width / 2) / pitch);
      setActiveIndex(closestIdx);
    };

    const onScroll = () => {
      if (rafId == null) rafId = requestAnimationFrame(updateActiveDot);
    };

    const restoreSnap = () => {
      explicitSelection.current = false;
      navigationTargetRef.current = null;
      carousel.style.scrollSnapType = '';
    };
    const onScrollEnd = () => {
      // An interrupted animation can emit its own late scrollend. It must not
      // restore snapping over a newer target that has not arrived yet.
      const target = navigationTargetRef.current;
      if (target === null || Math.abs(carousel.scrollLeft - target) <= 1) {
        const wasExplicit = explicitSelection.current;
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
  }, [carousel, pageMotion]);

  // Mouse drag-to-scroll (desktop only — touch uses native scroll)
  useEffect(() => {
    if (!carousel) return;

    let isDragging = false;
    let startX = 0;
    let scrollStart = 0;

    const onMouseDown = (e: MouseEvent) => {
      explicitSelection.current = false;
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
  }, [carousel]);

  const scrollToSlide = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
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
    carousel.style.scrollSnapType = 'none';
    navigationTargetRef.current = targetLeft;
    const resolvedBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior;
    carousel.scrollTo({
      left: targetLeft,
      behavior: resolvedBehavior,
    });
    if (resolvedBehavior === 'instant') {
      // Direct selection need not traverse/admit the intervening scans. Update
      // the control and image admission in the same click, then restore touch snap.
      navigationTargetRef.current = null;
      carousel.style.scrollSnapType = '';
      setActiveIndex(index);
    }
  }, []);

  return { carouselRef, attachCarousel, activeIndex, pageMotion, carouselDraggedRef, scrollToSlide };
}

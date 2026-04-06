import { useCallback, useEffect, useRef, type RefObject } from 'react';

export interface UseCarouselDragReturn {
  carouselRef: RefObject<HTMLDivElement | null>;
  /** True when a drag gesture occurred (suppresses click handler) */
  carouselDraggedRef: RefObject<boolean>;
  /** Smoothly scroll to a slide by index */
  scrollToSlide: (index: number) => void;
}

/**
 * Lightweight carousel hook using CSS scroll-snap.
 * Touch/trackpad scrolling is native. Mouse drag-to-scroll for desktop.
 * Tracks closest slide and updates `.scan-dot` active state.
 */
export default function useCarouselDrag(): UseCarouselDragReturn {
  const carouselRef = useRef<HTMLDivElement>(null);
  const carouselDraggedRef = useRef(false);

  // Active dot tracking via scroll position
  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    const getDots = () =>
      Array.from(carousel.parentElement?.querySelectorAll<HTMLElement>('.scan-dot') ?? []);

    let rafId: number | null = null;
    let currentActive = 0;

    const updateActiveDot = () => {
      rafId = null;
      const slides = carousel.children;
      const dots = getDots();
      if (slides.length === 0 || dots.length === 0) return;

      const center = carousel.scrollLeft + carousel.clientWidth / 2;
      let closestIdx = 0;
      let closestDist = Infinity;

      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i] as HTMLElement;
        const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
        const dist = Math.abs(center - slideCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }

      if (closestIdx !== currentActive) {
        dots[currentActive]?.classList.remove('active');
        dots[closestIdx]?.classList.add('active');
        currentActive = closestIdx;
      }
    };

    const onScroll = () => {
      if (rafId == null) rafId = requestAnimationFrame(updateActiveDot);
    };

    carousel.addEventListener('scroll', onScroll, { passive: true });
    requestAnimationFrame(updateActiveDot);

    return () => {
      carousel.removeEventListener('scroll', onScroll);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Mouse drag-to-scroll (desktop only — touch uses native scroll)
  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    let isDragging = false;
    let startX = 0;
    let scrollStart = 0;

    const onMouseDown = (e: MouseEvent) => {
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
    };
  }, []);

  const scrollToSlide = useCallback((index: number) => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const slide = carousel.children[index] as HTMLElement | undefined;
    if (!slide) return;
    slide.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, []);

  return { carouselRef, carouselDraggedRef, scrollToSlide };
}

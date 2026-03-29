import { useCallback, useEffect, useRef, type RefObject } from 'react';

export interface UseCarouselDragReturn {
  carouselRef: RefObject<HTMLDivElement | null>;
  /** True when a drag gesture occurred (suppresses click handler) */
  carouselDraggedRef: RefObject<boolean>;
  /** Smoothly scroll to a slide by index */
  scrollToSlide: (index: number) => void;
}

/**
 * Manages scroll-driven scaling, mouse drag-to-scroll with momentum glide,
 * and snap-to-nearest-slide behavior for a horizontal carousel.
 *
 * Expects the carousel to contain `.scan-slide` children and an adjacent
 * `.scan-dot` list for active dot indicators.
 */
export default function useCarouselDrag(): UseCarouselDragReturn {
  const carouselRef = useRef<HTMLDivElement>(null);
  const carouselDraggedRef = useRef(false);

  // Scroll-driven scaling + mouse-drag scrolling
  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    const MIN_SCALE = 0.82;
    let rafId: number | null = null;
    let currentClosest = -1;

    const slides = Array.from(carousel.querySelectorAll<HTMLElement>('.scan-slide'));
    const dots = Array.from(carousel.parentElement?.querySelectorAll<HTMLElement>('.scan-dot') ?? []);

    const updateScales = () => {
      rafId = null;
      if (slides.length <= 1) return;

      const carouselRect = carousel.getBoundingClientRect();
      const center = carouselRect.left + carouselRect.width / 2;
      const maxDist = carouselRect.width * 0.5;

      // Pass 1: batch all DOM reads
      const data: { scale: number; opacity: number; dist: number }[] = [];
      for (let i = 0; i < slides.length; i++) {
        const slideRect = slides[i].getBoundingClientRect();
        const dist = Math.abs(slideRect.left + slideRect.width / 2 - center);
        const t = Math.min(dist / maxDist, 1);
        data.push({
          scale: 1 - t * (1 - MIN_SCALE),
          opacity: 1 - t * 0.3,
          dist,
        });
      }

      // Pass 2: batch all DOM writes
      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < slides.length; i++) {
        slides[i].style.transform = `scale(${data[i].scale})`;
        slides[i].style.opacity = `${data[i].opacity}`;
        if (data[i].dist < closestDist) {
          closestDist = data[i].dist;
          closestIdx = i;
        }
      }

      if (closestIdx !== currentClosest) {
        currentClosest = closestIdx;
        for (let i = 0; i < dots.length; i++) {
          dots[i].classList.toggle('active', i === closestIdx);
        }
      }
    };

    // ── Mouse drag-to-scroll with momentum glide ──
    let isDragging = false;
    let startX = 0;
    let scrollStart = 0;
    let dragDirection = 0;
    let glideRaf: number | null = null;
    let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
    let isGliding = false;

    const velocitySamples: { dx: number; dt: number }[] = [];
    const MAX_SAMPLES = 5;

    const getSmoothedVelocity = (): number => {
      if (velocitySamples.length === 0) return 0;
      let totalDx = 0;
      let totalDt = 0;
      for (const s of velocitySamples) {
        totalDx += s.dx;
        totalDt += s.dt;
      }
      if (totalDt === 0) return 0;
      return (totalDx / totalDt) * 16;
    };

    const stopGlide = () => {
      if (glideRaf != null) {
        cancelAnimationFrame(glideRaf);
        glideRaf = null;
      }
      isGliding = false;
    };

    const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

    const getSlideCenterScroll = (slide: HTMLElement): number => {
      const slideLeft = slide.offsetLeft;
      const slideWidth = slide.offsetWidth;
      const viewWidth = carousel.offsetWidth;
      return slideLeft - (viewWidth - slideWidth) / 2;
    };

    const glideTo = (targetScroll: number, durationMs: number) => {
      stopGlide();
      const from = carousel.scrollLeft;
      const delta = targetScroll - from;
      if (Math.abs(delta) < 1) return;

      isGliding = true;
      const start = performance.now();

      const tick = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / durationMs, 1);
        carousel.scrollLeft = from + delta * easeOutQuart(t);

        if (t < 1) {
          glideRaf = requestAnimationFrame(tick);
        } else {
          glideRaf = null;
          isGliding = false;
        }
      };

      glideRaf = requestAnimationFrame(tick);
    };

    const findNearestSlide = (projectedScroll: number, tiebreakDir: number): HTMLElement | null => {
      if (slides.length === 0) return null;

      const slideData: { el: HTMLElement; center: number; dist: number }[] = [];
      for (const slide of slides) {
        const center = getSlideCenterScroll(slide);
        slideData.push({ el: slide, center, dist: Math.abs(projectedScroll - center) });
      }
      slideData.sort((a, b) => a.dist - b.dist);

      if (slideData.length >= 2 && slideData[0].dist > 0) {
        const ratio = slideData[1].dist / slideData[0].dist;
        if (ratio < 1.15) {
          if (tiebreakDir !== 0) {
            const prefer = tiebreakDir > 0
              ? slideData.find((s) => s.center <= projectedScroll) || slideData[0]
              : slideData.find((s) => s.center >= projectedScroll) || slideData[0];
            return prefer.el;
          }
        }
      }

      return slideData[0]?.el ?? null;
    };

    const settleToNearest = (dir: number) => {
      const target = findNearestSlide(carousel.scrollLeft, dir);
      if (target) {
        const targetScroll = getSlideCenterScroll(target);
        const dist = Math.abs(carousel.scrollLeft - targetScroll);
        if (dist > 1) {
          const duration = Math.min(800, Math.max(350, dist * 0.8));
          glideTo(targetScroll, duration);
        }
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      stopGlide();
      if (scrollEndTimer) { clearTimeout(scrollEndTimer); scrollEndTimer = null; }
      isDragging = true;
      carouselDraggedRef.current = false;
      startX = e.clientX;
      dragDirection = 0;
      velocitySamples.length = 0;
      scrollStart = carousel.scrollLeft;
      carousel.style.cursor = 'grabbing';
    };

    let lastMoveX = 0;
    let lastMoveTime = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) carouselDraggedRef.current = true;
      carousel.scrollLeft = scrollStart - dx;

      const now = Date.now();
      if (lastMoveTime > 0) {
        const dt = now - lastMoveTime;
        const moveDx = e.clientX - lastMoveX;
        if (dt > 0) {
          velocitySamples.push({ dx: moveDx, dt });
          if (velocitySamples.length > MAX_SAMPLES) velocitySamples.shift();
          if (Math.abs(moveDx) > 1) {
            dragDirection = moveDx > 0 ? 1 : -1;
          }
        }
      }
      lastMoveX = e.clientX;
      lastMoveTime = now;
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      carousel.style.cursor = '';

      const velocity = getSmoothedVelocity();
      const FRICTION = 0.94;
      const projectedDelta = -velocity * FRICTION / (1 - FRICTION);
      const projectedScroll = carousel.scrollLeft + projectedDelta;

      const target = findNearestSlide(projectedScroll, dragDirection);
      if (target) {
        const targetScroll = getSlideCenterScroll(target);
        const dist = Math.abs(carousel.scrollLeft - targetScroll);
        const duration = Math.min(900, Math.max(350, dist * 0.9));
        glideTo(targetScroll, duration);
      }
    };

    const onScroll = () => {
      if (rafId == null) rafId = requestAnimationFrame(updateScales);

      if (isDragging || isGliding) return;

      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(() => {
        scrollEndTimer = null;
        if (!isDragging && !isGliding) {
          settleToNearest(0);
        }
      }, 150);
    };

    carousel.addEventListener('scroll', onScroll, { passive: true });
    carousel.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    requestAnimationFrame(updateScales);

    return () => {
      carousel.removeEventListener('scroll', onScroll);
      carousel.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      stopGlide();
      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }); // No deps — runs after every render (preserves original behavior)

  const scrollToSlide = useCallback((index: number) => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const slide = carousel.children[index] as HTMLElement | undefined;
    if (!slide) return;

    const targetScroll = slide.offsetLeft - (carousel.clientWidth - slide.clientWidth) / 2;
    const start = carousel.scrollLeft;
    const distance = targetScroll - start;
    if (Math.abs(distance) < 2) return;

    const duration = Math.min(900, Math.max(500, Math.abs(distance) * 0.6));
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      carousel!.scrollLeft = start + distance * ease;
      if (t < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }, []);

  return { carouselRef, carouselDraggedRef, scrollToSlide };
}

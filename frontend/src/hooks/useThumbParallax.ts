import { useEffect } from 'react';

/**
 * Scroll-driven parallax + zigzag animation for floating page thumbnails
 * alongside the transcript. Desktop only (min-width: 769px).
 *
 * Thumbnails are positioned via `.page-thumb` elements and animated with
 * translate3d transforms based on scroll position.
 */
export default function useThumbParallax(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 769px)');
    if (!mq.matches) return;

    let rafId: number | null = null;
    let lastScrollY = -1;

    interface ThumbLayout {
      thumb: HTMLElement;
      sectionDocTop: number;
      sectionHeight: number;
      thumbH: number;
      curX: number;
      curY: number;
    }
    let layout: ThumbLayout[] = [];
    let headerHeight = 0;
    let viewportH = window.innerHeight;

    const getDocTop = (el: HTMLElement): number => {
      let top = 0;
      let cur: HTMLElement | null = el;
      while (cur) {
        top += cur.offsetTop;
        cur = cur.offsetParent as HTMLElement | null;
      }
      return top;
    };

    const cacheLayout = () => {
      const headerEl = document.querySelector<HTMLElement>('.header');
      headerHeight = headerEl?.offsetHeight ?? 0;
      viewportH = window.innerHeight;

      const thumbEls = document.querySelectorAll<HTMLElement>('.page-thumb');
      layout = [];
      thumbEls.forEach((thumb) => {
        const section = thumb.parentElement;
        if (!section) return;
        const prev = layout.find((l) => l.thumb === thumb);
        layout.push({
          thumb,
          sectionDocTop: getDocTop(section),
          sectionHeight: section.offsetHeight,
          thumbH: thumb.offsetHeight,
          curX: prev?.curX ?? 0,
          curY: prev?.curY ?? 0,
        });
      });
      lastScrollY = -1;
    };

    cacheLayout();

    const onResize = () => { cacheLayout(); start(); };
    window.addEventListener('resize', onResize, { passive: true });

    const observer = new MutationObserver(() => {
      setTimeout(cacheLayout, 50);
    });
    const transcriptEl = document.querySelector('.letter-transcript-section');
    if (transcriptEl) observer.observe(transcriptEl, { childList: true, subtree: true });

    const TWO_PI = Math.PI * 2;
    const factor = 0.065;

    const tick = () => {
      const scrollY = window.scrollY;

      if (scrollY === lastScrollY && rafId === null) return;
      lastScrollY = scrollY;

      const stickyTop = headerHeight + 16;
      const viewCenter = viewportH / 2;

      let needsMore = false;

      for (let i = 0; i < layout.length; i++) {
        const l = layout[i];
        const sectionViewTop = l.sectionDocTop - scrollY;
        const naturalTop = 8;
        const maxTravel = l.sectionHeight - l.thumbH - naturalTop - 16;

        let targetX = 0;
        let targetY = 0;
        if (maxTravel > 0) {
          const idealY = viewCenter - l.thumbH / 2 - sectionViewTop - naturalTop;
          const minFromHeader = stickyTop - sectionViewTop - naturalTop;
          targetY = maxTravel < idealY ? maxTravel : idealY;
          if (targetY < minFromHeader) targetY = minFromHeader > 0 ? minFromHeader : 0;
          if (targetY < 0) targetY = 0;
          if (targetY > maxTravel) targetY = maxTravel;

          const progress = targetY / maxTravel;
          const amp = l.sectionHeight * 0.012;
          targetX = Math.sin(progress * TWO_PI) * (amp < 8 ? 8 : amp > 18 ? 18 : amp);
        }

        const nx = l.curX + (targetX - l.curX) * factor;
        const ny = l.curY + (targetY - l.curY) * factor;
        l.curX = nx;
        l.curY = ny;

        if (Math.abs(nx) > 0.5 || Math.abs(ny) > 0.5) {
          l.thumb.style.transform = `translate3d(${nx | 0}px,${ny | 0}px,0)`;
        } else if (l.thumb.style.transform) {
          l.thumb.style.transform = '';
        }

        const dx = targetX - nx;
        const dy = targetY - ny;
        if (dx * dx + dy * dy > 0.25) {
          needsMore = true;
        }
      }

      if (needsMore) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };

    function start() { if (rafId == null) rafId = requestAnimationFrame(tick); }
    window.addEventListener('scroll', start, { passive: true });
    start();

    const onMq = (e: MediaQueryListEvent) => {
      if (!e.matches) {
        for (const l of layout) l.thumb.style.transform = '';
      }
    };
    mq.addEventListener('change', onMq);

    return () => {
      window.removeEventListener('scroll', start);
      window.removeEventListener('resize', onResize);
      mq.removeEventListener('change', onMq);
      observer.disconnect();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [enabled]);
}

import { useLayoutEffect, useRef } from 'react';
import { getImageUrl } from '../../api/client';
import type { LetterImage } from '../../types/Letter';
import { PreviewImage } from '../common/PreviewImage';
import './ViewerPageDrawer.css';

/** Shared native filmstrip. Only settled user scrolling selects a new scan. */
export function ViewerPageDrawer({ id, images, selected, onSelect, layout = 'viewer' }: {
  id: string; images: LetterImage[]; selected: number; onSelect: (index: number) => void;
  layout?: 'viewer' | 'inline';
}) {
  const root = useRef<HTMLDivElement>(null);
  const browsing = useRef(false);
  const current = useRef({ selected, onSelect });
  useLayoutEffect(() => { current.current = { selected, onSelect }; });

  const center = (index: number, behavior: ScrollBehavior) => {
    const list = root.current;
    const item = list?.querySelectorAll<HTMLButtonElement>('button')[index];
    if (!list || !item) return;
    const bounds = list.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    if (!bounds.width) return;
    list.scrollTo({ left: list.scrollLeft + box.left + box.width / 2 - bounds.left - bounds.width / 2, behavior });
  };

  useLayoutEffect(() => {
    const list = root.current;
    if (!list) return;
    let timer: ReturnType<typeof setTimeout>;
    let pressed = false;
    let touching = false;
    const settle = () => {
      if (!browsing.current || pressed || touching) return;
      browsing.current = false;
      const bounds = list.getBoundingClientRect();
      const midpoint = bounds.left + bounds.width / 2;
      const choices = [...list.querySelectorAll<HTMLButtonElement>('button')];
      const nearest = choices.reduce((best, item, index) => {
        const box = item.getBoundingClientRect();
        const distance = Math.abs(box.left + box.width / 2 - midpoint);
        return distance < best.distance ? { index, distance } : best;
      }, { index: current.current.selected, distance: Infinity }).index;
      if (nearest !== current.current.selected) current.current.onSelect(nearest);
    };
    const scroll = () => {
      // Older Safari versions lack scrollend. Wait for motion AND release.
      if (!('onscrollend' in list)) { clearTimeout(timer); timer = setTimeout(settle, 160); }
    };
    const down = () => { pressed = true; browsing.current = true; };
    const up = () => { pressed = false; scroll(); };
    const wheel = () => { browsing.current = true; };
    // A native touch scroll cancels pointer events before the finger lifts.
    const touchStart = () => { touching = true; browsing.current = true; };
    const touchEnd = (event: TouchEvent) => { touching = event.touches.length > 0; scroll(); };
    list.addEventListener('scroll', scroll, { passive: true });
    list.addEventListener('scrollend', settle);
    list.addEventListener('pointerdown', down, { passive: true });
    list.addEventListener('wheel', wheel, { passive: true });
    list.addEventListener('touchstart', touchStart, { passive: true });
    window.addEventListener('touchend', touchEnd, { passive: true });
    window.addEventListener('touchcancel', touchEnd, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    const resize = new ResizeObserver(() => {
      browsing.current = false;
      center(current.current.selected, 'instant');
    });
    resize.observe(list);
    return () => {
      clearTimeout(timer); resize.disconnect();
      list.removeEventListener('scroll', scroll); list.removeEventListener('scrollend', settle);
      list.removeEventListener('pointerdown', down); list.removeEventListener('wheel', wheel);
      list.removeEventListener('touchstart', touchStart);
      window.removeEventListener('touchend', touchEnd); window.removeEventListener('touchcancel', touchEnd);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    };
  }, []);

  useLayoutEffect(() => {
    browsing.current = false;
    center(selected, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');
  }, [selected]);

  return <div id={id} ref={root} className={`viewer-page-drawer${layout === 'inline' ? ' viewer-page-drawer--inline' : ''}`} role="region" aria-label="Scan pages" data-image-scroll-root data-swipe-ignore
    onKeyDown={event => {
      const index = event.key === 'ArrowRight' ? Math.min(images.length - 1, selected + 1)
        : event.key === 'ArrowLeft' ? Math.max(0, selected - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? images.length - 1 : undefined;
      if (index === undefined) return;
      event.preventDefault(); browsing.current = false; onSelect(index); center(index, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');
      root.current?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus({ preventScroll: true });
    }}>
    {images.map((image, index) => <button key={image.id || image.imageUrl} type="button" tabIndex={selected === index ? 0 : -1}
      className="viewer-page-choice" aria-label={`Go to scan ${index + 1}: ${image.type.replace(/_/g, ' ')}`}
      aria-current={selected === index ? 'page' : undefined} onClick={() => {
        browsing.current = false; onSelect(index);
        center(index, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');
      }}>
      <PreviewImage src={getImageUrl(image.imageUrl, { width: 200 })} alt="" preloadMargin="120px" context="viewer-pages" />
      <span className="viewer-page-notch" aria-hidden="true">{index + 1}</span>
    </button>)}
  </div>;
}

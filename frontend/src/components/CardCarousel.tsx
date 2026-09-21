import { Children, isValidElement, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import useCardCarouselPointer from '../hooks/useCardCarouselPointer';
import './CardCarousel.css';
import useCarouselMotion from '../hooks/useCarouselMotion';
import { CarouselOverlayContext } from './carouselOverlayContext';

interface CardCarouselProps {
  children: ReactNode;
  label: string;
  className?: string;
  initialIndex?: number;
  onSlideChange?: (index: number) => void;
  showDots?: boolean;
  overlayPlacement?: 'frame' | 'slide';
  /** Keep content mounted when the page switches to its desktop layout. */
  layout?: 'carousel' | 'static';
}

/** One clipped frame, bounded pointer settling, native wheel scrolling, and no clones. */
export default function CardCarousel({ children, label, className = '', layout = 'carousel', initialIndex = 0, onSlideChange, showDots = true, overlayPlacement = 'frame' }: CardCarouselProps) {
  const slides = Children.toArray(children);
  const keys = slides.map((slide, i) => isValidElement(slide) ? String(slide.key ?? i) : String(i));
  const signature = JSON.stringify(keys);
  const [selected, setSelected] = useState<string | null>(() => keys[initialIndex] ?? null);
  const active = Math.max(0, keys.indexOf(selected ?? keys[0]));
  const [settledSlide, setSettledSlide] = useState<number | null>(initialIndex);
  const selectedRef = useRef<string | null>(keys[initialIndex] ?? null);
  const changeRef = useRef(onSlideChange);
  useLayoutEffect(() => { changeRef.current = onSlideChange; }, [onSlideChange]);
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<number | null>(null);
  const carousel = layout === 'carousel';
  const interactive = carousel && slides.length > 1;
  const motion = useCarouselMotion();
  const pointer = useCardCarouselPointer(interactive, viewportRef, frameRef, (element, index) => {
    targetRef.current = index;
    motion.move(element, index * element.clientWidth);
  }, () => { motion.cancel(); targetRef.current = null; });

  const finishMotion = useRef(motion.finish);
  useLayoutEffect(() => { finishMotion.current = motion.finish; }, [motion.finish]);

  useLayoutEffect(() => {
    const observedKeys: string[] = JSON.parse(signature);
    const viewport = viewportRef.current;
    if (!viewport || !observedKeys.length) return;
    let frame = 0;
    let alignedWidth = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const select = (index: number) => {
      const changed = selectedRef.current !== observedKeys[index];
      selectedRef.current = observedKeys[index];
      setSelected(observedKeys[index]);
      if (changed) changeRef.current?.(index);
    };
    const readPosition = () => {
      frame = 0;
      if (!carousel || !viewport.clientWidth || viewport.clientWidth !== alignedWidth) return;
      select(Math.max(0, Math.min(observedKeys.length - 1, Math.round(viewport.scrollLeft / viewport.clientWidth))));
    };
    const settle = () => {
      clearTimeout(settleTimer);
      cancelAnimationFrame(frame);
      frame = 0;
      // A canceled animation can emit scrollend after a newer request.
      const target = targetRef.current;
      if (target !== null && Math.abs(viewport.scrollLeft - target * viewport.clientWidth) > 1) return;
      targetRef.current = null;
      if (!viewport.hasAttribute('data-dragging')) viewport.style.scrollSnapType = '';
      readPosition();
      const index = Math.round(viewport.scrollLeft / (viewport.clientWidth || 1));
      setSettledSlide(!viewport.hasAttribute('data-dragging') && Math.abs(viewport.scrollLeft - index * viewport.clientWidth) < 1 ? index : null);
    };
    const onScroll = () => {
      setSettledSlide(null);
      if (!frame) frame = requestAnimationFrame(readPosition);
      // Fallback for browsers without scrollend; never drives scrolling itself.
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, 160);
    };
    const realign = () => {
      finishMotion.current();
      targetRef.current = null;
      viewport.style.scrollSnapType = '';
      const index = Math.max(0, observedKeys.indexOf(selectedRef.current ?? observedKeys[0]));
      select(index);
      setSettledSlide(index);
      alignedWidth = viewport.clientWidth;
      if (carousel) viewport.scrollTo({ left: index * viewport.clientWidth, behavior: 'instant' });
    };
    const interrupt = () => {
      finishMotion.current();
      if (targetRef.current !== null) viewport.style.scrollSnapType = '';
      targetRef.current = null;
    };
    realign();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(realign);
    observer?.observe(viewport);
    window.addEventListener('resize', realign);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('scrollend', settle);
    viewport.addEventListener('wheel', interrupt, { passive: true });
    return () => {
      cancelAnimationFrame(frame); clearTimeout(settleTimer); observer?.disconnect();
      window.removeEventListener('resize', realign);
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('scrollend', settle);
      viewport.removeEventListener('wheel', interrupt);
    };
  }, [signature, carousel]);

  const goTo = (index: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = Math.max(0, Math.min(keys.length - 1, index));
    // Explicit navigation already has an exact destination. Avoid WebKit's
    // snap target competing with a rapidly reversed smooth-scroll target.
    viewport.style.scrollSnapType = 'none';
    targetRef.current = next;
    setSettledSlide(null);
    motion.move(viewport, next * viewport.clientWidth);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    const dot = target.closest('.card-carousel-dot');
    // Inner page buttons and links retain their own keyboard behavior.
    if (target !== viewportRef.current && !dot) return;
    const current = targetRef.current ?? active;
    const next = event.key === 'ArrowRight' ? current + 1 : event.key === 'ArrowLeft' ? current - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const bounded = Math.max(0, Math.min(keys.length - 1, next));
    if (dot) (dot.parentElement?.children[bounded] as HTMLElement)?.focus({ preventScroll: true });
    goTo(bounded);
  };

  if (!slides.length) return null;
  return (
    <div className={`card-carousel ${className}`} data-layout={layout}
      role={interactive ? 'region' : undefined} aria-roledescription={interactive ? 'carousel' : undefined}
      aria-label={interactive ? label : undefined} onKeyDown={onKeyDown}>
      <div className="card-carousel-frame" ref={frameRef} data-settled-slide={settledSlide ?? undefined} {...pointer}>
        <div className="card-carousel-viewport" ref={viewportRef} tabIndex={interactive ? 0 : undefined}
          aria-label={interactive ? `${label}: use left and right arrow keys to change slides` : undefined}>
          {slides.map((slide, index) => (
            <div className="card-carousel-slide" key={keys[index]} inert={carousel && index !== active}
              role={interactive ? 'group' : undefined} aria-roledescription={interactive ? 'slide' : undefined}
              aria-label={interactive ? `${index + 1} of ${slides.length}` : undefined}>
              <CarouselOverlayContext.Provider value={carousel && overlayPlacement === 'frame' ? { host: overlayHost, active: index === active } : null}>{slide}</CarouselOverlayContext.Provider>
            </div>
          ))}
        </div>
        {carousel && overlayPlacement === 'frame' && <div className="card-carousel-overlay-host" ref={setOverlayHost} />}
      </div>
      {interactive && showDots && (
        <div className="card-carousel-dots" role="group" aria-label="Choose slide">
          {slides.map((_, index) => <button key={keys[index]} type="button" className="card-carousel-dot"
            aria-label={`Slide ${index + 1}`} aria-current={index === active ? 'true' : undefined} onClick={() => goTo(index)} />)}
        </div>
      )}
    </div>
  );
}

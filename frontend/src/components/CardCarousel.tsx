import { Children, isValidElement, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import useCardCarouselPointer from '../hooks/useCardCarouselPointer';
import './CardCarousel.css';

interface CardCarouselProps {
  children: ReactNode;
  label: string;
  className?: string;
  /** Keep content mounted when the page switches to its desktop layout. */
  layout?: 'carousel' | 'static';
}

/** One clipped frame, native touch/trackpad scrolling, and no cloned content. */
export default function CardCarousel({ children, label, className = '', layout = 'carousel' }: CardCarouselProps) {
  const slides = Children.toArray(children);
  const keys = slides.map((slide, i) => isValidElement(slide) ? String(slide.key ?? i) : String(i));
  const signature = JSON.stringify(keys);
  const [selected, setSelected] = useState<string | null>(null);
  const active = Math.max(0, keys.indexOf(selected ?? keys[0]));
  const [settledSlide, setSettledSlide] = useState<number | null>(0);
  const selectedRef = useRef<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<number | null>(null);
  const carousel = layout === 'carousel';
  const interactive = carousel && slides.length > 1;
  const pointer = useCardCarouselPointer(interactive);

  useLayoutEffect(() => {
    const observedKeys: string[] = JSON.parse(signature);
    const viewport = viewportRef.current;
    if (!viewport || !observedKeys.length) return;
    let frame = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const select = (index: number) => {
      selectedRef.current = observedKeys[index];
      setSelected(observedKeys[index]);
    };
    const readPosition = () => {
      frame = 0;
      if (!carousel || !viewport.clientWidth) return;
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
      targetRef.current = null;
      viewport.style.scrollSnapType = '';
      const index = Math.max(0, observedKeys.indexOf(selectedRef.current ?? observedKeys[0]));
      select(index);
      setSettledSlide(index);
      if (carousel) viewport.scrollTo({ left: index * viewport.clientWidth, behavior: 'instant' });
    };
    const interrupt = () => {
      if (targetRef.current !== null) viewport.style.scrollSnapType = '';
      targetRef.current = null;
    };
    realign();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(realign);
    observer?.observe(viewport);
    window.addEventListener('resize', realign);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('scrollend', settle);
    viewport.addEventListener('pointerdown', interrupt, { passive: true });
    viewport.addEventListener('wheel', interrupt, { passive: true });
    return () => {
      cancelAnimationFrame(frame); clearTimeout(settleTimer); observer?.disconnect();
      window.removeEventListener('resize', realign);
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('scrollend', settle);
      viewport.removeEventListener('pointerdown', interrupt);
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
    if (Math.abs(viewport.scrollLeft - next * viewport.clientWidth) < 1) {
      viewport.scrollTo({ left: next * viewport.clientWidth, behavior: 'instant' });
      viewport.style.scrollSnapType = '';
      targetRef.current = null;
      return;
    }
    setSettledSlide(null);
    viewport.scrollTo({ left: next * viewport.clientWidth,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
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
    <div className={`card-carousel ${className}`} data-layout={layout} data-swipe-ignore={interactive || undefined}
      role={interactive ? 'region' : undefined} aria-roledescription={interactive ? 'carousel' : undefined}
      aria-label={interactive ? label : undefined} onKeyDown={onKeyDown}>
      <div className="card-carousel-frame" data-settled-slide={settledSlide ?? undefined}>
        <div className="card-carousel-viewport" ref={viewportRef} tabIndex={interactive ? 0 : undefined}
          aria-label={interactive ? `${label}: use left and right arrow keys to change slides` : undefined} {...pointer}>
          {slides.map((slide, index) => (
            <div className="card-carousel-slide" key={keys[index]} inert={carousel && index !== active}
              role={interactive ? 'group' : undefined} aria-roledescription={interactive ? 'slide' : undefined}
              aria-label={interactive ? `${index + 1} of ${slides.length}` : undefined}>{slide}</div>
          ))}
        </div>
      </div>
      {interactive && (
        <div className="card-carousel-dots" role="group" aria-label="Choose slide">
          {slides.map((_, index) => <button key={keys[index]} type="button" className="card-carousel-dot"
            aria-label={`Slide ${index + 1}`} aria-current={index === active ? 'true' : undefined} onClick={() => goTo(index)} />)}
        </div>
      )}
    </div>
  );
}

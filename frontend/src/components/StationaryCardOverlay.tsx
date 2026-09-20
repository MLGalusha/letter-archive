import { useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './StationaryCardOverlay.css';

import { CarouselOverlayContext } from './carouselOverlayContext';

/** Overlay follows the frame, never the scrolling slide. Wide cards keep it local. */
export default function StationaryCardOverlay({ children, className = '' }: { children: ReactNode; className?: string }) {
  const carousel = useContext(CarouselOverlayContext);
  const content = <div className={`stationary-card-overlay ${className}`} hidden={carousel ? !carousel.active : false}>{children}</div>;
  return carousel ? (carousel.host ? createPortal(content, carousel.host) : null) : content;
}

/** Update text in place; do not remount controls or animate unchanged values. */
export function OverlayText({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(children);
  useLayoutEffect(() => {
    if (previous.current === children) return;
    previous.current = children;
    if (!ref.current?.animate) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = ref.current?.animate?.([{ opacity: 0.7, transform: 'translateY(2px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 140, easing: 'ease-out' });
    return () => animation?.cancel();
  }, [children]);
  return <span ref={ref} className="overlay-text">{children}</span>;
}

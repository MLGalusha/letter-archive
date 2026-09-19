import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { LetterImage } from '../../types/Letter';
import { useAccessibleDialog } from '../common/useAccessibleDialog';
import { useReaderViewerSurface } from '../../hooks/useReaderViewerSurface';
import LetterViewer from './LetterViewer';
import './ReaderFocusViewer.css';

const DURATION = 420;
const EASING = 'cubic-bezier(.22,.75,.2,1)';
const scanElement = (index: number) => document.querySelector<HTMLElement>(`.scan-slide[data-scan-index="${index}"] .scan-slide-img`);
const visibleSource = (element: Element | null) => {
  const images = Array.from(element?.querySelectorAll<HTMLImageElement>('img') ?? []);
  return images.find(image => image.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity !== '0')?.currentSrc ?? '';
};

/** Owns the reversible trip between the document scan and the viewport stage. */
export function ReaderFocusViewer({ images, letterId, initialIndex, onClose, onPageChange, entryZoom = 1 }: {
  images: LetterImage[]; letterId: string; initialIndex: number; entryZoom?: number;
  onClose: () => void; onPageChange: (index: number) => void;
}) {
  const [origin] = useState(() => {
    const image = scanElement(initialIndex);
    return { opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      image: image?.getBoundingClientRect(), src: visibleSource(image),
      strip: document.querySelector('.letter-scan-figure .scan-navigation')?.getBoundingClientRect() };
  });
  const [phase, setPhase] = useState<'preparing' | 'entering' | 'focused' | 'exiting'>('preparing');
  const [index, setIndex] = useState(initialIndex);
  const indexRef = useRef(index);
  const closing = useRef(false);
  const flightRef = useRef<HTMLImageElement>(null);
  const animations = useRef<Animation[]>([]);
  const historyToken = useId();
  const closeCallback = useRef(onClose);
  useLayoutEffect(() => { closeCallback.current = onClose; }, [onClose]);
  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setPhase('exiting');
    if (history.state?.readerFocus === historyToken) history.back();
  }, [historyToken]);
  const { dialogRef } = useAccessibleDialog({ isOpen: true, onClose: requestClose, isolateBackground: true, restoreFocusTo: origin.opener });
  useReaderViewerSurface(true, dialogRef, '#f5ede1');

  useLayoutEffect(() => {
    // StrictMode replays effects; the same focus session owns one history entry.
    if (history.state?.readerFocus !== historyToken) history.pushState({ ...history.state, readerFocus: historyToken }, '');
    const onPop = () => { if (history.state?.readerFocus !== historyToken) requestClose(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, [requestClose, historyToken]);

  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>('.main-page-layout.public-site-shell');
    if (!shell) return;
    shell.dataset.readerFocus = 'preparing';
    const flight = flightRef.current;
    if (flight && origin.image && origin.src) {
      Object.assign(flight.style, { visibility: 'visible', left: `${origin.image.left}px`, top: `${origin.image.top}px`,
        width: `${origin.image.width}px`, height: `${origin.image.height}px` });
    }

    return () => {
      delete shell.dataset.readerFocus;
      shell.querySelectorAll<HTMLElement>('[data-focus-side]').forEach(el => delete el.dataset.focusSide);
      animations.current.forEach(animation => animation.cancel());
    };
  }, [origin]);

  useLayoutEffect(() => {
    indexRef.current = index;
    document.querySelectorAll<HTMLElement>('.scan-slide').forEach((el, i) => {
      el.dataset.focusSide = i < index ? 'left' : i > index ? 'right' : 'selected';
    });
    onPageChange(index);
  }, [index, onPageChange]);

  const selectPage = useCallback((next: number) => {
    setIndex(next);
  }, []);

  const exiting = phase === 'exiting';
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const flight = flightRef.current;
    const shell = document.querySelector<HTMLElement>('.main-page-layout.public-site-shell');
    if (!dialog || !flight || !shell) return;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : DURATION;
    let cancelled = false;
    let frame = 0;
    let flightFrame = 0;
    const run = () => {
      if (cancelled) return;
      const image = dialog.querySelector<HTMLElement>('.viewer-transform');
      const strip = dialog.querySelector<HTMLElement>('.reader-focus-strip');
      if (!image || !strip || image.getBoundingClientRect().width === 0) {
        frame = requestAnimationFrame(run);
        return;
      }
      const entering = !exiting;
      const target = scanElement(indexRef.current);
      const from = entering ? origin.image : flight.style.visibility === 'visible'
        ? flight.getBoundingClientRect() : image.getBoundingClientRect();
      const to = entering ? image.getBoundingClientRect() : target?.getBoundingClientRect();
      const source = entering ? origin.src : visibleSource(image) || flight.src;
      // Capture the displayed frame before cancelling a partially completed trip.
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
      shell.dataset.readerFocus = entering ? 'entering' : 'exiting';
      image.style.visibility = 'hidden';
      let liveFlight: Promise<void> | undefined;
      if (from && to && from.width && to.width && source) {
        flight.src = source;
        Object.assign(flight.style, { visibility: 'visible', left: `${from.left}px`, top: `${from.top}px`,
          width: `${from.width}px`, height: `${from.height}px` });
        if (entering) {
          // The destination stays live: wheel/pinch updates during entry must
          // enlarge the visible scan now, not jump when the flight finishes.
          const clock = strip.animate([{ opacity: 1 }, { opacity: 1 }], { duration, easing: EASING, fill: 'both' });
          animations.current.push(clock);
          liveFlight = new Promise(resolve => {
            const draw = () => {
              if (cancelled) { resolve(); return; }
              const progress = clock.effect?.getComputedTiming().progress ?? 0;
              const destination = image.getBoundingClientRect();
              const mix = (a: number, b: number) => a + (b - a) * progress;
              Object.assign(flight.style, { left: `${mix(from.left, destination.left)}px`, top: `${mix(from.top, destination.top)}px`,
                width: `${mix(from.width, destination.width)}px`, height: `${mix(from.height, destination.height)}px` });
              if (progress === 1) resolve();
              else flightFrame = requestAnimationFrame(draw);
            };
            draw();
          });
        } else {
          animations.current.push(flight.animate([
            { transform: 'none' },
            { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})` },
          ], { duration, easing: EASING, fill: 'both' }));
        }
      }
      const stripRect = strip.getBoundingClientRect();
      const documentStrip = document.querySelector('.letter-scan-figure .scan-navigation')?.getBoundingClientRect();
      const sourceStrip = entering ? origin.strip : stripRect;
      const targetStrip = entering ? stripRect : documentStrip;
      if (sourceStrip && targetStrip) {
        const dx = sourceStrip.left + sourceStrip.width / 2 - targetStrip.left - targetStrip.width / 2;
        const dy = sourceStrip.top - targetStrip.top;
        animations.current.push(strip.animate(entering
          ? [{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }]
          : [{ translate: '0px 0px' }, { translate: `${-dx}px ${-dy}px` }],
        { duration, easing: EASING, fill: 'both' }));
      }
      strip.style.visibility = 'visible';
      if (entering) setPhase('entering');
      // Includes the page's CSS movement even if no scan is available to animate.
      const finished = animations.current.length ? Promise.allSettled([...animations.current.map(a => a.finished), ...(liveFlight ? [liveFlight] : [])])
        : new Promise(resolve => setTimeout(resolve, duration));
      void finished.then(() => {
        if (cancelled || (entering && closing.current)) return;
        if (entering) {
          flight.style.visibility = 'hidden';
          image.style.visibility = '';
          setPhase('focused');
          shell.dataset.readerFocus = 'focused';
        } else closeCallback.current();
      });
    };
    frame = requestAnimationFrame(run);
    return () => { cancelled = true; cancelAnimationFrame(frame); cancelAnimationFrame(flightFrame); };
  }, [exiting, dialogRef, origin]);

  return <div className="reader-focus-backdrop viewer-backdrop" data-phase={phase}>
    <div ref={dialogRef} className="reader-focus viewer-modal" role="dialog" aria-modal="true" aria-label="Original scans" tabIndex={-1}>
      <LetterViewer images={images} letterId={letterId} variant="lightbox" focusMode entryZoom={entryZoom}
        initialIndex={initialIndex} initialAspectRatio={origin.image ? origin.image.width / origin.image.height : undefined}
        fallbackSrc={origin.src} onClose={requestClose} onPageChange={selectPage} />
    </div>
    <img ref={flightRef} className="reader-focus-flight" src={origin.src || undefined} alt="" aria-hidden draggable={false} />
  </div>;
}

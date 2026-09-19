import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { LetterImage } from '../../types/Letter';
import { useAccessibleDialog } from '../common/useAccessibleDialog';
import { useReaderViewerSurface } from '../../hooks/useReaderViewerSurface';
import LetterViewer from './LetterViewer';
import { createScanReturnPainter, createScanReturnSnapshot } from './drawScanReturn';
import { focusZoomProgress } from './focusZoomProgress';
import { animateFocusChrome } from './animateFocusChrome';
import './ReaderFocusViewer.css';

const DURATION = 420;
const EASING = 'cubic-bezier(.22,.75,.2,1)';
const scanElement = (index: number) => document.querySelector<HTMLElement>(`.scan-slide[data-scan-index="${index}"] .scan-slide-img`);
const visibleImage = (element: Element | null) => {
  const images = Array.from(element?.querySelectorAll<HTMLImageElement>('img') ?? []);
  return images.find(image => image.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity !== '0');
};
const visibleSource = (element: Element | null) => visibleImage(element)?.currentSrc ?? '';

/** Owns the reversible trip between the document scan and the viewport stage. */
export function ReaderFocusViewer({ images, letterId, initialIndex, onClose, onPageChange, cornerRatios, entryZoom = 1, directZoom = false }: {
  images: LetterImage[]; letterId: string; initialIndex: number; cornerRatios: number[]; entryZoom?: number;
  onClose: (selectedIndex: number) => void; onPageChange: (index: number) => void;
  directZoom?: boolean;
}) {
  const [origin] = useState(() => {
    const image = scanElement(initialIndex);
    return { opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      cornerRatio: image && image.getBoundingClientRect().width ? parseFloat(getComputedStyle(image).borderTopLeftRadius) / image.getBoundingClientRect().width : .01,
      image: image?.getBoundingClientRect(), src: visibleSource(image),
      strip: document.querySelector('.letter-scan-figure .scan-navigation')?.getBoundingClientRect() };
  });
  const [phase, setPhase] = useState<'preparing' | 'entering' | 'focused' | 'exiting'>('preparing');
  const [index] = useState(initialIndex);
  const pendingSelection = useRef(initialIndex);
  const stripOffset = useRef<{ width: number; height: number; x: number; y: number } | null>(null);
  const closing = useRef(false);
  const chromeReady = useRef(false);
  const chromeHidden = useRef<boolean | null>(null);
  const currentScale = useRef(entryZoom);
  const setChromeHidden = useCallback((hidden: boolean, duration?: number) => {
    if (!directZoom || chromeHidden.current === hidden) return;
    const shell = document.querySelector<HTMLElement>('.public-site-shell');
    if (!shell) return;
    chromeHidden.current = hidden;
    animateFocusChrome(shell, hidden, duration);
  }, [directZoom]);
  const flightRef = useRef<HTMLImageElement>(null);
  const returnCanvasRef = useRef<HTMLCanvasElement>(null);
  const returnSnapshot = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
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
  const finishZoomOut = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (history.state?.readerFocus === historyToken) history.back();
    setChromeHidden(false);
    closeCallback.current(pendingSelection.current);
  }, [historyToken, setChromeHidden]);
  const followScale = useCallback((scale: number) => {
    if (!directZoom || closing.current) return;
    const progress = focusZoomProgress(scale);
    currentScale.current = scale;
    if (chromeReady.current) setChromeHidden(scale > 1);
    const strip = document.querySelector<HTMLElement>('.reader-focus-strip');
    if (strip && origin.strip) {
      // Measure once per viewport, not once per wheel/pinch update.
      if (!stripOffset.current || stripOffset.current.width !== innerWidth || stripOffset.current.height !== innerHeight) {
        strip.style.translate = 'none';
        const rect = strip.getBoundingClientRect();
        stripOffset.current = { width: innerWidth, height: innerHeight,
          x: origin.strip.left + origin.strip.width / 2 - rect.left - rect.width / 2, y: origin.strip.top - rect.top };
      }
      strip.style.translate = `${stripOffset.current.x * (1 - progress)}px ${stripOffset.current.y * (1 - progress)}px`;
    }
  }, [directZoom, origin, setChromeHidden]);
  const { dialogRef } = useAccessibleDialog({ isOpen: true, onClose: requestClose, isolateBackground: true, restoreFocusTo: origin.opener });
  useReaderViewerSurface(true, dialogRef, '#f5ede1');

  const prepareReturnImage = useCallback((source: HTMLImageElement) => {
    const viewport = returnCanvasRef.current?.getBoundingClientRect();
    if (!viewport) return null;
    const key = `${source.currentSrc}:${source.naturalWidth}:${source.naturalHeight}:${viewport.width}:${viewport.height}`;
    if (returnSnapshot.current?.key === key) return returnSnapshot.current.canvas;
    const canvas = createScanReturnSnapshot(source, viewport);
    if (!canvas) return null;
    if (returnSnapshot.current) {
      returnSnapshot.current.canvas.width = 0; returnSnapshot.current.canvas.height = 0;
    }
    returnSnapshot.current = { key, canvas };
    return canvas;
  }, []);

  useLayoutEffect(() => {
    if (phase !== 'focused' || !dialogRef.current) return;
    // Prepare once after a rendition loads, away from the thumbnail click. This
    // avoids decoding/resampling a large original on the first return frame.
    let idle = 0;
    const prepare = () => {
      const source = visibleImage(dialogRef.current?.querySelector('.viewer-transform') ?? null);
      if (source) prepareReturnImage(source);
    };
    const schedule = () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else clearTimeout(idle);
      idle = window.requestIdleCallback ? window.requestIdleCallback(prepare, { timeout: 200 }) : window.setTimeout(prepare, 0);
    };
    const dialog = dialogRef.current;
    const observer = new MutationObserver(schedule);
    observer.observe(dialog, { childList: true, subtree: true });
    dialog.addEventListener('load', schedule, true);
    schedule();
    return () => {
      observer.disconnect(); dialog.removeEventListener('load', schedule, true);
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else clearTimeout(idle);
    };
  }, [phase, dialogRef, prepareReturnImage]);

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
    if (directZoom) shell.dataset.readerDirectZoom = 'true';
    // The thumbnail controls are hidden during entry; focus the dialog itself.
    dialogRef.current?.focus({ preventScroll: true });
    const flight = flightRef.current;
    if (!directZoom && flight && origin.image && origin.src) {
      Object.assign(flight.style, { visibility: 'visible', left: `${origin.image.left}px`, top: `${origin.image.top}px`,
        width: `${origin.image.width}px`, height: `${origin.image.height}px`, borderRadius: `${origin.image.width * origin.cornerRatio}px` });
    }

    return () => {
      chromeReady.current = false;
      if (directZoom) setChromeHidden(false);
      delete shell.dataset.readerFocus;
      delete shell.dataset.readerDirectZoom;
      shell.style.removeProperty('--reader-focus-duration');
      shell.querySelectorAll<HTMLElement>('[data-focus-side]').forEach(el => {
        delete el.dataset.focusSide;
        el.style.removeProperty('--reader-focus-exit-x');
      });
      animations.current.forEach(animation => animation.cancel());
      if (returnSnapshot.current) {
        returnSnapshot.current.canvas.width = 0; returnSnapshot.current.canvas.height = 0;
        returnSnapshot.current = null;
      }
    };
  }, [origin, dialogRef, directZoom, setChromeHidden]);

  useLayoutEffect(() => {
    document.querySelectorAll<HTMLElement>('.scan-slide').forEach((el, i) => {
      // Travel only the visible distance to the viewport edge during entry.
      // A full viewport jump makes narrow side previews disappear in one frame.
      const rect = el.querySelector('.scan-slide-img')?.getBoundingClientRect();
      if (rect && i !== index) {
        // A new zoom may interrupt the previous return. Measure the resting
        // edge, not the still-animated neighbor's intermediate position.
        const transform = getComputedStyle(el).transform;
        const offset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
        el.style.setProperty('--reader-focus-exit-x',
          `${i < index ? -Math.max(0, rect.right - offset) - 1 : Math.max(0, innerWidth - rect.left + offset) + 1}px`);
      }
      el.dataset.focusSide = i < index ? 'left' : i > index ? 'right' : 'selected';
    });
    onPageChange(index);
  }, [index, onPageChange]);

  const selectPage = useCallback((next: number) => {
    pendingSelection.current = next;
  }, []);

  const exiting = phase === 'exiting';
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const flight = flightRef.current;
    const returnCanvas = returnCanvasRef.current;
    const shell = document.querySelector<HTMLElement>('.main-page-layout.public-site-shell');
    if (!dialog || !flight || !returnCanvas || !shell) return;
    // Keep the return brief; subsequent paging uses the regular carousel animation.
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0
      : exiting && pendingSelection.current !== index ? 260 : DURATION;
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
      if (entering && directZoom) {
        // The actual scan follows the gesture from its document geometry;
        // there is no timed flight image to catch up or swap out afterward.
        image.style.visibility = '';
        strip.style.visibility = 'visible';
        shell.dataset.readerFocus = 'focused';
        chromeReady.current = true;
        setChromeHidden(currentScale.current > 1);
        setPhase('focused');
        return;
      }
      if (exiting && directZoom) setChromeHidden(false, duration);
      const currentStripRect = strip.getBoundingClientRect();
      strip.style.translate = 'none';
      const target = scanElement(index);
      const from = entering ? origin.image : flight.style.visibility === 'visible'
        ? flight.getBoundingClientRect() : image.getBoundingClientRect();
      const to = entering ? image.getBoundingClientRect() : target?.getBoundingClientRect();
      const cornerRatio = entering || !target?.getBoundingClientRect().width ? origin.cornerRatio
        : parseFloat(getComputedStyle(target).borderTopLeftRadius) / target.getBoundingClientRect().width;
      const source = origin.src;
      const returnImage = flight.style.visibility === 'visible' && flight.complete && flight.naturalWidth
        ? flight : visibleImage(image) || visibleImage(target);
      // Capture the displayed frame before cancelling a partially completed trip.
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
      shell.dataset.readerFocus = entering ? 'entering' : 'exiting';
      shell.style.setProperty('--reader-focus-duration', `${duration}ms`);
      image.style.visibility = 'hidden';
      let liveFlight: Promise<void> | undefined;
      if (entering && from && to && from.width && to.width && source) {
        flight.src = source;
        Object.assign(flight.style, { visibility: 'visible', left: `${from.left}px`, top: `${from.top}px`,
          width: `${from.width}px`, height: `${from.height}px`, borderRadius: `${from.width * cornerRatio}px` });
        // The destination stays live: wheel/pinch updates during entry must
        // enlarge the visible scan now, not jump when the flight finishes.
        const clock = flight.animate([{ opacity: 1 }, { opacity: 1 }], { duration, easing: EASING, fill: 'both' });
        animations.current.push(clock);
        liveFlight = new Promise(resolve => {
          const draw = () => {
            if (cancelled) { resolve(); return; }
            const progress = clock.effect?.getComputedTiming().progress ?? 0;
            const destination = image.getBoundingClientRect();
            const mix = (a: number, b: number) => a + (b - a) * progress;
            Object.assign(flight.style, { left: `${mix(from.left, destination.left)}px`, top: `${mix(from.top, destination.top)}px`,
              width: `${mix(from.width, destination.width)}px`, height: `${mix(from.height, destination.height)}px`,
              borderRadius: `${mix(from.width, destination.width) * cornerRatio}px` });
            if (progress === 1) resolve();
            else flightFrame = requestAnimationFrame(draw);
          };
          draw();
        });
      } else if (!entering && from && to && returnImage) {
        const snapshot = prepareReturnImage(returnImage);
        const paint = snapshot && createScanReturnPainter(returnCanvas, snapshot);
        if (paint) {
          paint(from, cornerRatio);
          returnCanvas.style.visibility = 'visible';
          const clock = returnCanvas.animate([{ opacity: 1 }, { opacity: 1 }], { duration, easing: EASING, fill: 'both' });
          animations.current.push(clock);
          liveFlight = new Promise(resolve => {
            const draw = () => {
              if (cancelled) { resolve(); return; }
              const progress = clock.effect?.getComputedTiming().progress ?? 0;
              const mix = (a: number, b: number) => a + (b - a) * progress;
              paint({ left: mix(from.left, to.left), top: mix(from.top, to.top),
                width: mix(from.width, to.width), height: mix(from.height, to.height) }, cornerRatio);
              if (progress === 1) resolve();
              else flightFrame = requestAnimationFrame(draw);
            };
            draw();
          });
        }
        flight.style.visibility = 'hidden';
      }
      const stripRect = strip.getBoundingClientRect();
      const documentStrip = document.querySelector('.letter-scan-figure .scan-navigation')?.getBoundingClientRect();
      const sourceStrip = entering ? origin.strip : currentStripRect;
      const targetStrip = entering ? stripRect : documentStrip;
      if (sourceStrip && targetStrip) {
        const offset = (rect: DOMRect) => `${rect.left + rect.width / 2 - stripRect.left - stripRect.width / 2}px ${rect.top - stripRect.top}px`;
        animations.current.push(strip.animate(
          [{ translate: offset(sourceStrip) }, { translate: offset(targetStrip) }],
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
          // Filled animations can retain compositor/backdrop boundaries after
          // finishing. The resting CSS already matches their final geometry.
          animations.current.forEach(animation => animation.cancel());
          animations.current = [];
          setPhase('focused');
          shell.dataset.readerFocus = 'focused';
        } else closeCallback.current(pendingSelection.current);
      });
    };
    frame = requestAnimationFrame(run);
    return () => {
      cancelled = true; cancelAnimationFrame(frame); cancelAnimationFrame(flightFrame);
      // Release the backing store as soon as the temporary surface is finished.
      returnCanvas.width = 0; returnCanvas.height = 0;
    };
  }, [exiting, dialogRef, origin, prepareReturnImage, index, directZoom, setChromeHidden]);

  return <div className="reader-focus-backdrop viewer-backdrop" data-phase={phase} data-direct-zoom={directZoom}>
    <div ref={dialogRef} className="reader-focus viewer-modal" role="dialog" aria-modal="true" aria-label="Original scans" tabIndex={-1}>
      <LetterViewer images={images} letterId={letterId} variant="lightbox" focusMode cornerRatios={cornerRatios} entryZoom={entryZoom}
        focusOrigin={directZoom ? origin.image : undefined} onFocusScale={followScale} onZoomExit={directZoom ? finishZoomOut : requestClose}
        initialIndex={initialIndex} initialAspectRatio={origin.image ? origin.image.width / origin.image.height : undefined}
        fallbackSrc={origin.src} onClose={requestClose} onPageChange={selectPage} />
    </div>
    <img ref={flightRef} className="reader-focus-flight" src={origin.src || undefined} alt="" aria-hidden draggable={false} />
    <canvas ref={returnCanvasRef} className="reader-focus-return" aria-hidden />
  </div>;
}

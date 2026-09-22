import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { LetterImage } from '../../types/Letter';
import useCarouselDrag from '../../hooks/useCarouselDrag';
import { useScanCornerRatios } from '../../hooks/useScanCornerRatios';
import { useScanFocusEntry } from '../../hooks/useScanFocusEntry';
import { allowImageSpeculation } from '../../services/imagePreloadService';
import { InlineScanNavigation } from './InlineScanNavigation';
import { ReaderScanImage } from './ReaderScanImage';
import { ReaderFocusViewer } from './ReaderFocusViewer';

export interface ScanReaderHandle { open: (index: number, opener: HTMLElement) => void }

/** One selection owner for the document, thumbnails, and fullscreen viewer. */
export const ScanReader = forwardRef<ScanReaderHandle, {
  images: LetterImage[]; letterId: string; targetImageId: string | null;
  onViewerChange: (open: boolean) => void;
}>(function ScanReader({ images, letterId, targetImageId, onViewerChange }, ref) {
  const { carouselRef, attachCarousel, activeIndex, transitionFromIndex, carouselDraggedRef, scrollToSlide } = useCarouselDrag();
  const cornerRatios = useScanCornerRatios(carouselRef, images);
  const [initialized, setInitialized] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(() => history.state?.readerFocusLetter === letterId && !!history.state?.readerFocus);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [readyScan, setReadyScan] = useState<string | null>(null);
  const activeKey = images[activeIndex]?.imageUrl;
  const transition = useRef<ViewTransition | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const requestedMode = useRef(viewerOpen);
  const changeMode = useCallback((open: boolean) => {
    if (requestedMode.current === open) return;
    requestedMode.current = open;
    transition.current?.skipTransition();
    const update = () => flushSync(() => setViewerOpen(open));
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update();
      return;
    }
    const next = document.startViewTransition(update);
    transition.current = next;
    // Unsupported captures must never block opening/closing the reader.
    void next.ready.catch(() => {});
    void next.finished.then(() => {
      if (transition.current !== next) return;
      transition.current = null;
      // A browser transition can reset focus after the dialog's cleanup.
      if (!requestedMode.current && document.activeElement === document.body && returnFocus.current?.isConnected) {
        returnFocus.current.focus({ preventScroll: true });
      }
    }).catch(() => {});
  }, []);
  useEffect(() => () => transition.current?.skipTransition(), []);

  useLayoutEffect(() => {
    const restored = history.state?.readerFocusLetter === letterId && history.state?.readerFocus;
    const requested = restored ? history.state.readerFocusIndex : images.findIndex(image => image.id === targetImageId);
    scrollToSlide(Math.max(0, Math.min(images.length - 1, requested ?? 0)), 'instant');
    setInitialized(true);
  }, [letterId, images, targetImageId, scrollToSlide]);
  useEffect(() => { onViewerChange(viewerOpen); }, [viewerOpen, onViewerChange]);
  useEffect(() => {
    const restore = () => {
      if (history.state?.readerFocusLetter !== letterId || !history.state?.readerFocus) return;
      scrollToSlide(history.state.readerFocusIndex ?? 0, 'instant');
      changeMode(true);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [letterId, scrollToSlide, changeMode]);

  const open = useCallback((index: number, opener: HTMLElement) => {
    setOpener(opener);
    returnFocus.current = opener;
    opener.focus({ preventScroll: true });
    scrollToSlide(index, 'instant');
    changeMode(true);
  }, [scrollToSlide, changeMode]);
  const { entryZoom, resetEntryZoom } = useScanFocusEntry(open, carouselRef, viewerRef);
  useImperativeHandle(ref, () => ({ open: (index, element) => { resetEntryZoom(); open(index, element); } }), [open, resetEntryZoom]);
  const activate = (index: number, opener: HTMLElement) => {
    if (index !== activeIndex) scrollToSlide(index);
    else { resetEntryZoom(); open(index, opener); }
  };
  const selectFullscreen = useCallback((index: number) => scrollToSlide(index, 'instant'), [scrollToSlide]);
  const close = useCallback(() => changeMode(false), [changeMode]);
  if (!images.length) return null;

  return <>
    <figure id="letter-scans" className="letter-scan-figure" tabIndex={-1}>
      <div className="scan-carousel" ref={attachCarousel} data-image-scroll-root>
        {images.map((image, index) => <div key={image.id} className="scan-slide" data-index={index} data-scan-index={index}
          role="button" tabIndex={index === activeIndex ? 0 : -1} aria-pressed={index === activeIndex}
          aria-label={`Open scan ${index + 1} full screen`}
          onClick={event => {
            if (event.detail > 0 && carouselDraggedRef.current) {
              carouselDraggedRef.current = false;
              return;
            }
            activate(index, event.currentTarget);
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(index, event.currentTarget); }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              const nextIndex = Math.max(0, Math.min(images.length - 1, activeIndex + (event.key === 'ArrowRight' ? 1 : -1)));
              scrollToSlide(nextIndex);
              (carouselRef.current?.children[nextIndex] as HTMLElement | undefined)?.focus({ preventScroll: true });
            }
          }}>
          <ReaderScanImage imageUrl={image.imageUrl} alt={image.type === 'letter' ? `Page ${image.pageNumber ?? index + 1} of letter` : `${image.type.charAt(0).toUpperCase() + image.type.slice(1)}`}
            previewEnabled={readyScan === activeKey && allowImageSpeculation()}
            enabled={index === activeIndex || index === transitionFromIndex || (Math.abs(index - activeIndex) === 1 && readyScan === activeKey && allowImageSpeculation())}
            onReadyChange={ready => { if (index === activeIndex) setReadyScan(ready ? activeKey : null); }}
            fetchPriority={index === activeIndex ? 'high' : 'low'} className="scan-slide-img" imgClassName="scan-slide-img-inner"
            style={{ viewTransitionName: !viewerOpen && index === activeIndex ? 'reader-scan' : 'none' }}
            objectFit="contain" draggable={false} loading="eager" decoding="async" context="carousel"
            aspectRatio={image.width && image.height ? image.width / image.height : undefined} />
        </div>)}
      </div>
      <figcaption style={{ viewTransitionName: viewerOpen ? 'none' : 'reader-pages' }}><InlineScanNavigation images={images} selected={activeIndex} cornerRatios={cornerRatios}
        enabled={!viewerOpen} onSelect={index => scrollToSlide(index)} /></figcaption>
    </figure>
    {viewerOpen && initialized && createPortal(<ReaderFocusViewer viewerRef={viewerRef} opener={opener} images={images}
      letterId={letterId} selectedIndex={activeIndex} cornerRatios={cornerRatios} entryZoom={entryZoom}
      onPageChange={selectFullscreen} onClose={close} />, document.body)}
  </>;
});

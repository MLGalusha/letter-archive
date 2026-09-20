import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getAppScrollRootForIO } from '../../utils/appScroll';
import './PreviewImage.css';
import { recordImageLoad } from '../../utils/imagePerformance';
import { imagePreloadService } from '../../services/imagePreloadService';
import { useImageRetry } from '../../hooks/useImageRetry';

/** Small card previews need one display-sized image, not several competing tiers. */
export function PreviewImage({ src, alt, className, preloadMargin = '1200px 0px', context = 'archive-card', enabled = true }: {
  enabled?: boolean; src: string; alt: string; className?: string; preloadMargin?: string; context?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handoffRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(() => imagePreloadService.isPreloaded(src) || typeof IntersectionObserver === 'undefined');
  const { attempt, failed, onError, onLoad } = useImageRetry(src);
  const loadStartedAt = useRef(0);

  // The focus strip mounts new controls. Even a previously loaded URL can need
  // another decode/request, so retain the already-painted document thumbnail
  // until this instance loads. This tiny canvas lives only during the handoff.
  useLayoutEffect(() => {
    const canvas = handoffRef.current;
    const image = containerRef.current?.querySelector('img');
    if (canvas) { canvas.style.display = 'none'; delete canvas.dataset.ready; }
    if (!canvas || !image || !nearViewport || (image.complete && image.naturalWidth)) return;
    const source = Array.from(document.images).find(candidate => candidate !== image
      && candidate.src === image.src && candidate.complete && candidate.naturalWidth > 0);
    if (!source) return;
    const ratio = Math.min(1, 200 / Math.max(source.naturalWidth, source.naturalHeight));
    canvas.width = Math.max(1, Math.round(source.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    canvas.dataset.ready = 'true';
    canvas.style.display = 'block';
  }, [src, nearViewport, attempt]);

  useLayoutEffect(() => {
    if (nearViewport) loadStartedAt.current = performance.now();
  }, [nearViewport, src]);

  useEffect(() => {
    if (nearViewport || !enabled) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setNearViewport(true);
      observer.disconnect();
    }, { root: containerRef.current?.closest('[data-image-scroll-root]') ?? getAppScrollRootForIO(), rootMargin: preloadMargin });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [nearViewport, preloadMargin, enabled]);

  return (
    <div ref={containerRef} className={`preview-image ${className ?? ''}`}>
      <img
        key={`${src}:${attempt}`}
        className="preview-image__image"
        src={nearViewport ? src : undefined}
        alt={alt}
        loading="eager"
        decoding={imagePreloadService.isPreloaded(src) ? 'sync' : 'async'}
        draggable={false}
        onLoad={(event) => {
          if (handoffRef.current) {
            handoffRef.current.style.display = 'none';
            delete handoffRef.current.dataset.ready;
            handoffRef.current.width = 0;
            handoffRef.current.height = 0;
          }
          onLoad();
          imagePreloadService.recordLoaded(src, event.currentTarget);
          const timing = performance.getEntriesByName(src, 'resource').at(-1) as PerformanceResourceTiming | undefined;
          // Keep measuring after a long session fills the Resource Timing buffer.
          recordImageLoad({
            url: src,
            context,
            tier: 'full',
            durationMs: Math.max(0, performance.now() - loadStartedAt.current),
            cached: Boolean(timing && timing.transferSize === 0 && timing.decodedBodySize > 0),
          });
        }}
        onError={onError}
        style={failed ? { visibility: 'hidden' } : undefined}
      />
      {context === 'viewer-pages' && <canvas ref={handoffRef} aria-hidden className="preview-image__handoff"
        style={{ display: 'none', position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
      {failed && <span className="preview-image__error">Image unavailable</span>}
    </div>
  );
}

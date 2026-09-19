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
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === 'undefined');
  const { attempt, failed, onError, onLoad } = useImageRetry(src);
  const loadStartedAt = useRef(0);

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
        decoding="async"
        draggable={false}
        onLoad={(event) => {
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
      {failed && <span className="preview-image__error">Image unavailable</span>}
    </div>
  );
}

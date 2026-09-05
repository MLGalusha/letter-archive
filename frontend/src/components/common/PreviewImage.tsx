import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getAppScrollRootForIO } from '../../utils/appScroll';
import './PreviewImage.css';
import { recordImageLoad } from '../../utils/imagePerformance';

/** Small card previews need one display-sized image, not several competing tiers. */
export function PreviewImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === 'undefined');
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loadStartedAt = useRef(0);

  useLayoutEffect(() => {
    if (nearViewport) loadStartedAt.current = performance.now();
  }, [nearViewport, src]);

  useEffect(() => {
    if (nearViewport) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setNearViewport(true);
      observer.disconnect();
    }, { root: containerRef.current?.closest('[data-image-scroll-root]') ?? getAppScrollRootForIO(), rootMargin: '1200px 0px' });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [nearViewport]);

  return (
    <div ref={containerRef} className={`preview-image ${className ?? ''}`}>
      <img
        className="preview-image__image"
        src={nearViewport ? src : undefined}
        alt={alt}
        loading="eager"
        decoding="async"
        draggable={false}
        onLoad={() => {
          const timing = performance.getEntriesByName(src, 'resource').at(-1) as PerformanceResourceTiming | undefined;
          // Keep measuring after a long session fills the Resource Timing buffer.
          recordImageLoad({
            url: src,
            context: 'archive-card',
            tier: 'full',
            durationMs: Math.max(0, performance.now() - loadStartedAt.current),
            cached: Boolean(timing && timing.transferSize === 0 && timing.decodedBodySize > 0),
          });
        }}
        onError={() => setFailedSrc(src)}
        style={failedSrc === src ? { visibility: 'hidden' } : undefined}
      />
      {failedSrc === src && <span className="preview-image__error">Image unavailable</span>}
    </div>
  );
}

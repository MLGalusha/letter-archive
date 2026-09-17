import { forwardRef, useState, useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { useProgressiveImage } from '../../hooks/useProgressiveImage';
import { useImageRetry } from '../../hooks/useImageRetry';
import './ProgressiveImage.css';
import { getAppScrollRootForIO } from '../../utils/appScroll';

export interface ProgressiveImageProps {
  containerRef?: RefObject<HTMLDivElement | null>;
  src: string;
  thumbSrc: string;
  midSrc?: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  imgStyle?: CSSProperties;
  style?: CSSProperties;
  objectFit?: 'cover' | 'contain';
  loading?: 'eager' | 'lazy';
  decoding?: 'sync' | 'async';
  draggable?: boolean;
  fetchPriority?: 'high' | 'low' | 'auto';
  idleUpgrade?: boolean;
  deferFullUntilVisible?: boolean;
  context?: string;
  onLoad?: () => void;
  /** Known aspect ratio (width/height) from DB — used for placeholder sizing */
  aspectRatio?: number;
  /** Delay in ms before starting the full-quality load (gives priority images a head start) */
  fullDelay?: number;
}

export const ProgressiveImage = forwardRef<HTMLImageElement, ProgressiveImageProps>(
  function ProgressiveImage(
    {
      src,
      containerRef: externalContainerRef,
      thumbSrc,
      midSrc,
      alt,
      className,
      imgClassName,
      imgStyle,
      style,
      objectFit = 'cover',
      loading,
      decoding,
      draggable,
      fetchPriority,
      idleUpgrade,
      deferFullUntilVisible,
      context,
      onLoad,
      aspectRatio: knownAspectRatio,
      fullDelay,
    },
    ref,
  ) {
    const internalContainerRef = useRef<HTMLDivElement>(null);
    const containerRef = externalContainerRef ?? internalContainerRef;
    const [hasBeenVisible, setHasBeenVisible] = useState(() => typeof IntersectionObserver === 'undefined');
    const needsVisibility = loading === 'lazy' || deferFullUntilVisible;
    const enabled = !needsVisibility || hasBeenVisible;

    useEffect(() => {
      if (enabled) return;
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasBeenVisible(true);
          observer.disconnect();
        }
      }, { root: containerRef.current?.closest('[data-image-scroll-root]') ?? getAppScrollRootForIO(), rootMargin: '200px' });
      if (containerRef.current) observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, [enabled, containerRef]);

    const { thumbLoaded, midLoaded, fullLoaded, fullFailed, currentSrc, naturalWidth, naturalHeight } = useProgressiveImage({
      thumbSrc,
      midSrc,
      fullSrc: src,
      idleUpgrade,
      enabled,
      context,
      fullDelay,
      fetchPriority,
    });

    const [imgError, setImgError] = useState(false);


    useEffect(() => {
      setImgError(false);
    }, [src, currentSrc, fullLoaded]);

    // Best non-full source for the placeholder layer
    const showPlaceholder = !fullLoaded;
    const placeholderSrc = midLoaded && midSrc ? midSrc : thumbLoaded ? thumbSrc : '';
    const isThumbOnly = !midLoaded || !midSrc;
    const displayedRetry = useImageRetry(fullLoaded ? src : placeholderSrc || src);
    const mainOwnsDisplay = fullLoaded || !placeholderSrc;
    const handleVisibleError = () => {
      setImgError(true);
      // Before any tier is loaded, the background loader alone owns retries.
      if (fullLoaded || placeholderSrc) displayedRetry.onError();
    };
    const handleVisibleLoad = () => { setImgError(false); displayedRetry.onLoad(); };

    // Reserve scan space even when legacy records lack dimensions and loading is deferred.
    const resolvedAspectRatio = knownAspectRatio
      ?? (naturalWidth && naturalHeight ? naturalWidth / naturalHeight : 3 / 4);

    // Fire onLoad when best quality is ready
    useEffect(() => {
      if (fullLoaded) onLoad?.();
    }, [fullLoaded, src, onLoad]);

    const containerStyle: CSSProperties = {
      ...style,
      ...(resolvedAspectRatio && !fullLoaded ? { aspectRatio: resolvedAspectRatio } : {}),
    };

    return (
      <div ref={containerRef} className={`progressive-image ${className ?? ''}`} style={containerStyle}>
        {showPlaceholder && placeholderSrc && (
          <img
            key={`placeholder:${placeholderSrc}:${displayedRetry.attempt}`}
            src={placeholderSrc}
            onError={handleVisibleError}
            onLoad={handleVisibleLoad}
            alt=""
            className={`progressive-image__thumb ${imgClassName ?? ''}`}
            style={{
              ...imgStyle,
              objectFit,
              filter: isThumbOnly ? 'blur(20px)' : undefined,
              transform: isThumbOnly ? 'scale(1.05)' : undefined,
            }}
            draggable={false}
            aria-hidden
          />
        )}
        {/* Only render a full URL after its loader admits and completes it. */}
        <img
          key={`main:${currentSrc}:${displayedRetry.attempt}`}
          ref={ref}
          src={enabled && fullLoaded ? currentSrc : undefined}
          alt={alt}
          className={`progressive-image__full ${imgClassName ?? ''} ${fullLoaded ? '' : 'progressive-image__full--loading'}`}
          style={{ ...imgStyle, objectFit, ...(imgError ? { visibility: 'hidden' as const } : {}) }}
          loading={loading}
          decoding={decoding}
          draggable={draggable}
          fetchPriority={fetchPriority}
          // A hidden main layer must not cancel recovery of the visible placeholder.
          onError={() => { if (mainOwnsDisplay) handleVisibleError(); }}
          onLoad={() => { if (mainOwnsDisplay) handleVisibleLoad(); }}
        />
        {(imgError || (fullFailed && !placeholderSrc)) && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(160deg, rgba(250,245,237,0.98), rgba(227,216,201,0.88))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(109,95,81,0.6)', fontSize: '0.8rem',
          }}>
            Image unavailable
          </div>
        )}
      </div>
    );
  },
);

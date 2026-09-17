import { forwardRef, useState, useEffect, useLayoutEffect, useCallback, useRef, type CSSProperties, type RefObject } from 'react';
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

    const { thumbLoaded, midLoaded, fullLoaded, fullFailed, fullAdmitted, onFullLoad, onFullError, naturalWidth, naturalHeight } = useProgressiveImage({
      thumbSrc,
      midSrc,
      fullSrc: src,
      idleUpgrade,
      enabled,
      context,
      fullDelay,
      fetchPriority,
      fullLoadMode: 'dom',
    });

    // The preview and full DOM image have independent recovery budgets. A
    // pending/full failure must not hide a useful preview or cancel its retry.
    const showPlaceholder = !fullLoaded;
    const placeholderSrc = midLoaded && midSrc ? midSrc : thumbLoaded ? thumbSrc : '';
    const isThumbOnly = !midLoaded || !midSrc;
    const placeholderRetry = useImageRetry(placeholderSrc);
    const fullRetry = useImageRetry(src);
    const mainRef = useRef<HTMLImageElement>(null);
    const attachMain = useCallback((image: HTMLImageElement | null) => {
      mainRef.current = image;
      if (typeof ref === 'function') return ref(image);
      if (ref) ref.current = image;
    }, [ref]);
    useLayoutEffect(() => {
      const image = mainRef.current;
      return () => {
        // Release this DOM owner's pending request without touching another
        // consumer of the URL. Cancellation remains browser-dependent.
        if (image && !image.complete) image.removeAttribute('src');
      };
    }, [src, fullRetry.attempt]);
    useLayoutEffect(() => {
      const image = mainRef.current;
      // A retained/cached DOM node may already have fired load. Its own complete
      // state is authoritative; background readiness never substitutes for it.
      if (fullAdmitted && !fullLoaded && !fullRetry.failed && image?.complete && image.naturalWidth > 0) {
        onFullLoad(image);
      }
    }, [fullAdmitted, fullLoaded, fullRetry.failed, onFullLoad]);
    const unavailable = fullRetry.failed
      ? !placeholderSrc || placeholderRetry.failed
      : !fullLoaded && (placeholderSrc ? placeholderRetry.failed : fullFailed);

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
            key={`placeholder:${placeholderSrc}:${placeholderRetry.attempt}`}
            src={placeholderSrc}
            onError={placeholderRetry.onError}
            onLoad={placeholderRetry.onLoad}
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
        {/* Admission starts the only full request; its DOM load owns readiness. */}
        <img
          key={`main:${src}:${fullRetry.attempt}`}
          ref={attachMain}
          src={enabled && fullAdmitted ? src : undefined}
          alt={alt}
          className={`progressive-image__full ${imgClassName ?? ''} ${fullLoaded ? '' : 'progressive-image__full--loading'}`}
          style={{ ...imgStyle, objectFit, ...(fullRetry.failed ? { visibility: 'hidden' as const } : {}) }}
          loading={loading}
          decoding={decoding}
          draggable={draggable}
          fetchPriority={fetchPriority}
          onError={() => { onFullError(); fullRetry.onError(); }}
          onLoad={(event) => { fullRetry.onLoad(); onFullLoad(event.currentTarget); }}
        />
        {unavailable && (
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

import { forwardRef, useState, useEffect, type CSSProperties } from 'react';
import { useProgressiveImage } from '../../hooks/useProgressiveImage';
import './ProgressiveImage.css';

export interface ProgressiveImageProps {
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
    const { thumbLoaded, midLoaded, fullLoaded, currentSrc, naturalWidth, naturalHeight } = useProgressiveImage({
      thumbSrc,
      midSrc,
      fullSrc: src,
      idleUpgrade,
      deferFullUntilVisible,
      context,
      fullDelay,
    });

    const [imgError, setImgError] = useState(false);

    useEffect(() => {
      setImgError(false);
    }, [src]);

    // Best non-full source for the placeholder layer
    const showPlaceholder = !fullLoaded;
    const placeholderSrc = midLoaded && midSrc ? midSrc : thumbLoaded ? thumbSrc : '';
    const isThumbOnly = !midLoaded || !midSrc;

    // Aspect ratio: prefer DB value, fall back to natural dims from thumb
    const resolvedAspectRatio = knownAspectRatio
      ?? (naturalWidth && naturalHeight ? naturalWidth / naturalHeight : undefined);

    // Fire onLoad when best quality is ready
    if (fullLoaded && onLoad) onLoad();

    const containerStyle: CSSProperties = {
      ...style,
      ...(resolvedAspectRatio && !fullLoaded ? { aspectRatio: resolvedAspectRatio } : {}),
    };

    return (
      <div className={`progressive-image ${className ?? ''}`} style={containerStyle}>
        {showPlaceholder && placeholderSrc && (
          <img
            src={placeholderSrc}
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
        <img
          ref={ref}
          src={currentSrc || src}
          alt={alt}
          className={`progressive-image__full ${imgClassName ?? ''} ${fullLoaded ? '' : 'progressive-image__full--loading'}`}
          style={{ ...imgStyle, objectFit, ...(imgError ? { visibility: 'hidden' as const } : {}) }}
          loading={loading}
          decoding={decoding}
          draggable={draggable}
          fetchPriority={fetchPriority}
          onError={() => setImgError(true)}
        />
        {imgError && (
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

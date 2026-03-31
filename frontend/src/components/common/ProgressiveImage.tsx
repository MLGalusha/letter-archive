import { forwardRef, type CSSProperties } from 'react';
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
  context?: string;
  onLoad?: () => void;
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
      context,
      onLoad,
    },
    ref,
  ) {
    const { thumbLoaded, midLoaded, fullLoaded, currentSrc } = useProgressiveImage({
      thumbSrc,
      midSrc,
      fullSrc: src,
      idleUpgrade,
      context,
    });

    // Best non-full source for the placeholder layer
    const showPlaceholder = !fullLoaded;
    const placeholderSrc = midLoaded && midSrc ? midSrc : thumbLoaded ? thumbSrc : '';
    const isThumbOnly = !midLoaded || !midSrc;

    // Fire onLoad when best quality is ready
    if (fullLoaded && onLoad) onLoad();

    return (
      <div className={`progressive-image ${className ?? ''}`} style={style}>
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
          style={{ ...imgStyle, objectFit }}
          loading={loading}
          decoding={decoding}
          draggable={draggable}
          fetchPriority={fetchPriority}
        />
      </div>
    );
  },
);

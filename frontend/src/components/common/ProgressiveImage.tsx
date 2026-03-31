import { forwardRef, type CSSProperties } from 'react';
import { useProgressiveImage } from '../../hooks/useProgressiveImage';
import './ProgressiveImage.css';

export interface ProgressiveImageProps {
  src: string;
  thumbSrc: string;
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
}

export const ProgressiveImage = forwardRef<HTMLImageElement, ProgressiveImageProps>(
  function ProgressiveImage(
    {
      src,
      thumbSrc,
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
    },
    ref,
  ) {
    const { fullLoaded } = useProgressiveImage(thumbSrc, src);

    return (
      <div className={`progressive-image ${className ?? ''}`} style={style}>
        {!fullLoaded && (
          <img
            src={thumbSrc}
            alt=""
            className={`progressive-image__thumb ${imgClassName ?? ''}`}
            style={{ ...imgStyle, objectFit }}
            draggable={false}
            aria-hidden
          />
        )}
        <img
          ref={ref}
          src={src}
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

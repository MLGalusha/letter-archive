import { forwardRef, type ImgHTMLAttributes } from 'react';
import { useImageRetry } from '../../hooks/useImageRetry';

type Props = ImgHTMLAttributes<HTMLImageElement> & { src: string };

/** Preserve a plain img's layout while recovering brief transform overloads. */
export const RetryingImage = forwardRef<HTMLImageElement, Props>(
  function RetryingImage({ src, style, onError, onLoad, ...props }, ref) {
    const retry = useImageRetry(src);
    return <img
      {...props}
      key={`${src}:${retry.attempt}`}
      ref={ref}
      src={src}
      style={{ ...style, ...(retry.failed ? { visibility: 'hidden' } : {}) }}
      onError={(event) => { retry.onError(); onError?.(event); }}
      onLoad={(event) => { retry.onLoad(); onLoad?.(event); }}
    />;
  },
);

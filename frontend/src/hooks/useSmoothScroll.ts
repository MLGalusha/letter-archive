import { useCallback, useEffect, useRef } from 'react';
import { smoothScrollToY, type SmoothScrollOptions } from '../utils/smoothScrollTo';

/** Cancels only this caller's animation on unmount; callers own target/focus policy. */
export default function useSmoothScroll() {
  const cancelRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelRef.current?.(), []);
  return useCallback((destination: number, options?: SmoothScrollOptions) => {
    cancelRef.current?.();
    cancelRef.current = smoothScrollToY(destination, options);
  }, []);
}

import { useLayoutEffect, useState, type RefObject } from 'react';

/** Pixel width needed by the unzoomed scan, including the display's pixel density. */
export function useScanDisplayWidth(
  ref: RefObject<HTMLElement | null>,
  aspectRatio?: number,
  fitHeight = false,
  measureParent = false,
) {
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const element = measureParent ? ref.current?.parentElement : ref.current;
    if (!element) return;
    const measure = () => {
      let cssWidth = element.clientWidth;
      if (fitHeight && aspectRatio && element.clientHeight > 0) {
        cssWidth = Math.min(cssWidth, element.clientHeight * aspectRatio);
      }
      if (cssWidth > 0) setWidth(cssWidth * (window.devicePixelRatio || 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, aspectRatio, fitHeight, measureParent]);
  return width;
}

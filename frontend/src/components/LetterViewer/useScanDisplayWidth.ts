import { useLayoutEffect, useState, type RefObject } from 'react';

/** Pixel width needed by the unzoomed scan, including the display's pixel density. */
export function useScanDisplayWidth(
  ref: RefObject<HTMLElement | null>,
  aspectRatio?: number,
  fitHeight = false,
  measureParent = false,
) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = measureParent ? ref.current?.parentElement : ref.current;
    if (!element) return;
    const measure = () => {
      // A contained preview can be narrower than its carousel slide. Its own
      // reserved box is measurable before the network request starts.
      let cssWidth = measureParent
        ? Math.min(element.clientWidth, ref.current?.clientWidth ?? element.clientWidth)
        : element.clientWidth;
      if (fitHeight && aspectRatio && element.clientHeight > 0) {
        cssWidth = Math.min(cssWidth, element.clientHeight * aspectRatio);
      }
      if (cssWidth > 0) setWidth(cssWidth * (window.devicePixelRatio || 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (measureParent && ref.current) observer.observe(ref.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, aspectRatio, fitHeight, measureParent]);
  return width;
}

import { useCallback, useEffect, useState, type RefObject } from 'react';

/** Only a pinch begun on the inline scan needs a bridge across the portal mount.
 * Pinches begun in fullscreen are handled by the zoom surface itself. */
export function useScanFocusEntry(open: (index: number, opener: HTMLElement) => void,
  carouselRef: RefObject<HTMLDivElement | null>, viewerRef: RefObject<HTMLDivElement | null>) {
  const [entryZoom, setEntryZoom] = useState(1);
  const resetEntryZoom = useCallback(() => setEntryZoom(1), []);
  useEffect(() => {
    let pinch: { distance: number; zoom: number; opener: HTMLElement; opened: boolean;
      midpoint: { x: number; y: number } } | null = null;
    const scan = (target: EventTarget | null) => target instanceof Element && carouselRef.current?.contains(target)
      ? target.closest<HTMLElement>('.scan-slide') : null;
    const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const midpoint = (touches: TouchList) => ({ x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 });
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY >= 0 || viewerRef.current) return;
      const opener = scan(event.target);
      if (!opener) return;
      event.preventDefault(); event.stopPropagation();
      setEntryZoom(Math.pow(1.01, -event.deltaY));
      open(Number(opener.dataset.scanIndex), opener);
    };
    const key = (event: KeyboardEvent) => {
      if ((event.key !== '+' && event.key !== '=') || event.ctrlKey || event.metaKey || event.altKey || viewerRef.current) return;
      const opener = scan(event.target);
      if (!opener) return;
      event.preventDefault(); event.stopPropagation();
      setEntryZoom(1.4); open(Number(opener.dataset.scanIndex), opener);
    };
    const start = (event: TouchEvent) => {
      if (pinch && event.touches.length === 2) {
        pinch.distance = distance(event.touches) / pinch.zoom;
        pinch.midpoint = midpoint(event.touches);
        event.preventDefault(); event.stopPropagation();
        return;
      }
      if (event.touches.length !== 2 || viewerRef.current) return;
      const opener = scan(event.target);
      if (!opener || !distance(event.touches)) return;
      pinch = { distance: distance(event.touches), zoom: 1, opener, opened: false, midpoint: midpoint(event.touches) };
      event.preventDefault(); event.stopPropagation();
    };
    const move = (event: TouchEvent) => {
      if (!pinch) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.touches.length) return;
      const zoom = event.touches.length === 2 ? Math.max(1, distance(event.touches) / pinch.distance) : pinch.zoom;
      const center = event.touches.length === 2 ? midpoint(event.touches)
        : { x: event.touches[0].clientX, y: event.touches[0].clientY };
      pinch.zoom = zoom;
      const surface = viewerRef.current?.querySelector('.viewer-container');
      if (surface) surface.dispatchEvent(new CustomEvent('reader-focus-pinch', {
        detail: { scale: zoom, midpoint: center, previousMidpoint: pinch.midpoint },
      }));
      else if (zoom > 1) {
        setEntryZoom(zoom);
        if (!pinch.opened) { pinch.opened = true; open(Number(pinch.opener.dataset.scanIndex), pinch.opener); }
      }
      pinch.midpoint = center;
    };
    const end = (event: TouchEvent) => {
      if (!pinch) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.touches.length || event.type === 'touchcancel') {
        viewerRef.current?.querySelector('.viewer-container')?.dispatchEvent(new CustomEvent('reader-focus-pinch-end'));
        pinch = null;
      } else if (event.touches.length === 1) {
        pinch.midpoint = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }
    };
    const options = { capture: true, passive: false };
    document.addEventListener('wheel', wheel, options);
    document.addEventListener('keydown', key, options);
    document.addEventListener('touchstart', start, options);
    document.addEventListener('touchmove', move, options);
    document.addEventListener('touchend', end, options);
    document.addEventListener('touchcancel', end, options);
    return () => {
      document.removeEventListener('wheel', wheel, options); document.removeEventListener('keydown', key, options);
      document.removeEventListener('touchstart', start, options); document.removeEventListener('touchmove', move, options);
      document.removeEventListener('touchend', end, options); document.removeEventListener('touchcancel', end, options);
    };
  }, [open, carouselRef, viewerRef]);
  return { entryZoom, resetEntryZoom };
}

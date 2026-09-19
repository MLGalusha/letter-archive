import { useEffect, useState } from 'react';

/** Keep ownership of a pinch that started on the document, even after its
 * original touch target becomes inert behind the focus viewer. */
export function useScanFocusEntry(open: (index: number, opener: HTMLElement) => void, owner: string | undefined) {
  const [entryZoom, setEntryZoom] = useState(1);
  useEffect(() => {
    let pinch: { distance: number; opener: HTMLElement; index: number; opened: boolean } | null = null;
    const scan = (target: EventTarget | null) => target instanceof Element
      ? target.closest<HTMLElement>('.scan-slide') : null;
    const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY >= 0 || document.querySelector('.reader-focus-backdrop')) return;
      const opener = scan(event.target);
      if (!opener) return;
      event.preventDefault();
      event.stopPropagation();
      setEntryZoom(Math.pow(1.01, -event.deltaY));
      open(Number(opener.dataset.scanIndex), opener);
    };
    const key = (event: KeyboardEvent) => {
      if ((event.key !== '+' && event.key !== '=') || event.ctrlKey || event.metaKey || event.altKey
        || document.querySelector('.reader-focus-backdrop')) return;
      const opener = scan(event.target);
      if (!opener) return;
      event.preventDefault();
      event.stopPropagation();
      setEntryZoom(1.4);
      open(Number(opener.dataset.scanIndex), opener);
    };
    const start = (event: TouchEvent) => {
      if (pinch || event.touches.length !== 2 || document.querySelector('.reader-focus-backdrop')) return;
      const opener = scan(event.target);
      if (!opener || distance(event.touches) === 0) return;
      pinch = { distance: distance(event.touches), opener, index: Number(opener.dataset.scanIndex), opened: false };
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (event: TouchEvent) => {
      if (!pinch) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.touches.length !== 2) return;
      const zoom = distance(event.touches) / pinch.distance;
      if (!pinch.opened && zoom <= 1.015) return;
      setEntryZoom(Math.max(1, zoom));
      if (!pinch.opened) {
        pinch.opened = true;
        open(pinch.index, pinch.opener);
      }
    };
    const end = (event: TouchEvent) => {
      if (!pinch) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.touches.length || event.type === 'touchcancel') pinch = null;
    };
    const options = { capture: true, passive: false };
    document.addEventListener('wheel', wheel, options);
    document.addEventListener('keydown', key, options);
    document.addEventListener('touchstart', start, options);
    document.addEventListener('touchmove', move, options);
    document.addEventListener('touchend', end, options);
    document.addEventListener('touchcancel', end, options);
    return () => {
      document.removeEventListener('wheel', wheel, options);
      document.removeEventListener('keydown', key, options);
      document.removeEventListener('touchstart', start, options);
      document.removeEventListener('touchmove', move, options);
      document.removeEventListener('touchend', end, options);
      document.removeEventListener('touchcancel', end, options);
    };
  }, [open, owner]);
  return { entryZoom };
}

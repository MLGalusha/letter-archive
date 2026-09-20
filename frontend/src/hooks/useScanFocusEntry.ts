import { useEffect, useState } from 'react';

/** Keep ownership of a pinch that started on the document, even after its
 * original touch target becomes inert behind the focus viewer. */
export function useScanFocusEntry(open: (index: number, opener: HTMLElement) => void, owner: string | undefined) {
  const [entryZoom, setEntryZoom] = useState(1);
  const [directZoom, setDirectZoom] = useState(false);
  useEffect(() => {
    let pinch: { distance: number; initialZoom: number; opener: HTMLElement; index: number; opened: boolean;
      midpoint: { x: number; y: number } } | null = null;
    const scan = (target: EventTarget | null) => target instanceof Element
      ? target.closest<HTMLElement>('.scan-slide') : null;
    const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const midpoint = (touches: TouchList) => ({ x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2 });
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY >= 0 || document.querySelector('.reader-focus-backdrop')) return;
      const opener = scan(event.target);
      if (!opener) return;
      event.preventDefault();
      event.stopPropagation();
      setDirectZoom(true);
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
      setDirectZoom(false);
      setEntryZoom(1.4);
      open(Number(opener.dataset.scanIndex), opener);
    };
    const start = (event: TouchEvent) => {
      if (pinch || event.touches.length !== 2) return;
      const viewer = document.querySelector<HTMLElement>('.reader-focus-backdrop[data-direct-zoom="true"] .letter-viewer');
      const inViewer = viewer?.contains(event.target as Node);
      if (document.querySelector('.reader-focus-backdrop') && !inViewer) return;
      const opener = inViewer ? document.querySelector<HTMLElement>('.scan-slide[aria-pressed="true"]') : scan(event.target);
      if (!opener || distance(event.touches) === 0) return;
      pinch = { distance: distance(event.touches), initialZoom: inViewer ? Number(viewer!.dataset.zoom) : 1,
        opener, index: Number(opener.dataset.scanIndex), opened: Boolean(inViewer), midpoint: midpoint(event.touches) };
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (event: TouchEvent) => {
      if (!pinch) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.touches.length !== 2) return;
      const zoom = pinch.initialZoom * distance(event.touches) / pinch.distance;
      const center = midpoint(event.touches);
      const viewer = document.querySelector('.reader-focus-backdrop[data-direct-zoom="true"] .viewer-container');
      if (pinch.opened && viewer) viewer.dispatchEvent(new CustomEvent('reader-focus-pinch', {
        detail: { scale: zoom, midpoint: center, previousMidpoint: pinch.midpoint },
      }));
      pinch.midpoint = center;
      if (zoom <= 1) {
        if (pinch.opened && !viewer) setEntryZoom(zoom);
        // Keep the native touch target mounted until both fingers lift.
        // Detaching it here would stop the rest of this same pinch reaching us.
        if (!viewer) pinch.opened = false;
        // There is no zoom below the document size and no accumulated dead zone.
        pinch.distance = distance(event.touches); pinch.initialZoom = 1;
        return;
      }
      setDirectZoom(true);
      if (!viewer) setEntryZoom(zoom);
      if (!pinch.opened) {
        pinch.opened = true;
        open(pinch.index, pinch.opener);
      }
    };
    const end = (event: TouchEvent) => {
      if (!pinch) return;
      event.preventDefault();
      event.stopPropagation();
      document.querySelector('.reader-focus .viewer-container')?.dispatchEvent(new CustomEvent('reader-focus-pinch-end', {
        detail: { finished: !event.touches.length || event.type === 'touchcancel' },
      }));
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
  return { entryZoom, directZoom };
}

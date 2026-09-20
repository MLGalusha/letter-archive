import { useLayoutEffect, useState, type RefObject } from 'react';
import type { LetterImage } from '../types/Letter';

/** Normalize each regular scan's corner against its rendered width, so every
 * smaller/larger representation keeps the same curve instead of a fixed radius. */
export function useScanCornerRatios(carousel: RefObject<HTMLDivElement | null>, images: LetterImage[] | undefined) {
  const [ratios, setRatios] = useState<number[]>([]);
  useLayoutEffect(() => {
    const root = carousel.current;
    if (!root) return;
    const scans = [...root.querySelectorAll<HTMLElement>('.scan-slide-img')];
    const measure = () => {
      const next = scans.map(scan => {
        const width = scan.getBoundingClientRect().width;
        return width > 0 ? parseFloat(getComputedStyle(scan).borderTopLeftRadius) / width : .01;
      });
      setRatios(previous => next.length === previous.length && next.every((value, index) => Math.abs(value - previous[index]) < .000001) ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    scans.forEach(scan => observer?.observe(scan));
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [carousel, images]);
  return ratios;
}

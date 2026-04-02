import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import type { RefObject } from 'react';
import { measurePerf } from '../utils/textMeasurePerf.js';

interface PretextFontSizeOptions {
  baseFontSize?: number;   // in rem, default 1.1
  minScale?: number;       // minimum scale factor, default 0.4
  fontFamily?: string;     // override font family (otherwise read from DOM)
}

const REM_PX = 16; // 1rem = 16px base

/**
 * Calculates dynamic font size using Pretext for cached text measurement.
 *
 * prepare() runs once when text changes (measures & caches segment widths).
 * On resize, only a cached maxWidth vs containerWidth comparison runs — no re-measurement.
 */
export function usePretextFontSize(
  containerRef: RefObject<HTMLElement | null>,
  text: string,
  options: PretextFontSizeOptions = {},
): string {
  const {
    baseFontSize = 1.1,
    minScale = 0.4,
    fontFamily: fontFamilyOverride,
  } = options;

  const [fontSize, setFontSize] = useState(`${baseFontSize}rem`);
  const maxWidthRef = useRef(0);

  // Resolve font family from the DOM or override
  const resolvedFontFamily = useRef('');

  const resolveFontFamily = useCallback(() => {
    if (fontFamilyOverride) return fontFamilyOverride;
    const el = containerRef.current;
    if (!el) return "'Courier New', Courier, monospace";
    // Try to read from a .transcript-text child, fall back to container
    const textEl = el.querySelector('.transcript-text');
    const target = textEl || el;
    return window.getComputedStyle(target).fontFamily || "'Courier New', Courier, monospace";
  }, [containerRef, fontFamilyOverride]);

  // Prepare text and compute max natural line width (runs when text changes)
  useMemo(() => {
    if (!text) {
      maxWidthRef.current = 0;
      return;
    }

    const family = resolveFontFamily();
    resolvedFontFamily.current = family;
    const basePx = baseFontSize * REM_PX;
    const fontString = `${basePx}px ${family}`;

    measurePerf('prepare', () => {
      const prepared = prepareWithSegments(text, fontString, { whiteSpace: 'pre-wrap' });
      // Use a huge maxWidth so no wrapping occurs — get natural line widths
      const result = layoutWithLines(prepared, 1e6, basePx);
      let maxW = 0;
      for (const line of result.lines) {
        if (line.width > maxW) maxW = line.width;
      }
      maxWidthRef.current = maxW;
    }, 'usePretextFontSize');
  }, [text, baseFontSize, resolveFontFamily]);

  // Compute font size from cached maxWidth and current container width
  const computeScale = useCallback(() => {
    measurePerf('resize', () => {
      const el = containerRef.current;
      if (!el || !text) {
        setFontSize(`${baseFontSize}rem`);
        return;
      }

      const computedStyle = window.getComputedStyle(el);
      const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
      const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
      const containerWidth = el.clientWidth - paddingLeft - paddingRight;

      const maxWidth = maxWidthRef.current;
      if (maxWidth > containerWidth && maxWidth > 0) {
        const scale = Math.max(minScale, containerWidth / maxWidth);
        setFontSize(`${baseFontSize * scale}rem`);
      } else {
        setFontSize(`${baseFontSize}rem`);
      }
    }, 'usePretextFontSize');
  }, [containerRef, text, baseFontSize, minScale]);

  // Observe container resizes
  useEffect(() => {
    computeScale();

    const el = containerRef.current;
    const parent = el?.parentElement;

    if (el || parent) {
      const observer = new ResizeObserver(() => computeScale());
      if (el) observer.observe(el);
      if (parent) observer.observe(parent);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', computeScale);
    return () => window.removeEventListener('resize', computeScale);
  }, [computeScale, containerRef]);

  return fontSize;
}

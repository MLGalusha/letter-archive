import type { LineSegment } from '../types/Letter';

export interface AlignedLine {
  visualLineIndex: number;
  transcriptText: string;
  bbox: [number, number, number, number];
  baseline: number[][];
}

/**
 * Aligns transcript lines to Kraken visual line segments in order.
 * Transcript lines are never reordered — they stay exactly as the AI output them.
 * If counts differ, lines are distributed proportionally across positions.
 */
export function alignTranscriptToVisualLines(
  pageText: string,
  lineSegments: LineSegment[],
): AlignedLine[] {
  const transcriptLines = pageText.split('\n').filter(l => l.trim().length > 0);
  const segCount = lineSegments.length;

  if (segCount === 0) return [];
  if (transcriptLines.length === 0) {
    return lineSegments.map((seg, i) => ({
      visualLineIndex: i,
      transcriptText: '',
      bbox: seg.bbox,
      baseline: seg.baseline,
    }));
  }

  // 1:1 — assign in order
  if (transcriptLines.length === segCount) {
    return lineSegments.map((seg, i) => ({
      visualLineIndex: i,
      transcriptText: transcriptLines[i],
      bbox: seg.bbox,
      baseline: seg.baseline,
    }));
  }

  // More segments than transcript lines — assign each transcript line to the
  // proportionally closest segment, leaving extra segments empty
  if (segCount > transcriptLines.length) {
    return lineSegments.map((seg, i) => {
      const tIdx = Math.round((i / segCount) * transcriptLines.length);
      // Only assign if this is the closest segment for that transcript line
      const closestSeg = Math.round((tIdx / transcriptLines.length) * segCount);
      return {
        visualLineIndex: i,
        transcriptText: closestSeg === i && tIdx < transcriptLines.length ? transcriptLines[tIdx] : '',
        bbox: seg.bbox,
        baseline: seg.baseline,
      };
    });
  }

  // Fewer segments than transcript lines — evenly subdivide each segment
  const result: AlignedLine[] = [];
  let tIdx = 0;
  for (let s = 0; s < segCount; s++) {
    const seg = lineSegments[s];
    const tStart = tIdx;
    const tEnd = s < segCount - 1
      ? Math.round(((s + 1) / segCount) * transcriptLines.length)
      : transcriptLines.length;
    const subCount = tEnd - tStart;
    const subHeight = (seg.bbox[3] - seg.bbox[1]) / subCount;
    for (let sub = 0; sub < subCount; sub++) {
      const sy1 = Math.round(seg.bbox[1] + sub * subHeight);
      const sy2 = Math.round(seg.bbox[1] + (sub + 1) * subHeight);
      result.push({
        visualLineIndex: result.length,
        transcriptText: transcriptLines[tStart + sub],
        bbox: [seg.bbox[0], sy1, seg.bbox[2], sy2],
        baseline: [
          [seg.bbox[0], sy2 - Math.round(subHeight * 0.2)],
          [seg.bbox[2], sy2 - Math.round(subHeight * 0.2)],
        ],
      });
    }
    tIdx = tEnd;
  }
  return result;
}

/**
 * Detected line boundary from pixel analysis.
 */
export interface DetectedLine {
  y1: number;
  y2: number;
  x1: number;
  x2: number;
}

/**
 * Analyzes an image element's pixel data to detect the overall text bounding box.
 * Uses horizontal projection profile (sum of dark pixels per row) to find the
 * top/bottom extent of text, plus leftmost/rightmost dark pixel columns.
 *
 * Returns a single DetectedLine representing the entire text region.
 * The caller divides this region evenly by transcript line count.
 *
 * Works on a downsampled version for performance.
 */
export function detectImageLines(img: HTMLImageElement): DetectedLine[] {
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  if (naturalW === 0 || naturalH === 0) return [];

  // Downsample to max 800px wide for speed
  const scale = Math.min(1, 800 / naturalW);
  const w = Math.round(naturalW * scale);
  const h = Math.round(naturalH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  ctx.drawImage(img, 0, 0, w, h);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    // SecurityError from tainted canvas (cross-origin image without CORS headers)
    return [];
  }
  const data = imageData.data;

  // Compute horizontal projection: count dark pixels per row
  const darkThreshold = 140;
  const rowDarkCount = new Uint32Array(h);

  for (let y = 0; y < h; y++) {
    let count = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum < darkThreshold) count++;
    }
    rowDarkCount[y] = count;
  }

  // Determine threshold for "text rows" using adaptive median-based approach
  const nonzero = Array.from(rowDarkCount).filter(c => c > 0).sort((a, b) => a - b);
  const medianDark = nonzero.length > 0 ? nonzero[Math.floor(nonzero.length / 2)] : 0;
  const minTextPixels = Math.max(w * 0.005, medianDark * 0.15);

  // Find the overall text region: first and last rows with enough dark pixels
  let topY = -1;
  let bottomY = -1;
  for (let y = 0; y < h; y++) {
    if (rowDarkCount[y] >= minTextPixels) {
      if (topY === -1) topY = y;
      bottomY = y;
    }
  }

  if (topY === -1) return [];

  // Find leftmost and rightmost dark pixels across the entire text region
  let xMin = w;
  let xMax = 0;
  for (let y = topY; y <= bottomY; y++) {
    if (rowDarkCount[y] < minTextPixels) continue;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum < darkThreshold) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
      }
    }
  }

  // Return a single bounding box for the entire text region
  return [{
    y1: Math.round(topY / scale),
    y2: Math.round((bottomY + 1) / scale),
    x1: Math.round(Math.max(0, xMin) / scale),
    x2: Math.round(Math.min(w, xMax + 1) / scale),
  }];
}

/**
 * Builds AlignedLine[] by dividing the detected text region evenly among transcript lines.
 * detectImageLines returns a single bounding box for the entire text region;
 * this function splits that region into uniform line slots.
 */
export function buildAlignedLinesFromDetected(
  transcriptLines: string[],
  detected: DetectedLine[],
): AlignedLine[] {
  if (transcriptLines.length === 0 || detected.length === 0) return [];

  // Compute overall bounding box from all detected regions
  const y1 = Math.min(...detected.map(d => d.y1));
  const y2 = Math.max(...detected.map(d => d.y2));
  const x1 = Math.min(...detected.map(d => d.x1));
  const x2 = Math.max(...detected.map(d => d.x2));

  const tCount = transcriptLines.length;
  const lineHeight = (y2 - y1) / tCount;

  return transcriptLines.map((text, i) => {
    const ly1 = Math.round(y1 + i * lineHeight);
    const ly2 = Math.round(y1 + (i + 1) * lineHeight);
    return {
      visualLineIndex: i,
      transcriptText: text,
      bbox: [x1, ly1, x2, ly2] as [number, number, number, number],
      baseline: [
        [x1, ly2 - Math.round(lineHeight * 0.2)],
        [x2, ly2 - Math.round(lineHeight * 0.2)],
      ],
    };
  });
}

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
 * Smooths an array using a moving average window.
 */
function smooth(arr: Uint32Array, windowSize: number): Float64Array {
  const result = new Float64Array(arr.length);
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j];
      count++;
    }
    result[i] = sum / count;
  }
  return result;
}

/**
 * Analyzes an image element's pixel data to detect individual text lines
 * using valley detection in the horizontal projection profile.
 *
 * Algorithm:
 * 1. Compute horizontal projection (dark pixel count per row)
 * 2. Smooth the profile to reduce noise
 * 3. Find peaks (line centers) as local maxima above a threshold
 * 4. Find valleys (line boundaries) as local minima between peaks
 * 5. Each line spans from one valley to the next
 * 6. Measure left/right dark pixel extent per line
 *
 * Works on a downsampled version for performance.
 * Returns coordinates in the original (natural) image space.
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

  // Step 1: Compute horizontal projection (dark pixel count per row)
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

  // Step 2: Smooth the profile to reduce noise from individual letter features.
  // Window should be roughly half a typical line height to smooth within-line
  // variations while preserving between-line valleys.
  const smoothWindow = Math.max(3, Math.round(h * 0.012));
  const smoothed = smooth(rowDarkCount, smoothWindow);

  // Step 3: Determine peak threshold
  // A peak must be above this to count as a text line
  const nonzero = Array.from(rowDarkCount).filter(c => c > 0).sort((a, b) => a - b);
  const medianDark = nonzero.length > 0 ? nonzero[Math.floor(nonzero.length / 2)] : 0;
  const peakThreshold = Math.max(w * 0.005, medianDark * 0.15);

  // Step 4: Find text bands (contiguous above-threshold regions),
  // then split each band into individual lines using internal valleys.
  //
  // A "band" is a run of rows where smoothed dark count exceeds the threshold.
  // Within a band, local minima (dips) indicate gaps between lines.
  // If a band has no significant internal dips, it's a single line.
  const bands: { start: number; end: number }[] = [];
  let bandStart = -1;
  for (let y = 0; y < h; y++) {
    if (smoothed[y] > peakThreshold) {
      if (bandStart === -1) bandStart = y;
    } else {
      if (bandStart !== -1) {
        bands.push({ start: bandStart, end: y });
        bandStart = -1;
      }
    }
  }
  if (bandStart !== -1) bands.push({ start: bandStart, end: h });

  if (bands.length === 0) return [];

  // For each band, find internal valleys to split into individual lines.
  // A valley is a local minimum that dips significantly (>30%) below the
  // average of its neighboring peaks.
  const valleys: number[] = []; // line boundaries in downsampled coords
  const minLineHeight = Math.max(3, Math.round(h * 0.01));

  for (const band of bands) {
    const bandLen = band.end - band.start;

    if (bandLen < minLineHeight * 2) {
      // Band too short to contain multiple lines — treat as single line
      valleys.push(band.start);
      continue;
    }

    // Find local minima within the band
    const internalValleys: { y: number; val: number }[] = [];
    for (let y = band.start + 1; y < band.end - 1; y++) {
      if (smoothed[y] <= smoothed[y - 1] && smoothed[y] <= smoothed[y + 1]) {
        // Check if this is a significant dip: compare to neighbors' max
        const leftMax = Math.max(...Array.from(smoothed.slice(Math.max(band.start, y - Math.round(bandLen * 0.1)), y)));
        const rightMax = Math.max(...Array.from(smoothed.slice(y + 1, Math.min(band.end, y + 1 + Math.round(bandLen * 0.1)))));
        const neighborAvg = (leftMax + rightMax) / 2;
        // Valley must dip at least 20% below the neighbor average
        if (neighborAvg > 0 && smoothed[y] < neighborAvg * 0.8) {
          internalValleys.push({ y, val: smoothed[y] });
        }
      }
    }

    // Filter valleys that are too close together — keep the deeper one
    const filteredValleys: number[] = [];
    for (const v of internalValleys) {
      if (filteredValleys.length > 0) {
        const lastV = filteredValleys[filteredValleys.length - 1];
        if (v.y - lastV < minLineHeight) {
          // Keep the deeper valley
          if (v.val < smoothed[lastV]) {
            filteredValleys[filteredValleys.length - 1] = v.y;
          }
          continue;
        }
      }
      filteredValleys.push(v.y);
    }

    // Build line boundaries: band.start, then each internal valley, then band.end
    valleys.push(band.start);
    for (const vy of filteredValleys) {
      valleys.push(vy);
    }
    valleys.push(band.end);
  }

  // Number of lines = number of boundary intervals
  const lineCount = valleys.length - 1;
  if (lineCount <= 0) return [];

  // Step 6: Build lines from consecutive valley pairs, measure x extent per line
  const lines: DetectedLine[] = [];
  for (let i = 0; i < lineCount; i++) {
    const ly1 = valleys[i];
    const ly2 = valleys[i + 1];

    // Find leftmost and rightmost dark pixels in this line's row range
    let xMin = w;
    let xMax = 0;
    for (let y = ly1; y < Math.min(ly2, h); y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
        if (lum < darkThreshold) {
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
        }
      }
    }

    // Skip lines with no dark pixels (e.g. pure whitespace between paragraphs)
    if (xMin >= w) continue;

    // Scale back to natural image coordinates
    lines.push({
      y1: Math.round(ly1 / scale),
      y2: Math.round(ly2 / scale),
      x1: Math.round(Math.max(0, xMin) / scale),
      x2: Math.round(Math.min(w, xMax + 1) / scale),
    });
  }

  return lines;
}

/**
 * Builds AlignedLine[] from detected lines matched to transcript lines in order.
 * If counts differ, transcript lines are distributed proportionally across positions.
 * Transcript order is always preserved.
 */
export function buildAlignedLinesFromDetected(
  transcriptLines: string[],
  detected: DetectedLine[],
): AlignedLine[] {
  if (transcriptLines.length === 0 || detected.length === 0) return [];

  const tCount = transcriptLines.length;
  const dCount = detected.length;

  // 1:1 — counts match
  if (tCount === dCount) {
    return detected.map((d, i) => ({
      visualLineIndex: i,
      transcriptText: transcriptLines[i],
      bbox: [d.x1, d.y1, d.x2, d.y2] as [number, number, number, number],
      baseline: [
        [d.x1, d.y2 - Math.round((d.y2 - d.y1) * 0.2)],
        [d.x2, d.y2 - Math.round((d.y2 - d.y1) * 0.2)],
      ],
    }));
  }

  // More detected lines than transcript lines — assign transcript lines to
  // proportionally spaced detected positions, extras get empty text
  if (dCount > tCount) {
    return detected.map((d, i) => {
      const tIdx = Math.round((i / dCount) * tCount);
      const closestDet = Math.round((tIdx / tCount) * dCount);
      return {
        visualLineIndex: i,
        transcriptText: closestDet === i && tIdx < tCount ? transcriptLines[tIdx] : '',
        bbox: [d.x1, d.y1, d.x2, d.y2] as [number, number, number, number],
        baseline: [
          [d.x1, d.y2 - Math.round((d.y2 - d.y1) * 0.2)],
          [d.x2, d.y2 - Math.round((d.y2 - d.y1) * 0.2)],
        ],
      };
    });
  }

  // Fewer detected lines than transcript lines — subdivide each detected line
  const result: AlignedLine[] = [];
  let tIdx = 0;
  for (let d = 0; d < dCount; d++) {
    const det = detected[d];
    const tStart = tIdx;
    const tEnd = d < dCount - 1
      ? Math.round(((d + 1) / dCount) * tCount)
      : tCount;
    const subCount = tEnd - tStart;
    const subHeight = (det.y2 - det.y1) / subCount;
    for (let s = 0; s < subCount; s++) {
      const sy1 = Math.round(det.y1 + s * subHeight);
      const sy2 = Math.round(det.y1 + (s + 1) * subHeight);
      result.push({
        visualLineIndex: result.length,
        transcriptText: transcriptLines[tStart + s],
        bbox: [det.x1, sy1, det.x2, sy2] as [number, number, number, number],
        baseline: [
          [det.x1, sy2 - Math.round(subHeight * 0.2)],
          [det.x2, sy2 - Math.round(subHeight * 0.2)],
        ],
      });
    }
    tIdx = tEnd;
  }
  return result;
}

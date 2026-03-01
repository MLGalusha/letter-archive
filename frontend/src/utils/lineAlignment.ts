import type { LineSegment } from '../types/Letter';

export interface AlignedLine {
  visualLineIndex: number;
  transcriptText: string;
  bbox: [number, number, number, number];
  baseline: number[][];
}

/**
 * Computes Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () => Array(lb + 1).fill(0));

  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[la][lb];
}

/**
 * Computes similarity ratio between two strings (0 to 1).
 */
function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

/**
 * Aligns transcript lines to Kraken visual line segments using greedy fuzzy matching.
 * Kraken line count is the source of truth — transcript lines are split/merged to match.
 */
export function alignTranscriptToVisualLines(
  pageText: string,
  lineSegments: LineSegment[],
): AlignedLine[] {
  const transcriptLines = pageText.split('\n').filter(l => l.trim().length > 0);
  const krakenLineCount = lineSegments.length;

  if (krakenLineCount === 0) return [];
  if (transcriptLines.length === 0) {
    // No transcript text — return empty lines for each visual line
    return lineSegments.map((seg, i) => ({
      visualLineIndex: i,
      transcriptText: '',
      bbox: seg.bbox,
      baseline: seg.baseline,
    }));
  }

  // If counts match, do 1:1 assignment
  if (transcriptLines.length === krakenLineCount) {
    return lineSegments.map((seg, i) => ({
      visualLineIndex: i,
      transcriptText: transcriptLines[i],
      bbox: seg.bbox,
      baseline: seg.baseline,
    }));
  }

  // Greedy fuzzy matching: match each Kraken line to the best transcript line(s)
  const result: AlignedLine[] = [];
  const usedTranscript = new Set<number>();

  for (let k = 0; k < krakenLineCount; k++) {
    const seg = lineSegments[k];
    const ocrText = seg.ocrText || '';

    if (!ocrText) {
      // No OCR text to match — assign proportionally
      const proportionalIdx = Math.round((k / krakenLineCount) * transcriptLines.length);
      const idx = Math.min(proportionalIdx, transcriptLines.length - 1);
      // Find nearest unused
      let bestIdx = idx;
      for (let offset = 0; offset < transcriptLines.length; offset++) {
        if (!usedTranscript.has(idx + offset) && idx + offset < transcriptLines.length) {
          bestIdx = idx + offset;
          break;
        }
        if (!usedTranscript.has(idx - offset) && idx - offset >= 0) {
          bestIdx = idx - offset;
          break;
        }
      }
      usedTranscript.add(bestIdx);
      result.push({
        visualLineIndex: k,
        transcriptText: transcriptLines[bestIdx] || '',
        bbox: seg.bbox,
        baseline: seg.baseline,
      });
      continue;
    }

    // Find best matching transcript line by similarity
    let bestScore = -1;
    let bestIdx = -1;
    for (let t = 0; t < transcriptLines.length; t++) {
      if (usedTranscript.has(t)) continue;
      const score = similarity(ocrText, transcriptLines[t]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = t;
      }
    }

    if (bestIdx >= 0) {
      usedTranscript.add(bestIdx);
      result.push({
        visualLineIndex: k,
        transcriptText: transcriptLines[bestIdx],
        bbox: seg.bbox,
        baseline: seg.baseline,
      });
    } else {
      // All transcript lines used — assign empty
      result.push({
        visualLineIndex: k,
        transcriptText: '',
        bbox: seg.bbox,
        baseline: seg.baseline,
      });
    }
  }

  // If there are leftover transcript lines not assigned, append them to the last Kraken line
  const unassigned = transcriptLines.filter((_, i) => !usedTranscript.has(i));
  if (unassigned.length > 0 && result.length > 0) {
    const lastLine = result[result.length - 1];
    lastLine.transcriptText += '\n' + unassigned.join('\n');
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
 * Analyzes an image element's pixel data to detect text line boundaries.
 * Uses horizontal projection profile (sum of dark pixels per row) to find
 * line regions, then measures left/right extent per line.
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
  // A pixel is "dark" if its luminance is below a threshold
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

  // Determine a "text row" threshold: a row has text if its dark pixel
  // count exceeds a fraction of the width. Use adaptive threshold based
  // on the median of nonzero rows.
  const nonzero = Array.from(rowDarkCount).filter(c => c > 0).sort((a, b) => a - b);
  const medianDark = nonzero.length > 0 ? nonzero[Math.floor(nonzero.length / 2)] : 0;
  // Rows with at least 15% of the median count are considered text rows,
  // but at minimum 0.5% of image width (to avoid noise)
  const minTextPixels = Math.max(w * 0.005, medianDark * 0.15);

  const isTextRow = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    isTextRow[y] = rowDarkCount[y] >= minTextPixels ? 1 : 0;
  }

  // Smooth out small gaps within text lines (merge gaps < gapTolerance rows)
  const gapTolerance = Math.max(2, Math.round(h * 0.004));
  for (let y = 0; y < h; y++) {
    if (isTextRow[y] === 0) {
      // Check if this gap is small enough to bridge
      let gapEnd = y;
      while (gapEnd < h && isTextRow[gapEnd] === 0) gapEnd++;
      const gapSize = gapEnd - y;
      if (gapSize <= gapTolerance && y > 0 && gapEnd < h && isTextRow[y - 1] === 1 && isTextRow[gapEnd] === 1) {
        for (let fill = y; fill < gapEnd; fill++) isTextRow[fill] = 1;
      }
      y = gapEnd - 1;
    }
  }

  // Extract contiguous text-row runs as raw line bands
  const rawBands: { y1: number; y2: number }[] = [];
  let inBand = false;
  let bandStart = 0;
  for (let y = 0; y < h; y++) {
    if (isTextRow[y] && !inBand) {
      bandStart = y;
      inBand = true;
    } else if (!isTextRow[y] && inBand) {
      rawBands.push({ y1: bandStart, y2: y });
      inBand = false;
    }
  }
  if (inBand) rawBands.push({ y1: bandStart, y2: h });

  // Filter out tiny noise bands (less than 0.8% of image height)
  const minBandHeight = Math.max(3, h * 0.008);
  const bands = rawBands.filter(b => (b.y2 - b.y1) >= minBandHeight);

  if (bands.length === 0) return [];

  // For each band, find leftmost and rightmost dark pixel columns
  const lines: DetectedLine[] = bands.map(band => {
    let xMin = w;
    let xMax = 0;
    for (let y = band.y1; y < band.y2; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        if (lum < darkThreshold) {
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
        }
      }
    }
    // Scale back to natural image coordinates
    return {
      y1: Math.round(band.y1 / scale),
      y2: Math.round(band.y2 / scale),
      x1: Math.round(Math.max(0, xMin) / scale),
      x2: Math.round(Math.min(w, xMax + 1) / scale),
    };
  });

  return lines;
}

/**
 * Builds AlignedLine[] from detected pixel lines matched to transcript lines.
 * If there are more detected lines than transcript lines, merges adjacent detected
 * lines to match the transcript count. If fewer, splits transcript lines evenly.
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
      baseline: [[d.x1, d.y2 - Math.round((d.y2 - d.y1) * 0.2)], [d.x2, d.y2 - Math.round((d.y2 - d.y1) * 0.2)]],
    }));
  }

  // More detected lines than transcript lines — merge groups of detected lines
  if (dCount > tCount) {
    const result: AlignedLine[] = [];
    for (let t = 0; t < tCount; t++) {
      // Map transcript line t to a range of detected lines
      const dStart = Math.round((t / tCount) * dCount);
      const dEnd = Math.round(((t + 1) / tCount) * dCount);
      // Merge the detected range into one bbox
      const group = detected.slice(dStart, Math.max(dStart + 1, dEnd));
      const y1 = Math.min(...group.map(g => g.y1));
      const y2 = Math.max(...group.map(g => g.y2));
      const x1 = Math.min(...group.map(g => g.x1));
      const x2 = Math.max(...group.map(g => g.x2));
      result.push({
        visualLineIndex: t,
        transcriptText: transcriptLines[t],
        bbox: [x1, y1, x2, y2],
        baseline: [[x1, y2 - Math.round((y2 - y1) * 0.2)], [x2, y2 - Math.round((y2 - y1) * 0.2)]],
      });
    }
    return result;
  }

  // Fewer detected lines than transcript lines — assign multiple transcript lines per detected
  const result: AlignedLine[] = [];
  let tIdx = 0;
  for (let d = 0; d < dCount; d++) {
    const tStart = tIdx;
    const tEnd = d < dCount - 1
      ? Math.round(((d + 1) / dCount) * tCount)
      : tCount;
    // Split this detected line evenly among the transcript lines assigned to it
    const det = detected[d];
    const subCount = tEnd - tStart;
    const subHeight = (det.y2 - det.y1) / subCount;
    for (let s = 0; s < subCount; s++) {
      const sy1 = Math.round(det.y1 + s * subHeight);
      const sy2 = Math.round(det.y1 + (s + 1) * subHeight);
      result.push({
        visualLineIndex: result.length,
        transcriptText: transcriptLines[tStart + s],
        bbox: [det.x1, sy1, det.x2, sy2],
        baseline: [[det.x1, sy2 - Math.round(subHeight * 0.2)], [det.x2, sy2 - Math.round(subHeight * 0.2)]],
      });
    }
    tIdx = tEnd;
  }
  return result;
}

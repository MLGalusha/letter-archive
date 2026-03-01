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

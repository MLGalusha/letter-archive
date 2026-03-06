/**
 * Per-word bounding box analysis.
 *
 * Crops each OCR word box from the page image and computes pixel-level
 * metrics: ink density, contrast, stroke width, actual ink bounds, edge
 * sharpness, and more.  A second pass derives page-level medians/IQR and
 * scores every box as an outlier (higher = more likely noise/bleed-through).
 */

import type { LineSegmentWord } from '../types/Letter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WordBoxMetrics {
  word: LineSegmentWord;

  // Ink / Pixel
  inkDensity: number;            // dark pixels / total pixels (0-1)
  peakRowDensity: number;        // max single-row dark-pixel ratio (0-1)
  inkContrast: number;           // avg-bg-luminance − avg-ink-luminance (0-255)
  minLuminance: number;          // darkest pixel luminance (0-255)
  luminanceStdDev: number;       // std-dev of dark-pixel luminances

  // Geometry (natural image coordinates)
  actualInkTop: number;
  actualInkBottom: number;
  actualInkLeft: number;
  actualInkRight: number;
  verticalInkRatio: number;      // actual ink height / box height (0-1)
  horizontalInkRatio: number;    // actual ink width  / box width  (0-1)
  verticalCenterOfMass: number;  // 0 = top of box, 1 = bottom
  horizontalCenterOfMass: number;// 0 = left of box, 1 = right
  aspectRatio: number;           // box width / box height

  // Stroke
  estimatedStrokeWidth: number;  // avg horizontal dark-pixel run length (px)
  strokeWidthVariance: number;   // variance of those run lengths
  baselineY: number;             // natural-image y of estimated baseline

  // Texture
  edgePixelRatio: number;        // edge dark pixels / total dark pixels (0-1)
  horizontalConnectivity: number;// avg dark-pixel horizontal run length (px)

  // Rotation / Angle
  rotationDegrees: number;       // baseline angle from image moments, positive = clockwise

  // Character-level estimates
  avgCharWidth: number;          // actualInkWidth / char count
  charDensity: number;           // char count / box width (chars per pixel)

  // Stroke depth
  verticalStrokeWidth: number;   // avg vertical dark-pixel run length (px)

  // X-height / Ascender / Descender
  xHeight: number;               // height of densest contiguous row band (px)
  hasAscender: boolean;          // significant ink above x-height zone
  hasDescender: boolean;         // significant ink below x-height zone

  // Vision bbox padding ratios (0-1)
  paddingTop: number;            // (actualInkTop - bbox top) / box height
  paddingBottom: number;         // (bbox bottom - actualInkBottom) / box height
  paddingLeft: number;           // (actualInkLeft - bbox left) / box width
  paddingRight: number;          // (bbox right - actualInkRight) / box width

  // Font weight proxy
  inkCoveragePerChar: number;    // dark pixel count / char count

  // Outlier (populated in second pass)
  outlierScore: number;          // 0-1, higher = more likely non-body-text
}

interface PageMedians {
  inkDensity: number;
  inkContrast: number;
  minLuminance: number;
  strokeWidth: number;
  inkHeight: number;
  edgePixelRatio: number;
  verticalCenterOfMass: number;
  rotationDegrees: number;
  avgCharWidth: number;
  charDensity: number;
  verticalStrokeWidth: number;
  xHeight: number;
  inkCoveragePerChar: number;
}

export interface PageAnalysis {
  metrics: WordBoxMetrics[];
  medians: PageMedians;
  iqrs: PageMedians;
  pageRotation: number;       // median rotation across all boxes
  avgPageCharWidth: number;   // median character width across the page
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function luminance(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function iqr(values: number[]): number {
  if (values.length < 4) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const q1Idx = Math.floor(sorted.length * 0.25);
  const q3Idx = Math.floor(sorted.length * 0.75);
  return sorted[q3Idx] - sorted[q1Idx];
}

/**
 * Otsu's method — finds the luminance threshold that maximises inter-class
 * variance between foreground (ink) and background pixels.
 */
function otsuThreshold(luminances: Float64Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < luminances.length; i++) {
    hist[Math.min(255, Math.max(0, Math.round(luminances[i])))]++;
  }

  const total = luminances.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let sumBg = 0;
  let weightBg = 0;
  let best = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    weightBg += hist[t];
    if (weightBg === 0) continue;
    const weightFg = total - weightBg;
    if (weightFg === 0) break;

    sumBg += t * hist[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const variance = weightBg * weightFg * (meanBg - meanFg) ** 2;

    if (variance > best) {
      best = variance;
      threshold = t;
    }
  }

  return threshold;
}

// ---------------------------------------------------------------------------
// Per-box analysis
// ---------------------------------------------------------------------------

function analyzeWordBox(
  data: Uint8ClampedArray,
  imgWidth: number,
  word: LineSegmentWord,
): WordBoxMetrics {
  const [bx0, by0, bx1, by1] = word.bbox;
  const boxW = Math.max(1, bx1 - bx0);
  const boxH = Math.max(1, by1 - by0);
  const totalPixels = boxW * boxH;

  // --- Collect luminances for threshold calculation -----------------------
  const lums = new Float64Array(totalPixels);
  let idx = 0;
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const pi = (y * imgWidth + x) * 4;
      lums[idx++] = luminance(data[pi], data[pi + 1], data[pi + 2]);
    }
  }

  const threshold = otsuThreshold(lums);

  // --- Single pass: gather all per-pixel metrics --------------------------
  let darkCount = 0;
  let lightCount = 0;
  let darkLumSum = 0;
  let lightLumSum = 0;
  let darkLumSqSum = 0;
  let minLum = 255;

  // Centre-of-mass accumulators
  let comXSum = 0;
  let comYSum = 0;

  // Second-order moment accumulators (for rotation)
  let m20 = 0;
  let m02 = 0;
  let m11 = 0;

  // Actual ink bounds
  let inkTop = by1;
  let inkBottom = by0;
  let inkLeft = bx1;
  let inkRight = bx0;

  // Per-row dark count for peak-row density & baseline
  const rowDarkCounts = new Uint32Array(boxH);

  // Edge detection: dark pixel with at least one light 4-neighbour.
  // Build a boolean grid first (avoids re-reading pixels).
  const isDark = new Uint8Array(totalPixels);
  idx = 0;
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const pi = (y * imgWidth + x) * 4;
      const l = luminance(data[pi], data[pi + 1], data[pi + 2]);
      const dark = l <= threshold ? 1 : 0;
      isDark[idx] = dark;

      if (dark) {
        darkCount++;
        darkLumSum += l;
        darkLumSqSum += l * l;
        if (l < minLum) minLum = l;
        const dx = x - bx0;
        const dy = y - by0;
        comXSum += dx;
        comYSum += dy;
        m20 += dx * dx;
        m02 += dy * dy;
        m11 += dx * dy;
        rowDarkCounts[y - by0]++;
        if (y < inkTop) inkTop = y;
        if (y > inkBottom) inkBottom = y;
        if (x < inkLeft) inkLeft = x;
        if (x > inkRight) inkRight = x;
      } else {
        lightCount++;
        lightLumSum += l;
      }

      idx++;
    }
  }

  // Fallbacks for edge cases
  if (darkCount === 0) {
    return emptyMetrics(word, boxW, boxH);
  }
  if (inkTop > inkBottom) { inkTop = by0; inkBottom = by1; }
  if (inkLeft > inkRight) { inkLeft = bx0; inkRight = bx1; }

  // --- Derived ink / pixel metrics ----------------------------------------
  const inkDensity = darkCount / totalPixels;
  const avgDarkLum = darkLumSum / darkCount;
  const avgLightLum = lightCount > 0 ? lightLumSum / lightCount : 255;
  const inkContrast = avgLightLum - avgDarkLum;
  const lumVariance = darkLumSqSum / darkCount - avgDarkLum * avgDarkLum;
  const luminanceStdDev = Math.sqrt(Math.max(0, lumVariance));

  // --- Peak-row density ---------------------------------------------------
  let peakRowDark = 0;
  for (let r = 0; r < boxH; r++) {
    if (rowDarkCounts[r] > peakRowDark) peakRowDark = rowDarkCounts[r];
  }
  const peakRowDensity = peakRowDark / boxW;

  // --- Geometry -----------------------------------------------------------
  const actualInkHeight = inkBottom - inkTop + 1;
  const actualInkWidth = inkRight - inkLeft + 1;
  const verticalInkRatio = actualInkHeight / boxH;
  const horizontalInkRatio = actualInkWidth / boxW;
  const verticalCenterOfMass = (comYSum / darkCount) / Math.max(1, boxH - 1);
  const horizontalCenterOfMass = (comXSum / darkCount) / Math.max(1, boxW - 1);
  const aspectRatio = boxW / boxH;

  // --- Baseline: row with peak density in lower 60% of ink region ---------
  const inkRegionStart = Math.round(inkTop - by0 + actualInkHeight * 0.4);
  const inkRegionEnd = inkBottom - by0;
  let baselineRow = inkRegionEnd;
  let baselinePeak = 0;
  for (let r = inkRegionStart; r <= inkRegionEnd; r++) {
    if (rowDarkCounts[r] > baselinePeak) {
      baselinePeak = rowDarkCounts[r];
      baselineRow = r;
    }
  }
  const baselineY = by0 + baselineRow;

  // --- Stroke width & horizontal connectivity -----------------------------
  // Measure horizontal dark-pixel run lengths
  const runLengths: number[] = [];
  for (let y = by0; y < by1; y++) {
    let run = 0;
    for (let x = bx0; x < bx1; x++) {
      const gi = (y - by0) * boxW + (x - bx0);
      if (isDark[gi]) {
        run++;
      } else if (run > 0) {
        runLengths.push(run);
        run = 0;
      }
    }
    if (run > 0) runLengths.push(run);
  }

  let estimatedStrokeWidth = 0;
  let strokeWidthVariance = 0;
  let horizontalConnectivity = 0;

  if (runLengths.length > 0) {
    const sum = runLengths.reduce((s, v) => s + v, 0);
    estimatedStrokeWidth = sum / runLengths.length;
    horizontalConnectivity = estimatedStrokeWidth;
    const sqSum = runLengths.reduce((s, v) => s + (v - estimatedStrokeWidth) ** 2, 0);
    strokeWidthVariance = sqSum / runLengths.length;
  }

  // --- Edge pixel ratio ---------------------------------------------------
  let edgeCount = 0;
  for (let ry = 0; ry < boxH; ry++) {
    for (let rx = 0; rx < boxW; rx++) {
      const gi = ry * boxW + rx;
      if (!isDark[gi]) continue;
      // Check 4-neighbours for a light pixel
      const hasLightNeighbour =
        (rx > 0 && !isDark[gi - 1]) ||
        (rx < boxW - 1 && !isDark[gi + 1]) ||
        (ry > 0 && !isDark[gi - boxW]) ||
        (ry < boxH - 1 && !isDark[gi + boxW]);
      if (hasLightNeighbour) edgeCount++;
    }
  }
  const edgePixelRatio = edgeCount / darkCount;

  // --- Rotation from image moments -----------------------------------------
  const meanX = comXSum / darkCount;
  const meanY = comYSum / darkCount;
  const mu20 = m20 / darkCount - meanX * meanX;
  const mu02 = m02 / darkCount - meanY * meanY;
  const mu11 = m11 / darkCount - meanX * meanY;
  const rotationDegrees = 0.5 * Math.atan2(2 * mu11, mu20 - mu02) * (180 / Math.PI);

  // --- Character-level estimates -------------------------------------------
  const charCount = Math.max(1, word.text.length);
  const avgCharWidth = actualInkWidth / charCount;
  const charDensity = word.text.length / boxW;

  // --- Vertical stroke width -----------------------------------------------
  const vertRunLengths: number[] = [];
  for (let rx = 0; rx < boxW; rx++) {
    let run = 0;
    for (let ry = 0; ry < boxH; ry++) {
      if (isDark[ry * boxW + rx]) {
        run++;
      } else if (run > 0) {
        vertRunLengths.push(run);
        run = 0;
      }
    }
    if (run > 0) vertRunLengths.push(run);
  }
  let verticalStrokeWidth = 0;
  if (vertRunLengths.length > 0) {
    verticalStrokeWidth = vertRunLengths.reduce((s, v) => s + v, 0) / vertRunLengths.length;
  }

  // --- X-height / Ascender / Descender -------------------------------------
  // Find the tallest contiguous band of rows where density stays >= 50% of peak
  const halfPeak = peakRowDark * 0.5;
  let bestBandStart = 0;
  let bestBandLen = 0;
  let bandStart = -1;
  for (let r = 0; r < boxH; r++) {
    if (rowDarkCounts[r] >= halfPeak) {
      if (bandStart < 0) bandStart = r;
    } else {
      if (bandStart >= 0) {
        const len = r - bandStart;
        if (len > bestBandLen) {
          bestBandLen = len;
          bestBandStart = bandStart;
        }
        bandStart = -1;
      }
    }
  }
  if (bandStart >= 0) {
    const len = boxH - bandStart;
    if (len > bestBandLen) {
      bestBandLen = len;
      bestBandStart = bandStart;
    }
  }
  const xHeight = bestBandLen > 0 ? bestBandLen : actualInkHeight;

  // Check for significant ink outside x-height band (>5% of dark pixels)
  const xBandTop = by0 + bestBandStart;
  const xBandBottom = by0 + bestBandStart + bestBandLen;
  let inkAbove = 0;
  let inkBelow = 0;
  for (let r = 0; r < boxH; r++) {
    const absRow = by0 + r;
    if (absRow < xBandTop) inkAbove += rowDarkCounts[r];
    else if (absRow >= xBandBottom) inkBelow += rowDarkCounts[r];
  }
  const hasAscender = inkAbove > darkCount * 0.05;
  const hasDescender = inkBelow > darkCount * 0.05;

  // --- Padding ratios ------------------------------------------------------
  const paddingTop = (inkTop - by0) / boxH;
  const paddingBottom = (by1 - inkBottom) / boxH;
  const paddingLeft = (inkLeft - bx0) / boxW;
  const paddingRight = (bx1 - inkRight) / boxW;

  // --- Ink coverage per char -----------------------------------------------
  const inkCoveragePerChar = darkCount / charCount;

  return {
    word,
    inkDensity,
    peakRowDensity,
    inkContrast,
    minLuminance: minLum,
    luminanceStdDev,
    actualInkTop: inkTop,
    actualInkBottom: inkBottom,
    actualInkLeft: inkLeft,
    actualInkRight: inkRight,
    verticalInkRatio,
    horizontalInkRatio,
    verticalCenterOfMass,
    horizontalCenterOfMass,
    aspectRatio,
    estimatedStrokeWidth,
    strokeWidthVariance,
    baselineY,
    edgePixelRatio,
    horizontalConnectivity,
    rotationDegrees,
    avgCharWidth,
    charDensity,
    verticalStrokeWidth,
    xHeight,
    hasAscender,
    hasDescender,
    paddingTop,
    paddingBottom,
    paddingLeft,
    paddingRight,
    inkCoveragePerChar,
    outlierScore: 0, // populated in second pass
  };
}

/** Metrics for a box with no detectable dark pixels. */
function emptyMetrics(word: LineSegmentWord, boxW: number, boxH: number): WordBoxMetrics {
  const [bx0, by0, , by1] = word.bbox;
  return {
    word,
    inkDensity: 0,
    peakRowDensity: 0,
    inkContrast: 0,
    minLuminance: 255,
    luminanceStdDev: 0,
    actualInkTop: by0,
    actualInkBottom: by1,
    actualInkLeft: word.bbox[0],
    actualInkRight: word.bbox[2],
    verticalInkRatio: 0,
    horizontalInkRatio: 0,
    verticalCenterOfMass: 0.5,
    horizontalCenterOfMass: 0.5,
    aspectRatio: boxW / boxH,
    estimatedStrokeWidth: 0,
    strokeWidthVariance: 0,
    baselineY: by0 + Math.round(boxH * 0.75),
    edgePixelRatio: 0,
    horizontalConnectivity: 0,
    rotationDegrees: 0,
    avgCharWidth: 0,
    charDensity: 0,
    verticalStrokeWidth: 0,
    xHeight: 0,
    hasAscender: false,
    hasDescender: false,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    paddingRight: 0,
    inkCoveragePerChar: 0,
    outlierScore: 1,
  };
}

// ---------------------------------------------------------------------------
// Page-level aggregation & outlier scoring
// ---------------------------------------------------------------------------

type MetricKey = keyof PageMedians;

const METRIC_EXTRACTORS: Record<MetricKey, (m: WordBoxMetrics) => number> = {
  inkDensity: (m) => m.inkDensity,
  inkContrast: (m) => m.inkContrast,
  minLuminance: (m) => m.minLuminance,
  strokeWidth: (m) => m.estimatedStrokeWidth,
  inkHeight: (m) => m.actualInkBottom - m.actualInkTop,
  edgePixelRatio: (m) => m.edgePixelRatio,
  verticalCenterOfMass: (m) => m.verticalCenterOfMass,
  rotationDegrees: (m) => m.rotationDegrees,
  avgCharWidth: (m) => m.avgCharWidth,
  charDensity: (m) => m.charDensity,
  verticalStrokeWidth: (m) => m.verticalStrokeWidth,
  xHeight: (m) => m.xHeight,
  inkCoveragePerChar: (m) => m.inkCoveragePerChar,
};

function computePageStats(metrics: WordBoxMetrics[]): {
  medians: PageAnalysis['medians'];
  iqrs: PageAnalysis['iqrs'];
} {
  const medians = {} as PageAnalysis['medians'];
  const iqrs = {} as PageAnalysis['iqrs'];

  for (const key of Object.keys(METRIC_EXTRACTORS) as MetricKey[]) {
    const values = metrics.map(METRIC_EXTRACTORS[key]);
    medians[key] = median(values);
    iqrs[key] = iqr(values);
  }

  return { medians, iqrs };
}

/**
 * Composite outlier score (0-1).
 *
 * For each metric, compute how many IQRs the box deviates from the page
 * median. Metrics where large deviations signal noise are weighted higher.
 *
 * The final score is a weighted average of per-metric outlier signals,
 * clamped to [0, 1].
 */
function computeOutlierScore(
  m: WordBoxMetrics,
  med: PageAnalysis['medians'],
  pageIqr: PageAnalysis['iqrs'],
): number {
  // Per-metric deviation measured in IQR units.  A deviation > 1.5 IQR is
  // traditionally considered a mild outlier; > 3 IQR a strong one.
  function deviation(value: number, medianVal: number, iqrVal: number): number {
    if (iqrVal < 0.0001) return 0;
    return Math.abs(value - medianVal) / iqrVal;
  }

  // Weighted signals — higher weight = stronger evidence of non-body-text.
  // Direction matters: low contrast = bad, low density = bad, etc.
  const signals: { value: number; weight: number }[] = [];

  // Low ink density → faded / sparse → likely bleed-through or noise
  const densityDev = deviation(m.inkDensity, med.inkDensity, pageIqr.inkDensity);
  const densityDir = m.inkDensity < med.inkDensity ? 1 : 0.3; // penalise low more
  signals.push({ value: densityDev * densityDir, weight: 0.2 });

  // Low contrast → faded ink → bleed-through
  const contrastDev = deviation(m.inkContrast, med.inkContrast, pageIqr.inkContrast);
  const contrastDir = m.inkContrast < med.inkContrast ? 1 : 0.2;
  signals.push({ value: contrastDev * contrastDir, weight: 0.25 });

  // High min luminance → no truly dark pixels → bleed-through / noise
  const lumDev = deviation(m.minLuminance, med.minLuminance, pageIqr.minLuminance);
  const lumDir = m.minLuminance > med.minLuminance ? 1 : 0.1;
  signals.push({ value: lumDev * lumDir, weight: 0.2 });

  // Stroke width divergence → different pen / typed vs handwritten
  const strokeDev = deviation(m.estimatedStrokeWidth, med.strokeWidth, pageIqr.strokeWidth);
  signals.push({ value: strokeDev, weight: 0.1 });

  // Ink height divergence → different text source / scale
  const inkH = m.actualInkBottom - m.actualInkTop;
  const heightDev = deviation(inkH, med.inkHeight, pageIqr.inkHeight);
  signals.push({ value: heightDev, weight: 0.1 });

  // Low edge sharpness → blurry → bleed-through
  const edgeDev = deviation(m.edgePixelRatio, med.edgePixelRatio, pageIqr.edgePixelRatio);
  const edgeDir = m.edgePixelRatio < med.edgePixelRatio ? 1 : 0.2;
  signals.push({ value: edgeDev * edgeDir, weight: 0.15 });

  // Weighted average, normalised with a sigmoid-like curve so that
  // 1.5 IQR ≈ 0.5 outlier score and 3 IQR ≈ 0.9.
  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of signals) {
    weightedSum += s.value * s.weight;
    weightTotal += s.weight;
  }
  const rawScore = weightedSum / weightTotal;

  // Sigmoid: score = 1 / (1 + e^(−k(x − midpoint)))
  // k=2, midpoint=1.5 gives a smooth 0→1 ramp centred at 1.5 IQR
  return 1 / (1 + Math.exp(-2 * (rawScore - 1.5)));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyse every OCR word box on a page image.
 *
 * Draws the image to an offscreen canvas once, then extracts pixel data
 * per box.  Returns per-box metrics, page-level medians/IQR, and an
 * outlier score for each box.
 *
 * @param img       The <img> element (must have crossOrigin="anonymous")
 * @param words     All OCR word boxes for the page (across all line segments)
 * @returns         PageAnalysis with per-box metrics and page statistics
 */
export function analyzePageWords(
  img: HTMLImageElement,
  words: LineSegmentWord[],
): PageAnalysis | null {
  if (words.length === 0) return null;

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w === 0 || h === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    // SecurityError from tainted canvas
    return null;
  }

  const data = imageData.data;

  // --- First pass: per-box metrics ----------------------------------------
  const metrics = words.map((word) => analyzeWordBox(data, w, word));

  // --- Second pass: page stats & outlier scores ---------------------------
  // Only use boxes with actual ink for computing page norms
  const withInk = metrics.filter((m) => m.inkDensity > 0);
  if (withInk.length === 0) {
    return { metrics, medians: zeroMedians(), iqrs: zeroMedians(), pageRotation: 0, avgPageCharWidth: 0 };
  }

  const { medians, iqrs } = computePageStats(withInk);

  for (const m of metrics) {
    m.outlierScore = m.inkDensity === 0
      ? 1
      : computeOutlierScore(m, medians, iqrs);
  }

  return {
    metrics,
    medians,
    iqrs,
    pageRotation: medians.rotationDegrees,
    avgPageCharWidth: medians.avgCharWidth,
  };
}

function zeroMedians(): PageMedians {
  return {
    inkDensity: 0,
    inkContrast: 0,
    minLuminance: 0,
    strokeWidth: 0,
    inkHeight: 0,
    edgePixelRatio: 0,
    verticalCenterOfMass: 0,
    rotationDegrees: 0,
    avgCharWidth: 0,
    charDensity: 0,
    verticalStrokeWidth: 0,
    xHeight: 0,
    inkCoveragePerChar: 0,
  };
}

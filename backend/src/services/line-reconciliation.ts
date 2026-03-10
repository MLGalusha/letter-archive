import sharp from 'sharp';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — hull.js has no type declarations
import hull from 'hull.js';
import { createLogger } from '../utils/logger.js';
import type { LineSegment } from './line-finder.js';

const log = createLogger({ module: 'line-reconciliation' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OcrWordBox {
  text: string;
  bbox: [number, number, number, number];
  confidence: number;
  hasContent?: boolean;
}

export interface ReconciledLine {
  line: number;
  bbox: [number, number, number, number];
  baseline: number[][];
  boundary?: { x: number; y: number }[];
  sourceSegmentIds: number[];
  wasMerged: boolean;
  wasExtended: boolean;
  mergeGapPx?: number;
  confidence: number;
  isPhantom: boolean;
  isPrintedText: boolean;
  isDeleted: boolean;
  pixelStats?: {
    rmsContrast: number;
    michelson: number;
    inkDensity: number;
    variance: number;
    minValue: number;
    meanValue: number;
  };
  hppOverlap: number;
  visionWordCount: number;
  transcriptLineIndex?: number;
  transcriptMatchScore?: number;
  wordCountRatio?: number;
  adminBboxOverride?: [number, number, number, number];
}

export interface ReconciliationThresholds {
  minYOverlapRatio: number;
  maxPolygonGapFactor: number;
  maxBaselineDiscrepancy: number;
  concaveHullFactor: number;
  maxExtensionGapFactor: number;
  phantomMinSignals: number;
  rmsContrastBleed: number;
  hppOverlapMin: number;
  minValueBleed: number;
  minWordWidthRatio: number;
  sequenceMatchMin: number;
  overlapIouThreshold: number;
}

export interface CalibratedThresholds extends Partial<ReconciliationThresholds> {
  calibratedAt: string;
  correctionCount: number;
  collectionCode?: string;
}

export interface LineCorrection {
  id: string;
  pageId: string;
  letterId: string;
  collectionCode?: string;
  correctionType: 'delete' | 'undelete' | 'resize' | 'merge' | 'split' | 'reject_phantom' | 'confirm_phantom';
  timestamp: string;
  algorithmOutput: {
    bbox: [number, number, number, number];
    confidence: number;
    isPhantom: boolean;
    wasMerged: boolean;
    mergeGapPx?: number;
    pixelStats?: ReconciledLine['pixelStats'];
    hppOverlap: number;
    visionWordCount: number;
    transcriptMatchScore?: number;
  };
  correctedBbox?: [number, number, number, number];
  correctedIsDeleted?: boolean;
  sourceSegmentIds: number[];
  errorRegionPixelStats?: ReconciledLine['pixelStats'];
  pageContext: {
    medianRmsContrast: number;
    medianVariance: number;
    medianDensity: number;
    medianMinValue: number;
    totalSegments: number;
    totalVisionBoxes: number;
    imageWidth: number;
    imageHeight: number;
  };
}

// ---------------------------------------------------------------------------
// Default thresholds
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLDS: ReconciliationThresholds = {
  minYOverlapRatio: 0.40,
  maxPolygonGapFactor: 3.0,
  maxBaselineDiscrepancy: 0.3,
  concaveHullFactor: 1.5,
  maxExtensionGapFactor: 1.5,
  phantomMinSignals: 3,
  rmsContrastBleed: 0.20,
  hppOverlapMin: 0.30,
  minValueBleed: 140,
  minWordWidthRatio: 0.30,
  sequenceMatchMin: 0.15,
  overlapIouThreshold: 0.30,
};

// ---------------------------------------------------------------------------
// Union-Find
// ---------------------------------------------------------------------------

class UnionFind {
  parent: number[];
  rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;
    if (this.rank[rx] < this.rank[ry]) this.parent[rx] = ry;
    else if (this.rank[rx] > this.rank[ry]) this.parent[ry] = rx;
    else {
      this.parent[ry] = rx;
      this.rank[rx]++;
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function pointToSegmentDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p[0] - a[0];
    const ey = p[1] - a[1];
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  const ex = p[0] - projX;
  const ey = p[1] - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

function minPolygonDistance(
  polyA: { x: number; y: number }[],
  polyB: { x: number; y: number }[],
): number {
  let minDist = Infinity;

  // Check every vertex of A against every edge of B, and vice versa
  for (const pA of polyA) {
    for (let i = 0; i < polyB.length; i++) {
      const j = (i + 1) % polyB.length;
      const d = pointToSegmentDistance(
        [pA.x, pA.y],
        [polyB[i].x, polyB[i].y],
        [polyB[j].x, polyB[j].y],
      );
      if (d < minDist) minDist = d;
    }
  }

  for (const pB of polyB) {
    for (let i = 0; i < polyA.length; i++) {
      const j = (i + 1) % polyA.length;
      const d = pointToSegmentDistance(
        [pB.x, pB.y],
        [polyA[i].x, polyA[i].y],
        [polyA[j].x, polyA[j].y],
      );
      if (d < minDist) minDist = d;
    }
  }

  return minDist;
}

function fitBaseline(points: number[][]): { slope: number; intercept: number } {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: points[0][1] };

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;

  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) {
    return { slope: 0, intercept: sumY / n };
  }

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function computeMedianLineHeight(segments: LineSegment[]): number {
  if (segments.length === 0) return 0;
  const heights = segments.map((s) => s.bbox[3] - s.bbox[1]).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)];
}

function bboxGap(a: [number, number, number, number], b: [number, number, number, number]): number {
  // Horizontal gap between two bboxes (negative = overlap)
  return Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2]));
}

function yOverlapRatio(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const overlapTop = Math.max(a[1], b[1]);
  const overlapBottom = Math.min(a[3], b[3]);
  const overlap = Math.max(0, overlapBottom - overlapTop);
  const minHeight = Math.min(a[3] - a[1], b[3] - b[1]);
  return minHeight > 0 ? overlap / minHeight : 0;
}

function bboxIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const interLeft = Math.max(a[0], b[0]);
  const interTop = Math.max(a[1], b[1]);
  const interRight = Math.min(a[2], b[2]);
  const interBottom = Math.min(a[3], b[3]);
  const interArea = Math.max(0, interRight - interLeft) * Math.max(0, interBottom - interTop);
  if (interArea === 0) return 0;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return interArea / (areaA + areaB - interArea);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ---------------------------------------------------------------------------
// Phase 1: Geometric Merge
// ---------------------------------------------------------------------------

function mergeFragments(
  segments: LineSegment[],
  medianHeight: number,
  thresholds: ReconciliationThresholds,
): ReconciledLine[] {
  const n = segments.length;
  if (n === 0) return [];

  const uf = new UnionFind(n);
  const gapMap = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = segments[i];
      const b = segments[j];

      // 1. Y-overlap filter
      const overlap = yOverlapRatio(a.bbox, b.bbox);
      if (overlap < thresholds.minYOverlapRatio) continue;

      // 2. Polygon / bbox gap distance
      let dist: number;
      if (a.boundary && a.boundary.length >= 3 && b.boundary && b.boundary.length >= 3) {
        dist = minPolygonDistance(a.boundary, b.boundary);
      } else {
        dist = bboxGap(a.bbox, b.bbox);
      }
      if (dist > medianHeight * thresholds.maxPolygonGapFactor) continue;

      // 3. Baseline collinearity
      const fitA = fitBaseline(a.baseline);
      const fitB = fitBaseline(b.baseline);
      const gapMidX = (Math.min(a.bbox[2], b.bbox[2]) + Math.max(a.bbox[0], b.bbox[0])) / 2;
      const aY = fitA.slope * gapMidX + fitA.intercept;
      const bY = fitB.slope * gapMidX + fitB.intercept;
      if (Math.abs(aY - bY) > medianHeight * thresholds.maxBaselineDiscrepancy) continue;

      // Passes all tests — union them
      uf.union(i, j);
      gapMap.set(`${i}-${j}`, dist);
    }
  }

  // Group segments by root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  const reconciled: ReconciledLine[] = [];

  for (const [, indices] of groups) {
    const groupSegments = indices.map((i) => segments[i]);
    const wasMerged = indices.length > 1;

    // Compute max gap within group
    let maxGap = 0;
    if (wasMerged) {
      for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
          const key1 = `${indices[i]}-${indices[j]}`;
          const key2 = `${indices[j]}-${indices[i]}`;
          const g = gapMap.get(key1) ?? gapMap.get(key2) ?? 0;
          if (g > maxGap) maxGap = g;
        }
      }
    }

    // Merged bbox
    const mergedBbox: [number, number, number, number] = [
      Math.min(...groupSegments.map((s) => s.bbox[0])),
      Math.min(...groupSegments.map((s) => s.bbox[1])),
      Math.max(...groupSegments.map((s) => s.bbox[2])),
      Math.max(...groupSegments.map((s) => s.bbox[3])),
    ];

    // Merged baseline — concatenate and sort by X
    const mergedBaseline = groupSegments
      .flatMap((s) => s.baseline)
      .sort((a, b) => a[0] - b[0]);

    // Merged boundary via concave hull
    let mergedBoundary: { x: number; y: number }[] | undefined;
    const allBoundaryPoints: number[][] = [];
    for (const seg of groupSegments) {
      if (seg.boundary && seg.boundary.length >= 3) {
        for (const pt of seg.boundary) {
          allBoundaryPoints.push([pt.x, pt.y]);
        }
      }
    }
    if (allBoundaryPoints.length >= 3) {
      const concavity = medianHeight * thresholds.concaveHullFactor;
      const hullPoints = hull(allBoundaryPoints, concavity) as number[][];
      mergedBoundary = hullPoints.map(([x, y]) => ({ x, y }));
    }

    reconciled.push({
      line: 0, // assigned later
      bbox: mergedBbox,
      baseline: mergedBaseline,
      boundary: mergedBoundary,
      sourceSegmentIds: indices.map((i) => segments[i].line),
      wasMerged,
      wasExtended: false,
      mergeGapPx: wasMerged ? Math.round(maxGap) : undefined,
      confidence: 0,
      isPhantom: false,
      isPrintedText: false,
      isDeleted: false,
      hppOverlap: 0,
      visionWordCount: 0,
    });
  }

  log.debug(
    { inputSegments: n, outputLines: reconciled.length, mergedCount: reconciled.filter((r) => r.wasMerged).length },
    'Phase 1: geometric merge complete',
  );

  return reconciled;
}

// ---------------------------------------------------------------------------
// Phase 2: Line Width Extension
// ---------------------------------------------------------------------------

function extendSegmentWidths(
  lines: ReconciledLine[],
  ocrWordBoxes: OcrWordBox[],
  medianHeight: number,
  thresholds: ReconciliationThresholds,
): void {
  const contentBoxes = ocrWordBoxes.filter((b) => b.hasContent);

  for (const line of lines) {
    const overlapping = contentBoxes.filter((box) => {
      const overlap = yOverlapRatio(line.bbox, box.bbox);
      return overlap > 0.5;
    });

    line.visionWordCount = overlapping.length;

    const maxExtGap = medianHeight * thresholds.maxExtensionGapFactor;

    for (const box of overlapping) {
      // Extend left
      if (box.bbox[0] < line.bbox[0]) {
        const gap = line.bbox[0] - box.bbox[0];
        if (gap <= maxExtGap) {
          line.bbox[0] = box.bbox[0];
          line.wasExtended = true;
        }
      }
      // Extend right
      if (box.bbox[2] > line.bbox[2]) {
        const gap = box.bbox[2] - line.bbox[2];
        if (gap <= maxExtGap) {
          line.bbox[2] = box.bbox[2];
          line.wasExtended = true;
        }
      }
    }
  }

  // Resolve overlaps between adjacent segments — clip to midpoint
  const sorted = [...lines].sort((a, b) => a.bbox[1] - b.bbox[1]);
  for (let i = 0; i < sorted.length - 1; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const iou = bboxIoU(sorted[i].bbox, sorted[j].bbox);
      if (iou > thresholds.overlapIouThreshold) {
        // Clip horizontally to midpoint
        const midX = (Math.min(sorted[i].bbox[2], sorted[j].bbox[2]) +
                      Math.max(sorted[i].bbox[0], sorted[j].bbox[0])) / 2;
        // The one on the left gets clipped right, the one on the right gets clipped left
        if (sorted[i].bbox[0] < sorted[j].bbox[0]) {
          sorted[i].bbox[2] = Math.min(sorted[i].bbox[2], midX);
          sorted[j].bbox[0] = Math.max(sorted[j].bbox[0], midX);
        } else {
          sorted[j].bbox[2] = Math.min(sorted[j].bbox[2], midX);
          sorted[i].bbox[0] = Math.max(sorted[i].bbox[0], midX);
        }
      }
    }
  }

  const extendedCount = lines.filter((l) => l.wasExtended).length;
  log.debug({ extendedCount, totalLines: lines.length }, 'Phase 2: line width extension complete');
}

// ---------------------------------------------------------------------------
// Phase 3: Phantom Filtering
// ---------------------------------------------------------------------------

async function detectPhantomSegments(
  lines: ReconciledLine[],
  imageBuffer: Buffer,
  imageWidth: number,
  imageHeight: number,
  thresholds: ReconciliationThresholds,
): Promise<void> {
  // Compute pixel stats for all lines first
  const allStats: Array<ReconciledLine['pixelStats']> = [];

  for (const line of lines) {
    const [x1, y1, x2, y2] = line.bbox;
    const left = Math.max(0, Math.round(x1));
    const top = Math.max(0, Math.round(y1));
    const width = Math.min(Math.round(x2) - left, imageWidth - left);
    const height = Math.min(Math.round(y2) - top, imageHeight - top);

    if (width <= 0 || height <= 0) {
      line.pixelStats = {
        rmsContrast: 0,
        michelson: 0,
        inkDensity: 0,
        variance: 0,
        minValue: 255,
        meanValue: 255,
      };
      allStats.push(line.pixelStats);
      continue;
    }

    try {
      // Get sharp stats for RMS contrast and Michelson
      const region = sharp(imageBuffer).extract({ left, top, width, height }).greyscale();
      const { channels } = await region.stats();
      const ch = channels[0];

      const rmsContrast = ch.stdev / Math.max(1, ch.mean);
      const michelson = (ch.max - ch.min) / Math.max(1, ch.max + ch.min);

      // Get raw buffer for ink density and variance
      const { data: rawBuf } = await sharp(imageBuffer)
        .extract({ left, top, width, height })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const pixelCount = width * height;
      let sum = 0;
      let sumSq = 0;
      let minVal = 255;
      let darkCount = 0;

      for (let i = 0; i < rawBuf.length; i++) {
        const val = rawBuf[i];
        sum += val;
        sumSq += val * val;
        if (val < minVal) minVal = val;
        if (val < 140) darkCount++;
      }

      const meanValue = sum / pixelCount;
      const variance = sumSq / pixelCount - meanValue * meanValue;
      const inkDensity = darkCount / pixelCount;

      line.pixelStats = {
        rmsContrast,
        michelson,
        inkDensity,
        variance,
        minValue: minVal,
        meanValue,
      };
    } catch {
      line.pixelStats = {
        rmsContrast: 0,
        michelson: 0,
        inkDensity: 0,
        variance: 0,
        minValue: 255,
        meanValue: 255,
      };
    }

    allStats.push(line.pixelStats);
  }

  // Compute page-wide medians for relative comparisons
  const validStats = allStats.filter((s): s is NonNullable<typeof s> => s != null);
  const medianVariance = median(validStats.map((s) => s.variance));
  const medianDensity = median(validStats.map((s) => s.inkDensity));

  // Count phantom signals for each line
  let phantomCount = 0;
  for (const line of lines) {
    const stats = line.pixelStats;
    if (!stats) continue;

    let signals = 0;

    // No Vision content boxes
    if (line.visionWordCount === 0) signals++;

    // Low RMS contrast
    if (stats.rmsContrast < thresholds.rmsContrastBleed) signals++;

    // High min value (light — no dark ink)
    if (stats.minValue > thresholds.minValueBleed) signals++;

    // Low HPP overlap
    if (line.hppOverlap < thresholds.hppOverlapMin) signals++;

    // Very low variance AND density relative to page median
    if (stats.variance < medianVariance * 0.25 && stats.inkDensity < medianDensity * 0.25) {
      signals++;
    }

    if (signals >= thresholds.phantomMinSignals) {
      line.isPhantom = true;
      phantomCount++;
    }
  }

  log.debug({ phantomCount, totalLines: lines.length }, 'Phase 3: phantom filtering complete');
}

// ---------------------------------------------------------------------------
// Phase 4: Transcript Reconciliation
// ---------------------------------------------------------------------------

function reconcileWithTranscript(
  lines: ReconciledLine[],
  ocrWordBoxes: OcrWordBox[],
  transcriptLines: string[],
  thresholds: ReconciliationThresholds,
): void {
  const nonPhantom = lines.filter((l) => !l.isPhantom && !l.isDeleted);

  // Compute average word box width for punctuation filtering
  const contentBoxes = ocrWordBoxes.filter((b) => b.hasContent);
  const avgBoxWidth =
    contentBoxes.length > 0
      ? contentBoxes.reduce((sum, b) => sum + (b.bbox[2] - b.bbox[0]), 0) / contentBoxes.length
      : 0;
  const minWidth = avgBoxWidth * thresholds.minWordWidthRatio;

  // For each non-phantom segment, count vision words (excluding punctuation-width boxes)
  for (const line of nonPhantom) {
    const overlapping = contentBoxes.filter((box) => {
      const overlap = yOverlapRatio(line.bbox, box.bbox);
      return overlap > 0.5;
    });

    const significantWords = overlapping.filter(
      (box) => (box.bbox[2] - box.bbox[0]) >= minWidth,
    );

    line.visionWordCount = significantWords.length;
  }

  // Basic 1:1 line count matching
  if (nonPhantom.length === transcriptLines.length) {
    for (let i = 0; i < nonPhantom.length; i++) {
      nonPhantom[i].transcriptLineIndex = i;

      const transcriptWordCount = transcriptLines[i].trim().split(/\s+/).filter(Boolean).length;
      const visionCount = nonPhantom[i].visionWordCount;

      if (transcriptWordCount > 0 && visionCount > 0) {
        const ratio = Math.min(visionCount, transcriptWordCount) /
                      Math.max(visionCount, transcriptWordCount);
        nonPhantom[i].wordCountRatio = ratio;
        nonPhantom[i].transcriptMatchScore = ratio;
      } else if (transcriptWordCount === 0 && visionCount === 0) {
        nonPhantom[i].transcriptMatchScore = 1.0;
        nonPhantom[i].wordCountRatio = 1.0;
      } else {
        nonPhantom[i].transcriptMatchScore = 0;
        nonPhantom[i].wordCountRatio = 0;
      }
    }

    log.debug(
      { nonPhantomLines: nonPhantom.length, transcriptLines: transcriptLines.length },
      'Phase 4: 1:1 transcript reconciliation',
    );
  } else {
    // Line count mismatch — apply sequence matching heuristic
    log.debug(
      { nonPhantomLines: nonPhantom.length, transcriptLines: transcriptLines.length },
      'Phase 4: line count mismatch, skipping detailed reconciliation',
    );

    // Still set basic word count ratios based on vision word counts
    for (const line of nonPhantom) {
      if (line.visionWordCount > 0) {
        line.transcriptMatchScore = thresholds.sequenceMatchMin;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// HPP Computation
// ---------------------------------------------------------------------------

async function computeHPP(
  imageBuffer: Buffer,
): Promise<{ peaks: { y1: number; y2: number }[] }> {
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // Count dark pixels per row (< 140 threshold)
  const rowDarkCounts = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      if (data[rowOffset + x] < 140) count++;
    }
    rowDarkCounts[y] = count;
  }

  // Smooth with a moving average (window = 5 or ~1% of height)
  const windowSize = Math.max(5, Math.round(height * 0.01));
  const smoothed = new Float64Array(height);
  let windowSum = 0;
  for (let y = 0; y < Math.min(windowSize, height); y++) {
    windowSum += rowDarkCounts[y];
  }

  for (let y = 0; y < height; y++) {
    const windowEnd = Math.min(y + windowSize, height);
    const windowStart = Math.max(0, y);
    const windowLen = windowEnd - windowStart;
    smoothed[y] = windowSum / windowLen;

    // Slide the window
    if (y + windowSize < height) {
      windowSum += rowDarkCounts[y + windowSize];
    }
    if (y > 0) {
      windowSum -= rowDarkCounts[y - 1];
    }
  }

  // Find peaks: regions where dark pixel count is above median
  const allSmoothed = Array.from(smoothed);
  const sortedSmoothed = [...allSmoothed].sort((a, b) => a - b);
  const medianVal = sortedSmoothed[Math.floor(sortedSmoothed.length / 2)];
  const peakThreshold = medianVal * 1.5; // require 1.5x median to count as a peak

  const peaks: { y1: number; y2: number }[] = [];
  let inPeak = false;
  let peakStart = 0;

  for (let y = 0; y < height; y++) {
    if (smoothed[y] > peakThreshold) {
      if (!inPeak) {
        inPeak = true;
        peakStart = y;
      }
    } else {
      if (inPeak) {
        peaks.push({ y1: peakStart, y2: y });
        inPeak = false;
      }
    }
  }
  if (inPeak) {
    peaks.push({ y1: peakStart, y2: height });
  }

  return { peaks };
}

function assignHPPOverlaps(
  lines: ReconciledLine[],
  peaks: { y1: number; y2: number }[],
): void {
  for (const line of lines) {
    const lineY1 = line.bbox[1];
    const lineY2 = line.bbox[3];
    const lineHeight = lineY2 - lineY1;
    if (lineHeight <= 0) {
      line.hppOverlap = 0;
      continue;
    }

    // Find best overlapping peak
    let bestOverlap = 0;
    for (const peak of peaks) {
      const overlapTop = Math.max(lineY1, peak.y1);
      const overlapBottom = Math.min(lineY2, peak.y2);
      const overlap = Math.max(0, overlapBottom - overlapTop);
      if (overlap > bestOverlap) bestOverlap = overlap;
    }

    line.hppOverlap = bestOverlap / lineHeight;
  }
}

// ---------------------------------------------------------------------------
// Phase 5: Confidence Scoring
// ---------------------------------------------------------------------------

function computeConfidence(
  lines: ReconciledLine[],
  hasTranscript: boolean,
): void {
  for (const line of lines) {
    if (line.isPhantom) {
      line.confidence = 0;
      continue;
    }

    const stats = line.pixelStats;

    // Individual signal scores (0-1)
    const visionScore = Math.min(1, line.visionWordCount / 3); // 3+ words = 1.0
    const contrastScore = stats ? Math.min(1, stats.rmsContrast / 0.5) : 0;
    const hppScore = Math.min(1, line.hppOverlap / 0.6); // 60%+ overlap = 1.0
    const singleSegmentScore = line.wasMerged ? 0.5 : 1.0;
    const phantomPassScore = line.isPhantom ? 0 : 1.0;
    const transcriptScore = line.transcriptMatchScore ?? 0;

    let weightedSum: number;
    let totalWeight: number;

    if (hasTranscript) {
      // With transcript
      weightedSum =
        visionScore * 0.25 +
        contrastScore * 0.15 +
        hppScore * 0.15 +
        singleSegmentScore * 0.05 +
        phantomPassScore * 0.15 +
        transcriptScore * 0.25;
      totalWeight = 1.0;
    } else {
      // Without transcript — redistribute transcript weight
      weightedSum =
        visionScore * 0.35 +
        contrastScore * 0.20 +
        hppScore * 0.20 +
        singleSegmentScore * 0.05 +
        phantomPassScore * 0.20;
      totalWeight = 1.0;
    }

    // Geometric mean approach: use weighted product for values > 0
    const signals = hasTranscript
      ? [
          { score: visionScore, weight: 0.25 },
          { score: contrastScore, weight: 0.15 },
          { score: hppScore, weight: 0.15 },
          { score: singleSegmentScore, weight: 0.05 },
          { score: phantomPassScore, weight: 0.15 },
          { score: transcriptScore, weight: 0.25 },
        ]
      : [
          { score: visionScore, weight: 0.35 },
          { score: contrastScore, weight: 0.20 },
          { score: hppScore, weight: 0.20 },
          { score: singleSegmentScore, weight: 0.05 },
          { score: phantomPassScore, weight: 0.20 },
        ];

    // Weighted geometric mean: exp(sum(w_i * ln(s_i)) / sum(w_i))
    let logSum = 0;
    let wSum = 0;
    let hasZero = false;

    for (const { score, weight } of signals) {
      if (score <= 0) {
        hasZero = true;
        break;
      }
      logSum += weight * Math.log(score);
      wSum += weight;
    }

    if (hasZero) {
      // Fall back to weighted arithmetic mean when any signal is zero
      line.confidence = Math.round(weightedSum / totalWeight * 100) / 100;
    } else {
      const geoMean = Math.exp(logSum / wSum);
      line.confidence = Math.round(geoMean * 100) / 100;
    }
  }
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

export async function reconcileLines(params: {
  segments: LineSegment[];
  ocrWordBoxes: OcrWordBox[];
  imageBuffer: Buffer;
  imageWidth: number;
  imageHeight: number;
  transcriptLines?: string[];
  thresholds?: Partial<ReconciliationThresholds>;
}): Promise<ReconciledLine[]> {
  const {
    segments,
    ocrWordBoxes,
    imageBuffer,
    imageWidth,
    imageHeight,
    transcriptLines,
    thresholds: overrides,
  } = params;

  const thresholds: ReconciliationThresholds = { ...DEFAULT_THRESHOLDS, ...overrides };

  log.info(
    { segmentCount: segments.length, ocrBoxCount: ocrWordBoxes.length, hasTranscript: !!transcriptLines },
    'Starting line reconciliation pipeline',
  );

  if (segments.length === 0) {
    log.info('No segments to reconcile');
    return [];
  }

  // Step 1: Compute median line height
  const medianHeight = computeMedianLineHeight(segments);
  log.debug({ medianHeight }, 'Computed median line height');

  // Step 2: Compute HPP
  const hpp = await computeHPP(imageBuffer);
  log.debug({ peakCount: hpp.peaks.length }, 'HPP computation complete');

  // Step 3 (Phase 1): Geometric merge
  let lines = mergeFragments(segments, medianHeight, thresholds);

  // Assign HPP overlaps before phantom detection
  assignHPPOverlaps(lines, hpp.peaks);

  // Step 4 (Phase 2): Line width extension
  extendSegmentWidths(lines, ocrWordBoxes, medianHeight, thresholds);

  // Step 5 (Phase 3): Phantom filtering
  await detectPhantomSegments(lines, imageBuffer, imageWidth, imageHeight, thresholds);

  // Step 6 (Phase 4): Transcript reconciliation
  if (transcriptLines && transcriptLines.length > 0) {
    reconcileWithTranscript(lines, ocrWordBoxes, transcriptLines, thresholds);
  }

  // Step 7 (Phase 5): Confidence scoring
  computeConfidence(lines, !!transcriptLines);

  // Step 8: Sort by vertical position (top-to-bottom), assign line numbers
  lines.sort((a, b) => a.bbox[1] - b.bbox[1]);
  for (let i = 0; i < lines.length; i++) {
    lines[i].line = i + 1;
  }

  log.info(
    {
      outputLineCount: lines.length,
      phantomCount: lines.filter((l) => l.isPhantom).length,
      mergedCount: lines.filter((l) => l.wasMerged).length,
      extendedCount: lines.filter((l) => l.wasExtended).length,
    },
    'Line reconciliation pipeline complete',
  );

  return lines;
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export async function calibrateThresholds(
  corrections: LineCorrection[],
  collectionCode?: string,
): Promise<CalibratedThresholds> {
  log.info(
    { correctionCount: corrections.length, collectionCode },
    'Calibrating thresholds from corrections',
  );

  if (corrections.length === 0) {
    return {
      calibratedAt: new Date().toISOString(),
      correctionCount: 0,
      collectionCode,
    };
  }

  const calibrated: CalibratedThresholds = {
    calibratedAt: new Date().toISOString(),
    correctionCount: corrections.length,
    collectionCode,
  };

  // Group corrections by type
  const byType = new Map<string, LineCorrection[]>();
  for (const c of corrections) {
    const list = byType.get(c.correctionType) ?? [];
    list.push(c);
    byType.set(c.correctionType, list);
  }

  // --- Phantom detection calibration ---
  // reject_phantom = algorithm said phantom, user said real
  // confirm_phantom = algorithm said phantom, user agreed
  // delete = algorithm said real, user said phantom/delete
  const rejectPhantom = byType.get('reject_phantom') ?? [];
  const confirmPhantom = byType.get('confirm_phantom') ?? [];
  const deletes = byType.get('delete') ?? [];

  // Collect pixel stats from "real" lines (rejected phantoms = actually real)
  const realStats = rejectPhantom
    .map((c) => c.errorRegionPixelStats ?? c.algorithmOutput.pixelStats)
    .filter((s): s is NonNullable<typeof s> => s != null);

  // Collect pixel stats from "phantom" lines (confirmed phantoms + deletes)
  const phantomStats = [
    ...confirmPhantom.map((c) => c.algorithmOutput.pixelStats),
    ...deletes.map((c) => c.algorithmOutput.pixelStats),
  ].filter((s): s is NonNullable<typeof s> => s != null);

  if (realStats.length > 0 && phantomStats.length > 0) {
    // Find midpoint between real and phantom distributions for each metric

    const realRms = median(realStats.map((s) => s.rmsContrast));
    const phantomRms = median(phantomStats.map((s) => s.rmsContrast));
    if (realRms !== phantomRms) {
      calibrated.rmsContrastBleed = (realRms + phantomRms) / 2;
    }

    const realMinVal = median(realStats.map((s) => s.minValue));
    const phantomMinVal = median(phantomStats.map((s) => s.minValue));
    if (realMinVal !== phantomMinVal) {
      calibrated.minValueBleed = (realMinVal + phantomMinVal) / 2;
    }

    const realHpp = median(
      rejectPhantom.map((c) => c.algorithmOutput.hppOverlap),
    );
    const phantomHpp = median(
      [...confirmPhantom, ...deletes].map((c) => c.algorithmOutput.hppOverlap),
    );
    if (realHpp !== phantomHpp) {
      calibrated.hppOverlapMin = (realHpp + phantomHpp) / 2;
    }
  }

  // --- Merge calibration ---
  const mergeCorrections = byType.get('merge') ?? [];
  const splitCorrections = byType.get('split') ?? [];

  if (mergeCorrections.length > 0) {
    // User merged lines the algorithm kept separate — loosen gap thresholds
    const mergeGaps = mergeCorrections
      .map((c) => c.algorithmOutput.mergeGapPx)
      .filter((g): g is number => g != null);
    if (mergeGaps.length > 0) {
      const maxCorrectedGap = Math.max(...mergeGaps);
      // Derive from page context: gapPx / medianLineHeight
      const avgMedianHeight = median(
        mergeCorrections.map((c) => {
          const totalSegs = c.pageContext.totalSegments;
          return totalSegs > 0 ? c.pageContext.imageHeight / totalSegs : 40;
        }),
      );
      if (avgMedianHeight > 0) {
        const neededFactor = maxCorrectedGap / avgMedianHeight;
        calibrated.maxPolygonGapFactor = Math.max(
          DEFAULT_THRESHOLDS.maxPolygonGapFactor,
          neededFactor * 1.1, // 10% margin
        );
      }
    }
  }

  if (splitCorrections.length > 0) {
    // User split lines the algorithm merged — tighten baseline discrepancy
    const splitGaps = splitCorrections
      .map((c) => c.algorithmOutput.mergeGapPx)
      .filter((g): g is number => g != null);
    if (splitGaps.length > 0) {
      const minSplitGap = Math.min(...splitGaps);
      const avgMedianHeight = median(
        splitCorrections.map((c) => {
          const totalSegs = c.pageContext.totalSegments;
          return totalSegs > 0 ? c.pageContext.imageHeight / totalSegs : 40;
        }),
      );
      if (avgMedianHeight > 0) {
        const factor = minSplitGap / avgMedianHeight;
        calibrated.maxBaselineDiscrepancy = Math.min(
          DEFAULT_THRESHOLDS.maxBaselineDiscrepancy,
          factor * 0.9, // 10% stricter
        );
      }
    }
  }

  // --- Resize calibration ---
  const resizeCorrections = byType.get('resize') ?? [];
  if (resizeCorrections.length > 0) {
    // Analyze how far bboxes were extended by user corrections
    const extensionRatios: number[] = [];
    for (const c of resizeCorrections) {
      if (!c.correctedBbox) continue;
      const algoBbox = c.algorithmOutput.bbox;
      const algoWidth = algoBbox[2] - algoBbox[0];
      const corrWidth = c.correctedBbox[2] - c.correctedBbox[0];
      if (algoWidth > 0) {
        extensionRatios.push(corrWidth / algoWidth);
      }
    }
    if (extensionRatios.length > 0) {
      const maxRatio = Math.max(...extensionRatios);
      if (maxRatio > 1) {
        // User needed wider lines — increase extension gap factor
        calibrated.maxExtensionGapFactor = Math.max(
          DEFAULT_THRESHOLDS.maxExtensionGapFactor,
          DEFAULT_THRESHOLDS.maxExtensionGapFactor * (maxRatio - 1) + DEFAULT_THRESHOLDS.maxExtensionGapFactor,
        );
      }
    }
  }

  log.info(
    { calibrated, correctionCount: corrections.length },
    'Threshold calibration complete',
  );

  return calibrated;
}

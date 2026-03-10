import type { OcrWordBox } from '../types/Letter';
import type { EnrichedSegment } from './attachWordsToSegments';

export interface GroupedLine {
  /** Sequential line number after grouping */
  line: number;
  /** Union bounding box of all constituent segments */
  bbox: [number, number, number, number];
  /** Combined baseline */
  baseline: number[][];
  /** Combined boundary points */
  boundary?: { x: number; y: number }[];
  /** All Vision words attached to this grouped line */
  visionWords: OcrWordBox[];
  /** Concatenated vision text */
  visionText: string;
  /** Original segments that were grouped */
  constituents: EnrichedSegment[];
  /** Whether this line is the result of merging multiple segments */
  merged: boolean;
  /** Which region this line belongs to */
  region: 'body' | 'margin' | 'header' | 'footer';
}

export interface GroupingResult {
  lines: GroupedLine[];
  /** Segments that were classified as marginal/non-body */
  marginalSegments: EnrichedSegment[];
}

function midY(seg: EnrichedSegment): number {
  return (seg.bbox[1] + seg.bbox[3]) / 2;
}

function segHeight(seg: EnrichedSegment): number {
  return seg.bbox[3] - seg.bbox[1];
}

function segWidth(seg: EnrichedSegment): number {
  return seg.bbox[2] - seg.bbox[0];
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Checks whether the rightmost word of `left` is spatially adjacent to
 * the leftmost word of `right`, indicating text continuity across the gap.
 */
function hasWordContinuity(
  left: EnrichedSegment,
  right: EnrichedSegment,
  medianLineHeight: number,
): boolean {
  if (left.visionWords.length === 0 || right.visionWords.length === 0) {
    return false;
  }

  // visionWords are already sorted left-to-right by attachWordsToSegments
  const rightmostWord = left.visionWords[left.visionWords.length - 1];
  const leftmostWord = right.visionWords[0];

  // Horizontal gap between the two words
  const gap = leftmostWord.bbox[0] - rightmostWord.bbox[2];
  // Vertical center alignment
  const rightCenter = (rightmostWord.bbox[1] + rightmostWord.bbox[3]) / 2;
  const leftCenter = (leftmostWord.bbox[1] + leftmostWord.bbox[3]) / 2;
  const vertDelta = Math.abs(rightCenter - leftCenter);

  return gap >= 0 && gap <= medianLineHeight * 2.5 && vertDelta <= medianLineHeight * 0.5;
}

type RegionLabel = 'body' | 'margin' | 'header' | 'footer';

/**
 * Classifies each segment into a region based on its center-x position
 * relative to the IQR of all center-x values.
 */
function classifyRegions(
  segments: EnrichedSegment[],
  minAspectRatio: number,
): Map<EnrichedSegment, RegionLabel> {
  const regionMap = new Map<EnrichedSegment, RegionLabel>();

  if (segments.length === 0) return regionMap;

  const centerXs = segments.map((s) => (s.bbox[0] + s.bbox[2]) / 2);
  const q25 = percentile(centerXs, 25);
  const q75 = percentile(centerXs, 75);

  // Compute overall page bounds from all segments
  let pageLeft = Infinity;
  let pageRight = -Infinity;
  for (const s of segments) {
    if (s.bbox[0] < pageLeft) pageLeft = s.bbox[0];
    if (s.bbox[2] > pageRight) pageRight = s.bbox[2];
  }
  const pageWidth = pageRight - pageLeft;
  // Edge zone: segments whose center-x is in the outer 15% of the page
  const edgeThreshold = pageWidth * 0.15;

  for (const seg of segments) {
    const cx = (seg.bbox[0] + seg.bbox[2]) / 2;
    const ar = segWidth(seg) / Math.max(1, segHeight(seg));

    // Low aspect ratio at the edges = margin annotation
    const isAtEdge =
      (cx - pageLeft) < edgeThreshold || (pageRight - cx) < edgeThreshold;
    const isLowAspect = ar < minAspectRatio;

    if (isAtEdge && isLowAspect) {
      regionMap.set(seg, 'margin');
    } else if (cx < q25 || cx > q75) {
      // Outside the IQR but not necessarily a margin — use aspect ratio
      // to decide. Normal text lines tend to have decent width.
      if (isLowAspect) {
        regionMap.set(seg, 'margin');
      } else {
        regionMap.set(seg, 'body');
      }
    } else {
      regionMap.set(seg, 'body');
    }
  }

  return regionMap;
}

/**
 * Runs greedy left-to-right chaining within a set of segments,
 * using relative thresholds based on median line height.
 */
function chainSegments(
  segments: EnrichedSegment[],
  medianLineHeight: number,
  maxGapRatio: number,
  maxVerticalRatio: number,
  maxEdgeRatio: number,
): EnrichedSegment[][] {
  if (segments.length === 0) return [];

  // Sort by left edge, then top edge as tiebreaker
  const sorted = [...segments].sort((a, b) => {
    const dx = a.bbox[0] - b.bbox[0];
    if (dx !== 0) return dx;
    return a.bbox[1] - b.bbox[1];
  });

  const chains: EnrichedSegment[][] = [];

  for (const seg of sorted) {
    let bestChainIdx = -1;
    let bestGap = Infinity;

    for (let c = 0; c < chains.length; c++) {
      const tail = chains[c][chains[c].length - 1];

      // Horizontal gap: seg's west pole minus tail's east pole
      const gap = seg.bbox[0] - tail.bbox[2];
      if (gap < 0) continue;

      // Base thresholds (relative to median line height)
      const baseMaxGap = maxGapRatio * medianLineHeight;
      const maxVertDelta = maxVerticalRatio * medianLineHeight;
      const maxEdgeDelta = maxEdgeRatio * medianLineHeight;

      // Word continuity boost: allow 1.5x gap when words bridge the gap
      const continuityBoost = hasWordContinuity(tail, seg, medianLineHeight);
      const effectiveMaxGap = continuityBoost ? baseMaxGap * 1.5 : baseMaxGap;

      if (gap > effectiveMaxGap) continue;

      // Vertical center alignment
      if (Math.abs(midY(seg) - midY(tail)) > maxVertDelta) continue;

      // Top edge alignment
      if (Math.abs(seg.bbox[1] - tail.bbox[1]) > maxEdgeDelta) continue;

      // Bottom edge alignment
      if (Math.abs(seg.bbox[3] - tail.bbox[3]) > maxEdgeDelta) continue;

      // Pick the chain with the smallest gap
      if (gap < bestGap) {
        bestGap = gap;
        bestChainIdx = c;
      }
    }

    if (bestChainIdx >= 0) {
      chains[bestChainIdx].push(seg);
    } else {
      chains.push([seg]);
    }
  }

  return chains;
}

/**
 * Converts a chain of enriched segments into a GroupedLine.
 */
function chainToGroupedLine(
  chain: EnrichedSegment[],
  region: RegionLabel,
): GroupedLine {
  if (chain.length === 1) {
    const seg = chain[0];
    return {
      line: 0, // renumbered later
      bbox: [...seg.bbox],
      baseline: seg.baseline,
      boundary: seg.boundary,
      visionWords: [...seg.visionWords],
      visionText: seg.visionText,
      constituents: [seg],
      merged: false,
      region,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const allWords: OcrWordBox[] = [];
  let allBoundary: { x: number; y: number }[] = [];
  let hasBoundary = true;

  for (const seg of chain) {
    minX = Math.min(minX, seg.bbox[0]);
    minY = Math.min(minY, seg.bbox[1]);
    maxX = Math.max(maxX, seg.bbox[2]);
    maxY = Math.max(maxY, seg.bbox[3]);

    allWords.push(...seg.visionWords);

    if (seg.boundary && seg.boundary.length > 0) {
      allBoundary = allBoundary.concat(seg.boundary);
    } else {
      hasBoundary = false;
    }
  }

  if (!hasBoundary || allBoundary.length === 0) {
    allBoundary = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
  }

  // Sort words left-to-right
  allWords.sort((a, b) => a.bbox[0] - b.bbox[0]);

  const first = chain[0];
  const last = chain[chain.length - 1];

  // Build visionText: prefer word-level text; fall back to segment-level visionText
  const visionText = allWords.length > 0
    ? allWords.map((w) => w.text).join(' ')
    : chain.map((s) => s.visionText).filter(Boolean).join(' ');

  return {
    line: 0, // renumbered later
    bbox: [minX, minY, maxX, maxY],
    baseline: [
      [first.bbox[0], last.bbox[3]],
      [last.bbox[2], last.bbox[3]],
    ],
    boundary: allBoundary,
    visionWords: allWords,
    visionText,
    constituents: chain,
    merged: chain.length > 1,
    region,
  };
}

/**
 * Replaces the magnet merge algorithm with constrained grouping.
 *
 * Key improvements over magnetMerge:
 * - Relative thresholds based on segment height (not fixed pixels)
 * - Region awareness: body vs. margin regions don't cross-merge
 * - Word continuity: Vision words validate merges across gaps
 * - Orientation filtering: low aspect ratio edge segments get isolated
 */
export function constrainedGrouping(
  segments: EnrichedSegment[],
  opts?: {
    /** Max horizontal gap as fraction of median line height. Default: 1.5 */
    maxGapRatio?: number;
    /** Max vertical center offset as fraction of line height. Default: 0.3 */
    maxVerticalRatio?: number;
    /** Max top/bottom edge offset as fraction of line height. Default: 0.4 */
    maxEdgeRatio?: number;
    /** Min aspect ratio (width/height) to be considered a text line. Default: 1.5 */
    minAspectRatio?: number;
  },
): GroupingResult {
  if (!segments || segments.length === 0) {
    return { lines: [], marginalSegments: [] };
  }

  const maxGapRatio = opts?.maxGapRatio ?? 1.5;
  const maxVerticalRatio = opts?.maxVerticalRatio ?? 0.3;
  const maxEdgeRatio = opts?.maxEdgeRatio ?? 0.4;
  const minAspectRatio = opts?.minAspectRatio ?? 1.5;

  // Step 1: Compute median line height
  const heights = segments.map((s) => segHeight(s));
  const medianLineHeight = Math.max(1, computeMedian(heights));

  // Step 2: Classify regions
  const regionMap = classifyRegions(segments, minAspectRatio);

  // Step 3: Separate segments by region
  const bodySegments: EnrichedSegment[] = [];
  const marginalSegments: EnrichedSegment[] = [];

  for (const seg of segments) {
    const region = regionMap.get(seg) ?? 'body';
    if (region === 'margin') {
      marginalSegments.push(seg);
    } else {
      bodySegments.push(seg);
    }
  }

  // Step 4: Chain within each region independently
  const bodyChains = chainSegments(
    bodySegments,
    medianLineHeight,
    maxGapRatio,
    maxVerticalRatio,
    maxEdgeRatio,
  );

  const marginChains = chainSegments(
    marginalSegments,
    medianLineHeight,
    maxGapRatio,
    maxVerticalRatio,
    maxEdgeRatio,
  );

  // Step 5: Convert chains to GroupedLines
  const allLines: GroupedLine[] = [];

  for (const chain of bodyChains) {
    allLines.push(chainToGroupedLine(chain, 'body'));
  }

  for (const chain of marginChains) {
    allLines.push(chainToGroupedLine(chain, 'margin'));
  }

  // Step 6: Sort by reading order (top-to-bottom, left-to-right)
  allLines.sort((a, b) => {
    const ay = (a.bbox[1] + a.bbox[3]) / 2;
    const by = (b.bbox[1] + b.bbox[3]) / 2;
    // If vertical centers are close (within half median line height),
    // sort by left edge
    if (Math.abs(ay - by) < medianLineHeight * 0.5) {
      return a.bbox[0] - b.bbox[0];
    }
    return ay - by;
  });

  // Renumber sequentially
  for (let i = 0; i < allLines.length; i++) {
    allLines[i].line = i + 1;
  }

  return {
    lines: allLines,
    marginalSegments,
  };
}

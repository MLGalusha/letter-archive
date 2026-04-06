import type { LineSegment, LineSegmentWord } from '../types/Letter';

type EdgeSegment = Pick<LineSegment, 'bbox' | 'boundary'>;

export interface GroupedLine {
  /** Sequential line number after grouping */
  line: number;
  /** Union bounding box of all constituent segments */
  bbox: [number, number, number, number];
  /** Combined baseline */
  baseline: number[][];
  /** Combined boundary points */
  boundary?: { x: number; y: number }[];
  /** All Kraken words attached to this grouped line */
  words: LineSegmentWord[];
  /** Concatenated Kraken word text */
  wordText: string;
  /** Original segments that were grouped */
  constituents: LineSegment[];
  /** Whether this line is the result of merging multiple segments */
  merged: boolean;
  /** Which region this line belongs to */
  region: 'body' | 'margin' | 'header' | 'footer';
}

export interface GroupingResult {
  lines: GroupedLine[];
  /** Segments that were classified as marginal/non-body */
  marginalSegments: LineSegment[];
}

function midY(seg: LineSegment): number {
  return (seg.bbox[1] + seg.bbox[3]) / 2;
}

function segHeight(seg: LineSegment): number {
  return seg.bbox[3] - seg.bbox[1];
}

function segWidth(seg: LineSegment): number {
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
  left: LineSegment,
  right: LineSegment,
  medianLineHeight: number,
): boolean {
  const leftWords = left.words ?? [];
  const rightWords = right.words ?? [];
  if (leftWords.length === 0 || rightWords.length === 0) {
    return false;
  }

  const rightmostWord = leftWords[leftWords.length - 1];
  const leftmostWord = rightWords[0];

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
 * Identifies outlier segments that don't belong to the main body text
 * using contextual analysis rather than fixed aspect-ratio rules.
 *
 * Strategy:
 * 1. Wide segments form the "core body" cluster — they define the body column.
 * 2. Narrow segments are body fragments if they're inside the body column
 *    OR directly adjacent to a core segment (like "9" next to "70").
 * 3. Narrow segments outside the body column with no nearby core neighbors
 *    are margin annotations.
 */
function identifyOutliers(
  segments: LineSegment[],
  medianHeight: number,
): { body: LineSegment[]; margin: LineSegment[] } {
  if (segments.length === 0) {
    return { body: [], margin: [] };
  }

  const widths = segments.map((s) => segWidth(s));
  const medianWidth = computeMedian(widths);

  // Core body segments: width >= max(40% of median, 25th percentile)
  const coreThreshold = Math.max(medianWidth * 0.4, percentile(widths, 25));
  const coreSegments = segments.filter((s) => segWidth(s) >= coreThreshold);

  if (coreSegments.length === 0) {
    return { body: [...segments], margin: [] };
  }

  // Body column X bounds from core segments (generous percentiles)
  const bodyLeft = percentile(coreSegments.map((s) => s.bbox[0]), 15);
  const bodyRight = percentile(coreSegments.map((s) => s.bbox[2]), 85);

  const body: LineSegment[] = [];
  const margin: LineSegment[] = [];

  for (const seg of segments) {
    // Core-width segments → always body
    if (segWidth(seg) >= coreThreshold) {
      body.push(seg);
      continue;
    }

    // Narrow segment — check context
    const cx = (seg.bbox[0] + seg.bbox[2]) / 2;
    const inBodyColumn = cx >= bodyLeft && cx <= bodyRight;

    let adjacentToCore = false;
    const sh = segHeight(seg);
    for (const core of coreSegments) {
      if (Math.abs(midY(seg) - midY(core)) > medianHeight * 1.5) continue;
      const ch = segHeight(core);
      if (sh / Math.max(ch, 1) < 0.4) continue;
      const xGap = Math.max(
        0,
        seg.bbox[0] - core.bbox[2],
        core.bbox[0] - seg.bbox[2],
      );
      if (xGap < medianHeight * 2.0) {
        adjacentToCore = true;
        break;
      }
    }

    if (inBodyColumn || adjacentToCore) {
      body.push(seg);
    } else {
      margin.push(seg);
    }
  }

  return { body, margin };
}

/**
 * Gets the Y range (top, bottom) at the east (right) edge of a segment,
 * using boundary polygon if available, otherwise falling back to bbox.
 */
export function eastEdgeY(seg: EdgeSegment): [number, number] {
  if (seg.boundary && seg.boundary.length >= 3) {
    const sorted = [...seg.boundary].sort((a, b) => b.x - a.x);
    const edgeX = sorted[0].x;
    const tolerance = Math.max(3, (seg.bbox[2] - seg.bbox[0]) * 0.03);
    const edgePoints = sorted.filter((p) => edgeX - p.x <= tolerance);
    if (edgePoints.length >= 2) {
      const ys = edgePoints.map((p) => p.y);
      return [Math.min(...ys), Math.max(...ys)];
    }
  }
  return [seg.bbox[1], seg.bbox[3]];
}

/**
 * Gets the Y range (top, bottom) at the west (left) edge of a segment,
 * using boundary polygon if available, otherwise falling back to bbox.
 */
export function westEdgeY(seg: EdgeSegment): [number, number] {
  if (seg.boundary && seg.boundary.length >= 3) {
    const sorted = [...seg.boundary].sort((a, b) => a.x - b.x);
    const edgeX = sorted[0].x;
    const tolerance = Math.max(3, (seg.bbox[2] - seg.bbox[0]) * 0.03);
    const edgePoints = sorted.filter((p) => p.x - edgeX <= tolerance);
    if (edgePoints.length >= 2) {
      const ys = edgePoints.map((p) => p.y);
      return [Math.min(...ys), Math.max(...ys)];
    }
  }
  return [seg.bbox[1], seg.bbox[3]];
}

/**
 * Runs greedy left-to-right chaining within a set of segments.
 *
 * Merge decision is based purely on edge-to-edge matching:
 * the RIGHT side (east edge) of the tail connects to the LEFT side
 * (west edge) of the candidate. Both the position (top/bottom Y)
 * and the height at those edges must be compatible.
 */
function chainSegments(
  segments: LineSegment[],
  medianLineHeight: number,
  maxGapRatio: number,
  maxEdgeRatio: number,
): { chains: LineSegment[][] } {
  if (segments.length === 0) return { chains: [] };

  // Sort by left edge, then top edge as tiebreaker
  const sorted = [...segments].sort((a, b) => {
    const dx = a.bbox[0] - b.bbox[0];
    if (dx !== 0) return dx;
    return a.bbox[1] - b.bbox[1];
  });

  const chains: LineSegment[][] = [];

  for (const seg of sorted) {
    let bestChainIdx = -1;
    let bestGap = Infinity;

    for (let c = 0; c < chains.length; c++) {
      const tail = chains[c][chains[c].length - 1];

      // 1. Horizontal gap: seg's left edge minus tail's right edge.
      const gap = seg.bbox[0] - tail.bbox[2];
      if (gap < 0) continue;

      const baseMaxGap = maxGapRatio * medianLineHeight;
      const continuityBoost = hasWordContinuity(tail, seg, medianLineHeight);
      const effectiveMaxGap = continuityBoost ? baseMaxGap * 1.5 : baseMaxGap;
      if (gap > effectiveMaxGap) continue;

      // 2. Overall height compatibility
      const segH = segHeight(seg);
      const tailH = segHeight(tail);
      const maxOverallH = Math.max(segH, tailH, 1);
      const minOverallH = Math.min(segH, tailH);
      if (minOverallH / maxOverallH < 0.35) continue;

      // 3. Edge matching: RIGHT side of tail → LEFT side of seg.
      const tailRight = eastEdgeY(tail);
      const segLeft = westEdgeY(seg);

      const maxEdgeDelta = maxEdgeRatio * medianLineHeight;

      const topDelta = Math.abs(segLeft[0] - tailRight[0]);
      const bottomDelta = Math.abs(segLeft[1] - tailRight[1]);
      if (topDelta > maxEdgeDelta || bottomDelta > maxEdgeDelta) continue;

      // 4. Edge height check
      const tailEdgeH = tailRight[1] - tailRight[0];
      const segEdgeH = segLeft[1] - segLeft[0];
      const maxH = Math.max(tailEdgeH, segEdgeH, 1);
      const minH = Math.min(tailEdgeH, segEdgeH);
      if (minH / maxH < 0.4) continue;

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

  return { chains };
}

/**
 * Converts a chain of segments into a GroupedLine.
 */
function chainToGroupedLine(
  chain: LineSegment[],
  region: RegionLabel,
): GroupedLine {
  if (chain.length === 1) {
    const seg = chain[0];
    return {
      line: 0,
      bbox: [...seg.bbox],
      baseline: seg.baseline,
      boundary: seg.boundary,
      words: [...(seg.words ?? [])],
      wordText: (seg.words ?? []).map((w) => w.text).join(' '),
      constituents: [seg],
      merged: false,
      region,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const allWords: LineSegmentWord[] = [];

  for (const seg of chain) {
    minX = Math.min(minX, seg.bbox[0]);
    minY = Math.min(minY, seg.bbox[1]);
    maxX = Math.max(maxX, seg.bbox[2]);
    maxY = Math.max(maxY, seg.bbox[3]);

    allWords.push(...(seg.words ?? []));
  }

  const allBoundary = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

  // Sort words left-to-right
  allWords.sort((a, b) => a.bbox[0] - b.bbox[0]);

  const first = chain[0];
  const last = chain[chain.length - 1];

  const wordText = allWords.length > 0
    ? allWords.map((w) => w.text).join(' ')
    : '';

  return {
    line: 0,
    bbox: [minX, minY, maxX, maxY],
    baseline: [
      [first.bbox[0], last.bbox[3]],
      [last.bbox[2], last.bbox[3]],
    ],
    boundary: allBoundary,
    words: allWords,
    wordText,
    constituents: chain,
    merged: chain.length > 1,
    region,
  };
}

/**
 * Groups Kraken line segments using constrained chaining.
 *
 * Key features:
 * - Relative thresholds based on segment height (not fixed pixels)
 * - Region awareness: body vs. margin regions don't cross-merge
 * - Word continuity: Kraken words validate merges across gaps
 */
export function constrainedGrouping(
  segments: LineSegment[],
  opts?: {
    /** Max horizontal gap as fraction of median line height. Default: 2.0 */
    maxGapRatio?: number;
    /** Max top/bottom edge offset as fraction of line height. Default: 0.6 */
    maxEdgeRatio?: number;
  },
): GroupingResult {
  if (!segments || segments.length === 0) {
    return { lines: [], marginalSegments: [] };
  }

  const maxGapRatio = opts?.maxGapRatio ?? 2.0;
  const maxEdgeRatio = opts?.maxEdgeRatio ?? 0.6;

  // Step 1: Compute median line height
  const heights = segments.map((s) => segHeight(s));
  const medianLineHeight = Math.max(1, computeMedian(heights));

  // Step 1.5: Contextual outlier detection
  const { body: candidateSegments, margin: definiteMargin } = identifyOutliers(
    segments,
    medianLineHeight,
  );

  // Step 2: Group candidate segments
  const { chains: allChains } = chainSegments(
    candidateSegments,
    medianLineHeight,
    maxGapRatio,
    maxEdgeRatio,
  );

  // Step 3: Convert chains to GroupedLines
  const allLines: GroupedLine[] = [];
  const marginalSegments: LineSegment[] = [...definiteMargin];

  for (const chain of allChains) {
    allLines.push(chainToGroupedLine(chain, 'body'));
  }

  // Add pre-filtered margin segments as their own grouped lines
  for (const seg of definiteMargin) {
    allLines.push(chainToGroupedLine([seg], 'margin'));
  }

  // Sort by reading order (top-to-bottom, left-to-right)
  allLines.sort((a, b) => {
    const ay = (a.bbox[1] + a.bbox[3]) / 2;
    const by = (b.bbox[1] + b.bbox[3]) / 2;
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

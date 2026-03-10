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

/** A merge that Kraken approved but Vision rejected */
export interface VisionRejectedMerge {
  left: EnrichedSegment;
  right: EnrichedSegment;
}

export interface GroupingResult {
  lines: GroupedLine[];
  /** Segments that were classified as marginal/non-body */
  marginalSegments: EnrichedSegment[];
  /** Merges that Kraken wanted but Vision rejected (for debug) */
  visionRejections: VisionRejectedMerge[];
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
  segments: EnrichedSegment[],
  medianHeight: number,
): { body: EnrichedSegment[]; margin: EnrichedSegment[] } {
  if (segments.length === 0) {
    return { body: [], margin: [] };
  }

  const widths = segments.map((s) => segWidth(s));
  const medianWidth = computeMedian(widths);

  // Core body segments: width >= max(40% of median, 25th percentile)
  // These reliably represent body text lines
  const coreThreshold = Math.max(medianWidth * 0.4, percentile(widths, 25));
  const coreSegments = segments.filter((s) => segWidth(s) >= coreThreshold);

  if (coreSegments.length === 0) {
    return { body: [...segments], margin: [] };
  }

  // Body column X bounds from core segments (generous percentiles)
  const bodyLeft = percentile(coreSegments.map((s) => s.bbox[0]), 15);
  const bodyRight = percentile(coreSegments.map((s) => s.bbox[2]), 85);

  const body: EnrichedSegment[] = [];
  const margin: EnrichedSegment[] = [];

  for (const seg of segments) {
    // Core-width segments → always body
    if (segWidth(seg) >= coreThreshold) {
      body.push(seg);
      continue;
    }

    // Narrow segment — check context
    const cx = (seg.bbox[0] + seg.bbox[2]) / 2;
    const inBodyColumn = cx >= bodyLeft && cx <= bodyRight;

    // Check if directly adjacent to a core segment at similar Y AND height.
    // This catches body fragments like "9" next to "70" that are
    // outside the body column but clearly part of a body line.
    // Requires height similarity to avoid classifying short margin annotations
    // as body just because they're near a body line.
    let adjacentToCore = false;
    const sh = segHeight(seg);
    for (const core of coreSegments) {
      if (Math.abs(midY(seg) - midY(core)) > medianHeight * 1.5) continue;
      // Height compatibility: the narrow segment must have similar height
      // to the core segment (at least 40% as tall)
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
export function eastEdgeY(seg: EnrichedSegment): [number, number] {
  if (seg.boundary && seg.boundary.length >= 3) {
    // Find boundary points closest to the right edge.
    // Use the rightmost point's x as anchor, include points within a tight
    // tolerance (3% of width or 3px) to avoid capturing midline contour points
    // that would inflate the edge height beyond the actual segment edge.
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
export function westEdgeY(seg: EnrichedSegment): [number, number] {
  if (seg.boundary && seg.boundary.length >= 3) {
    // Find boundary points closest to the left edge (same tight tolerance)
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
 * Vision-based edge alignment check for merge validation.
 *
 * Grabs the rightmost Vision word of the left segment and the leftmost
 * Vision word of the right segment. Compares the right edge (top/bottom Y)
 * of the left word against the left edge (top/bottom Y) of the right word —
 * same logic as the Kraken edge-to-edge check but using Vision boxes as an
 * independent second opinion.
 *
 * Returns `true` if Vision confirms the merge (edges align) or if there
 * aren't enough Vision words to judge. Returns `false` if Vision says
 * the edges clearly don't align (different lines).
 */
function visionConfirmsMerge(
  left: EnrichedSegment,
  right: EnrichedSegment,
  medianLineHeight: number,
): boolean {
  // Quick win: if any Vision word literally spans the gap between the
  // two segments, that's definitive proof they belong on the same line.
  const gapStart = left.bbox[2];
  const gapEnd = right.bbox[0];
  const allWords = [...left.visionWords, ...right.visionWords];
  for (const w of allWords) {
    if (w.bbox[0] <= gapStart && w.bbox[2] >= gapEnd) {
      return true; // a word bridges the gap
    }
  }

  // If neither side has Vision words, allow (nothing to validate against).
  // If one side has words and the other doesn't, only allow if the wordless
  // segment is substantial (wide enough to be a real text fragment).
  // Tiny segments with no words are likely edge artifacts.
  const hasLeft = left.visionWords.length > 0;
  const hasRight = right.visionWords.length > 0;
  if (!hasLeft && !hasRight) return true;
  if (!hasLeft) {
    return segWidth(left) >= medianLineHeight * 1.5;
  }
  if (!hasRight) {
    return segWidth(right) >= medianLineHeight * 1.5;
  }

  const leftWord = left.visionWords[left.visionWords.length - 1];
  const rightWord = right.visionWords[0];

  // Right edge of left word: top Y = bbox[1], bottom Y = bbox[3]
  const leftTop = leftWord.bbox[1];
  const leftBottom = leftWord.bbox[3];

  // Left edge of right word: top Y = bbox[1], bottom Y = bbox[3]
  const rightTop = rightWord.bbox[1];
  const rightBottom = rightWord.bbox[3];

  // Check top-top and bottom-bottom alignment
  const topDelta = Math.abs(leftTop - rightTop);
  const bottomDelta = Math.abs(leftBottom - rightBottom);

  // Also check height similarity of the junction words themselves
  const leftWordH = leftBottom - leftTop;
  const rightWordH = rightBottom - rightTop;
  const maxWordH = Math.max(leftWordH, rightWordH, 1);
  const minWordH = Math.min(leftWordH, rightWordH);

  // Vision boxes are less precise than Kraken but should still agree
  // on which line they're on. Use moderate tolerance.
  const maxDelta = medianLineHeight * 0.5;

  if (topDelta > maxDelta || bottomDelta > maxDelta) return false;
  if (minWordH / maxWordH < 0.5) return false;

  return true;
}

/**
 * Runs greedy left-to-right chaining within a set of segments.
 *
 * Merge decision is based purely on edge-to-edge matching:
 * the RIGHT side (east edge) of the tail connects to the LEFT side
 * (west edge) of the candidate. Both the position (top/bottom Y)
 * and the height at those edges must be compatible.
 *
 * This prevents merging segments from adjacent lines whose overall
 * bboxes might overlap but whose actual meeting edges don't align.
 */
function chainSegments(
  segments: EnrichedSegment[],
  medianLineHeight: number,
  maxGapRatio: number,
  maxEdgeRatio: number,
): { chains: EnrichedSegment[][]; visionRejections: VisionRejectedMerge[] } {
  if (segments.length === 0) return { chains: [], visionRejections: [] };

  // Sort by left edge, then top edge as tiebreaker
  const sorted = [...segments].sort((a, b) => {
    const dx = a.bbox[0] - b.bbox[0];
    if (dx !== 0) return dx;
    return a.bbox[1] - b.bbox[1];
  });

  const chains: EnrichedSegment[][] = [];
  const visionRejections: VisionRejectedMerge[] = [];

  for (const seg of sorted) {
    let bestChainIdx = -1;
    let bestGap = Infinity;

    for (let c = 0; c < chains.length; c++) {
      const tail = chains[c][chains[c].length - 1];

      // 1. Horizontal gap: seg's left edge minus tail's right edge.
      //    Only right→left connections allowed (no overlapping merges).
      const gap = seg.bbox[0] - tail.bbox[2];
      if (gap < 0) continue;

      const baseMaxGap = maxGapRatio * medianLineHeight;
      const continuityBoost = hasWordContinuity(tail, seg, medianLineHeight);
      const effectiveMaxGap = continuityBoost ? baseMaxGap * 1.5 : baseMaxGap;
      if (gap > effectiveMaxGap) continue;

      // 2. Overall height compatibility: segments with very different
      //    heights are clearly from different lines (e.g., short margin
      //    annotation vs. full body line). Reject early.
      const segH = segHeight(seg);
      const tailH = segHeight(tail);
      const maxOverallH = Math.max(segH, tailH, 1);
      const minOverallH = Math.min(segH, tailH);
      if (minOverallH / maxOverallH < 0.35) continue;

      // 3. Edge matching: RIGHT side of tail → LEFT side of seg.
      //    Get top/bottom Y at the meeting edges from boundary polygons.
      const tailRight = eastEdgeY(tail);   // [topY, bottomY]
      const segLeft = westEdgeY(seg);      // [topY, bottomY]

      const maxEdgeDelta = maxEdgeRatio * medianLineHeight;

      // Position check: the top and bottom Y at meeting edges must be close
      const topDelta = Math.abs(segLeft[0] - tailRight[0]);
      const bottomDelta = Math.abs(segLeft[1] - tailRight[1]);
      if (topDelta > maxEdgeDelta || bottomDelta > maxEdgeDelta) continue;

      // 4. Edge height check: the heights at the meeting edges must be similar.
      //    Prevents merging a tall segment (different line) with a short one.
      const tailEdgeH = tailRight[1] - tailRight[0];
      const segEdgeH = segLeft[1] - segLeft[0];
      const maxH = Math.max(tailEdgeH, segEdgeH, 1);
      const minH = Math.min(tailEdgeH, segEdgeH);
      if (minH / maxH < 0.4) continue;

      // 5. Vision word edge alignment: use Vision boxes as independent
      //    confirmation. Grab the rightmost word of tail and leftmost word
      //    of seg, compare their top-top / bottom-bottom Y alignment.
      //    If Vision says the junction doesn't line up, reject the merge.
      if (!visionConfirmsMerge(tail, seg, medianLineHeight)) {
        visionRejections.push({ left: tail, right: seg });
        continue;
      }

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

  return { chains, visionRejections };
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

    if (!seg.boundary || seg.boundary.length === 0) {
      hasBoundary = false;
    }
  }

  // Merged boundary: just use the union bbox rectangle.
  // Individual constituent boundaries are preserved on each segment
  // and rendered separately in the debug overlay.
  allBoundary = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

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
    /** Max horizontal gap as fraction of median line height. Default: 2.0 */
    maxGapRatio?: number;
    /** Max top/bottom edge offset as fraction of line height. Default: 0.6 */
    maxEdgeRatio?: number;
  },
): GroupingResult {
  if (!segments || segments.length === 0) {
    return { lines: [], marginalSegments: [], visionRejections: [] };
  }

  const maxGapRatio = opts?.maxGapRatio ?? 2.0;
  const maxEdgeRatio = opts?.maxEdgeRatio ?? 0.6;

  // Step 1: Compute median line height
  const heights = segments.map((s) => segHeight(s));
  const medianLineHeight = Math.max(1, computeMedian(heights));

  // Step 1.5: Contextual outlier detection.
  // Instead of fixed aspect-ratio rules, analyze what's around each segment:
  // wide segments form the body cluster, narrow segments are body fragments
  // if they're in the body column or adjacent to core segments, otherwise margin.
  const { body: candidateSegments, margin: definiteMargin } = identifyOutliers(
    segments,
    medianLineHeight,
  );

  // Step 2: Group candidate segments (excludes obvious margin).
  // This allows small body fragments (like "9" from "970") to merge with
  // adjacent body segments before region classification runs.
  const { chains: allChains, visionRejections } = chainSegments(
    candidateSegments,
    medianLineHeight,
    maxGapRatio,
    maxEdgeRatio,
  );

  // Step 3: Convert chains to GroupedLines. All candidate segments passed
  // outlier detection, so they're body lines.
  const allLines: GroupedLine[] = [];
  const marginalSegments: EnrichedSegment[] = [...definiteMargin];

  for (const chain of allChains) {
    allLines.push(chainToGroupedLine(chain, 'body'));
  }

  // Add pre-filtered margin segments as their own grouped lines
  for (const seg of definiteMargin) {
    allLines.push(chainToGroupedLine([seg], 'margin'));
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
    visionRejections,
  };
}

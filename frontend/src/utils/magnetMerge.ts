import type { LineSegment } from '../types/Letter';

export interface MergedLineSegment extends LineSegment {
  merged: boolean;
  constituents: LineSegment[];
}

interface MergeOptions {
  maxGapPx?: number;
  maxVerticalDeltaPx?: number;
  maxTopBottomDeltaPx?: number;
}

function midY(seg: LineSegment): number {
  return (seg.bbox[1] + seg.bbox[3]) / 2;
}

/**
 * Merges horizontally adjacent Kraken line segments whose edges are close
 * ("magnet merge").  East pole of one segment attracts the west pole of the
 * next when they are vertically aligned.
 *
 * Pure function -- does not mutate the input array.
 */
export function magnetMerge(
  segments: LineSegment[],
  opts?: MergeOptions,
): MergedLineSegment[] {
  if (!segments || segments.length === 0) return [];

  const maxGapPx = opts?.maxGapPx ?? 40;
  const maxVerticalDeltaPx = opts?.maxVerticalDeltaPx ?? 20;
  const maxTopBottomDeltaPx = opts?.maxTopBottomDeltaPx ?? 30;

  // Sort by left_x (bbox[0]) ascending, then top_y (bbox[1]) as tiebreaker
  const sorted = [...segments].sort((a, b) => {
    const dx = a.bbox[0] - b.bbox[0];
    if (dx !== 0) return dx;
    return a.bbox[1] - b.bbox[1];
  });

  // Each chain is an ordered list of segments to be merged together.
  // chains[i] is an array of LineSegments whose east-to-west edges are close.
  const chains: LineSegment[][] = [];

  for (const seg of sorted) {
    let bestChainIdx = -1;
    let bestGap = Infinity;

    for (let c = 0; c < chains.length; c++) {
      const tail = chains[c][chains[c].length - 1];

      // Horizontal gap: seg's west pole minus tail's east pole
      const gap = seg.bbox[0] - tail.bbox[2];
      if (gap < 0 || gap > maxGapPx) continue;

      // Vertical center alignment
      if (Math.abs(midY(seg) - midY(tail)) > maxVerticalDeltaPx) continue;

      // Top edge alignment
      if (Math.abs(seg.bbox[1] - tail.bbox[1]) > maxTopBottomDeltaPx) continue;

      // Bottom edge alignment
      if (Math.abs(seg.bbox[3] - tail.bbox[3]) > maxTopBottomDeltaPx) continue;

      // Pick the chain with the smallest gap (closest east-to-west)
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

  // Convert chains to MergedLineSegment[]
  const result: MergedLineSegment[] = [];

  for (const chain of chains) {
    if (chain.length === 1) {
      // Single segment -- pass through unchanged
      result.push({
        ...chain[0],
        merged: false,
        constituents: [chain[0]],
      });
      continue;
    }

    // Compute union bbox
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const allWords: LineSegment['words'] = [];
    const ocrParts: string[] = [];
    let allBoundary: { x: number; y: number }[] = [];
    let hasBoundary = true;

    for (const seg of chain) {
      minX = Math.min(minX, seg.bbox[0]);
      minY = Math.min(minY, seg.bbox[1]);
      maxX = Math.max(maxX, seg.bbox[2]);
      maxY = Math.max(maxY, seg.bbox[3]);

      if (seg.words) {
        allWords.push(...seg.words);
      }
      ocrParts.push(seg.ocrText);

      if (seg.boundary && seg.boundary.length > 0) {
        allBoundary = allBoundary.concat(seg.boundary);
      } else {
        hasBoundary = false;
      }
    }

    // Fall back to rectangular boundary from union bbox if any constituent
    // lacked boundary data
    if (!hasBoundary || allBoundary.length === 0) {
      allBoundary = [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ];
    }

    const first = chain[0];
    const last = chain[chain.length - 1];

    result.push({
      line: 0, // re-numbered below
      bbox: [minX, minY, maxX, maxY],
      baseline: [
        [first.bbox[0], last.bbox[3]],
        [last.bbox[2], last.bbox[3]],
      ],
      boundary: allBoundary,
      words: allWords.length > 0 ? allWords : undefined,
      ocrText: ocrParts.join(' '),
      merged: true,
      constituents: chain,
    });
  }

  // Re-number lines sequentially
  for (let i = 0; i < result.length; i++) {
    result[i].line = i + 1;
  }

  return result;
}

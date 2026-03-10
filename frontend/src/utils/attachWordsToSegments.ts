import type { LineSegment, OcrWordBox } from '../types/Letter';

export interface EnrichedSegment extends LineSegment {
  /** Vision words that overlap this segment */
  visionWords: OcrWordBox[];
  /** Concatenated text from attached Vision words (left-to-right) */
  visionText: string;
}

export interface AttachmentResult {
  /** Kraken segments with Vision words attached */
  enriched: EnrichedSegment[];
  /** Vision words that didn't overlap any Kraken segment */
  unassigned: OcrWordBox[];
}

function intersectionArea(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function boxArea(bbox: [number, number, number, number]): number {
  return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
}

/**
 * Attaches Vision OCR word boxes to Kraken line segments by spatial overlap.
 * Each word is assigned to the segment with the greatest intersection area.
 * Words with no significant overlap go into the unassigned pool.
 */
export function attachWordsToSegments(
  segments: LineSegment[],
  words: OcrWordBox[],
  opts?: {
    /** Minimum overlap ratio (intersection area / word area) to consider a match. Default: 0.3 */
    minOverlapRatio?: number;
  },
): AttachmentResult {
  const minOverlapRatio = opts?.minOverlapRatio ?? 0.3;

  // 1. Create enriched copies of each segment
  const enriched: EnrichedSegment[] = segments.map((seg) => ({
    ...seg,
    visionWords: [],
    visionText: '',
  }));

  const unassigned: OcrWordBox[] = [];

  // 2. For each word, find the best-overlapping segment
  for (const word of words) {
    const wordA = boxArea(word.bbox);
    if (wordA <= 0) {
      unassigned.push(word);
      continue;
    }

    let bestIdx = -1;
    let bestArea = 0;

    for (let i = 0; i < enriched.length; i++) {
      const overlap = intersectionArea(word.bbox, enriched[i].bbox);
      if (overlap > bestArea) {
        bestArea = overlap;
        bestIdx = i;
      }
    }

    const ratio = bestArea / wordA;
    if (bestIdx >= 0 && ratio >= minOverlapRatio) {
      enriched[bestIdx].visionWords.push(word);
    } else {
      unassigned.push(word);
    }
  }

  // 3. Sort words left-to-right and build visionText
  for (const seg of enriched) {
    seg.visionWords.sort((a, b) => a.bbox[0] - b.bbox[0]);
    seg.visionText = seg.visionWords.map((w) => w.text).join(' ');
  }

  return { enriched, unassigned };
}

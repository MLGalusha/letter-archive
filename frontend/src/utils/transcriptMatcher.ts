import type { OcrWordBox } from '../types/Letter';
import type { GroupedLine } from './constrainedGrouping';

export interface MatchedLine {
  /** The transcript line text */
  transcriptText: string;
  /** The transcript line index (0-based) */
  transcriptLineIndex: number;
  /** The matched grouped line, or null if no match (Vision fallback needed) */
  groupedLine: GroupedLine | null;
  /** Match confidence 0-1 */
  confidence: number;
  /** How this line was matched */
  matchSource: 'kraken+vision' | 'vision-only' | 'unmatched';
  /** Bounding box for display (from groupedLine or Vision fallback) */
  bbox: [number, number, number, number] | null;
  /** Boundary for display */
  boundary?: { x: number; y: number }[];
}

export interface TranscriptMatchResult {
  matched: MatchedLine[];
  /** Grouped lines with no transcript match (printed headers, excluded content) */
  excludedContent: GroupedLine[];
}

function normalizeToken(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Computes normalized word overlap (Jaccard-like) between two strings.
 * Returns a value in [0, 1].
 */
function wordOverlap(a: string, b: string): number {
  const tokensA = a
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  const tokensB = b
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);

  if (tokensA.length === 0 && tokensB.length === 0) return 0;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection++;
    }
  }

  // Also check fuzzy matches for tokens that didn't match exactly
  const unmatchedA = [...setA].filter((t) => !setB.has(t));
  const unmatchedB = [...setB].filter((t) => !setA.has(t));

  let fuzzyMatches = 0;
  for (const a of unmatchedA) {
    for (const b of unmatchedB) {
      if (a.length > 2 && b.length > 2) {
        // Simple containment or high similarity
        if (a.includes(b) || b.includes(a)) {
          fuzzyMatches += 0.7;
          break;
        }
        // Levenshtein-like: if edit distance is small relative to length
        const maxLen = Math.max(a.length, b.length);
        const minLen = Math.min(a.length, b.length);
        if (minLen / maxLen >= 0.6) {
          let commonPrefix = 0;
          for (let i = 0; i < minLen; i++) {
            if (a[i] === b[i]) commonPrefix++;
            else break;
          }
          if (commonPrefix / maxLen >= 0.5) {
            fuzzyMatches += 0.5;
            break;
          }
        }
      }
    }
  }

  const effectiveIntersection = intersection + fuzzyMatches;
  const union = new Set([...setA, ...setB]).size;

  return effectiveIntersection / union;
}

/**
 * Finds a run of unassigned Vision words that best matches a transcript line.
 * Returns the bounding box of the matching run, or null.
 */
function findVisionFallback(
  transcriptLine: string,
  unassignedWords: OcrWordBox[],
): { bbox: [number, number, number, number]; confidence: number } | null {
  if (unassignedWords.length === 0) return null;

  const transcriptTokens = transcriptLine
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  if (transcriptTokens.length === 0) return null;

  // Sort unassigned words by reading order (top-to-bottom, left-to-right)
  const sorted = [...unassignedWords].sort((a, b) => {
    const ay = (a.bbox[1] + a.bbox[3]) / 2;
    const by = (b.bbox[1] + b.bbox[3]) / 2;
    const heights = unassignedWords.map((w) => w.bbox[3] - w.bbox[1]);
    const medH = heights.length > 0
      ? heights.reduce((s, h) => s + h, 0) / heights.length
      : 20;
    if (Math.abs(ay - by) < medH * 0.5) {
      return a.bbox[0] - b.bbox[0];
    }
    return ay - by;
  });

  // Sliding window: try runs of length ~transcriptTokens.length
  const targetLen = transcriptTokens.length;
  let bestScore = 0;
  let bestStart = -1;
  let bestEnd = -1;

  for (let start = 0; start < sorted.length; start++) {
    // Try windows from targetLen-1 to targetLen+2
    for (let runLen = Math.max(1, targetLen - 1); runLen <= Math.min(sorted.length - start, targetLen + 2); runLen++) {
      const end = start + runLen;
      const runText = sorted.slice(start, end).map((w) => w.text).join(' ');
      const score = wordOverlap(runText, transcriptLine);
      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
        bestEnd = end;
      }
    }
  }

  if (bestScore < 0.3 || bestStart < 0) return null;

  const matchedWords = sorted.slice(bestStart, bestEnd);
  const bbox: [number, number, number, number] = [
    Math.min(...matchedWords.map((w) => w.bbox[0])),
    Math.min(...matchedWords.map((w) => w.bbox[1])),
    Math.max(...matchedWords.map((w) => w.bbox[2])),
    Math.max(...matchedWords.map((w) => w.bbox[3])),
  ];

  return { bbox, confidence: bestScore };
}

/**
 * Matches transcript lines to grouped line candidates.
 *
 * Algorithm:
 * 1. Score each transcript line against each grouped line's visionText
 * 2. Assign greedily in reading order (preserving top-to-bottom constraint)
 * 3. Fall back to Vision-only word matching for unmatched transcript lines
 * 4. Collect unmatched grouped lines as excluded content
 */
export function matchTranscriptToLines(
  transcriptLines: string[],
  groupedLines: GroupedLine[],
  unassignedWords?: OcrWordBox[],
): TranscriptMatchResult {
  if (transcriptLines.length === 0) {
    return {
      matched: [],
      excludedContent: [...groupedLines],
    };
  }

  if (groupedLines.length === 0) {
    // No grouped lines — everything must come from Vision fallback
    const matched: MatchedLine[] = transcriptLines.map((text, i) => {
      const fallback = unassignedWords
        ? findVisionFallback(text, unassignedWords)
        : null;

      return {
        transcriptText: text,
        transcriptLineIndex: i,
        groupedLine: null,
        confidence: fallback?.confidence ?? 0,
        matchSource: fallback ? 'vision-only' : 'unmatched',
        bbox: fallback?.bbox ?? null,
      };
    });

    return { matched, excludedContent: [] };
  }

  // Score matrix: transcriptLines x groupedLines
  const scores: number[][] = transcriptLines.map((tLine) =>
    groupedLines.map((gLine) => wordOverlap(tLine, gLine.visionText)),
  );

  // Greedy forward assignment preserving reading order.
  // For each transcript line (in order), find the best-scoring grouped line
  // that is at or below the previous match's y-position.
  const matchedGroupedIndices = new Set<number>();
  const assignments: (number | null)[] = new Array(transcriptLines.length).fill(null);
  let minNextGroupIdx = 0;

  for (let tIdx = 0; tIdx < transcriptLines.length; tIdx++) {
    let bestScore = 0;
    let bestGIdx = -1;

    for (let gIdx = minNextGroupIdx; gIdx < groupedLines.length; gIdx++) {
      if (matchedGroupedIndices.has(gIdx)) continue;

      const score = scores[tIdx][gIdx];
      if (score > bestScore) {
        bestScore = score;
        bestGIdx = gIdx;
      }
    }

    // Accept if score is reasonable (above 0.15 threshold)
    // or if there's only one candidate (positional fallback)
    const remainingGrouped = groupedLines.length - matchedGroupedIndices.size;
    const remainingTranscript = transcriptLines.length - tIdx;

    if (bestGIdx >= 0 && (bestScore >= 0.15 || remainingGrouped <= remainingTranscript)) {
      assignments[tIdx] = bestGIdx;
      matchedGroupedIndices.add(bestGIdx);
      minNextGroupIdx = bestGIdx + 1;
    }
  }

  // Build matched results
  const matched: MatchedLine[] = transcriptLines.map((text, tIdx) => {
    const gIdx = assignments[tIdx];

    if (gIdx !== null) {
      const gLine = groupedLines[gIdx];
      return {
        transcriptText: text,
        transcriptLineIndex: tIdx,
        groupedLine: gLine,
        confidence: scores[tIdx][gIdx],
        matchSource: 'kraken+vision' as const,
        bbox: [...gLine.bbox] as [number, number, number, number],
        boundary: gLine.boundary,
      };
    }

    // Vision-only fallback
    const fallback = unassignedWords
      ? findVisionFallback(text, unassignedWords)
      : null;

    return {
      transcriptText: text,
      transcriptLineIndex: tIdx,
      groupedLine: null,
      confidence: fallback?.confidence ?? 0,
      matchSource: fallback ? ('vision-only' as const) : ('unmatched' as const),
      bbox: fallback?.bbox ?? null,
    };
  });

  // Excluded content: grouped lines not matched by any transcript line
  const excludedContent = groupedLines.filter((_, i) => !matchedGroupedIndices.has(i));

  return { matched, excludedContent };
}

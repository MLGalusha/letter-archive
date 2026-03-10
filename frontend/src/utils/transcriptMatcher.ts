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
 * Strategy: positional matching first (reading order), text overlap only
 * to identify truly excluded content. Vision OCR on handwriting is too
 * unreliable to be the primary matching signal.
 *
 * Algorithm:
 * 1. Separate body lines from margin lines
 * 2. Assign transcript lines to body lines positionally (reading order)
 * 3. Only mark a grouped line as excluded if it has NO transcript assignment
 *    AND its region is 'margin' or it has very low text similarity to ALL
 *    transcript lines (clearly non-handwritten content like printed headers)
 * 4. Fall back to Vision-only word matching for unmatched transcript lines
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

  // Separate body lines from margin/other lines
  const bodyLines = groupedLines.filter((g) => g.region === 'body');
  const nonBodyLines = groupedLines.filter((g) => g.region !== 'body');

  // Positional assignment: assign transcript lines to body lines in reading order.
  // If there are more body lines than transcript lines, the extras are candidates
  // for exclusion (but only if they're clearly not handwritten content).
  // If there are more transcript lines than body lines, the extras get Vision fallback.
  const matched: MatchedLine[] = [];
  const matchedBodyIndices = new Set<number>();

  if (bodyLines.length <= transcriptLines.length) {
    // Fewer or equal body lines than transcript lines — each body line gets a transcript line.
    // Distribute transcript lines across body lines proportionally.
    for (let bIdx = 0; bIdx < bodyLines.length; bIdx++) {
      // Map body line index to transcript line index proportionally
      const tIdx = Math.round((bIdx / Math.max(1, bodyLines.length - 1)) * (transcriptLines.length - 1));
      // But we need 1:1 — so just assign sequentially, allowing gaps
      matchedBodyIndices.add(bIdx);
    }

    // Simple sequential assignment
    let bIdx = 0;
    for (let tIdx = 0; tIdx < transcriptLines.length; tIdx++) {
      if (bIdx < bodyLines.length) {
        const gLine = bodyLines[bIdx];
        const score = wordOverlap(transcriptLines[tIdx], gLine.visionText);
        matched.push({
          transcriptText: transcriptLines[tIdx],
          transcriptLineIndex: tIdx,
          groupedLine: gLine,
          confidence: Math.max(score, 0.5), // Positional match gets at least 0.5
          matchSource: 'kraken+vision',
          bbox: [...gLine.bbox] as [number, number, number, number],
          boundary: gLine.boundary,
        });
        bIdx++;
      } else {
        // More transcript lines than body lines — Vision fallback
        const fallback = unassignedWords
          ? findVisionFallback(transcriptLines[tIdx], unassignedWords)
          : null;
        matched.push({
          transcriptText: transcriptLines[tIdx],
          transcriptLineIndex: tIdx,
          groupedLine: null,
          confidence: fallback?.confidence ?? 0,
          matchSource: fallback ? 'vision-only' : 'unmatched',
          bbox: fallback?.bbox ?? null,
        });
      }
    }
  } else {
    // More body lines than transcript lines — need to pick which body lines
    // correspond to transcript lines. Use reading order + text similarity
    // to select the best subset.
    //
    // Strategy: walk through body lines top-to-bottom, greedily assign
    // transcript lines. Skip body lines that are clearly bad matches
    // when there's a better option ahead.
    let tIdx = 0;
    const assignedBodyIndices = new Set<number>();

    for (let bIdx = 0; bIdx < bodyLines.length && tIdx < transcriptLines.length; bIdx++) {
      const gLine = bodyLines[bIdx];
      const score = wordOverlap(transcriptLines[tIdx], gLine.visionText);
      const remainingBody = bodyLines.length - bIdx;
      const remainingTranscript = transcriptLines.length - tIdx;

      // Always assign if we'd run out of body lines otherwise,
      // or if the text has any reasonable overlap,
      // or if the body line has vision words (it's real content)
      if (remainingBody <= remainingTranscript || score > 0.05 || gLine.visionWords.length > 0) {
        matched.push({
          transcriptText: transcriptLines[tIdx],
          transcriptLineIndex: tIdx,
          groupedLine: gLine,
          confidence: Math.max(score, 0.3),
          matchSource: 'kraken+vision',
          bbox: [...gLine.bbox] as [number, number, number, number],
          boundary: gLine.boundary,
        });
        assignedBodyIndices.add(bIdx);
        tIdx++;
      }
    }

    // Any remaining transcript lines get Vision fallback
    for (; tIdx < transcriptLines.length; tIdx++) {
      const fallback = unassignedWords
        ? findVisionFallback(transcriptLines[tIdx], unassignedWords)
        : null;
      matched.push({
        transcriptText: transcriptLines[tIdx],
        transcriptLineIndex: tIdx,
        groupedLine: null,
        confidence: fallback?.confidence ?? 0,
        matchSource: fallback ? 'vision-only' : 'unmatched',
        bbox: fallback?.bbox ?? null,
      });
    }

    // Unassigned body lines — only exclude if they have NO vision words
    // (empty segments) or clearly no text content
    for (let bIdx = 0; bIdx < bodyLines.length; bIdx++) {
      if (!assignedBodyIndices.has(bIdx)) {
        matchedBodyIndices.add(bIdx); // track for exclusion check below
      }
    }
  }

  // Excluded content: only margin/non-body lines are excluded.
  // Body lines that weren't assigned are NOT excluded — they're just
  // extra fragments that the grouping didn't merge. They'll still show
  // as green Kraken segments in the debug overlay.
  const excludedContent = nonBodyLines;

  return { matched, excludedContent };
}

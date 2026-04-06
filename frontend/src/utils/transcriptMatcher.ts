import type { GroupedLine } from './constrainedGrouping';

export interface MatchedLine {
  /** The transcript line text */
  transcriptText: string;
  /** The transcript line index (0-based) */
  transcriptLineIndex: number;
  /** The matched grouped line, or null if no match */
  groupedLine: GroupedLine | null;
  /** Match confidence 0-1 */
  confidence: number;
  /** How this line was matched */
  matchSource: 'kraken' | 'unmatched';
  /** Bounding box for display (from groupedLine) */
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
    if (a.length <= 2) continue;
    for (const b of unmatchedB) {
      if (b.length <= 2) continue;
      const maxLen = Math.max(a.length, b.length);
      const minLen = Math.min(a.length, b.length);
      if (minLen / maxLen < 0.4) continue;
      if (a.includes(b) || b.includes(a)) {
        fuzzyMatches += 0.7;
        break;
      }
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

  const effectiveIntersection = intersection + fuzzyMatches;
  const union = setA.size + setB.size - intersection;

  return union > 0 ? effectiveIntersection / union : 0;
}

/**
 * Matches transcript lines to grouped line candidates.
 *
 * Strategy: positional matching first (reading order), text overlap only
 * to identify truly excluded content.
 *
 * Algorithm:
 * 1. Separate body lines from margin lines
 * 2. Assign transcript lines to body lines positionally (reading order)
 * 3. Only mark a grouped line as excluded if it has NO transcript assignment
 *    AND its region is 'margin' or it has very low text similarity to ALL
 *    transcript lines (clearly non-handwritten content like printed headers)
 */
export function matchTranscriptToLines(
  transcriptLines: string[],
  groupedLines: GroupedLine[],
): TranscriptMatchResult {
  if (transcriptLines.length === 0) {
    return {
      matched: [],
      excludedContent: [...groupedLines],
    };
  }

  if (groupedLines.length === 0) {
    const matched: MatchedLine[] = transcriptLines.map((text, i) => ({
      transcriptText: text,
      transcriptLineIndex: i,
      groupedLine: null,
      confidence: 0,
      matchSource: 'unmatched',
      bbox: null,
    }));

    return { matched, excludedContent: [] };
  }

  // Separate body lines from margin/other lines
  const bodyLines = groupedLines.filter((g) => g.region === 'body');
  const nonBodyLines = groupedLines.filter((g) => g.region !== 'body');

  const matched: MatchedLine[] = [];

  if (bodyLines.length <= transcriptLines.length) {
    // Fewer or equal body lines than transcript lines
    let bIdx = 0;
    for (let tIdx = 0; tIdx < transcriptLines.length; tIdx++) {
      if (bIdx < bodyLines.length) {
        const gLine = bodyLines[bIdx];
        const score = wordOverlap(transcriptLines[tIdx], gLine.wordText);
        matched.push({
          transcriptText: transcriptLines[tIdx],
          transcriptLineIndex: tIdx,
          groupedLine: gLine,
          confidence: Math.max(score, 0.5),
          matchSource: 'kraken',
          bbox: [...gLine.bbox] as [number, number, number, number],
          boundary: gLine.boundary,
        });
        bIdx++;
      } else {
        matched.push({
          transcriptText: transcriptLines[tIdx],
          transcriptLineIndex: tIdx,
          groupedLine: null,
          confidence: 0,
          matchSource: 'unmatched',
          bbox: null,
        });
      }
    }
  } else {
    // More body lines than transcript lines — pick best subset
    let tIdx = 0;
    const assignedBodyIndices = new Set<number>();

    for (let bIdx = 0; bIdx < bodyLines.length && tIdx < transcriptLines.length; bIdx++) {
      const gLine = bodyLines[bIdx];
      const score = wordOverlap(transcriptLines[tIdx], gLine.wordText);
      const remainingBody = bodyLines.length - bIdx;
      const remainingTranscript = transcriptLines.length - tIdx;

      if (remainingBody <= remainingTranscript || score > 0.05 || (gLine.words && gLine.words.length > 0)) {
        matched.push({
          transcriptText: transcriptLines[tIdx],
          transcriptLineIndex: tIdx,
          groupedLine: gLine,
          confidence: Math.max(score, 0.3),
          matchSource: 'kraken',
          bbox: [...gLine.bbox] as [number, number, number, number],
          boundary: gLine.boundary,
        });
        assignedBodyIndices.add(bIdx);
        tIdx++;
      }
    }

    // Any remaining transcript lines are unmatched
    for (; tIdx < transcriptLines.length; tIdx++) {
      matched.push({
        transcriptText: transcriptLines[tIdx],
        transcriptLineIndex: tIdx,
        groupedLine: null,
        confidence: 0,
        matchSource: 'unmatched',
        bbox: null,
      });
    }
  }

  // Excluded content: only margin/non-body lines
  const excludedContent = nonBodyLines;

  return { matched, excludedContent };
}

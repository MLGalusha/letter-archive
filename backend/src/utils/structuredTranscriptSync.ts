/**
 * Structured Transcript Sync
 *
 * Keeps `transcriptionJson` in lockstep with admin edits to `transcriptionText`.
 * The admin edits plain text in a normal textarea — this function transparently
 * diffs old vs new text and updates the structured annotations (x position,
 * paragraph grouping, continues flag, role).
 *
 * Algorithm: per-page LCS line matching with cross-match for reordering.
 */

import type {
  StructuredTranscript,
  StructuredTranscriptPage,
  TranscriptLine,
  TranscriptLineRole,
} from '../ai/schemas/structuredTranscript.js';

const PAGE_SEP = /^---\s*Page\s+(\d+)\s*---$/;

/** Minimum fraction of lines that must match to keep structured data. */
const ABANDON_THRESHOLD = 0.3;

// ── Public API ───────────────────────────────────────────

/**
 * Sync structured transcript data after an admin text edit.
 *
 * @param existingStructured - current structured data from DB
 * @param oldText - flat text before the edit (from DB)
 * @param newText - flat text after the edit (from admin)
 * @returns updated structured transcript, or null to abandon (clear from DB)
 */
export function syncStructuredTranscript(
  existingStructured: StructuredTranscript,
  oldText: string | null,
  newText: string,
): StructuredTranscript | null {
  if (!oldText) return null;
  if (!newText || !newText.trim()) return null;

  const oldPages = splitTextIntoPages(oldText);
  const newPages = splitTextIntoPages(newText);
  const existingPages = existingStructured.pages;

  // Structural mismatch between old text and existing structured data
  if (oldPages.length !== existingPages.length) return null;

  // Page count changed incompatibly (reordered, inserted in middle)
  if (newPages.length !== oldPages.length) {
    // Allow pages appended at end
    if (newPages.length > oldPages.length) {
      for (let i = 0; i < oldPages.length; i++) {
        if (newPages[i].pageNumber !== oldPages[i].pageNumber) return null;
      }
    // Allow pages removed from end
    } else {
      for (let i = 0; i < newPages.length; i++) {
        if (newPages[i].pageNumber !== oldPages[i].pageNumber) return null;
      }
    }
  }

  const resultPages: StructuredTranscriptPage[] = [];

  for (let i = 0; i < newPages.length; i++) {
    if (i < existingPages.length) {
      const synced = buildSyncedLines(
        existingPages[i].lines,
        oldPages[i].lines,
        newPages[i].lines,
      );
      if (!synced) return null; // too dramatic on this page
      fixContinuesFlags(synced);
      renumberParagraphs(synced);
      resultPages.push({
        pageNumber: newPages[i].pageNumber,
        lines: synced,
        specialAreas: existingPages[i].specialAreas ?? [],
      });
    } else {
      // New page with no prior structured data — create defaults
      const lines = newPages[i].lines.map(rawLine => createDefaultLine(rawLine));
      renumberParagraphs(lines);
      resultPages.push({ pageNumber: newPages[i].pageNumber, lines, specialAreas: [] });
    }
  }

  return { pages: resultPages };
}

// ── Exported helpers (also used by tests) ────────────────

/**
 * Split flat transcript text into per-page sections.
 */
export function splitTextIntoPages(
  text: string,
): { pageNumber: number; lines: string[] }[] {
  const rawLines = text.split('\n');
  const pages: { pageNumber: number; lines: string[] }[] = [];
  let currentLines: string[] = [];
  let currentPage = 1;
  let foundSeparator = false;

  for (const rawLine of rawLines) {
    const match = rawLine.match(PAGE_SEP);
    if (match) {
      // Flush previous page (if we had content)
      if (foundSeparator && currentLines.length > 0) {
        pages.push({ pageNumber: currentPage, lines: trimBlankEnds(currentLines) });
      }
      currentPage = parseInt(match[1], 10);
      currentLines = [];
      foundSeparator = true;
    } else {
      currentLines.push(rawLine);
    }
  }

  // Flush last page
  if (foundSeparator) {
    pages.push({ pageNumber: currentPage, lines: trimBlankEnds(currentLines) });
  } else {
    // No separators found — single page
    pages.push({ pageNumber: 1, lines: rawLines });
  }

  return pages;
}

/**
 * Convert leading spaces in a flat-text line to an x value (0-999).
 * Reverse of `structuredLinesToText`: spaces = Math.round((x/999)*60)
 */
export function textToX(line: string): number {
  const spaces = line.length - line.trimStart().length;
  if (spaces === 0) return 0;
  return Math.min(Math.round((spaces / 60) * 999), 999);
}

/**
 * Longest Common Subsequence on normalized (trimmed) line content.
 * Returns matched pairs of (oldIdx, newIdx).
 */
export function computeLineLCS(
  oldLines: string[],
  newLines: string[],
): { oldIdx: number; newIdx: number }[] {
  const m = oldLines.length;
  const n = newLines.length;
  if (m === 0 || n === 0) return [];

  // DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to get matching pairs
  const matches: { oldIdx: number; newIdx: number }[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      matches.push({ oldIdx: i - 1, newIdx: j - 1 });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return matches.reverse();
}

// ── Internal helpers ─────────────────────────────────────

/**
 * Core sync: match old structured lines to new text lines and build result.
 * Returns null if edit is too dramatic (< 30% match rate).
 */
function buildSyncedLines(
  oldStructured: TranscriptLine[],
  oldTextLines: string[],
  newTextLines: string[],
): TranscriptLine[] | null {
  // Normalize for matching (trim whitespace)
  const oldNorm = oldTextLines.map(l => l.trim());
  const newNorm = newTextLines.map(l => l.trim());

  // Phase 1: LCS matching on trimmed content
  const lcsMatches = computeLineLCS(oldNorm, newNorm);

  const matchedOld = new Set(lcsMatches.map(m => m.oldIdx));
  const matchedNew = new Set(lcsMatches.map(m => m.newIdx));

  // Phase 2: Cross-match unmatched lines by exact content (handles reordering)
  const crossMatches = new Map<number, number>(); // newIdx → oldIdx
  const unmatchedOld = new Set(
    oldNorm.map((_, i) => i).filter(i => !matchedOld.has(i)),
  );

  for (let ni = 0; ni < newNorm.length; ni++) {
    if (matchedNew.has(ni)) continue;
    if (newNorm[ni] === '') continue; // don't cross-match blanks

    // Find closest unmatched old line with same content
    let bestOldIdx = -1;
    let bestDist = Infinity;
    for (const oi of unmatchedOld) {
      if (oldNorm[oi] === newNorm[ni]) {
        const dist = Math.abs(oi - ni);
        if (dist < bestDist) {
          bestDist = dist;
          bestOldIdx = oi;
        }
      }
    }
    if (bestOldIdx >= 0) {
      crossMatches.set(ni, bestOldIdx);
      unmatchedOld.delete(bestOldIdx);
      matchedNew.add(ni);
    }
  }

  // Phase 3: Fuzzy match remaining unmatched lines by word overlap (handles typo fixes)
  const fuzzyMatches = new Map<number, number>(); // newIdx → oldIdx

  for (let ni = 0; ni < newNorm.length; ni++) {
    if (matchedNew.has(ni)) continue;
    if (newNorm[ni] === '') continue;

    let bestOldIdx = -1;
    let bestSim = 0;
    for (const oi of unmatchedOld) {
      if (oldNorm[oi] === '') continue;
      const sim = wordSimilarity(oldNorm[oi], newNorm[ni]);
      if (sim > 0.4 && sim > bestSim) {
        bestSim = sim;
        bestOldIdx = oi;
      }
    }
    if (bestOldIdx >= 0) {
      fuzzyMatches.set(ni, bestOldIdx);
      unmatchedOld.delete(bestOldIdx);
      matchedNew.add(ni);
    }
  }

  // Abandonment check — skip for small pages (< 5 content lines)
  const totalMatched = lcsMatches.length + crossMatches.size + fuzzyMatches.size;
  const oldContent = oldNorm.filter(l => l !== '').length;
  const newContent = newNorm.filter(l => l !== '').length;
  const minContent = Math.min(oldContent, newContent);

  if (minContent >= 5 && oldContent > 0 && newContent > 0) {
    const oldMatchRate = totalMatched / oldContent;
    const newMatchRate = totalMatched / newContent;
    if (oldMatchRate < ABANDON_THRESHOLD && newMatchRate < ABANDON_THRESHOLD) {
      return null;
    }
  }

  // Build reverse map: newIdx → oldIdx (from LCS)
  const newToOldLCS = new Map<number, number>();
  for (const m of lcsMatches) {
    newToOldLCS.set(m.newIdx, m.oldIdx);
  }

  // Phase 3: Build result lines
  const result: TranscriptLine[] = [];

  for (let ni = 0; ni < newTextLines.length; ni++) {
    const rawLine = newTextLines[ni];
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      result.push({ text: '', x: 0, paragraph: null, continues: false, role: null, areaId: null });
      continue;
    }

    // Find matched old structured line (LCS → exact cross-match → fuzzy)
    const oldIdx = newToOldLCS.get(ni) ?? crossMatches.get(ni) ?? fuzzyMatches.get(ni) ?? null;

    if (oldIdx !== null && oldIdx < oldStructured.length) {
      const old = oldStructured[oldIdx];
      const oldRawLine = oldTextLines[oldIdx] ?? '';

      // Preserve original x if indentation didn't change
      const oldSpaces = oldRawLine.length - oldRawLine.trimStart().length;
      const newSpaces = rawLine.length - rawLine.trimStart().length;
      const newX = oldSpaces === newSpaces ? old.x : textToX(rawLine);

      result.push({
        text: trimmed,
        x: newX,
        paragraph: old.paragraph,
        continues: old.continues,
        role: old.role,
        areaId: old.areaId ?? null,
      });
    } else {
      // New line — derive defaults
      result.push(createDefaultLine(rawLine, result));
    }
  }

  return result;
}

/**
 * Word-level similarity between two strings (Jaccard-ish on words).
 * Returns 0-1 where 1 = identical words.
 */
function wordSimilarity(a: string, b: string): number {
  const aWords = a.toLowerCase().split(/\s+/).filter(Boolean);
  const bWords = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (aWords.length === 0 && bWords.length === 0) return 1;
  if (aWords.length === 0 || bWords.length === 0) return 0;
  const bSet = new Set(bWords);
  const overlap = aWords.filter(w => bSet.has(w)).length;
  return overlap / Math.max(aWords.length, bWords.length);
}

/**
 * Create a default structured line for newly inserted text.
 */
function createDefaultLine(
  rawLine: string,
  precedingLines?: TranscriptLine[],
): TranscriptLine {
  const trimmed = rawLine.trim();

  if (trimmed === '') {
    return { text: '', x: 0, paragraph: null, continues: false, role: null, areaId: null };
  }

  const x = textToX(rawLine);

  // Inherit role from nearest preceding content line
  let role: TranscriptLineRole | null = 'body';
  if (precedingLines) {
    for (let i = precedingLines.length - 1; i >= 0; i--) {
      if (precedingLines[i].text !== '') {
        role = precedingLines[i].role;
        break;
      }
    }
  }

  return {
    text: trimmed,
    x,
    paragraph: null, // assigned by renumberParagraphs
    continues: false,
    role,
    areaId: null,
  };
}

/**
 * Post-processing: fix continues flags around blank lines.
 * If a blank line follows a continues=true line, the preceding line
 * should no longer continue (the blank breaks the flow).
 */
function fixContinuesFlags(lines: TranscriptLine[]): void {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].text === '' && i > 0 && lines[i - 1].continues) {
      lines[i - 1].continues = false;
    }
  }
}

/**
 * Post-processing: renumber paragraphs sequentially.
 * Blank lines mark paragraph boundaries. Non-body roles get paragraph=null.
 */
function renumberParagraphs(lines: TranscriptLine[]): void {
  let counter = 0;
  let inBlock = false;

  for (const line of lines) {
    if (line.text === '') {
      inBlock = false;
      line.paragraph = null;
      continue;
    }

    if (line.role !== null && line.role !== 'body') {
      line.paragraph = null;
      inBlock = false;
      continue;
    }

    if (!inBlock) {
      counter++;
      inBlock = true;
    }

    line.paragraph = counter;
  }
}

/**
 * Trim leading and trailing blank lines from an array.
 */
function trimBlankEnds(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start++;
  let end = lines.length - 1;
  while (end >= start && lines[end].trim() === '') end--;
  return lines.slice(start, end + 1);
}

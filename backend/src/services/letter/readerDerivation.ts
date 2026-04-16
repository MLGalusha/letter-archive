/**
 * Reader Derivation Pipeline (V2)
 *
 * Derives reader blocks from canonical transcript text + optional metadata.
 * The transcript text is never modified — only structural decisions are made
 * about how to assemble it into readable blocks.
 *
 * Pipeline:
 *   1. normalizeToSourceLines — split transcript into normalized lines
 *   2. buildProtectedBlocks — deterministic standalone block identification
 *   3. AI boundary classifier — narrow structural classification (ambiguous body text only)
 *   4. assembleReaderBlocks — build final blocks from lines + decisions
 */

import { eq } from 'drizzle-orm';
import { db, letters, letterPages } from '../../db/index.js';
import { getLetterById } from '../letters.js';
import { log } from './shared.js';
import { classifyBoundaries } from '../../ai/openai/boundaryClassifier.js';
import type {
  ReaderSourceLine,
  ReaderBlock,
  ReaderBlockType,
  ReaderDecision,
  BoundaryDecision,
} from '../../types/readerView.js';

/** Page divider pattern used in multi-page transcripts */
const PAGE_DIVIDER_RE = /^-{2,}\s*Page\s+\d+\s*-{2,}$/i;

/* ── Step 1: Normalize transcript to source lines ─────────── */

interface StructuredPageData {
  pageNumber: number;
  lines: { text: string; role: string | null; areaId?: number | null }[];
  specialAreas?: { id: number; type: 'continuation' | 'addition' }[];
}

/**
 * Normalize a letter's transcript into source lines.
 * Uses transcriptionText as canonical source, enhanced with metadata
 * from transcriptionJson (roles, special areas) when available.
 */
export function normalizeToSourceLines(
  transcriptText: string,
  structuredPages?: StructuredPageData[],
): ReaderSourceLine[] {
  const rawLines = transcriptText.split('\n');
  const lines: ReaderSourceLine[] = [];

  let pageNumber = 1;
  let orderInPage = 0;
  let prevWasPageBreak = false;

  // Build a lookup of structured line data by page
  const structuredLookup = new Map<number, StructuredPageData>();
  const specialAreaTypes = new Map<number, 'continuation' | 'addition'>();
  if (structuredPages) {
    for (const sp of structuredPages) {
      structuredLookup.set(sp.pageNumber, sp);
      if (sp.specialAreas) {
        for (const area of sp.specialAreas) {
          specialAreaTypes.set(area.id, area.type);
        }
      }
    }
  }

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];

    // Skip page divider lines
    if (PAGE_DIVIDER_RE.test(raw.trim())) {
      pageNumber++;
      orderInPage = 0;
      prevWasPageBreak = true;
      continue;
    }

    const text = raw; // preserve exact text including leading whitespace
    const trimmed = raw.trim();
    const isBlank = trimmed === '';

    // Compute indent hint from leading whitespace
    const leadingSpaces = raw.length - raw.trimStart().length;
    let indentHint: 'none' | 'small' | 'large' = 'none';
    if (leadingSpaces >= 8) indentHint = 'large';
    else if (leadingSpaces >= 3) indentHint = 'small';

    // Look up structured metadata for this line
    let roleHint: ReaderBlockType | 'body' | undefined;
    let specialAreaHint: 'continuation' | 'addition' | undefined;

    const structuredPage = structuredLookup.get(pageNumber);
    if (structuredPage && orderInPage < structuredPage.lines.length) {
      const sl = structuredPage.lines[orderInPage];
      if (sl.role) {
        roleHint = mapRoleToBlockType(sl.role);
      }
      if (sl.areaId != null) {
        specialAreaHint = specialAreaTypes.get(sl.areaId);
      }
    }

    const id = `p${pageNumber}-L${orderInPage + 1}`;

    lines.push({
      id,
      pageNumber,
      order: orderInPage,
      text,
      isBlank,
      pageBreakBefore: prevWasPageBreak,
      pageBreakAfter: false, // set below
      indentHint,
      roleHint,
      specialAreaHint,
    });

    prevWasPageBreak = false;
    orderInPage++;
  }

  // Set pageBreakAfter by looking at the next line
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i + 1].pageBreakBefore) {
      lines[i].pageBreakAfter = true;
    }
  }

  return lines;
}

function mapRoleToBlockType(role: string): ReaderBlockType | 'body' {
  const map: Record<string, ReaderBlockType> = {
    date: 'date',
    salutation: 'salutation',
    closing: 'closing',
    signature: 'signature',
    postscript: 'postscript',
    address: 'address',
    ps: 'postscript',
  };
  return map[role.toLowerCase()] ?? 'body';
}

/* ── Step 2: Deterministic protected block identification ──── */

interface ProtectedRange {
  startIdx: number;
  endIdx: number;
  type: ReaderBlockType;
}

/**
 * Identify lines that should NOT be collapsed into body paragraphs.
 * Returns index ranges of protected blocks plus their types.
 */
export function identifyProtectedBlocks(lines: ReaderSourceLine[]): ProtectedRange[] {
  const protectedRanges: ProtectedRange[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.isBlank) continue;

    // Structural roles from metadata
    if (line.roleHint && line.roleHint !== 'body') {
      const type = line.roleHint as ReaderBlockType;
      // Extend if consecutive lines have the same role
      const existing = protectedRanges[protectedRanges.length - 1];
      if (existing && existing.type === type && existing.endIdx === i - 1) {
        existing.endIdx = i;
      } else {
        protectedRanges.push({ startIdx: i, endIdx: i, type });
      }
      continue;
    }

    // Special area hints
    if (line.specialAreaHint) {
      const type = line.specialAreaHint as ReaderBlockType;
      const existing = protectedRanges[protectedRanges.length - 1];
      if (existing && existing.type === type && existing.endIdx === i - 1) {
        existing.endIdx = i;
      } else {
        protectedRanges.push({ startIdx: i, endIdx: i, type });
      }
      continue;
    }

    // Heuristic detection for common standalone patterns
    const trimmed = line.text.trim();

    // Date patterns (short line at start with date-like content)
    if (i <= 2 && !lines.slice(0, i).some(l => !l.isBlank) && looksLikeDate(trimmed)) {
      protectedRanges.push({ startIdx: i, endIdx: i, type: 'date' });
      continue;
    }

    // Salutation: "Dear ...", "My dear ...", "Dearest ..."
    if (/^(Dear|My\s+dear|Dearest)\b/i.test(trimmed) && trimmed.length < 80) {
      protectedRanges.push({ startIdx: i, endIdx: i, type: 'salutation' });
      continue;
    }

    // Closing patterns: "Love,", "Sincerely,", "Yours truly,", etc.
    if (looksLikeClosing(trimmed)) {
      protectedRanges.push({ startIdx: i, endIdx: i, type: 'closing' });
      continue;
    }

    // Signature: short line (1-3 words) after a closing
    const prevProtected = protectedRanges[protectedRanges.length - 1];
    if (
      prevProtected?.type === 'closing' &&
      prevProtected.endIdx >= i - 2 && // within 2 lines of closing
      trimmed.length > 0 &&
      trimmed.split(/\s+/).length <= 4 &&
      !trimmed.endsWith(',')
    ) {
      protectedRanges.push({ startIdx: i, endIdx: i, type: 'signature' });
      continue;
    }

    // Postscript: "P.S.", "PS:", "P.P.S."
    if (/^P\.?S\.?\s*[:-]?/i.test(trimmed) || /^P\.?P\.?S\.?\s*[:-]?/i.test(trimmed)) {
      protectedRanges.push({ startIdx: i, endIdx: i, type: 'postscript' });
      continue;
    }
  }

  return protectedRanges;
}

function looksLikeDate(text: string): boolean {
  if (text.length > 60) return false;
  // Common date patterns in historical letters
  return /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\b/i.test(text) ||
    /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/.test(text) ||
    /\b\d{4}\b/.test(text) && text.split(/\s+/).length <= 6;
}

function looksLikeClosing(text: string): boolean {
  if (text.length > 60) return false;
  const closingPatterns = [
    /^(Love|Much love|All my love|With love|Lovingly|Fondly)\b/i,
    /^(Sincerely|Yours sincerely|Very sincerely)\b/i,
    /^(Yours truly|Yours|Very truly yours)\b/i,
    /^(Affectionately|With affection)\b/i,
    /^(Best wishes|Best regards|Regards|Warmly)\b/i,
    /^(As ever|As always|Ever yours)\b/i,
    /^(Your loving|Your devoted|Your affectionate)\b/i,
    /^(God bless|Take care)\b/i,
  ];
  return closingPatterns.some(p => p.test(text));
}

/* ── Step 3: Assemble reader blocks ──────────────────────── */

/**
 * Build reader blocks from source lines and boundary decisions.
 */
export function assembleReaderBlocks(
  lines: ReaderSourceLine[],
  protectedRanges: ProtectedRange[],
  decisions: BoundaryDecision[],
): ReaderBlock[] {
  const blocks: ReaderBlock[] = [];

  // Build a set of protected line indices
  const protectedMap = new Map<number, ProtectedRange>();
  for (const range of protectedRanges) {
    for (let i = range.startIdx; i <= range.endIdx; i++) {
      protectedMap.set(i, range);
    }
  }

  // Build decision lookup
  const decisionMap = new Map<string, ReaderDecision>();
  for (const d of decisions) {
    decisionMap.set(d.afterLineId, d.decision);
  }

  let currentLines: ReaderSourceLine[] = [];
  let currentType: ReaderBlockType = 'paragraph';
  let blockCounter = 0;

  function flushBlock() {
    if (currentLines.length === 0) return;
    const nonBlank = currentLines.filter(l => !l.isBlank);
    if (nonBlank.length === 0) {
      currentLines = [];
      return;
    }
    blockCounter++;
    blocks.push({
      id: `block-${blockCounter}`,
      type: currentType,
      lineIds: nonBlank.map(l => l.id),
      text: joinLines(nonBlank),
      alignment: inferAlignment(nonBlank, currentType),
    });
    currentLines = [];
    currentType = 'paragraph';
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip blank lines — they always create a paragraph break
    if (line.isBlank) {
      flushBlock();
      continue;
    }

    // Check if this line is in a protected range
    const protectedRange = protectedMap.get(i);
    if (protectedRange) {
      // If we were accumulating body text, flush it first
      if (currentType === 'paragraph' && currentLines.length > 0 && currentType !== protectedRange.type) {
        flushBlock();
      }

      // If starting a new protected block
      if (currentType !== protectedRange.type || currentLines.length === 0) {
        if (currentLines.length > 0) flushBlock();
        currentType = protectedRange.type;
      }
      currentLines.push(line);

      // If this is the last line of the protected range, flush
      if (i === protectedRange.endIdx) {
        flushBlock();
      }
      continue;
    }

    // Body text — check boundary decision from previous line
    if (currentLines.length > 0) {
      const prevLine = currentLines[currentLines.length - 1];
      const decision = decisionMap.get(prevLine.id) ?? inferDefaultDecision(prevLine, line);

      switch (decision) {
        case 'new_paragraph':
        case 'keep_separate_block':
        case 'uncertain':
          flushBlock();
          break;
        case 'join_remove_hyphen':
        case 'join_with_space':
        case 'continues_special_area':
          // continue accumulating
          break;
      }
    }

    currentType = 'paragraph';
    currentLines.push(line);
  }

  flushBlock();
  return blocks;
}

/**
 * Default decision when AI hasn't classified a boundary.
 * Conservative: blank lines and large indentation changes = new paragraph.
 */
function inferDefaultDecision(prev: ReaderSourceLine, next: ReaderSourceLine): ReaderDecision {
  // Page break without other signals: join (paragraphs often span pages)
  // Large indent change: likely new paragraph
  if (next.indentHint === 'large' && prev.indentHint === 'none') {
    return 'new_paragraph';
  }
  if (next.indentHint === 'small' && prev.indentHint === 'none') {
    return 'new_paragraph';
  }

  // Hyphenated continuation
  if (prev.text.trim().match(/[a-zA-Z]-$/) && next.text.trim().match(/^[a-z]/)) {
    return 'join_remove_hyphen';
  }

  return 'join_with_space';
}

/**
 * Join lines into text, handling hyphenation.
 */
function joinLines(lines: ReaderSourceLine[]): string {
  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0].text.trim();

  let result = lines[0].text.trim();
  for (let i = 1; i < lines.length; i++) {
    const nextText = lines[i].text.trim();
    if (result.match(/[a-zA-Z]-$/) && nextText.match(/^[a-z]/)) {
      result = result.slice(0, -1) + nextText;
    } else {
      result = result + ' ' + nextText;
    }
  }
  return result;
}

function inferAlignment(
  lines: ReaderSourceLine[],
  type: ReaderBlockType,
): ReaderBlock['alignment'] {
  // Date, closing, signature often right-shifted
  if (type === 'date' || type === 'closing' || type === 'signature') {
    const avgIndent = lines.reduce((sum, l) => sum + (l.text.length - l.text.trimStart().length), 0) / lines.length;
    if (avgIndent >= 8) return 'right-shifted';
  }
  if (type === 'continuation' || type === 'addition') return 'aside';
  if (lines.length > 0 && lines[0].indentHint !== 'none') return 'indented';
  return 'left';
}

/* ── Step 4: Orchestration ──────────────────────────────── */

/**
 * Derive reader blocks for a letter and save to database.
 */
export async function deriveAndSaveReaderBlocks(letterId: string): Promise<ReaderBlock[] | null> {
  const letter = await getLetterById(letterId);
  if (!letter) {
    log.warn({ letterId }, 'Letter not found for reader derivation');
    return null;
  }

  if (!letter.transcriptionText) {
    log.warn({ letterId }, 'No transcript — cannot derive reader blocks');
    return null;
  }

  log.info({ letterId }, 'Starting reader block derivation');

  // Get structured page data if available
  const structuredPages = letter.transcriptionJson
    ? (letter.transcriptionJson as { pages: StructuredPageData[] }).pages
    : undefined;

  // Get segment classifications for trusted pages
  const pages = await db.query.letterPages.findMany({
    where: eq(letterPages.letterId, letterId),
    columns: {
      pageNumber: true,
      segmentTrustState: true,
      segmentClassifications: true,
      lineSegments: true,
    },
  });

  // Step 1: Normalize
  const sourceLines = normalizeToSourceLines(letter.transcriptionText, structuredPages);

  // Enhance with trusted segment data
  for (const page of pages) {
    if (page.segmentTrustState !== 'trusted') continue;
    const segments = page.lineSegments as { segmentClass?: string; isMapped?: boolean }[] | null;
    if (!segments) continue;

    for (const seg of segments) {
      if (seg.segmentClass === 'continuation' || seg.segmentClass === 'addition') {
        // Find matching source lines for this page and mark them
        const pageLines = sourceLines.filter(l => l.pageNumber === page.pageNumber);
        for (const pl of pageLines) {
          if (!pl.specialAreaHint) {
            // Only override if not already set from structured metadata
          }
        }
      }
    }
  }

  // Step 2: Identify protected blocks
  const protectedRanges = identifyProtectedBlocks(sourceLines);

  // Step 3: AI boundary classification for unprotected body text
  const unprotectedBoundaries = getUnprotectedBoundaries(sourceLines, protectedRanges);
  let aiDecisions: BoundaryDecision[] = [];

  if (unprotectedBoundaries.length > 0) {
    try {
      aiDecisions = await classifyBoundaries(unprotectedBoundaries, letterId);
    } catch (err) {
      log.warn({ letterId, err }, 'AI boundary classification failed — using heuristic fallback');
      // Heuristic fallback is handled by assembleReaderBlocks via inferDefaultDecision
    }
  }

  // Step 4: Assemble blocks
  const readerBlocks = assembleReaderBlocks(sourceLines, protectedRanges, aiDecisions);

  // Save to database
  await db.update(letters).set({
    readerBlocks: readerBlocks as unknown as Record<string, unknown>[],
    readerDecisions: aiDecisions as unknown as Record<string, unknown>[],
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info(
    { letterId, blockCount: readerBlocks.length, decisionCount: aiDecisions.length },
    'Reader blocks derived and saved',
  );

  return readerBlocks;
}

/**
 * Extract unprotected boundary pairs for AI classification.
 * Returns pairs of consecutive lines where the boundary is ambiguous.
 */
function getUnprotectedBoundaries(
  lines: ReaderSourceLine[],
  protectedRanges: ProtectedRange[],
): ReaderSourceLine[] {
  const protectedIndices = new Set<number>();
  for (const range of protectedRanges) {
    for (let i = range.startIdx; i <= range.endIdx; i++) {
      protectedIndices.add(i);
    }
  }

  // Return all non-blank, non-protected lines (the AI classifies boundaries between them)
  return lines.filter((line, idx) =>
    !line.isBlank && !protectedIndices.has(idx),
  );
}

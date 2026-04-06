import type { JSX } from 'react';
import type { TranscriptLine, StructuredPage, SpecialArea, SpecialAreaType } from '../types/Letter';

/**
 * Rendering utilities for structured transcript data.
 *
 * When the AI produces per-line JSON annotations (text, x, paragraph,
 * continues, role), these functions replace the heuristic-based
 * reflowTranscript/renderTranscriptLines pipeline with deterministic
 * rendering from structured data.
 */

/**
 * Reorder page lines to splice special area lines into reading order.
 * Continuations insert after the line they continue from;
 * additions insert after the paragraph matching readingOrder.
 */
function reorderPageLines(page: StructuredPage): TranscriptLine[] {
  const areas = page.specialAreas;
  if (!areas || areas.length === 0) return page.lines;

  const mainLines: TranscriptLine[] = [];
  const areaLineGroups = new Map<number, TranscriptLine[]>();

  for (const line of page.lines) {
    if (line.areaId != null) {
      if (!areaLineGroups.has(line.areaId)) areaLineGroups.set(line.areaId, []);
      areaLineGroups.get(line.areaId)!.push(line);
    } else {
      mainLines.push(line);
    }
  }

  if (areaLineGroups.size === 0) return page.lines;

  const result: TranscriptLine[] = [...mainLines];
  const additionAreas: { area: SpecialArea; lines: TranscriptLine[] }[] = [];

  for (const area of areas) {
    const areaLines = areaLineGroups.get(area.id);
    if (!areaLines || areaLines.length === 0) continue;

    if (area.type === 'continuation' && area.continuesFromLine != null) {
      const targetLine = page.lines[area.continuesFromLine];
      if (targetLine) {
        const insertIdx = result.indexOf(targetLine);
        if (insertIdx >= 0) {
          result.splice(insertIdx + 1, 0, ...areaLines);
          continue;
        }
      }
      result.push(...areaLines);
    } else {
      additionAreas.push({ area, lines: areaLines });
    }
  }

  additionAreas.sort((a, b) => (b.area.readingOrder ?? Infinity) - (a.area.readingOrder ?? Infinity));

  for (const { area, lines: aLines } of additionAreas) {
    if (area.readingOrder != null) {
      let insertIdx = -1;
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].paragraph === area.readingOrder) {
          insertIdx = i + 1;
          break;
        }
      }
      if (insertIdx >= 0) {
        const blank: TranscriptLine = { text: '', x: 0, paragraph: null, continues: false, role: null };
        result.splice(insertIdx, 0, blank, ...aLines);
        continue;
      }
    }
    result.push({ text: '', x: 0, paragraph: null, continues: false, role: null }, ...aLines);
  }

  return result;
}

// ============================================================================
// ORIGINAL VIEW — positioned lines matching handwriting layout
// ============================================================================

/**
 * Render structured pages in "original" mode with CSS-based positioning
 * derived from the AI's x-position annotations (0-999 scale).
 */
export function renderStructuredOriginalView(
  pages: StructuredPage[],
): JSX.Element[] {
  const elements: JSX.Element[] = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];

    if (pi > 0) {
      elements.push(
        <div key={`sep-${pi}`} className="page-boundary-mark" />,
      );
    }

    for (let li = 0; li < page.lines.length; li++) {
      const line = page.lines[li];
      const key = `${pi}-${li}`;

      if (line.text === '') {
        elements.push(<div key={key} className="transcript-blank" />);
        continue;
      }

      // x: 0-999 → percentage-based indent
      if (line.x > 30) {
        const indentPct = Math.min((line.x / 999) * 100, 90);
        elements.push(
          <div
            key={key}
            className="transcript-line transcript-line-positioned"
            style={{ paddingLeft: `${indentPct}%` }}
          >
            {line.text}
          </div>,
        );
      } else {
        elements.push(
          <div key={key} className="transcript-line">
            {line.text}
          </div>,
        );
      }
    }
  }

  return elements;
}

// ============================================================================
// READING TEXT — plain string for SpacingEditor / admin preview
// ============================================================================

/**
 * Generate reading-view text deterministically from structured transcript data.
 * Port of the backend's readingTextGenerator for live admin preview.
 *
 * - Joins lines where `continues: true` (margin wraps)
 * - Groups body text by `paragraph` number with blank line separators
 * - Keeps non-body roles as separate blocks
 * - Handles hyphenated word breaks: "un-" + "til" → "until"
 */
export function generateReadingTextFromStructured(pages: StructuredPage[]): string {
  const allLines: TranscriptLine[] = [];
  for (const page of pages) {
    allLines.push(...reorderPageLines(page));
  }

  const result: string[] = [];
  let lastParagraph: number | null = null;
  let lastRole: string | null = null;

  for (const line of allLines) {
    if (line.text === '') {
      result.push('');
      lastParagraph = null;
      lastRole = null;
      continue;
    }

    // Continuation: join with previous line (hyphen-aware)
    if (line.continues && result.length > 0) {
      const prev = result[result.length - 1];
      if (/[a-zA-Z]-$/.test(prev) && /^[a-z]/.test(line.text)) {
        result[result.length - 1] = prev.slice(0, -1) + line.text;
      } else {
        result[result.length - 1] = prev + ' ' + line.text;
      }
      continue;
    }

    // Non-continuation: decide if we need a blank line separator
    const needsSeparator = result.length > 0 && result[result.length - 1] !== '';
    const isNewParagraph = line.paragraph !== null && line.paragraph !== lastParagraph;
    const isRoleChange = line.role !== lastRole && line.role !== 'body';

    if (needsSeparator && (isNewParagraph || isRoleChange)) {
      result.push('');
    }

    // Same body paragraph as previous line — join into flowing text
    const sameParagraph = line.paragraph !== null && line.paragraph === lastParagraph
      && line.role === 'body' && lastRole === 'body';
    if (sameParagraph && result.length > 0 && result[result.length - 1] !== '') {
      result[result.length - 1] = result[result.length - 1] + ' ' + line.text;
    } else if (line.role && line.role !== 'body' && line.x > 100) {
      // Add indentation for positioned non-body elements
      const spaces = Math.round((line.x / 999) * 40);
      result.push(' '.repeat(spaces) + line.text);
    } else {
      result.push(line.text);
    }

    lastParagraph = line.paragraph;
    lastRole = line.role;
  }

  const text = result.join('\n');
  return text.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

// ============================================================================
// READING VIEW — rendered JSX with paragraph grouping
// ============================================================================

/**
 * Render structured pages in "reading" mode with proper paragraph
 * grouping, continuation joining, and role-based spacing.
 */
export function renderStructuredReadingView(
  pages: StructuredPage[],
): JSX.Element[] {
  // Collect all special areas across pages for annotation lookup
  const areaMap = new Map<number, SpecialArea>();
  for (const page of pages) {
    if (page.specialAreas) {
      for (const area of page.specialAreas) {
        areaMap.set(area.id, area);
      }
    }
  }

  const allLines: TranscriptLine[] = [];
  for (const page of pages) {
    allLines.push(...reorderPageLines(page));
  }

  // Build logical blocks (paragraphs / role groups) from lines
  interface Block {
    lines: string[];
    role: string | null;
    x: number;
    areaId: number | null;
    areaType: SpecialAreaType | null;
  }

  const blocks: Block[] = [];
  let currentBlock: Block | null = null;
  let lastParagraph: number | null = null;
  let lastRole: string | null = null;

  for (const line of allLines) {
    if (line.text === '') {
      // Blank line ends current block
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      lastParagraph = null;
      lastRole = null;
      continue;
    }

    // Continuation: append to last line of current block
    if (line.continues && currentBlock && currentBlock.lines.length > 0) {
      const prev = currentBlock.lines[currentBlock.lines.length - 1];
      if (/[a-zA-Z]-$/.test(prev) && /^[a-z]/.test(line.text)) {
        currentBlock.lines[currentBlock.lines.length - 1] = prev.slice(0, -1) + line.text;
      } else {
        currentBlock.lines[currentBlock.lines.length - 1] = prev + ' ' + line.text;
      }
      continue;
    }

    // Check if we need a new block
    const lineAreaId = line.areaId ?? null;
    const isNewParagraph = line.paragraph !== null && line.paragraph !== lastParagraph;
    const isRoleChange = line.role !== lastRole && line.role !== 'body';
    const isAreaChange = currentBlock && lineAreaId !== currentBlock.areaId;

    if (currentBlock && (isNewParagraph || isRoleChange || isAreaChange)) {
      blocks.push(currentBlock);
      currentBlock = null;
    }

    if (!currentBlock) {
      const area: SpecialArea | null | undefined = lineAreaId != null ? areaMap.get(lineAreaId) : null;
      currentBlock = {
        lines: [],
        role: line.role,
        x: line.x,
        areaId: lineAreaId,
        areaType: area?.type ?? null,
      };
    }

    currentBlock.lines.push(line.text);
    lastParagraph = line.paragraph;
    lastRole = line.role;
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  // Render blocks as JSX
  const elements: JSX.Element[] = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const text = block.lines.join(' ');

    // Add spacing between blocks
    if (bi > 0) {
      elements.push(<div key={`gap-${bi}`} className="transcript-blank" />);
    }

    // Special area annotation for addition-type areas
    const area = block.areaId != null ? areaMap.get(block.areaId) : null;

    // Positioned non-body elements (dates, closings, signatures)
    if (block.role && block.role !== 'body' && block.x > 100) {
      const indentPct = Math.min((block.x / 999) * 100, 90);
      elements.push(
        <div
          key={`block-${bi}`}
          className="transcript-line transcript-line-positioned"
          style={{ paddingLeft: `${indentPct}%` }}
        >
          {text}
        </div>,
      );
    } else if (area && area.type === 'addition') {
      elements.push(
        <div key={`block-${bi}`} className="transcript-special-area transcript-special-area-addition">
          <span className="special-area-label">{area.label}</span>
          <div className="transcript-line">{text}</div>
        </div>,
      );
    } else if (area && area.type === 'continuation') {
      elements.push(
        <div key={`block-${bi}`} className="transcript-line transcript-special-area-continuation">
          {text}
        </div>,
      );
    } else {
      elements.push(
        <div key={`block-${bi}`} className="transcript-line">
          {text}
        </div>,
      );
    }
  }

  return elements;
}

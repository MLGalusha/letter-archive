import type { JSX } from 'react';
import type { TranscriptLine, StructuredPage } from '../types/Letter';

/**
 * Rendering utilities for structured transcript data.
 *
 * When the AI produces per-line JSON annotations (text, x, paragraph,
 * continues, role), these functions replace the heuristic-based
 * reflowTranscript/renderTranscriptLines pipeline with deterministic
 * rendering from structured data.
 */

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
    allLines.push(...page.lines);
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

    // Continuation: join with previous line
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

    // Add indentation for positioned non-body elements
    if (line.role && line.role !== 'body' && line.x > 100) {
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
  const allLines: TranscriptLine[] = [];
  for (const page of pages) {
    allLines.push(...page.lines);
  }

  // Build logical blocks (paragraphs / role groups) from lines
  const blocks: { lines: string[]; role: string | null; x: number }[] = [];
  let currentBlock: { lines: string[]; role: string | null; x: number } | null = null;
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
    const isNewParagraph = line.paragraph !== null && line.paragraph !== lastParagraph;
    const isRoleChange = line.role !== lastRole && line.role !== 'body';

    if (currentBlock && (isNewParagraph || isRoleChange)) {
      blocks.push(currentBlock);
      currentBlock = null;
    }

    if (!currentBlock) {
      currentBlock = { lines: [], role: line.role, x: line.x };
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

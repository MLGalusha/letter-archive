import type { StructuredTranscript, TranscriptLine } from '../ai/schemas/structuredTranscript.js';

/**
 * Generate reading-view text deterministically from structured transcript data.
 *
 * - Joins lines where `continues: true` (margin wraps)
 * - Groups body text by `paragraph` number with blank line separators
 * - Keeps non-body roles (date, salutation, closing, etc.) as separate blocks
 * - Handles hyphenated word breaks: "un-" + "til" → "until"
 */
export function generateReadingText(transcript: StructuredTranscript): string {
  const allLines: TranscriptLine[] = [];
  for (const page of transcript.pages) {
    allLines.push(...page.lines);
  }
  return generateReadingTextFromLines(allLines);
}

export function generateReadingTextFromLines(lines: TranscriptLine[]): string {
  const result: string[] = [];
  let lastParagraph: number | null = null;
  let lastRole: string | null = null;

  for (const line of lines) {
    // Blank line
    if (line.text === '') {
      result.push('');
      lastParagraph = null;
      lastRole = null;
      continue;
    }

    // Continuation: join with previous line
    if (line.continues && result.length > 0) {
      const prev = result[result.length - 1];
      // Hyphenated word break: "un-" + "til" → "until"
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

  // Clean up: collapse 3+ consecutive blank lines to 2
  const text = result.join('\n');
  return text.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

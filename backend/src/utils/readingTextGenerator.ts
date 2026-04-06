import type { StructuredTranscript, StructuredTranscriptPage, TranscriptLine, SpecialArea } from '../ai/schemas/structuredTranscript.js';

/**
 * Generate reading-view text deterministically from structured transcript data.
 *
 * - Joins lines where `continues: true` (margin wraps)
 * - Groups body text by `paragraph` number with blank line separators
 * - Keeps non-body roles (date, salutation, closing, etc.) as separate blocks
 * - Handles hyphenated word breaks: "un-" + "til" → "until"
 * - Splices continuation special areas into the main flow
 * - Inserts addition special areas after the nearest paragraph
 */
export function generateReadingText(transcript: StructuredTranscript): string {
  const allLines: TranscriptLine[] = [];
  for (const page of transcript.pages) {
    const reordered = reorderLinesWithSpecialAreas(page);
    allLines.push(...reordered);
  }
  return generateReadingTextFromLines(allLines);
}

/**
 * Reorder page lines so that special area lines appear in reading order:
 * - Continuation areas splice after the line they continue from
 * - Addition areas insert after the paragraph matching readingOrder
 */
function reorderLinesWithSpecialAreas(page: StructuredTranscriptPage): TranscriptLine[] {
  const areas = page.specialAreas;
  if (!areas || areas.length === 0) return page.lines;

  // Separate main-flow lines from area lines
  const mainLines: TranscriptLine[] = [];
  const areaLineGroups = new Map<number, TranscriptLine[]>();

  for (const line of page.lines) {
    const aid = (line as TranscriptLine & { areaId?: number | null }).areaId;
    if (aid != null) {
      if (!areaLineGroups.has(aid)) areaLineGroups.set(aid, []);
      areaLineGroups.get(aid)!.push(line);
    } else {
      mainLines.push(line);
    }
  }

  if (areaLineGroups.size === 0) return page.lines;

  // Build result: splice continuations, collect additions for later insertion
  const result: TranscriptLine[] = [...mainLines];
  const additionAreas: { area: SpecialArea; lines: TranscriptLine[] }[] = [];

  for (const area of areas) {
    const areaLines = areaLineGroups.get(area.id);
    if (!areaLines || areaLines.length === 0) continue;

    if (area.type === 'continuation' && area.continuesFromLine != null) {
      // Find the insertion point after the referenced line in the main flow
      // continuesFromLine is a 0-based index into the original page.lines, but we need
      // to find where that line ended up in our mainLines array
      const targetLine = page.lines[area.continuesFromLine];
      if (targetLine) {
        const insertIdx = result.indexOf(targetLine);
        if (insertIdx >= 0) {
          result.splice(insertIdx + 1, 0, ...areaLines);
          continue;
        }
      }
      // Fallback: append at end
      result.push(...areaLines);
    } else {
      additionAreas.push({ area, lines: areaLines });
    }
  }

  // Insert addition areas after the last line of their readingOrder paragraph
  // Process in reverse readingOrder so insertions don't shift indices
  additionAreas.sort((a, b) => (b.area.readingOrder ?? Infinity) - (a.area.readingOrder ?? Infinity));

  for (const { area, lines: aLines } of additionAreas) {
    if (area.readingOrder != null) {
      // Find last line of the target paragraph in result
      let insertIdx = -1;
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].paragraph === area.readingOrder) {
          insertIdx = i + 1;
          break;
        }
      }
      if (insertIdx >= 0) {
        // Insert a blank line separator + a marker line + the area lines
        const markerLine: TranscriptLine = {
          text: '', x: 0, paragraph: null, continues: false, role: null, areaId: null,
        };
        result.splice(insertIdx, 0, markerLine, ...aLines);
        continue;
      }
    }
    // Fallback: append at end
    result.push(
      { text: '', x: 0, paragraph: null, continues: false, role: null, areaId: null },
      ...aLines,
    );
  }

  return result;
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

  // Clean up: collapse 3+ consecutive blank lines to 2
  const text = result.join('\n');
  return text.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

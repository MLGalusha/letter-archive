import { describe, expect, it } from 'vitest';
import type { TranscriptLine, StructuredTranscript } from '../../ai/schemas/structuredTranscript.js';
import {
  syncStructuredTranscript,
  splitTextIntoPages,
  textToX,
  computeLineLCS,
} from '../structuredTranscriptSync.js';

// ── Helpers ──────────────────────────────────────────────

function line(text: string, overrides?: Partial<TranscriptLine>): TranscriptLine {
  return { text, x: 0, paragraph: null, continues: false, role: null, areaId: null, ...overrides };
}

function bodyLine(text: string, para: number, overrides?: Partial<TranscriptLine>): TranscriptLine {
  return { text, x: 0, paragraph: para, continues: false, role: 'body', areaId: null, ...overrides };
}

function blankLine(): TranscriptLine {
  return { text: '', x: 0, paragraph: null, continues: false, role: null, areaId: null };
}

function makeStructured(pages: TranscriptLine[][]): StructuredTranscript {
  return { pages: pages.map((lines, i) => ({ pageNumber: i + 1, lines, specialAreas: [] })) };
}

/**
 * Build flat text from structured lines (same formula as transcription.ts).
 * Used to generate the "old text" that corresponds to structured data.
 */
function linesToText(lines: TranscriptLine[]): string {
  return lines.map(l => {
    if (l.text === '') return '';
    const spaces = Math.round((l.x / 999) * 60);
    return spaces > 0 ? ' '.repeat(spaces) + l.text : l.text;
  }).join('\n');
}

function multiPageText(pages: TranscriptLine[][]): string {
  return pages.map((lines, i) =>
    `--- Page ${i + 1} ---\n${linesToText(lines)}`,
  ).join('\n\n');
}

// ── Unit tests: helpers ──────────────────────────────────

describe('splitTextIntoPages', () => {
  it('handles single-page text with no separator', () => {
    const result = splitTextIntoPages('Hello world\nLine two');
    expect(result).toHaveLength(1);
    expect(result[0].pageNumber).toBe(1);
    expect(result[0].lines).toEqual(['Hello world', 'Line two']);
  });

  it('splits multi-page text on separators', () => {
    const text = '--- Page 1 ---\nHello\n\n--- Page 2 ---\nWorld';
    const result = splitTextIntoPages(text);
    expect(result).toHaveLength(2);
    expect(result[0].pageNumber).toBe(1);
    expect(result[0].lines).toEqual(['Hello']);
    expect(result[1].pageNumber).toBe(2);
    expect(result[1].lines).toEqual(['World']);
  });
});

describe('textToX', () => {
  it('returns 0 for no leading spaces', () => {
    expect(textToX('Hello')).toBe(0);
  });

  it('converts leading spaces to 0-999 range', () => {
    // 30 spaces → Math.round((30/60)*999) = 500
    expect(textToX(' '.repeat(30) + 'text')).toBe(500);
  });

  it('roundtrips with structuredLinesToText formula', () => {
    // structured → text: spaces = Math.round((500/999)*60) = 30
    // text → structured: x = Math.round((30/60)*999) = 500
    const x = 500;
    const spaces = Math.round((x / 999) * 60);
    const recovered = textToX(' '.repeat(spaces) + 'text');
    expect(recovered).toBe(x);
  });

  it('caps at 999', () => {
    expect(textToX(' '.repeat(100) + 'text')).toBeLessThanOrEqual(999);
  });
});

describe('computeLineLCS', () => {
  it('finds common subsequence', () => {
    const old = ['A', 'B', 'C', 'D'];
    const nw = ['A', 'C', 'D'];
    const matches = computeLineLCS(old, nw);
    // A matches A, C matches C, D matches D
    expect(matches).toHaveLength(3);
  });

  it('returns empty for completely different lines', () => {
    const matches = computeLineLCS(['A', 'B'], ['X', 'Y']);
    expect(matches).toHaveLength(0);
  });

  it('handles empty arrays', () => {
    expect(computeLineLCS([], ['A'])).toHaveLength(0);
    expect(computeLineLCS(['A'], [])).toHaveLength(0);
  });
});

// ── Edge case tests: syncStructuredTranscript ────────────

describe('syncStructuredTranscript', () => {

  // ── 1. Fix a typo ──

  it('preserves metadata when fixing a typo', () => {
    const structured = makeStructured([[
      line('September 12, 1943', { x: 500, role: 'date' }),
      blankLine(),
      line('Dear Mother,', { role: 'salutation' }),
      blankLine(),
      bodyLine('I hope teh letter finds you well.', 1),
      bodyLine('The weather has been quite', 1, { continues: true }),
      bodyLine('pleasant this week.', 1, { continues: true }),
    ]]);

    const oldText = linesToText(structured.pages[0].lines);
    const newText = oldText.replace('teh letter', 'the letter');

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    // Date preserved
    expect(lines[0]).toMatchObject({ text: 'September 12, 1943', x: 500, role: 'date' });
    // Typo fixed, metadata preserved
    expect(lines[4]).toMatchObject({
      text: 'I hope the letter finds you well.',
      paragraph: 1,
      role: 'body',
    });
    // Continuation lines still marked
    expect(lines[5].continues).toBe(true);
    expect(lines[6].continues).toBe(true);
  });

  // ── 2. Change indentation updates x ──

  it('updates x when admin changes indentation', () => {
    const structured = makeStructured([[
      line('September 12, 1943', { x: 300, role: 'date' }),
      blankLine(),
      bodyLine('Body text here.', 1),
    ]]);

    const oldText = linesToText(structured.pages[0].lines);
    // Move date further right — add more leading spaces
    const newText = ' '.repeat(40) + 'September 12, 1943\n\nBody text here.';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const dateLine = result!.pages[0].lines[0];
    expect(dateLine.text).toBe('September 12, 1943');
    expect(dateLine.role).toBe('date'); // role preserved
    // x should reflect 40 spaces: Math.round((40/60)*999) = 666
    expect(dateLine.x).toBe(Math.round((40 / 60) * 999));
  });

  // ── 3. Split one line into two ──

  it('handles splitting one line into two', () => {
    const structured = makeStructured([[
      bodyLine('Hello world how are you', 1),
    ]]);

    const oldText = 'Hello world how are you';
    const newText = 'Hello world\nhow are you';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('Hello world');
    expect(lines[1].text).toBe('how are you');
    // New lines default to continues=false
    expect(lines[0].continues).toBe(false);
    expect(lines[1].continues).toBe(false);
  });

  // ── 4. Merge two lines into one ──

  it('handles merging two lines into one', () => {
    const structured = makeStructured([[
      bodyLine('Hello', 1, { continues: true }),
      bodyLine('world', 1, { continues: true }),
      bodyLine('goodbye', 1),
    ]]);

    const oldText = 'Hello\nworld\ngoodbye';
    const newText = 'Hello world\ngoodbye';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('Hello world');
    expect(lines[1].text).toBe('goodbye');
  });

  // ── 5. Delete a line ──

  it('removes structured entry when line deleted', () => {
    const structured = makeStructured([[
      bodyLine('Line one', 1),
      bodyLine('Line two', 1),
      bodyLine('Line three', 1),
    ]]);

    const oldText = 'Line one\nLine two\nLine three';
    const newText = 'Line one\nLine three';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('Line one');
    expect(lines[1].text).toBe('Line three');
  });

  // ── 6. Insert a new line ──

  it('creates default structured entry for inserted line', () => {
    const structured = makeStructured([[
      bodyLine('First line', 1),
      bodyLine('Third line', 1),
    ]]);

    const oldText = 'First line\nThird line';
    const newText = 'First line\nBrand new line\nThird line';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    expect(lines).toHaveLength(3);
    expect(lines[1].text).toBe('Brand new line');
    expect(lines[1].continues).toBe(false);
    expect(lines[1].role).toBe('body'); // inherited from neighbor
  });

  // ── 7. Blank line breaks continuation ──

  it('sets continues=false when blank line inserted between continuation lines', () => {
    const structured = makeStructured([[
      bodyLine('The weather has been', 1, { continues: true }),
      bodyLine('quite pleasant.', 1, { continues: true }),
      bodyLine('We hope to see you.', 1),
    ]]);

    const oldText = 'The weather has been\nquite pleasant.\nWe hope to see you.';
    const newText = 'The weather has been\n\nquite pleasant.\nWe hope to see you.';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    // "The weather has been" should no longer continue (blank line after it)
    expect(lines[0].continues).toBe(false);
    expect(lines[0].text).toBe('The weather has been');
    // Blank line
    expect(lines[1].text).toBe('');
    // "quite pleasant." still has its text
    expect(lines[2].text).toBe('quite pleasant.');
  });

  // ── 8. Remove blank line merges paragraphs ──

  it('merges paragraph numbers when blank line removed', () => {
    const structured = makeStructured([[
      bodyLine('Paragraph one text.', 1),
      blankLine(),
      bodyLine('Paragraph two text.', 2),
    ]]);

    const oldText = 'Paragraph one text.\n\nParagraph two text.';
    const newText = 'Paragraph one text.\nParagraph two text.';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    expect(lines).toHaveLength(2);
    // Both should now share the same paragraph number
    expect(lines[0].paragraph).toBe(lines[1].paragraph);
  });

  // ── 9. Reorder lines ──

  it('preserves metadata when lines are reordered', () => {
    const structured = makeStructured([[
      line('With warm regards,', { x: 300, role: 'closing' }),
      line('John Smith', { x: 350, role: 'signature' }),
    ]]);

    const oldText = linesToText(structured.pages[0].lines);
    // Swap them
    const oldLines = oldText.split('\n');
    const newText = [oldLines[1], oldLines[0]].join('\n');

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    // "John Smith" is now first — should keep its role
    expect(lines[0].text).toBe('John Smith');
    expect(lines[0].role).toBe('signature');
    // "With warm regards," is now second — should keep its role
    expect(lines[1].text).toBe('With warm regards,');
    expect(lines[1].role).toBe('closing');
  });

  // ── 10. Multi-page: edit page 2 only ──

  it('preserves page 1 when only page 2 is edited', () => {
    const page1 = [
      line('September 12, 1943', { x: 500, role: 'date' }),
      blankLine(),
      bodyLine('Page one body.', 1),
    ];
    const page2 = [
      bodyLine('Page two has a tpyo.', 1),
    ];
    const structured = makeStructured([page1, page2]);

    const oldText = multiPageText([page1, page2]);
    // Fix typo on page 2 only
    const newText = oldText.replace('tpyo', 'typo');

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    // Page 1 unchanged
    expect(result!.pages[0].lines[0]).toMatchObject({ text: 'September 12, 1943', x: 500, role: 'date' });
    expect(result!.pages[0].lines[2]).toMatchObject({ text: 'Page one body.', role: 'body' });
    // Page 2 typo fixed
    expect(result!.pages[1].lines[0].text).toBe('Page two has a typo.');
  });

  // ── 11. Dramatic rewrite returns null ──

  it('returns null when edit is too dramatic', () => {
    const structured = makeStructured([[
      bodyLine('Original line one', 1),
      bodyLine('Original line two', 1),
      bodyLine('Original line three', 1),
      bodyLine('Original line four', 1),
      bodyLine('Original line five', 1),
    ]]);

    const oldText = 'Original line one\nOriginal line two\nOriginal line three\nOriginal line four\nOriginal line five';
    const newText = 'Completely different\nNothing matches\nAll new content\nWholesale rewrite\nNothing in common';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).toBeNull();
  });

  // ── 12. Single-page letter (no separator) ──

  it('works with single-page text without separator', () => {
    const structured = makeStructured([[
      bodyLine('Just one page.', 1),
    ]]);

    const oldText = 'Just one page.';
    const newText = 'Just one page, edited.';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();
    expect(result!.pages).toHaveLength(1);
    expect(result!.pages[0].lines[0].text).toBe('Just one page, edited.');
  });

  // ── 13. Old text is null ──

  it('returns null when old text is null', () => {
    const structured = makeStructured([[bodyLine('text', 1)]]);
    const result = syncStructuredTranscript(structured, null, 'new text');
    expect(result).toBeNull();
  });

  // ── 14. Empty new text returns null ──

  it('returns null when new text is empty', () => {
    const structured = makeStructured([[bodyLine('text', 1)]]);
    const result = syncStructuredTranscript(structured, 'text', '');
    expect(result).toBeNull();
  });

  // ── 15. Preserve all role types ──

  it('preserves non-body roles through edit', () => {
    const structured = makeStructured([[
      line('September 12, 1943', { x: 500, role: 'date' }),
      blankLine(),
      line('Dear Mother,', { role: 'salutation' }),
      blankLine(),
      bodyLine('Body text here.', 1),
      blankLine(),
      line('With love,', { x: 300, role: 'closing' }),
      line('Your son', { x: 350, role: 'signature' }),
    ]]);

    const oldText = linesToText(structured.pages[0].lines);
    // Fix body text only
    const newText = oldText.replace('Body text here.', 'Body text, edited.');

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    expect(lines.find(l => l.text === 'September 12, 1943')?.role).toBe('date');
    expect(lines.find(l => l.text === 'Dear Mother,')?.role).toBe('salutation');
    expect(lines.find(l => l.text === 'With love,')?.role).toBe('closing');
    expect(lines.find(l => l.text === 'Your son')?.role).toBe('signature');
  });

  // ── 16. Multiple typo fixes at once ──

  it('handles multiple typo fixes across the letter', () => {
    const structured = makeStructured([[
      bodyLine('Frist line has error.', 1),
      bodyLine('Secnd line also wrong.', 1),
      bodyLine('Thrid line too.', 1),
    ]]);

    const oldText = 'Frist line has error.\nSecnd line also wrong.\nThrid line too.';
    const newText = 'First line has error.\nSecond line also wrong.\nThird line too.';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    expect(lines[0].text).toBe('First line has error.');
    expect(lines[1].text).toBe('Second line also wrong.');
    expect(lines[2].text).toBe('Third line too.');
    // All retain body role and paragraph
    lines.forEach(l => {
      expect(l.role).toBe('body');
    });
  });

  // ── 17. Paragraph renumbering after delete ──

  it('renumbers paragraphs after deleting a paragraph', () => {
    const structured = makeStructured([[
      bodyLine('Para one.', 1),
      blankLine(),
      bodyLine('Para two.', 2),
      blankLine(),
      bodyLine('Para three.', 3),
    ]]);

    const oldText = 'Para one.\n\nPara two.\n\nPara three.';
    // Delete paragraph two entirely
    const newText = 'Para one.\n\nPara three.';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    const contentLines = lines.filter(l => l.text !== '');
    expect(contentLines[0].text).toBe('Para one.');
    expect(contentLines[1].text).toBe('Para three.');
    // Paragraphs should be sequential: 1, 2 (not 1, 3)
    expect(contentLines[0].paragraph).toBe(1);
    expect(contentLines[1].paragraph).toBe(2);
  });

  // ── 18. x roundtrip preserves original when spacing unchanged ──

  it('preserves original x when admin does not change indentation', () => {
    // x=501 → spaces = Math.round((501/999)*60) = 30
    // reverse: Math.round((30/60)*999) = 500 (lossy!)
    // But if spacing didn't change, we should keep original 501.
    const structured = makeStructured([[
      line('Date text', { x: 501, role: 'date' }),
      blankLine(),
      bodyLine('Body unchanged.', 1),
    ]]);

    const oldText = linesToText(structured.pages[0].lines);
    // Only change body text, don't touch the date line
    const newText = oldText.replace('Body unchanged.', 'Body edited.');

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    // Date x should be preserved exactly (spacing didn't change)
    expect(result!.pages[0].lines[0].x).toBe(501);
  });

  // ── 19. No changes returns same structure ──

  it('returns equivalent structure when text is unchanged', () => {
    const structured = makeStructured([[
      line('September 12', { x: 500, role: 'date' }),
      blankLine(),
      bodyLine('Body text.', 1),
    ]]);

    const text = linesToText(structured.pages[0].lines);

    const result = syncStructuredTranscript(structured, text, text);
    expect(result).not.toBeNull();
    expect(result!.pages[0].lines).toHaveLength(structured.pages[0].lines.length);
    expect(result!.pages[0].lines[0]).toMatchObject({ text: 'September 12', x: 500, role: 'date' });
  });

  // ── 20. Insert blank line between non-continuation lines ──

  it('handles blank line insertion without affecting non-continuation metadata', () => {
    const structured = makeStructured([[
      bodyLine('Line A.', 1),
      bodyLine('Line B.', 1),
    ]]);

    const oldText = 'Line A.\nLine B.';
    const newText = 'Line A.\n\nLine B.';

    const result = syncStructuredTranscript(structured, oldText, newText);
    expect(result).not.toBeNull();

    const lines = result!.pages[0].lines;
    expect(lines).toHaveLength(3);
    expect(lines[0].text).toBe('Line A.');
    expect(lines[1].text).toBe('');
    expect(lines[2].text).toBe('Line B.');
    // Now in different paragraphs
    expect(lines[0].paragraph).not.toBe(lines[2].paragraph);
  });
});

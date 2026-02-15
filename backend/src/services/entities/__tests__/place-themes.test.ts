import { describe, expect, it } from 'vitest';
import {
  PLACE_THEME_END_MARKER,
  PLACE_THEME_START_MARKER,
  extractPlaceThemesFromNotes,
  stripPlaceThemesFromNotes,
  upsertPlaceThemesInNotes,
} from '../place-themes.js';

describe('place theme note helpers', () => {
  it('extracts themes from marked block', () => {
    const notes = [
      'Manual admin note.',
      PLACE_THEME_START_MARKER,
      '- Theme A',
      '- Theme B',
      PLACE_THEME_END_MARKER,
    ].join('\n');

    expect(extractPlaceThemesFromNotes(notes)).toEqual(['Theme A', 'Theme B']);
  });

  it('strips only AI theme block and preserves manual notes', () => {
    const notes = [
      'Top note',
      '',
      PLACE_THEME_START_MARKER,
      '- Theme A',
      PLACE_THEME_END_MARKER,
      '',
      'Bottom note',
    ].join('\n');

    expect(stripPlaceThemesFromNotes(notes)).toBe('Top note\n\nBottom note');
  });

  it('upserts themes into notes deterministically', () => {
    const notes = upsertPlaceThemesInNotes('Manual note', ['One', 'Two']);

    expect(notes).toContain('Manual note');
    expect(notes).toContain(PLACE_THEME_START_MARKER);
    expect(notes).toContain('- One');
    expect(notes).toContain('- Two');
    expect(notes).toContain(PLACE_THEME_END_MARKER);
  });
});

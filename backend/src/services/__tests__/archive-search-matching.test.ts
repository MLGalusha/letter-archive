import { describe, expect, it } from 'vitest';
import { archiveTermRanges } from '../archive-search-matching.js';

describe('archive highlight coordinates', () => {
  it('keeps original offsets after Unicode lowercase expansion and surrogate pairs', () => {
    const text = 'İstanbul 📨 red';
    const ranges = archiveTermRanges(text, 'red', false);
    expect(ranges.map((range) => text.slice(range.start, range.end))).toEqual(['red']);
    expect(archiveTermRanges(text, '', false)).toEqual([]);
  });
});

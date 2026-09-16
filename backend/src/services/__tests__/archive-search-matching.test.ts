import { describe, expect, it } from 'vitest';
import { archiveTermRanges, archiveWordSimilarity } from '../archive-search-matching.js';

describe('archive highlight coordinates', () => {
  it('uses original eligibility and per-word trigrams for a database-expanded query', () => {
    expect(archiveWordSimilarity('stanbul', 'i\u0307stanbul')).toBeCloseTo(0.8);
    expect(archiveWordSimilarity('---', '...')).toBe(0);
    expect(archiveTermRanges('stanbul', 'i\u0307stanbul', true, 'stanbul', 'İstanbul'))
      .toEqual([{ start: 0, end: 7 }]);
    expect(archiveTermRanges('stanbul', 'i\u0307stanbul', true, 'stanbul', 'i\u0307stanbul')).toEqual([]);
    expect(archiveTermRanges('stanbul', 'i\u0307stanbul', false, 'stanbul', 'İstanbul')).toEqual([]);
  });
  it.each([
    ['İ𐐀 📨 red', 'i\u0307𐐨 📨 red', 'i\u0307', 'İ'],
    ['İ𐐀 📨 red', 'i\u0307𐐨 📨 red', 'red', 'red'],
    ['İ𐐀 📨 red', 'i𐐨 📨 red', 'red', 'red'],
    ['I\u0301 📨 red', 'i\u0307\u0301 📨 red', 'red', 'red'],
    ['I\u0301 📨 red', 'i\u0307\u0301 📨 red', 'i\u0307', 'I\u0301'],
    ['I\u0307 📨 red', 'i 📨 red', 'red', 'red'],
    ['I\u0307 📨 red', 'i 📨 red', 'i', 'I\u0307'],
    ['ΟΣ red', 'οσ red', 'οσ', 'ΟΣ'],
    ['\u0301İ red', '\u0301i\u0307 red', 'red', 'red'],
  ])('maps provider-specific folding of %s', (text, folded, term, expected) => {
    expect(archiveTermRanges(text, term, false, folded).map((range) => text.slice(range.start, range.end))).toEqual([expected]);
  });

  it('omits highlights for an unexpected cluster-changing transformation', () => {
    expect(archiveTermRanges('A', 'ab', false, 'ab')).toEqual([]);
  });

  it('handles a long transcript with repeated expansions and a trailing match', () => {
    const text = 'Aİ\u0301 📨 '.repeat(5_000) + 'tail';
    expect(archiveTermRanges(text, 'tail', false, text.toLowerCase()))
      .toEqual([{ start: text.length - 4, end: text.length }]);
  });

  it('keeps original offsets after Unicode lowercase expansion and surrogate pairs', () => {
    const text = 'İstanbul 📨 red';
    const ranges = archiveTermRanges(text, 'red', false);
    expect(ranges.map((range) => text.slice(range.start, range.end))).toEqual(['red']);
    expect(archiveTermRanges(text, '', false)).toEqual([]);
  });
});

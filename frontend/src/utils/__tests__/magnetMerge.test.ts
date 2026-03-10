import { describe, it, expect } from 'vitest';
import { magnetMerge } from '../magnetMerge';
import type { LineSegment } from '../../types/Letter';

function makeSeg(overrides: Partial<LineSegment> & { bbox: [number, number, number, number] }): LineSegment {
  return {
    line: 1,
    baseline: [[overrides.bbox[0], overrides.bbox[3]], [overrides.bbox[2], overrides.bbox[3]]],
    ocrText: overrides.ocrText ?? 'text',
    bbox: overrides.bbox,
    words: overrides.words,
    boundary: overrides.boundary,
  };
}

describe('magnetMerge', () => {
  it('returns empty array for empty input', () => {
    expect(magnetMerge([])).toEqual([]);
  });

  it('single segment passes through unchanged with merged: false', () => {
    const seg = makeSeg({ bbox: [10, 20, 100, 50], ocrText: 'hello' });
    const result = magnetMerge([seg]);
    expect(result).toHaveLength(1);
    expect(result[0].merged).toBe(false);
    expect(result[0].constituents).toEqual([seg]);
    expect(result[0].ocrText).toBe('hello');
    expect(result[0].line).toBe(1);
  });

  it('two horizontally adjacent segments merge into one', () => {
    const a = makeSeg({ bbox: [10, 20, 100, 50], ocrText: 'hello' });
    const b = makeSeg({ bbox: [120, 22, 200, 48], ocrText: 'world' });
    const result = magnetMerge([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].merged).toBe(true);
    expect(result[0].ocrText).toBe('hello world');
    expect(result[0].constituents).toHaveLength(2);
  });

  it('two vertically stacked segments do NOT merge', () => {
    const a = makeSeg({ bbox: [10, 20, 200, 50], ocrText: 'line one' });
    const b = makeSeg({ bbox: [10, 100, 200, 130], ocrText: 'line two' });
    const result = magnetMerge([a, b]);
    expect(result).toHaveLength(2);
    expect(result[0].merged).toBe(false);
    expect(result[1].merged).toBe(false);
  });

  it('chain of 3 (A-B-C) merges into one segment', () => {
    const a = makeSeg({ bbox: [10, 20, 100, 50], ocrText: 'one' });
    const b = makeSeg({ bbox: [120, 22, 200, 48], ocrText: 'two' });
    const c = makeSeg({ bbox: [220, 21, 300, 49], ocrText: 'three' });
    const result = magnetMerge([a, b, c]);
    expect(result).toHaveLength(1);
    expect(result[0].merged).toBe(true);
    expect(result[0].ocrText).toBe('one two three');
    expect(result[0].constituents).toHaveLength(3);
  });

  it('gap too large prevents merge', () => {
    const a = makeSeg({ bbox: [10, 20, 100, 50], ocrText: 'hello' });
    const b = makeSeg({ bbox: [200, 22, 300, 48], ocrText: 'world' }); // gap = 100
    const result = magnetMerge([a, b]);
    expect(result).toHaveLength(2);
    expect(result[0].merged).toBe(false);
    expect(result[1].merged).toBe(false);
  });

  it('vertical misalignment prevents merge', () => {
    const a = makeSeg({ bbox: [10, 20, 100, 50], ocrText: 'hello' });
    // Same horizontal proximity but very different Y
    const b = makeSeg({ bbox: [120, 120, 200, 150], ocrText: 'world' });
    const result = magnetMerge([a, b]);
    expect(result).toHaveLength(2);
  });

  it('merged bbox is union of constituents', () => {
    const a = makeSeg({ bbox: [10, 25, 100, 50], ocrText: 'a' });
    const b = makeSeg({ bbox: [120, 20, 200, 55], ocrText: 'b' });
    const result = magnetMerge([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].bbox).toEqual([10, 20, 200, 55]);
  });

  it('custom thresholds work (tight gap)', () => {
    const a = makeSeg({ bbox: [10, 20, 100, 50], ocrText: 'a' });
    const b = makeSeg({ bbox: [115, 22, 200, 48], ocrText: 'b' }); // gap = 15
    // Default maxGapPx = 40 would merge, but custom = 10 should not
    const result = magnetMerge([a, b], { maxGapPx: 10 });
    expect(result).toHaveLength(2);
  });

  it('custom thresholds work (loose vertical)', () => {
    const a = makeSeg({ bbox: [10, 20, 100, 50], ocrText: 'a' });
    // midY(a) = 35, midY(b) = 75, delta = 40
    const b = makeSeg({ bbox: [120, 60, 200, 90], ocrText: 'b' });
    // Default maxVerticalDeltaPx = 20 would NOT merge, but custom = 50 should
    const result = magnetMerge([a, b], {
      maxVerticalDeltaPx: 50,
      maxTopBottomDeltaPx: 50,
    });
    expect(result).toHaveLength(1);
    expect(result[0].merged).toBe(true);
  });

  it('words arrays are concatenated in merged segment', () => {
    const a = makeSeg({
      bbox: [10, 20, 100, 50],
      ocrText: 'hello',
      words: [{ text: 'hello', bbox: [10, 20, 100, 50] }],
    });
    const b = makeSeg({
      bbox: [120, 22, 200, 48],
      ocrText: 'world',
      words: [{ text: 'world', bbox: [120, 22, 200, 48] }],
    });
    const result = magnetMerge([a, b]);
    expect(result[0].words).toHaveLength(2);
    expect(result[0].words![0].text).toBe('hello');
    expect(result[0].words![1].text).toBe('world');
  });

  it('lines are re-numbered sequentially', () => {
    const a = makeSeg({ bbox: [10, 20, 100, 50], ocrText: 'a' });
    const b = makeSeg({ bbox: [10, 100, 100, 130], ocrText: 'b' });
    const c = makeSeg({ bbox: [10, 200, 100, 230], ocrText: 'c' });
    const result = magnetMerge([a, b, c]);
    expect(result.map(r => r.line)).toEqual([1, 2, 3]);
  });

  it('does not mutate input array', () => {
    const a = makeSeg({ bbox: [10, 20, 100, 50], ocrText: 'a' });
    const b = makeSeg({ bbox: [120, 22, 200, 48], ocrText: 'b' });
    const input = [a, b];
    const inputCopy = [...input];
    magnetMerge(input);
    expect(input).toEqual(inputCopy);
  });

  it('boundary points are concatenated from constituents', () => {
    const a = makeSeg({
      bbox: [10, 20, 100, 50],
      ocrText: 'a',
      boundary: [{ x: 10, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 50 }, { x: 10, y: 50 }],
    });
    const b = makeSeg({
      bbox: [120, 22, 200, 48],
      ocrText: 'b',
      boundary: [{ x: 120, y: 22 }, { x: 200, y: 22 }, { x: 200, y: 48 }, { x: 120, y: 48 }],
    });
    const result = magnetMerge([a, b]);
    expect(result[0].boundary).toHaveLength(8);
  });

  it('falls back to rectangular boundary when constituents lack boundary', () => {
    const a = makeSeg({ bbox: [10, 20, 100, 50], ocrText: 'a' });
    const b = makeSeg({ bbox: [120, 22, 200, 48], ocrText: 'b' });
    // Neither has boundary set
    const result = magnetMerge([a, b]);
    expect(result[0].boundary).toHaveLength(4);
    // Should be the union bbox corners
    expect(result[0].boundary).toEqual([
      { x: 10, y: 20 },
      { x: 200, y: 20 },
      { x: 200, y: 50 },
      { x: 10, y: 50 },
    ]);
  });
});

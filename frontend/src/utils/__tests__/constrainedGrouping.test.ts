import { describe, it, expect } from 'vitest';
import { constrainedGrouping } from '../constrainedGrouping';
import type { LineSegment, LineSegmentWord } from '../../types/Letter';

function makeSeg(
  overrides: Partial<LineSegment> & { bbox: [number, number, number, number] },
): LineSegment {
  return {
    line: overrides.line ?? 1,
    baseline: overrides.baseline ?? [
      [overrides.bbox[0], overrides.bbox[3]],
      [overrides.bbox[2], overrides.bbox[3]],
    ],
    ocrText: overrides.ocrText ?? '',
    bbox: overrides.bbox,
    boundary: overrides.boundary,
    words: overrides.words,
  };
}

function makeWord(
  text: string,
  bbox: [number, number, number, number],
): LineSegmentWord {
  return { text, bbox };
}

describe('constrainedGrouping', () => {
  it('returns empty result for empty input', () => {
    const result = constrainedGrouping([]);
    expect(result.lines).toEqual([]);
    expect(result.marginalSegments).toEqual([]);
  });

  it('single segment passes through unchanged', () => {
    const seg = makeSeg({
      bbox: [100, 100, 500, 130],
      words: [makeWord('Hello', [100, 100, 300, 130]), makeWord('world', [320, 100, 500, 130])],
    });
    const result = constrainedGrouping([seg]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].merged).toBe(false);
    expect(result.lines[0].constituents).toEqual([seg]);
    expect(result.lines[0].line).toBe(1);
    expect(result.lines[0].region).toBe('body');
  });

  it('two adjacent segments with small gap merge', () => {
    const a = makeSeg({ bbox: [100, 100, 300, 130] });
    const b = makeSeg({ bbox: [320, 102, 500, 128] });

    const result = constrainedGrouping([a, b]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].merged).toBe(true);
    expect(result.lines[0].constituents).toHaveLength(2);
    expect(result.lines[0].bbox).toEqual([100, 100, 500, 130]);
  });

  it('two segments in different regions do not merge', () => {
    const body = makeSeg({ bbox: [200, 100, 800, 130] });
    const margin = makeSeg({ bbox: [10, 100, 30, 130] });

    const result = constrainedGrouping([body, margin]);

    expect(result.lines).toHaveLength(2);
    expect(result.marginalSegments).toHaveLength(1);
  });

  it('relative thresholds scale with line height', () => {
    const a = makeSeg({ bbox: [100, 100, 300, 160] });
    const b = makeSeg({ bbox: [380, 105, 550, 155] });

    const result = constrainedGrouping([a, b]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].merged).toBe(true);

    const c = makeSeg({ bbox: [100, 100, 300, 115] });
    const d = makeSeg({ bbox: [380, 102, 550, 113] });

    const result2 = constrainedGrouping([c, d]);
    expect(result2.lines).toHaveLength(2);
  });

  it('low aspect ratio segments at edges classified as margin', () => {
    const body1 = makeSeg({ bbox: [200, 50, 800, 80] });
    const body2 = makeSeg({ bbox: [200, 100, 800, 130] });
    const body3 = makeSeg({ bbox: [200, 150, 800, 180] });
    const margin = makeSeg({ bbox: [5, 100, 20, 130] });

    const result = constrainedGrouping([body1, body2, body3, margin]);

    expect(result.marginalSegments).toContain(margin);
    const marginLine = result.lines.find(l => l.constituents.includes(margin));
    expect(marginLine?.region).toBe('margin');
  });

  it('word continuity boosts merge across slightly larger gaps', () => {
    const wordA = makeWord('Hello', [250, 105, 295, 125]);
    const wordB = makeWord('world', [355, 105, 395, 125]);

    const a = makeSeg({
      bbox: [100, 100, 300, 130],
      words: [wordA],
    });
    const b = makeSeg({
      bbox: [355, 102, 500, 128],
      words: [wordB],
    });

    const result = constrainedGrouping([a, b]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].merged).toBe(true);
  });

  it('chain of 3 merges correctly', () => {
    const a = makeSeg({ bbox: [100, 100, 200, 130] });
    const b = makeSeg({ bbox: [220, 102, 350, 128] });
    const c = makeSeg({ bbox: [370, 101, 500, 129] });

    const result = constrainedGrouping([a, b, c]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].merged).toBe(true);
    expect(result.lines[0].constituents).toHaveLength(3);
    expect(result.lines[0].bbox).toEqual([100, 100, 500, 130]);
  });

  it('vertically stacked segments do not merge', () => {
    const a = makeSeg({ bbox: [100, 100, 500, 130] });
    const b = makeSeg({ bbox: [100, 200, 500, 230] });

    const result = constrainedGrouping([a, b]);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].merged).toBe(false);
    expect(result.lines[1].merged).toBe(false);
  });

  it('sorts output by reading order (top-to-bottom)', () => {
    const bottom = makeSeg({ bbox: [100, 200, 500, 230] });
    const top = makeSeg({ bbox: [100, 100, 500, 130] });

    const result = constrainedGrouping([bottom, top]);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].line).toBe(1);
    expect(result.lines[0].bbox[1]).toBe(100);
    expect(result.lines[1].line).toBe(2);
    expect(result.lines[1].bbox[1]).toBe(200);
  });

  it('merged line has union bbox of constituents', () => {
    const a = makeSeg({ bbox: [100, 105, 300, 130] });
    const b = makeSeg({ bbox: [320, 100, 500, 135] });

    const result = constrainedGrouping([a, b]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].bbox).toEqual([100, 100, 500, 135]);
  });

  it('custom options override defaults', () => {
    const a = makeSeg({ bbox: [100, 100, 300, 130] });
    const b = makeSeg({ bbox: [320, 102, 500, 128] });

    const result = constrainedGrouping([a, b], { maxGapRatio: 0.5 });

    expect(result.lines).toHaveLength(2);
  });

  it('handles null/undefined input gracefully', () => {
    const result = constrainedGrouping(null as unknown as LineSegment[]);
    expect(result.lines).toEqual([]);
    expect(result.marginalSegments).toEqual([]);
  });

  it('does not mutate input segments', () => {
    const seg = makeSeg({ bbox: [100, 100, 500, 130] });
    const copy = JSON.parse(JSON.stringify(seg));

    constrainedGrouping([seg]);

    expect(seg).toEqual(copy);
  });
});

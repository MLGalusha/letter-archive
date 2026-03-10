import { describe, it, expect } from 'vitest';
import { constrainedGrouping } from '../constrainedGrouping';
import type { EnrichedSegment } from '../attachWordsToSegments';
import type { OcrWordBox } from '../../types/Letter';

function makeEnriched(
  overrides: Partial<EnrichedSegment> & { bbox: [number, number, number, number] },
): EnrichedSegment {
  return {
    line: overrides.line ?? 1,
    baseline: overrides.baseline ?? [
      [overrides.bbox[0], overrides.bbox[3]],
      [overrides.bbox[2], overrides.bbox[3]],
    ],
    ocrText: overrides.ocrText ?? '',
    bbox: overrides.bbox,
    boundary: overrides.boundary,
    visionWords: overrides.visionWords ?? [],
    visionText: overrides.visionText ?? '',
  };
}

function makeWord(
  text: string,
  bbox: [number, number, number, number],
  confidence = 0.95,
): OcrWordBox {
  return { text, bbox, confidence };
}

describe('constrainedGrouping', () => {
  it('returns empty result for empty input', () => {
    const result = constrainedGrouping([]);
    expect(result.lines).toEqual([]);
    expect(result.marginalSegments).toEqual([]);
  });

  it('single segment passes through unchanged', () => {
    const seg = makeEnriched({
      bbox: [100, 100, 500, 130],
      visionText: 'Hello world',
    });
    const result = constrainedGrouping([seg]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].merged).toBe(false);
    expect(result.lines[0].constituents).toEqual([seg]);
    expect(result.lines[0].line).toBe(1);
    expect(result.lines[0].region).toBe('body');
  });

  it('two adjacent segments with small gap merge', () => {
    // Segments are 30px tall, so median height = 30
    // Gap of 20px < 1.5 * 30 = 45 → should merge
    const a = makeEnriched({ bbox: [100, 100, 300, 130], visionText: 'Hello' });
    const b = makeEnriched({ bbox: [320, 102, 500, 128], visionText: 'world' });

    const result = constrainedGrouping([a, b]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].merged).toBe(true);
    expect(result.lines[0].constituents).toHaveLength(2);
    expect(result.lines[0].bbox).toEqual([100, 100, 500, 130]);
    expect(result.lines[0].visionText).toBe('Hello world');
  });

  it('two segments in different regions do not merge', () => {
    // Body segment — centered, wide
    const body = makeEnriched({ bbox: [200, 100, 800, 130] });
    // Margin segment — far left, narrow and short (low aspect ratio)
    const margin = makeEnriched({ bbox: [10, 100, 30, 130] });

    const result = constrainedGrouping([body, margin]);

    // They should not be merged even though they're horizontally adjacent
    // because the margin segment has low aspect ratio and is at the edge
    expect(result.lines).toHaveLength(2);
    expect(result.marginalSegments).toHaveLength(1);
  });

  it('relative thresholds scale with line height', () => {
    // Tall segments (height = 60), gap = 80
    // 80 < 1.5 * 60 = 90 → should merge
    const a = makeEnriched({ bbox: [100, 100, 300, 160] });
    const b = makeEnriched({ bbox: [380, 105, 550, 155] });

    const result = constrainedGrouping([a, b]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].merged).toBe(true);

    // Now with short segments (height = 15), same gap = 80
    // 80 > 1.5 * 15 = 22.5 → should NOT merge
    const c = makeEnriched({ bbox: [100, 100, 300, 115] });
    const d = makeEnriched({ bbox: [380, 102, 550, 113] });

    const result2 = constrainedGrouping([c, d]);
    expect(result2.lines).toHaveLength(2);
  });

  it('low aspect ratio segments at edges classified as margin', () => {
    // Wide body segments that establish the IQR
    const body1 = makeEnriched({ bbox: [200, 50, 800, 80] });
    const body2 = makeEnriched({ bbox: [200, 100, 800, 130] });
    const body3 = makeEnriched({ bbox: [200, 150, 800, 180] });
    // Narrow edge segment: width/height = 15/30 = 0.5 < 1.5
    const margin = makeEnriched({ bbox: [5, 100, 20, 130] });

    const result = constrainedGrouping([body1, body2, body3, margin]);

    expect(result.marginalSegments).toContain(margin);
    const marginLine = result.lines.find(l => l.constituents.includes(margin));
    expect(marginLine?.region).toBe('margin');
  });

  it('word continuity boosts merge across slightly larger gaps', () => {
    // Height = 30, normal max gap = 1.5 * 30 = 45
    // Gap of 55 > 45 → would NOT merge without word continuity
    // With word continuity, max gap = 45 * 1.5 = 67.5 → 55 < 67.5 → merges
    const wordA = makeWord('Hello', [250, 105, 295, 125]);
    const wordB = makeWord('world', [355, 105, 395, 125]);

    const a = makeEnriched({
      bbox: [100, 100, 300, 130],
      visionWords: [wordA],
      visionText: 'Hello',
    });
    const b = makeEnriched({
      bbox: [355, 102, 500, 128],
      visionWords: [wordB],
      visionText: 'world',
    });

    const result = constrainedGrouping([a, b]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].merged).toBe(true);
  });

  it('chain of 3 merges correctly', () => {
    const a = makeEnriched({ bbox: [100, 100, 200, 130] });
    const b = makeEnriched({ bbox: [220, 102, 350, 128] });
    const c = makeEnriched({ bbox: [370, 101, 500, 129] });

    const result = constrainedGrouping([a, b, c]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].merged).toBe(true);
    expect(result.lines[0].constituents).toHaveLength(3);
    expect(result.lines[0].bbox).toEqual([100, 100, 500, 130]);
  });

  it('vertically stacked segments do not merge', () => {
    const a = makeEnriched({ bbox: [100, 100, 500, 130] });
    const b = makeEnriched({ bbox: [100, 200, 500, 230] });

    const result = constrainedGrouping([a, b]);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].merged).toBe(false);
    expect(result.lines[1].merged).toBe(false);
  });

  it('sorts output by reading order (top-to-bottom)', () => {
    // Feed segments in reverse order
    const bottom = makeEnriched({ bbox: [100, 200, 500, 230] });
    const top = makeEnriched({ bbox: [100, 100, 500, 130] });

    const result = constrainedGrouping([bottom, top]);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].line).toBe(1);
    expect(result.lines[0].bbox[1]).toBe(100); // top line first
    expect(result.lines[1].line).toBe(2);
    expect(result.lines[1].bbox[1]).toBe(200); // bottom line second
  });

  it('merged line has union bbox of constituents', () => {
    const a = makeEnriched({ bbox: [100, 105, 300, 130] });
    const b = makeEnriched({ bbox: [320, 100, 500, 135] });

    const result = constrainedGrouping([a, b]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].bbox).toEqual([100, 100, 500, 135]);
  });

  it('custom options override defaults', () => {
    // Gap = 20, height = 30 → gap ratio = 20/30 = 0.67
    // With maxGapRatio = 0.5, 20 > 0.5 * 30 = 15 → should NOT merge
    const a = makeEnriched({ bbox: [100, 100, 300, 130] });
    const b = makeEnriched({ bbox: [320, 102, 500, 128] });

    const result = constrainedGrouping([a, b], { maxGapRatio: 0.5 });

    expect(result.lines).toHaveLength(2);
  });

  it('handles null/undefined input gracefully', () => {
    const result = constrainedGrouping(null as unknown as EnrichedSegment[]);
    expect(result.lines).toEqual([]);
    expect(result.marginalSegments).toEqual([]);
  });

  it('does not mutate input segments', () => {
    const seg = makeEnriched({ bbox: [100, 100, 500, 130] });
    const copy = JSON.parse(JSON.stringify(seg));

    constrainedGrouping([seg]);

    expect(seg).toEqual(copy);
  });
});

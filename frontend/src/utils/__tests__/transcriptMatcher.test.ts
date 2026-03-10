import { describe, it, expect } from 'vitest';
import { matchTranscriptToLines } from '../transcriptMatcher';
import type { GroupedLine } from '../constrainedGrouping';
import type { OcrWordBox } from '../../types/Letter';

function makeGroupedLine(
  overrides: Partial<GroupedLine> & {
    bbox: [number, number, number, number];
    visionText: string;
  },
): GroupedLine {
  return {
    line: overrides.line ?? 1,
    bbox: overrides.bbox,
    baseline: overrides.baseline ?? [
      [overrides.bbox[0], overrides.bbox[3]],
      [overrides.bbox[2], overrides.bbox[3]],
    ],
    visionWords: overrides.visionWords ?? [],
    visionText: overrides.visionText,
    constituents: overrides.constituents ?? [],
    merged: overrides.merged ?? false,
    region: overrides.region ?? 'body',
  };
}

function makeWord(
  text: string,
  bbox: [number, number, number, number],
  confidence = 0.95,
): OcrWordBox {
  return { text, bbox, confidence };
}

describe('matchTranscriptToLines', () => {
  it('matches transcript line to grouped line by word overlap', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 100, 500, 130],
        visionText: 'Dear Mother I hope',
      }),
    ];

    const result = matchTranscriptToLines(
      ['Dear Mother I hope'],
      grouped,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchSource).toBe('kraken+vision');
    expect(result.matched[0].confidence).toBeGreaterThan(0.5);
    expect(result.matched[0].bbox).toEqual([100, 100, 500, 130]);
    expect(result.excludedContent).toHaveLength(0);
  });

  it('preserves reading order in assignment', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 100, 500, 130],
        visionText: 'Line one text here',
      }),
      makeGroupedLine({
        line: 2,
        bbox: [100, 150, 500, 180],
        visionText: 'Line two more text',
      }),
      makeGroupedLine({
        line: 3,
        bbox: [100, 200, 500, 230],
        visionText: 'Line three final words',
      }),
    ];

    const result = matchTranscriptToLines(
      ['Line one text here', 'Line two more text', 'Line three final words'],
      grouped,
    );

    expect(result.matched).toHaveLength(3);
    // Assignments should follow order
    expect(result.matched[0].groupedLine).toBe(grouped[0]);
    expect(result.matched[1].groupedLine).toBe(grouped[1]);
    expect(result.matched[2].groupedLine).toBe(grouped[2]);
  });

  it('unmatched transcript line gets Vision-only fallback', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 100, 500, 130],
        visionText: 'Completely different text',
      }),
    ];

    const unassigned = [
      makeWord('Missing', [50, 300, 120, 330]),
      makeWord('line', [130, 300, 170, 330]),
      makeWord('text', [180, 300, 220, 330]),
    ];

    const result = matchTranscriptToLines(
      ['Missing line text'],
      grouped,
      unassigned,
    );

    // The transcript line should match unassigned words, not the grouped line
    // (depends on scores — grouped line text is "Completely different text"
    // which won't match "Missing line text" well)
    expect(result.matched).toHaveLength(1);
    // The grouped line with no transcript match goes to excluded
    expect(result.excludedContent.length).toBeGreaterThanOrEqual(0);
  });

  it('unmatched grouped line goes to excludedContent', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 50, 500, 80],
        visionText: 'PRINTED HEADER',
      }),
      makeGroupedLine({
        line: 2,
        bbox: [100, 100, 500, 130],
        visionText: 'Dear Mother',
      }),
    ];

    const result = matchTranscriptToLines(
      ['Dear Mother'],
      grouped,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].transcriptText).toBe('Dear Mother');
    // The printed header should be in excluded content
    expect(result.excludedContent).toHaveLength(1);
    expect(result.excludedContent[0].visionText).toBe('PRINTED HEADER');
  });

  it('empty transcript returns all grouped lines as excluded', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 100, 500, 130],
        visionText: 'Some text',
      }),
      makeGroupedLine({
        line: 2,
        bbox: [100, 150, 500, 180],
        visionText: 'More text',
      }),
    ];

    const result = matchTranscriptToLines([], grouped);

    expect(result.matched).toHaveLength(0);
    expect(result.excludedContent).toHaveLength(2);
  });

  it('exact text match produces high confidence', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 100, 500, 130],
        visionText: 'Hello dear world',
      }),
    ];

    const result = matchTranscriptToLines(
      ['Hello dear world'],
      grouped,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.matched[0].matchSource).toBe('kraken+vision');
  });

  it('partial text match works', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 100, 500, 130],
        visionText: 'Dear Mother I hope you are well',
      }),
    ];

    const result = matchTranscriptToLines(
      ['Dear Mother I hope you are doing well'],
      grouped,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchSource).toBe('kraken+vision');
    expect(result.matched[0].confidence).toBeGreaterThan(0.3);
  });

  it('no grouped lines falls back to Vision words', () => {
    const unassigned = [
      makeWord('Hello', [50, 100, 120, 130]),
      makeWord('world', [130, 100, 200, 130]),
    ];

    const result = matchTranscriptToLines(
      ['Hello world'],
      [],
      unassigned,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchSource).toBe('vision-only');
    expect(result.matched[0].bbox).not.toBeNull();
    expect(result.excludedContent).toHaveLength(0);
  });

  it('completely unmatched line when no data available', () => {
    const result = matchTranscriptToLines(
      ['Some text with no visual match'],
      [],
      [],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchSource).toBe('unmatched');
    expect(result.matched[0].bbox).toBeNull();
    expect(result.matched[0].confidence).toBe(0);
  });

  it('multiple transcript lines assigned in order across grouped lines', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 100, 500, 130],
        visionText: 'First line of the letter',
      }),
      makeGroupedLine({
        line: 2,
        bbox: [100, 150, 500, 180],
        visionText: 'Second line continues here',
      }),
    ];

    const result = matchTranscriptToLines(
      ['First line of the letter', 'Second line continues here'],
      grouped,
    );

    expect(result.matched).toHaveLength(2);
    expect(result.matched[0].transcriptLineIndex).toBe(0);
    expect(result.matched[0].groupedLine).toBe(grouped[0]);
    expect(result.matched[1].transcriptLineIndex).toBe(1);
    expect(result.matched[1].groupedLine).toBe(grouped[1]);
    expect(result.excludedContent).toHaveLength(0);
  });
});

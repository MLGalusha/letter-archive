import { describe, it, expect } from 'vitest';
import { matchTranscriptToLines } from '../transcriptMatcher';
import type { GroupedLine } from '../constrainedGrouping';

function makeGroupedLine(
  overrides: Partial<GroupedLine> & {
    bbox: [number, number, number, number];
    wordText: string;
  },
): GroupedLine {
  return {
    line: overrides.line ?? 1,
    bbox: overrides.bbox,
    baseline: overrides.baseline ?? [
      [overrides.bbox[0], overrides.bbox[3]],
      [overrides.bbox[2], overrides.bbox[3]],
    ],
    words: overrides.words ?? [],
    wordText: overrides.wordText,
    constituents: overrides.constituents ?? [],
    merged: overrides.merged ?? false,
    region: overrides.region ?? 'body',
  };
}

describe('matchTranscriptToLines', () => {
  it('matches transcript line to grouped line by word overlap', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 100, 500, 130],
        wordText: 'Dear Mother I hope',
      }),
    ];

    const result = matchTranscriptToLines(
      ['Dear Mother I hope'],
      grouped,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchSource).toBe('kraken');
    expect(result.matched[0].confidence).toBeGreaterThan(0.5);
    expect(result.matched[0].bbox).toEqual([100, 100, 500, 130]);
    expect(result.excludedContent).toHaveLength(0);
  });

  it('preserves reading order in assignment', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 100, 500, 130],
        wordText: 'Line one text here',
      }),
      makeGroupedLine({
        line: 2,
        bbox: [100, 150, 500, 180],
        wordText: 'Line two more text',
      }),
      makeGroupedLine({
        line: 3,
        bbox: [100, 200, 500, 230],
        wordText: 'Line three final words',
      }),
    ];

    const result = matchTranscriptToLines(
      ['Line one text here', 'Line two more text', 'Line three final words'],
      grouped,
    );

    expect(result.matched).toHaveLength(3);
    expect(result.matched[0].groupedLine).toBe(grouped[0]);
    expect(result.matched[1].groupedLine).toBe(grouped[1]);
    expect(result.matched[2].groupedLine).toBe(grouped[2]);
  });

  it('margin-region lines go to excludedContent', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 50, 500, 80],
        wordText: 'PRINTED HEADER',
        region: 'margin',
      }),
      makeGroupedLine({
        line: 2,
        bbox: [100, 100, 500, 130],
        wordText: 'Dear Mother',
      }),
    ];

    const result = matchTranscriptToLines(
      ['Dear Mother'],
      grouped,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].transcriptText).toBe('Dear Mother');
    expect(result.excludedContent).toHaveLength(1);
    expect(result.excludedContent[0].wordText).toBe('PRINTED HEADER');
  });

  it('empty transcript returns all grouped lines as excluded', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 100, 500, 130],
        wordText: 'Some text',
      }),
      makeGroupedLine({
        line: 2,
        bbox: [100, 150, 500, 180],
        wordText: 'More text',
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
        wordText: 'Hello dear world',
      }),
    ];

    const result = matchTranscriptToLines(
      ['Hello dear world'],
      grouped,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.matched[0].matchSource).toBe('kraken');
  });

  it('partial text match works', () => {
    const grouped = [
      makeGroupedLine({
        line: 1,
        bbox: [100, 100, 500, 130],
        wordText: 'Dear Mother I hope you are well',
      }),
    ];

    const result = matchTranscriptToLines(
      ['Dear Mother I hope you are doing well'],
      grouped,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchSource).toBe('kraken');
    expect(result.matched[0].confidence).toBeGreaterThan(0.3);
  });

  it('no grouped lines returns unmatched', () => {
    const result = matchTranscriptToLines(
      ['Hello world'],
      [],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchSource).toBe('unmatched');
    expect(result.matched[0].bbox).toBeNull();
    expect(result.excludedContent).toHaveLength(0);
  });

  it('completely unmatched line when no data available', () => {
    const result = matchTranscriptToLines(
      ['Some text with no visual match'],
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
        wordText: 'First line of the letter',
      }),
      makeGroupedLine({
        line: 2,
        bbox: [100, 150, 500, 180],
        wordText: 'Second line continues here',
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

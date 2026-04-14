import { describe, expect, it } from 'vitest';
import type { LineSegment } from '../types/Letter';
import { alignTranscriptToVisualLines } from './lineAlignment';

function makeSegment(
  line: number,
  bbox: [number, number, number, number],
  words: Array<{ text: string; bbox: [number, number, number, number] }>,
): LineSegment {
  return {
    line,
    bbox,
    baseline: [[bbox[0], bbox[3]], [bbox[2], bbox[3]]],
    ocrText: '',
    words,
  };
}

describe('alignTranscriptToVisualLines', () => {
  it('skips low-confidence ghost segments before aligning transcript lines', () => {
    const segments: LineSegment[] = [
      makeSegment(1, [20, 10, 100, 28], [
        { text: 'Bled', bbox: [20, 10, 60, 28] },
      ]),
      makeSegment(2, [40, 80, 240, 104], [
        { text: 'Hello', bbox: [40, 80, 85, 104] },
        { text: 'Again', bbox: [95, 80, 145, 104] },
        { text: 'Darling', bbox: [155, 80, 240, 104] },
      ]),
      makeSegment(3, [42, 120, 280, 144], [
        { text: 'I', bbox: [42, 120, 52, 144] },
        { text: 'am', bbox: [62, 120, 88, 144] },
        { text: 'almost', bbox: [98, 120, 162, 144] },
        { text: 'now', bbox: [172, 120, 208, 144] },
      ]),
    ];

    const aligned = alignTranscriptToVisualLines(
      'Hello Again Darling\nI am almost now',
      segments,
    );

    expect(aligned).toHaveLength(3);
    expect(aligned[0].transcriptText).toBe('');
    expect(aligned[1].bbox[1]).toBe(80);
    expect(aligned[1].words?.map((word) => word.text)).toEqual([
      'Hello',
      'Again',
      'Darling',
    ]);
    expect(aligned[2].bbox[1]).toBe(120);
  });

  it('drops detached ghost runs inside an accepted segment', () => {
    const segments: LineSegment[] = [
      makeSegment(1, [40, 80, 430, 104], [
        { text: 'Hello', bbox: [40, 80, 85, 104] },
        { text: 'Again', bbox: [95, 80, 145, 104] },
        { text: 'Darling', bbox: [155, 80, 240, 104] },
        { text: 'Ghost', bbox: [360, 78, 430, 102] },
      ]),
    ];

    const aligned = alignTranscriptToVisualLines('Hello Again Darling', segments);

    expect(aligned).toHaveLength(1);
    expect(aligned[0].words?.map((word) => word.text)).toEqual([
      'Hello',
      'Again',
      'Darling',
    ]);
    expect(aligned[0].bbox[2]).toBe(240);
  });
});

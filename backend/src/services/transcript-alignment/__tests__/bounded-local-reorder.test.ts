import { describe, expect, it } from 'vitest';
import { alignmentTextSimilarity } from '../aligner.js';
import {
  applyBoundedLocalReorders,
  type BoundedLocalReorderSide,
} from '../bounded-local-reorder.js';

function transcript(...entries: Array<readonly [id: string, text: string]>) {
  return entries.map(([id, text]) => ({ id, text }));
}

function segment({
  id,
  text,
  top,
  bottom = top + 80,
  left = 200,
  right = 1800,
  geometry = true,
  regionId = 'page-main',
}: {
  id: string;
  text: string;
  top: number;
  bottom?: number;
  left?: number;
  right?: number;
  geometry?: boolean;
  regionId?: string | null;
}) {
  return {
    id,
    text,
    regionId,
    orientationDegrees: 0,
    boundary: geometry
      ? [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ]
      : null,
    baseline: geometry
      ? [
        { x: left, y: bottom - 20 },
        { x: right, y: bottom - 20 },
      ]
      : null,
  };
}

function reorder(
  transcriptLines: ReturnType<typeof transcript>,
  segments: ReturnType<typeof segment>[],
  movableSide: BoundedLocalReorderSide,
) {
  return applyBoundedLocalReorders(transcriptLines, segments, {
    movableSide,
    similarity: alignmentTextSimilarity,
  });
}

describe('bounded local alignment reorder', () => {
  it('repairs the real-derived 009 greeting/date row order in one three-item window', () => {
    const transcriptLines = transcript(
      ['T03', 'Sat. Evening'],
      ['T04', 'August 30'],
      ['T06', 'Hello Molly Darling -'],
      ['T08', 'Well, that beautiful letter came and was'],
    );
    const segments = [
      segment({
        id: 'S01-greeting',
        text: 'Vello Holly Darling-',
        left: 428,
        top: 384,
        right: 1335,
        bottom: 493,
      }),
      segment({
        id: 'S02-date-heading',
        text: 'Jat. Bvenine',
        left: 1568,
        top: 253,
        right: 2086,
        bottom: 337,
      }),
      segment({
        id: 'S03-date',
        text: 'August 30',
        left: 1564,
        top: 311,
        right: 1971,
        bottom: 424,
      }),
      segment({
        id: 'S04-body',
        text: 'Mell, that beautiful Lebter oame and was',
        left: 671,
        top: 508,
        right: 2375,
        bottom: 617,
      }),
    ];

    const result = reorder(transcriptLines, segments, 'segments');

    expect(result.transcriptLines.map(({ id }) => id)).toEqual([
      'T03',
      'T04',
      'T06',
      'T08',
    ]);
    expect(result.segments.map(({ id }) => id)).toEqual([
      'S02-date-heading',
      'S03-date',
      'S01-greeting',
      'S04-body',
    ]);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        movableSide: 'segments',
        windowStart: 0,
        windowSize: 3,
        beforeIds: [
          'S01-greeting',
          'S02-date-heading',
          'S03-date',
        ],
        afterIds: [
          'S02-date-heading',
          'S03-date',
          'S01-greeting',
        ],
        permutation: [1, 2, 0],
        geometryScoreBefore: 0.5,
        geometryScoreAfter: 1,
      }),
    ]);
    expect(result.decisions[0].similarityGain).toBeGreaterThan(0.6);
    expect(new Set(result.segments.map(({ id }) => id))).toEqual(
      new Set(segments.map(({ id }) => id)),
    );
  });

  it('repairs a two-line LLM transcript swap when the image-row order is clear', () => {
    const transcriptLines = transcript(
      ['T02', 'The train arrived after midnight'],
      ['T01', 'Dear Ruth,'],
    );
    const segments = [
      segment({
        id: 'S01',
        text: 'Dear Ruth',
        top: 200,
      }),
      segment({
        id: 'S02',
        text: 'The train arived after midnight',
        top: 340,
      }),
    ];

    const result = reorder(transcriptLines, segments, 'transcript');

    expect(result.transcriptLines.map(({ id }) => id)).toEqual(['T01', 'T02']);
    expect(result.segments.map(({ id }) => id)).toEqual(['S01', 'S02']);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        movableSide: 'transcript',
        windowStart: 0,
        windowSize: 2,
        beforeIds: ['T02', 'T01'],
        afterIds: ['T01', 'T02'],
        permutation: [1, 0],
        geometryScoreBefore: 1,
        geometryScoreAfter: 1,
      }),
    ]);
  });

  it('does not guess when exact text suggests a swap but geometry is missing', () => {
    const transcriptLines = transcript(
      ['T01', 'Dear Ruth'],
      ['T02', 'The train arrived'],
    );
    const segments = [
      segment({
        id: 'S02',
        text: 'The train arrived',
        top: 0,
        geometry: false,
      }),
      segment({
        id: 'S01',
        text: 'Dear Ruth',
        top: 0,
        geometry: false,
      }),
    ];

    const result = reorder(transcriptLines, segments, 'segments');

    expect(result.decisions).toEqual([]);
    expect(result.segments.map(({ id }) => id)).toEqual(['S02', 'S01']);
  });

  it('rejects a geometrically plausible change when content evidence is weak', () => {
    const transcriptLines = transcript(
      ['T01', 'Dear Ruth'],
      ['T02', 'The train arrived'],
    );
    const segments = [
      segment({
        id: 'S02',
        text: 'unrelated neighboring photograph',
        top: 340,
      }),
      segment({
        id: 'S01',
        text: 'another unreadable fragment',
        top: 200,
      }),
    ];

    const result = reorder(transcriptLines, segments, 'segments');

    expect(result.decisions).toEqual([]);
    expect(result.segments.map(({ id }) => id)).toEqual(['S02', 'S01']);
  });

  it('never reorders across different explicit regions', () => {
    const transcriptLines = transcript(
      ['T01', 'Dear Ruth'],
      ['T02', 'The train arrived'],
    );
    const segments = [
      segment({
        id: 'S02',
        text: 'The train arrived',
        top: 340,
        regionId: 'margin',
      }),
      segment({
        id: 'S01',
        text: 'Dear Ruth',
        top: 200,
        regionId: 'body',
      }),
    ];

    const result = reorder(transcriptLines, segments, 'segments');

    expect(result.decisions).toEqual([]);
    expect(result.segments.map(({ id }) => id)).toEqual(['S02', 'S01']);
  });

  it('refuses to decompose a four-position move into cascading local reshuffles', () => {
    const transcriptLines = transcript(
      ['T01', 'alpha cedar'],
      ['T02', 'bravo harbor'],
      ['T03', 'charlie meadow'],
      ['T04', 'delta river'],
    );
    const segments = [
      segment({
        id: 'S04',
        text: 'delta river',
        top: 600,
      }),
      segment({
        id: 'S01',
        text: 'alpha cedar',
        top: 180,
      }),
      segment({
        id: 'S02',
        text: 'bravo harbor',
        top: 320,
      }),
      segment({
        id: 'S03',
        text: 'charlie meadow',
        top: 460,
      }),
    ];

    const result = reorder(transcriptLines, segments, 'segments');

    expect(result.decisions).toEqual([]);
    expect(result.segments.map(({ id }) => id)).toEqual([
      'S04',
      'S01',
      'S02',
      'S03',
    ]);
  });

  it('will not reorder correct image geometry to compensate for an LLM swap', () => {
    const transcriptLines = transcript(
      ['T02', 'The train arrived'],
      ['T01', 'Dear Ruth'],
    );
    const segments = [
      segment({
        id: 'S01',
        text: 'Dear Ruth',
        top: 200,
      }),
      segment({
        id: 'S02',
        text: 'The train arrived',
        top: 340,
      }),
    ];

    const result = reorder(transcriptLines, segments, 'segments');

    expect(result.decisions).toEqual([]);
    expect(result.segments.map(({ id }) => id)).toEqual(['S01', 'S02']);
  });

  it('applies independent swaps without moving any item beyond its local window', () => {
    const transcriptLines = transcript(
      ['T01', 'alpha cedar'],
      ['T02', 'bravo harbor'],
      ['T03', 'charlie meadow'],
      ['T04', 'delta river'],
    );
    const segments = [
      segment({ id: 'S02', text: 'bravo harbor', top: 320 }),
      segment({ id: 'S01', text: 'alpha cedar', top: 180 }),
      segment({ id: 'S04', text: 'delta river', top: 600 }),
      segment({ id: 'S03', text: 'charlie meadow', top: 460 }),
    ];

    const result = reorder(transcriptLines, segments, 'segments');

    expect(result.segments.map(({ id }) => id)).toEqual([
      'S01',
      'S02',
      'S03',
      'S04',
    ]);
    expect(result.decisions.map(({ windowStart, windowSize }) => ({
      windowStart,
      windowSize,
    }))).toEqual([
      { windowStart: 0, windowSize: 2 },
      { windowStart: 2, windowSize: 2 },
    ]);
    const originalIndex = new Map(
      segments.map(({ id }, index) => [id, index]),
    );
    result.segments.forEach(({ id }, index) => {
      expect(Math.abs(index - (originalIndex.get(id) as number)))
        .toBeLessThanOrEqual(2);
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  expandPreparedSegmentIds,
  prepareAlignmentSegments,
} from '../alignment-preparation.js';
import type {
  RecognizedSegment,
  TranscriptLine,
} from '../aligner.js';

function transcript(...texts: string[]): TranscriptLine[] {
  return texts.map((text, index) => ({
    id: `T${String(index + 1).padStart(2, '0')}`,
    text,
  }));
}

function segment({
  id,
  text,
  left,
  top,
  right,
  bottom,
  baseline,
  readingOrderIndex,
}: {
  id: string;
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  baseline?: Array<{ x: number; y: number }>;
  readingOrderIndex?: number;
}): RecognizedSegment {
  return {
    id,
    text,
    recognitionConfidence: 0.8,
    regionId: 'page',
    orientationDegrees: 0,
    readingOrderIndex,
    boundary: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
    baseline: baseline ?? [
      { x: left, y: bottom - 20 },
      { x: right, y: bottom - 20 },
    ],
  };
}

function sourceIds(
  rows: ReturnType<typeof prepareAlignmentSegments>['primaryRows'],
): string[] {
  return rows.flatMap(({ sourceSegmentIds }) => sourceSegmentIds);
}

describe('transcript alignment physical-row preparation', () => {
  it('reconstructs the real-derived 007 page-one split rows and preserves raw ids', () => {
    const segments = [
      segment({
        id: 'S01-header',
        text: 'ON ACTIVE SHMVICE',
        left: 1615,
        top: 568,
        right: 2200,
        bottom: 644,
      }),
      segment({
        id: 'S12-left',
        text: 'Etonl hummemee t',
        left: 984,
        top: 1753,
        right: 1848,
        bottom: 1886,
        baseline: [{ x: 984, y: 1840 }, { x: 1848, y: 1840 }],
      }),
      segment({
        id: 'S13-right',
        text: 'de',
        left: 1977,
        top: 1760,
        right: 2531,
        bottom: 1875,
        baseline: [{ x: 1977, y: 1843 }, { x: 2531, y: 1843 }],
      }),
      segment({
        id: 'S14-next',
        text: 'osee du cmm ommonf',
        left: 504,
        top: 1920,
        right: 2553,
        bottom: 2080,
      }),
      segment({
        id: 'S15-left',
        text: 'P Ee d',
        left: 448,
        top: 2071,
        right: 1851,
        bottom: 2195,
        baseline: [{ x: 448, y: 2144 }, { x: 1851, y: 2144 }],
      }),
      segment({
        id: 'S16-right',
        text: 'M',
        left: 2002,
        top: 2071,
        right: 2364,
        bottom: 2186,
        baseline: [{ x: 2002, y: 2158 }, { x: 2364, y: 2158 }],
      }),
    ];

    const result = prepareAlignmentSegments({
      transcriptLines: transcript(
        'I know it made',
        'you happy to hear',
        'the news that the',
      ),
      segments,
      options: {
        structural: { imageWidth: 3000, imageHeight: 4000 },
      },
    });

    const firstSplit = result.primaryRows.find(
      ({ sourceSegmentIds }) => sourceSegmentIds.includes('S12-left'),
    );
    const secondSplit = result.primaryRows.find(
      ({ sourceSegmentIds }) => sourceSegmentIds.includes('S15-left'),
    );
    expect(firstSplit).toEqual(expect.objectContaining({
      text: 'Etonl hummemee t de',
      sourceSegmentIds: ['S12-left', 'S13-right'],
    }));
    expect(secondSplit?.sourceSegmentIds).toEqual(['S15-left', 'S16-right']);
    expect(result.rawSegmentIdsByPreparedId[firstSplit!.id])
      .toEqual(['S12-left', 'S13-right']);
    expect(sourceIds(result.primaryRows)).toEqual(expect.arrayContaining(
      segments.map(({ id }) => id),
    ));
  });

  it('uses transcript content to isolate the 007 page-two main page from the neighboring page', () => {
    const segments = [
      segment({
        id: 'main-1',
        text: 'soin lo mai at',
        left: 500,
        top: 970,
        right: 2360,
        bottom: 1100,
      }),
      segment({
        id: 'main-2',
        text: 'ee many ople',
        left: 475,
        top: 1130,
        right: 2340,
        bottom: 1290,
      }),
      segment({
        id: 'main-3',
        text: 'hare Bi Loust',
        left: 510,
        top: 1290,
        right: 2450,
        bottom: 1430,
      }),
      segment({
        id: 'neighbor-1',
        text: 'a',
        left: 2700,
        top: 950,
        right: 2950,
        bottom: 1060,
      }),
      segment({
        id: 'neighbor-2',
        text: 'ol',
        left: 2740,
        top: 1060,
        right: 2960,
        bottom: 1180,
      }),
      segment({
        id: 'neighbor-3',
        text: 'A',
        left: 2760,
        top: 1240,
        right: 2940,
        bottom: 1330,
      }),
    ];
    const result = prepareAlignmentSegments({
      transcriptLines: transcript(
        'sorry to hear that',
        'so many people',
        'have the same',
      ),
      segments,
      options: {
        structural: { imageWidth: 3000, imageHeight: 4000 },
      },
    });

    expect(result.selection.mode).toBe('component-subset');
    expect(sourceIds(result.primaryRows)).toEqual([
      'main-1',
      'main-2',
      'main-3',
    ]);
    expect(result.secondaryRawSegments.map(({ id }) => id)).toEqual([
      'neighbor-1',
      'neighbor-2',
      'neighbor-3',
    ]);
    expect(result.selection.scoreImprovement).toBeGreaterThanOrEqual(0.04);
  });

  it('keeps the 007 page-three foreign bottom box out of the supported main flow', () => {
    const segments = [
      segment({
        id: 'main-1',
        text: 'rne druns a glais',
        left: 504,
        top: 3000,
        right: 2671,
        bottom: 3150,
      }),
      segment({
        id: 'main-2',
        text: 'af rheuni aird Phi',
        left: 555,
        top: 3160,
        right: 2597,
        bottom: 3310,
      }),
      segment({
        id: 'main-3',
        text: 'Ponce haisf ar sasle',
        left: 517,
        top: 3370,
        right: 2391,
        bottom: 3531,
      }),
      segment({
        id: 'foreign-box',
        text: 'ee.',
        left: 168,
        top: 3395,
        right: 322,
        bottom: 3522,
      }),
    ];
    const result = prepareAlignmentSegments({
      transcriptLines: transcript(
        'and drink a glass',
        'of Rhine and then',
        'Come back and take',
      ),
      segments,
      options: {
        structural: { imageWidth: 3000, imageHeight: 4000 },
      },
    });

    expect(sourceIds(result.primaryRows)).toEqual([
      'main-1',
      'main-2',
      'main-3',
    ]);
    expect(result.secondaryRawSegments.map(({ id }) => id))
      .toEqual(['foreign-box']);
  });

  it('reconstructs the 007 page-four split top row without absorbing the next row', () => {
    const segments = [
      segment({
        id: 'top-left',
        text: 'Edat',
        left: 735,
        top: 893,
        right: 1600,
        bottom: 1071,
        baseline: [{ x: 737, y: 1011 }, { x: 1600, y: 1006 }],
      }),
      segment({
        id: 'top-right',
        text: 'Aevur',
        left: 1628,
        top: 906,
        right: 2477,
        bottom: 1020,
        baseline: [{ x: 1631, y: 1008 }, { x: 2477, y: 984 }],
      }),
      segment({
        id: 'next-row',
        text: 'Pentray Lad peur',
        left: 422,
        top: 1071,
        right: 2553,
        bottom: 1204,
        baseline: [{ x: 424, y: 1173 }, { x: 2553, y: 1157 }],
      }),
    ];
    const result = prepareAlignmentSegments({
      transcriptLines: transcript(
        "I didn't know",
        'Mrs. Cummings had been',
      ),
      segments,
      options: {
        structural: { imageWidth: 3000, imageHeight: 4000 },
      },
    });

    expect(result.primaryRows.map(({ sourceSegmentIds }) => sourceSegmentIds))
      .toEqual([
        ['top-left', 'top-right'],
        ['next-row'],
      ]);
  });

  it('reconstructs the 005 address and 009 typewritten rows in spatial order', () => {
    const result005 = prepareAlignmentSegments({
      transcriptLines: transcript('9 Lexington Ave', 'New York'),
      segments: [
        segment({
          id: 'address-number',
          text: '9',
          left: 1295,
          top: 511,
          right: 1346,
          bottom: 655,
          baseline: [{ x: 1295, y: 604 }, { x: 1346, y: 604 }],
        }),
        segment({
          id: 'address-street',
          text: 'J Lexington Ave',
          left: 1401,
          top: 502,
          right: 2306,
          bottom: 653,
          baseline: [{ x: 1405, y: 606 }, { x: 2306, y: 589 }],
        }),
        segment({
          id: 'next-address-row',
          text: 'Neue york',
          left: 1600,
          top: 680,
          right: 2300,
          bottom: 790,
        }),
      ],
      options: {
        structural: { imageWidth: 3000, imageHeight: 4000 },
      },
    });
    expect(result005.primaryRows[0]).toEqual(expect.objectContaining({
      text: '9 J Lexington Ave',
      sourceSegmentIds: ['address-number', 'address-street'],
    }));

    const result009 = prepareAlignmentSegments({
      transcriptLines: transcript(
        'to remedy all the complaints you have',
        'Against me.',
      ),
      segments: [
        segment({
          id: 'row-1-left',
          text: 'to remedy all the',
          left: 517,
          top: 602,
          right: 977,
          bottom: 693,
          baseline: [{ x: 520, y: 662 }, { x: 977, y: 666 }],
        }),
        segment({
          id: 'row-1-right',
          text: 'complaints you have',
          left: 1057,
          top: 602,
          right: 2266,
          bottom: 702,
          baseline: [{ x: 1060, y: 668 }, { x: 2266, y: 653 }],
        }),
        segment({
          id: 'row-2-left',
          text: 'Ag',
          left: 502,
          top: 682,
          right: 713,
          bottom: 762,
          baseline: [{ x: 502, y: 731 }, { x: 713, y: 731 }],
        }),
        segment({
          id: 'row-2-middle',
          text: 'ri',
          left: 851,
          top: 677,
          right: 877,
          bottom: 762,
          baseline: [{ x: 853, y: 733 }, { x: 877, y: 735 }],
        }),
        segment({
          id: 'row-2-right',
          text: 'nst me.',
          left: 937,
          top: 664,
          right: 2313,
          bottom: 777,
          baseline: [{ x: 940, y: 735 }, { x: 2313, y: 722 }],
        }),
      ],
      options: {
        structural: { imageWidth: 3000, imageHeight: 4000 },
      },
    });
    expect(result009.primaryRows.map((row) => row.sourceSegmentIds))
      .toEqual([
        ['row-1-left', 'row-1-right'],
        ['row-2-left', 'row-2-middle', 'row-2-right'],
      ]);
    expect(result009.primaryRows.map(({ text }) => text)).toEqual([
      'to remedy all the complaints you have',
      'Ag ri nst me.',
    ]);
  });

  it('keeps multiple plausible date, greeting, correction, and body components', () => {
    const segments = [
      segment({
        id: 'date',
        text: 'August 30',
        left: 1600,
        top: 200,
        right: 2100,
        bottom: 300,
      }),
      segment({
        id: 'greeting',
        text: 'Hello Molly Darling',
        left: 400,
        top: 900,
        right: 1400,
        bottom: 1020,
      }),
      segment({
        id: 'correction',
        text: 'forgotten',
        left: 620,
        top: 1650,
        right: 1050,
        bottom: 1760,
      }),
      segment({
        id: 'body',
        text: 'the word belongs here',
        left: 300,
        top: 1800,
        right: 2450,
        bottom: 1930,
      }),
    ];
    const result = prepareAlignmentSegments({
      transcriptLines: transcript(
        'August 30',
        'Hello Molly Darling',
        'forgotten',
        'the word belongs here',
      ),
      segments,
      options: {
        structural: { imageWidth: 3000, imageHeight: 4000 },
      },
    });

    expect(result.structural.components.length).toBeGreaterThan(1);
    expect(result.selection.mode).toBe('all-components');
    expect(sourceIds(result.primaryRows)).toEqual(expect.arrayContaining([
      'date',
      'greeting',
      'correction',
      'body',
    ]));
    expect(result.secondaryRawSegments).toEqual([]);
  });

  it('bypasses structural reordering when every segment lacks geometry', () => {
    const segments: RecognizedSegment[] = [
      { id: 'raw-b', text: 'second', readingOrderIndex: 1 },
      { id: 'raw-a', text: 'first', readingOrderIndex: 0 },
      { id: 'raw-c', text: 'third' },
    ];
    const result = prepareAlignmentSegments({
      transcriptLines: transcript('first', 'second', 'third'),
      segments,
    });

    expect(result.selection.mode).toBe('geometry-bypass');
    expect(result.primaryRows.map(({ id }) => id)).toEqual([
      'raw-a',
      'raw-b',
      'raw-c',
    ]);
    expect(result.primaryRows.map(({ sourceSegmentIds }) => sourceSegmentIds))
      .toEqual([['raw-a'], ['raw-b'], ['raw-c']]);
    expect(result.secondaryRawSegments).toEqual([]);
  });

  it('expands prepared row ids back to stable deduplicated raw ids', () => {
    expect(expandPreparedSegmentIds(
      ['row-a', 'row-b', 'row-a'],
      {
        'row-a': ['raw-1', 'raw-2'],
        'row-b': ['raw-2', 'raw-3'],
      },
    )).toEqual(['raw-1', 'raw-2', 'raw-3']);
    expect(() => expandPreparedSegmentIds(['missing'], {}))
      .toThrow('Unknown prepared segment id missing');
  });
});

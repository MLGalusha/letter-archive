import { describe, expect, it } from 'vitest';
import {
  normalizeSegmentStructure,
  type StructuralSegment,
} from '../structural-normalization.js';

function fragment({
  id,
  left,
  top,
  right,
  bottom,
  baseline,
  orientationDegrees = 0,
  readingOrderIndex,
  regionId,
}: {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  baseline?: Array<{ x: number; y: number }>;
  orientationDegrees?: number;
  readingOrderIndex?: number;
  regionId?: string;
}): StructuralSegment {
  return {
    id,
    regionId,
    orientationDegrees,
    readingOrderIndex,
    boundary: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
    baseline: baseline ?? [
      { x: left, y: bottom - ((bottom - top) * 0.25) },
      { x: right, y: bottom - ((bottom - top) * 0.25) },
    ],
  };
}

function rowForSegment(
  result: ReturnType<typeof normalizeSegmentStructure>,
  segmentId: string,
) {
  return result.rows.find(({ id }) => id === result.segmentToRowId[segmentId]);
}

function componentForSegment(
  result: ReturnType<typeof normalizeSegmentStructure>,
  segmentId: string,
) {
  const rowId = result.segmentToRowId[segmentId];
  return result.components.find(
    ({ id }) => id === result.rowToComponentId[rowId],
  );
}

describe('transcript alignment structural normalization', () => {
  it('keeps the 007 page-3 foreign box out of the main row and flow', () => {
    const result = normalizeSegmentStructure([
      fragment({
        id: 'foreign-box',
        left: 168,
        top: 3395,
        right: 322,
        bottom: 3522,
        baseline: [{ x: 171, y: 3471 }, { x: 322, y: 3473 }],
        readingOrderIndex: 0,
      }),
      fragment({
        id: 'main-first',
        left: 504,
        top: 777,
        right: 2671,
        bottom: 982,
        baseline: [{ x: 508, y: 968 }, { x: 2671, y: 880 }],
        readingOrderIndex: 1,
      }),
      fragment({
        id: 'main-second',
        left: 555,
        top: 937,
        right: 2597,
        bottom: 1113,
        baseline: [{ x: 560, y: 1086 }, { x: 2597, y: 1031 }],
        readingOrderIndex: 2,
      }),
      fragment({
        id: 'main-near-bottom',
        left: 517,
        top: 3400,
        right: 2391,
        bottom: 3531,
        baseline: [{ x: 520, y: 3497 }, { x: 2391, y: 3493 }],
        readingOrderIndex: 17,
      }),
    ], {
      imageWidth: 3000,
      imageHeight: 4000,
    });

    expect(rowForSegment(result, 'foreign-box')?.memberSegmentIds)
      .toEqual(['foreign-box']);
    expect(result.segmentToRowId['foreign-box'])
      .not.toBe(result.segmentToRowId['main-first']);
    expect(result.segmentToRowId['foreign-box'])
      .not.toBe(result.segmentToRowId['main-near-bottom']);
    expect(componentForSegment(result, 'foreign-box')?.id)
      .not.toBe(componentForSegment(result, 'main-first')?.id);
    expect(componentForSegment(result, 'foreign-box')?.id)
      .not.toBe(componentForSegment(result, 'main-near-bottom')?.id);
    expect(componentForSegment(result, 'main-first')?.memberSegmentIds)
      .toEqual(expect.arrayContaining(['main-first', 'main-second']));
    expect(result.decisions).toContainEqual(expect.objectContaining({
      scope: 'row',
      outcome: 'separated',
      leftId: 'foreign-box',
      rightId: 'main-first',
      reason: 'flow-discontinuity',
    }));
  });

  it('reconstructs the 007 page-4 split top line without absorbing the next row', () => {
    const result = normalizeSegmentStructure([
      fragment({
        id: 'top-left',
        left: 735,
        top: 893,
        right: 1600,
        bottom: 1071,
        baseline: [{ x: 737, y: 1011 }, { x: 1600, y: 1006 }],
        readingOrderIndex: 0,
      }),
      fragment({
        id: 'top-right',
        left: 1628,
        top: 906,
        right: 2477,
        bottom: 1020,
        baseline: [{ x: 1631, y: 1008 }, { x: 2477, y: 984 }],
        readingOrderIndex: 1,
      }),
      fragment({
        id: 'next-row',
        left: 422,
        top: 1071,
        right: 2553,
        bottom: 1204,
        baseline: [{ x: 424, y: 1173 }, { x: 2553, y: 1157 }],
        readingOrderIndex: 2,
      }),
    ], {
      imageWidth: 3000,
      imageHeight: 4000,
    });

    expect(rowForSegment(result, 'top-left')?.memberSegmentIds)
      .toEqual(['top-left', 'top-right']);
    expect(result.segmentToRowId['top-left'])
      .toBe(result.segmentToRowId['top-right']);
    expect(result.segmentToRowId['top-left'])
      .not.toBe(result.segmentToRowId['next-row']);
    expect(rowForSegment(result, 'top-left')?.formation)
      .toEqual(expect.objectContaining({
        reason: 'collinear-fragments',
        decisionIds: [expect.stringMatching(/^row-decision-/u)],
      }));
  });

  it('joins the sloped 005 address fragments into one physical row', () => {
    const result = normalizeSegmentStructure([
      fragment({
        id: 'address-number',
        left: 1295,
        top: 511,
        right: 1346,
        bottom: 655,
        baseline: [{ x: 1295, y: 604 }, { x: 1346, y: 604 }],
        readingOrderIndex: 2,
      }),
      fragment({
        id: 'address-street',
        left: 1401,
        top: 502,
        right: 2306,
        bottom: 653,
        baseline: [{ x: 1405, y: 606 }, { x: 2306, y: 589 }],
        readingOrderIndex: 3,
      }),
    ], {
      imageWidth: 3000,
      imageHeight: 4000,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual(expect.objectContaining({
      memberSegmentIds: ['address-number', 'address-street'],
      orientationFamily: 'horizontal',
      formation: expect.objectContaining({
        reason: 'collinear-fragments',
      }),
    }));
  });

  it('reconstructs left, middle, and right typewritten fragments on 009 page 9', () => {
    const pageNineSegments = [
      fragment({
        id: 'typed-row-1-left',
        left: 517,
        top: 602,
        right: 977,
        bottom: 693,
        baseline: [{ x: 520, y: 662 }, { x: 977, y: 666 }],
        readingOrderIndex: 1,
      }),
      fragment({
        id: 'typed-row-1-right',
        left: 1057,
        top: 602,
        right: 2266,
        bottom: 702,
        baseline: [{ x: 1060, y: 668 }, { x: 2266, y: 653 }],
        readingOrderIndex: 9,
      }),
      fragment({
        id: 'typed-row-2-left',
        left: 502,
        top: 682,
        right: 713,
        bottom: 762,
        baseline: [{ x: 502, y: 731 }, { x: 713, y: 731 }],
        readingOrderIndex: 2,
      }),
      fragment({
        id: 'typed-row-2-middle',
        left: 851,
        top: 677,
        right: 877,
        bottom: 762,
        baseline: [{ x: 853, y: 733 }, { x: 877, y: 735 }],
        readingOrderIndex: 8,
      }),
      fragment({
        id: 'typed-row-2-right',
        left: 937,
        top: 664,
        right: 2313,
        bottom: 777,
        baseline: [{ x: 940, y: 735 }, { x: 2313, y: 722 }],
        readingOrderIndex: 10,
      }),
    ];
    const options = { imageWidth: 3000, imageHeight: 4000 };

    const result = normalizeSegmentStructure(pageNineSegments, options);
    const reversed = normalizeSegmentStructure(
      pageNineSegments.slice().reverse(),
      options,
    );

    expect(rowForSegment(result, 'typed-row-1-left')?.memberSegmentIds)
      .toEqual(['typed-row-1-left', 'typed-row-1-right']);
    expect(rowForSegment(result, 'typed-row-2-left')?.memberSegmentIds)
      .toEqual([
        'typed-row-2-left',
        'typed-row-2-middle',
        'typed-row-2-right',
      ]);
    expect(result.segmentToRowId['typed-row-1-left'])
      .not.toBe(result.segmentToRowId['typed-row-2-left']);
    expect(reversed).toEqual(result);
  });

  it('reconstructs the staggered 003 page-3 closing row in left-to-right order', () => {
    const result = normalizeSegmentStructure([
      fragment({
        id: 'closing-right',
        left: 1774,
        top: 2261,
        right: 3534,
        bottom: 2368,
        baseline: [
          { x: 1775, y: 2330 },
          { x: 1872, y: 2334 },
          { x: 2765, y: 2311 },
          { x: 3534, y: 2313 },
        ],
        readingOrderIndex: 20,
        regionId: 'letter-body',
      }),
      fragment({
        id: 'closing-left',
        left: 222,
        top: 2311,
        right: 1591,
        bottom: 2443,
        baseline: [
          { x: 223, y: 2379 },
          { x: 698, y: 2380 },
          { x: 1190, y: 2388 },
          { x: 1591, y: 2390 },
        ],
        readingOrderIndex: 19,
        regionId: 'letter-body',
      }),
    ], {
      imageWidth: 4000,
      imageHeight: 3000,
      minimumFragmentGapTolerance: 155,
      maximumFragmentGapPageRatio: 0.05,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.memberSegmentIds).toEqual([
      'closing-left',
      'closing-right',
    ]);
    expect(result.decisions).toContainEqual(expect.objectContaining({
      scope: 'row',
      outcome: 'joined',
      reason: 'same-region-fragment-bridge',
    }));
  });

  it('reconstructs both wider 007 page-2 rows, including three fragments', () => {
    const result = normalizeSegmentStructure([
      fragment({
        id: 'flu-left',
        left: 455,
        top: 1433,
        right: 935,
        bottom: 1555,
        baseline: [{ x: 455, y: 1520 }, { x: 935, y: 1520 }],
        readingOrderIndex: 3,
        regionId: 'letter-body',
      }),
      fragment({
        id: 'flu-right',
        left: 1842,
        top: 1448,
        right: 2380,
        bottom: 1571,
        baseline: [{ x: 1842, y: 1530 }, { x: 2380, y: 1527 }],
        readingOrderIndex: 5,
        regionId: 'letter-body',
      }),
      fragment({
        id: 'flu-middle',
        left: 1131,
        top: 1455,
        right: 1808,
        bottom: 1571,
        baseline: [{ x: 1131, y: 1523 }, { x: 1808, y: 1530 }],
        readingOrderIndex: 4,
        regionId: 'letter-body',
      }),
      fragment({
        id: 'now-right',
        left: 1871,
        top: 1882,
        right: 2428,
        bottom: 2044,
        baseline: [{ x: 1871, y: 1991 }, { x: 2428, y: 1988 }],
        readingOrderIndex: 10,
        regionId: 'letter-body',
      }),
      fragment({
        id: 'now-left',
        left: 526,
        top: 1897,
        right: 1580,
        bottom: 2033,
        baseline: [{ x: 526, y: 1970 }, { x: 1580, y: 1972 }],
        readingOrderIndex: 8,
        regionId: 'letter-body',
      }),
    ], {
      imageWidth: 3000,
      imageHeight: 4000,
      minimumFragmentGapTolerance: 155,
      maximumFragmentGapPageRatio: 0.05,
    });

    expect(rowForSegment(result, 'flu-left')?.memberSegmentIds).toEqual([
      'flu-left',
      'flu-middle',
      'flu-right',
    ]);
    expect(rowForSegment(result, 'now-left')?.memberSegmentIds).toEqual([
      'now-left',
      'now-right',
    ]);
    expect(result.segmentToRowId['flu-left'])
      .not.toBe(result.segmentToRowId['now-left']);
  });

  it('reconstructs the near-threshold 007 page-8 opening row', () => {
    const result = normalizeSegmentStructure([
      fragment({
        id: 'opening-left',
        left: 806,
        top: 946,
        right: 1422,
        bottom: 1086,
        baseline: [
          { x: 808, y: 1057 },
          { x: 1071, y: 1044 },
          { x: 1422, y: 1046 },
        ],
        readingOrderIndex: 0,
        regionId: 'letter-body',
      }),
      fragment({
        id: 'opening-right',
        left: 1577,
        top: 964,
        right: 2462,
        bottom: 1091,
        baseline: [{ x: 1580, y: 1046 }, { x: 2462, y: 1068 }],
        readingOrderIndex: 1,
        regionId: 'letter-body',
      }),
    ], {
      imageWidth: 3000,
      imageHeight: 4000,
      minimumFragmentGapTolerance: 155,
      maximumFragmentGapPageRatio: 0.05,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.memberSegmentIds).toEqual([
      'opening-left',
      'opening-right',
    ]);
  });

  it('does not bridge the nearby 009 page-1 date and greeting rows', () => {
    const result = normalizeSegmentStructure([
      fragment({
        id: 'greeting',
        left: 428,
        top: 384,
        right: 1335,
        bottom: 493,
        baseline: [{ x: 431, y: 453 }, { x: 1335, y: 446 }],
        readingOrderIndex: 0,
        regionId: 'letter-body',
      }),
      fragment({
        id: 'date',
        left: 1564,
        top: 311,
        right: 1971,
        bottom: 424,
        baseline: [{ x: 1566, y: 373 }, { x: 1971, y: 368 }],
        readingOrderIndex: 2,
        regionId: 'letter-body',
      }),
    ], {
      imageWidth: 3000,
      imageHeight: 4000,
      minimumFragmentGapTolerance: 155,
      maximumFragmentGapPageRatio: 0.05,
    });

    expect(result.rows).toHaveLength(2);
    expect(result.segmentToRowId.greeting)
      .not.toBe(result.segmentToRowId.date);
  });

  it('never joins the 007 page-7 split-page fragments across explicit regions', () => {
    const result = normalizeSegmentStructure([
      fragment({
        id: 'neighbor-page-fragment',
        left: 44,
        top: 1011,
        right: 346,
        bottom: 1135,
        baseline: [{ x: 44, y: 1102 }, { x: 346, y: 1097 }],
        readingOrderIndex: 23,
        regionId: 'left-page',
      }),
      fragment({
        id: 'letter-row',
        left: 488,
        top: 1000,
        right: 2606,
        bottom: 1126,
        baseline: [{ x: 488, y: 1080 }, { x: 2606, y: 1088 }],
        readingOrderIndex: 6,
        regionId: 'right-page',
      }),
    ], {
      imageWidth: 3000,
      imageHeight: 4000,
      minimumFragmentGapTolerance: 155,
      maximumFragmentGapPageRatio: 0.05,
    });

    expect(result.rows).toHaveLength(2);
    expect(result.segmentToRowId['neighbor-page-fragment'])
      .not.toBe(result.segmentToRowId['letter-row']);
    expect(result.decisions).toContainEqual(expect.objectContaining({
      scope: 'row',
      outcome: 'separated',
      reason: 'region-mismatch',
    }));
  });

  it('keeps the short 009 page-5 "up." line below the preceding row', () => {
    const result = normalizeSegmentStructure([
      fragment({
        id: 'preceding-row',
        left: 493,
        top: 3253,
        right: 2324,
        bottom: 3386,
        baseline: [{ x: 495, y: 3308 }, { x: 2324, y: 3328 }],
        readingOrderIndex: 41,
        regionId: 'page-body',
      }),
      fragment({
        id: 'short-up-row',
        left: 497,
        top: 3311,
        right: 617,
        bottom: 3435,
        baseline: [{ x: 497, y: 3364 }, { x: 617, y: 3364 }],
        readingOrderIndex: 42,
        regionId: 'page-body',
      }),
      fragment({
        id: 'following-row',
        left: 1384,
        top: 3362,
        right: 2337,
        bottom: 3520,
        baseline: [{ x: 1386, y: 3446 }, { x: 2337, y: 3473 }],
        readingOrderIndex: 43,
        regionId: 'page-body',
      }),
    ], {
      imageWidth: 3000,
      imageHeight: 4000,
    });

    expect(result.segmentToRowId['preceding-row'])
      .not.toBe(result.segmentToRowId['short-up-row']);
    expect(result.segmentToRowId['short-up-row'])
      .not.toBe(result.segmentToRowId['following-row']);
    expect(componentForSegment(result, 'preceding-row')?.id)
      .toBe(componentForSegment(result, 'short-up-row')?.id);
    expect(result.decisions).toContainEqual(expect.objectContaining({
      scope: 'row',
      outcome: 'separated',
      leftId: 'preceding-row',
      rightId: 'short-up-row',
      reason: 'along-overlap-too-large',
    }));
  });

  it('absorbs delayed one-character Kraken fragments into their visible row', () => {
    const result = normalizeSegmentStructure([
      fragment({
        id: 'body-row',
        left: 428,
        top: 1840,
        right: 1853,
        bottom: 1968,
        baseline: [{ x: 428, y: 1945 }, { x: 1853, y: 1945 }],
        readingOrderIndex: 12,
        regionId: 'page-body',
      }),
      fragment({
        id: 'delayed-letter',
        left: 1895,
        top: 1860,
        right: 1977,
        bottom: 1928,
        baseline: [{ x: 1895, y: 1906 }, { x: 1977, y: 1906 }],
        readingOrderIndex: 16,
        regionId: 'page-body',
      }),
      fragment({
        id: 'next-row',
        left: 402,
        top: 1980,
        right: 2308,
        bottom: 2146,
        readingOrderIndex: 17,
        regionId: 'page-body',
      }),
    ], {
      imageWidth: 2573,
      imageHeight: 4000,
    });

    expect(rowForSegment(result, 'body-row')?.memberSegmentIds)
      .toEqual(['body-row', 'delayed-letter']);
    expect(result.segmentToRowId['body-row'])
      .toBe(result.segmentToRowId['delayed-letter']);
    expect(result.segmentToRowId['body-row'])
      .not.toBe(result.segmentToRowId['next-row']);
    expect(result.decisions).toContainEqual(expect.objectContaining({
      scope: 'row',
      outcome: 'joined',
      leftId: 'body-row',
      rightId: 'delayed-letter',
      reason: 'same-region-fragment-bridge',
    }));
  });

  it('retains vertical marginal notes as a separate orientation and component', () => {
    const result = normalizeSegmentStructure([
      fragment({
        id: 'body-1',
        left: 418,
        top: 853,
        right: 1894,
        bottom: 980,
        baseline: [{ x: 420, y: 948 }, { x: 1894, y: 931 }],
      }),
      fragment({
        id: 'body-2',
        left: 820,
        top: 910,
        right: 2443,
        bottom: 1090,
        baseline: [{ x: 824, y: 1056 }, { x: 2443, y: 967 }],
      }),
      fragment({
        id: 'vertical-note-lower',
        left: 164,
        top: 3030,
        right: 255,
        bottom: 3098,
        baseline: [{ x: 224, y: 3098 }, { x: 226, y: 3034 }],
        orientationDegrees: -88.21,
      }),
      fragment({
        id: 'vertical-note-upper',
        left: 181,
        top: 2793,
        right: 262,
        bottom: 2910,
        baseline: [{ x: 230, y: 2910 }, { x: 232, y: 2795 }],
        orientationDegrees: -89.004,
      }),
    ], {
      imageWidth: 3000,
      imageHeight: 4000,
    });

    const marginalRow = rowForSegment(result, 'vertical-note-lower');
    expect(marginalRow).toEqual(expect.objectContaining({
      memberSegmentIds: expect.arrayContaining([
        'vertical-note-lower',
        'vertical-note-upper',
      ]),
      orientationFamily: 'vertical',
    }));
    expect(componentForSegment(result, 'vertical-note-lower')?.id)
      .not.toBe(componentForSegment(result, 'body-1')?.id);
    expect(result.components.flatMap(({ memberSegmentIds }) => memberSegmentIds))
      .toEqual(expect.arrayContaining([
        'vertical-note-lower',
        'vertical-note-upper',
      ]));
    expect(result.decisions).toContainEqual(expect.objectContaining({
      scope: 'row',
      outcome: 'separated',
      reason: 'orientation-mismatch',
      leftId: 'body-1',
      rightId: 'vertical-note-lower',
    }));
  });
});

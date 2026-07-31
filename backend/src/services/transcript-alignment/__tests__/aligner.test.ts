import { describe, expect, it } from 'vitest';
import {
  alignTranscriptToRecognizedSegments,
  alignmentTextSimilarity,
  normalizeAlignmentText,
} from '../aligner.js';

function transcript(...texts: string[]) {
  return texts.map((text, index) => ({
    id: `t${index + 1}`,
    text,
  }));
}

function segments(...texts: string[]) {
  return texts.map((text, index) => ({
    id: `s${index + 1}`,
    text,
  }));
}

function positionedSegment({
  id,
  text,
  orientationDegrees = 0,
  flowDirectionSign,
  geometryEvidence,
  left = 0,
  recognitionState,
  top,
  right = 1000,
  bottom,
}: {
  id: string;
  text: string;
  orientationDegrees?: number;
  flowDirectionSign?: 1 | -1;
  geometryEvidence?: 'machine' | 'human-gap-fill';
  left?: number;
  recognitionState?: 'recognized' | 'attempted-empty' | 'not-attempted';
  top: number;
  right?: number;
  bottom: number;
}) {
  return {
    id,
    text,
    recognitionState,
    geometryEvidence,
    orientationDegrees,
    flowDirectionSign,
    boundary: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
  };
}

describe('transcript-to-recognized-segment alignment', () => {
  it('normalizes historical punctuation, diacritics, and editorial uncertainty', () => {
    expect(normalizeAlignmentText(
      '“Café,” [illegible word] ſaid Mary.',
    )).toBe('cafe said mary');
  });

  it('gives visibly damaged versions of the same line a useful similarity', () => {
    expect(alignmentTextSimilarity(
      'I arrived yesterday evening.',
      'I arived yestcrday evenlng',
    )).toBeGreaterThan(0.72);
  });

  it('does not invent evidence when both normalized lines are empty', () => {
    expect(alignmentTextSimilarity('[illegible]', '[unreadable]')).toBe(0);
  });

  it('keeps a standalone editorial marker unlocated instead of letting it merge-steal a segment', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        '[illegible]',
        '2 Ep. Aug 10/88',
        'My dear Sadie',
      ),
      segments(
        'Br Lear Padu',
        'Lex Ang1',
      ),
    );

    expect(result.mappings[0]).toEqual(expect.objectContaining({
      transcriptId: 't1',
      segmentIds: [],
      operation: 'unlocated-transcript',
      status: 'unlocated',
    }));
    expect(result.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'merge',
        transcriptIds: expect.arrayContaining(['t1']),
      }),
    ]));
  });

  it('leaves an undetected short greeting unlocated instead of attaching it to the next line', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        'Hi.',
        'Will try to answer your letter',
      ),
      segments('Will try lo ancire your lellur'),
    );

    expect(result.mappings).toEqual([
      expect.objectContaining({
        transcriptId: 't1',
        segmentIds: [],
        operation: 'unlocated-transcript',
        status: 'unlocated',
      }),
      expect.objectContaining({
        transcriptId: 't2',
        segmentIds: ['s1'],
        operation: 'match',
      }),
    ]);
  });

  it('does not move an undetected short greeting onto the preceding date', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        '24th April, 1945.',
        'Hi.',
        'Will try to answer your letter',
      ),
      segments(
        'Aaril, 1970.',
        'Will try lo ancire your lellur',
      ),
    );

    expect(result.mappings).toEqual([
      expect.objectContaining({
        transcriptId: 't1',
        segmentIds: ['s1'],
      }),
      expect.objectContaining({
        transcriptId: 't2',
        segmentIds: [],
        operation: 'unlocated-transcript',
        status: 'unlocated',
      }),
      expect.objectContaining({
        transcriptId: 't3',
        segmentIds: ['s2'],
        operation: 'match',
      }),
    ]);
  });

  it('maps a middle human gap-fill to Hi without shifting recognized neighbors', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        '24th April, 1945.',
        'Hi.',
        'Will try to answer your letter',
      ),
      [
        positionedSegment({
          id: 'date',
          text: '24th April, 1945',
          recognitionState: 'recognized',
          geometryEvidence: 'machine',
          top: 0,
          bottom: 40,
        }),
        positionedSegment({
          id: 'human-hi',
          text: '',
          recognitionState: 'not-attempted',
          geometryEvidence: 'human-gap-fill',
          top: 60,
          bottom: 100,
          right: 160,
        }),
        positionedSegment({
          id: 'body',
          text: 'Will try lo ancire your lellur',
          recognitionState: 'recognized',
          geometryEvidence: 'machine',
          top: 120,
          bottom: 160,
        }),
      ],
    );

    expect(result.mappings).toEqual([
      expect.objectContaining({
        transcriptId: 't1',
        segmentIds: ['date'],
        evidence: 'content',
      }),
      expect.objectContaining({
        transcriptId: 't2',
        segmentIds: ['human-hi'],
        operation: 'match',
        evidence: 'geometry-only',
        status: 'ambiguous',
      }),
      expect.objectContaining({
        transcriptId: 't3',
        segmentIds: ['body'],
        evidence: 'content',
      }),
    ]);
    expect(result.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'split',
        segmentIds: expect.arrayContaining(['human-hi']),
      }),
    ]));
  });

  it('maps a terminal human gap-fill to Dave after the recognized sign-off', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('Yours', 'Dave'),
      [
        positionedSegment({
          id: 'yours',
          text: 'Yours',
          recognitionState: 'recognized',
          geometryEvidence: 'machine',
          top: 0,
          bottom: 40,
          left: 300,
          right: 600,
        }),
        positionedSegment({
          id: 'human-dave',
          text: '',
          recognitionState: 'attempted-empty',
          geometryEvidence: 'human-gap-fill',
          top: 60,
          bottom: 100,
          left: 360,
          right: 620,
        }),
      ],
    );

    expect(result.mappings).toEqual([
      expect.objectContaining({
        transcriptId: 't1',
        segmentIds: ['yours'],
      }),
      expect.objectContaining({
        transcriptId: 't2',
        segmentIds: ['human-dave'],
        evidence: 'geometry-only',
        status: 'ambiguous',
      }),
    ]);
  });

  it('labels blank machine recognition as geometry-only evidence', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        'First recognized line',
        'Unread middle line',
        'Last recognized line',
      ),
      [
        positionedSegment({
          id: 'first',
          text: 'First recognized line',
          recognitionState: 'recognized',
          geometryEvidence: 'machine',
          top: 0,
          bottom: 40,
        }),
        positionedSegment({
          id: 'blank-machine',
          text: '',
          recognitionState: 'attempted-empty',
          geometryEvidence: 'machine',
          top: 60,
          bottom: 100,
        }),
        positionedSegment({
          id: 'last',
          text: 'Last recognized line',
          recognitionState: 'recognized',
          geometryEvidence: 'machine',
          top: 120,
          bottom: 160,
        }),
      ],
    );

    expect(result.mappings[1]).toMatchObject({
      transcriptId: 't2',
      segmentIds: ['blank-machine'],
      evidence: 'geometry-only',
      status: 'ambiguous',
    });
  });

  it('skips an extra unused human gap-fill without cascading the body', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('First recognized line', 'Second recognized line'),
      [
        positionedSegment({
          id: 'first',
          text: 'First recognized line',
          recognitionState: 'recognized',
          geometryEvidence: 'machine',
          top: 0,
          bottom: 40,
        }),
        positionedSegment({
          id: 'unused-human',
          text: '',
          recognitionState: 'not-attempted',
          geometryEvidence: 'human-gap-fill',
          top: 60,
          bottom: 100,
          right: 140,
        }),
        positionedSegment({
          id: 'second',
          text: 'Second recognized line',
          recognitionState: 'recognized',
          geometryEvidence: 'machine',
          top: 120,
          bottom: 160,
        }),
      ],
    );

    expect(result.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
      ['first'],
      ['second'],
    ]);
    expect(result.skippedSegmentIds).toContain('unused-human');
  });

  it('never absorbs a collinear blank human gap-fill into recognized text', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('The recognized body line'),
      [
        positionedSegment({
          id: 'human-collinear',
          text: '',
          recognitionState: 'not-attempted',
          geometryEvidence: 'human-gap-fill',
          left: 0,
          right: 140,
          top: 0,
          bottom: 40,
        }),
        positionedSegment({
          id: 'recognized-collinear',
          text: 'The recognized body line',
          recognitionState: 'recognized',
          geometryEvidence: 'machine',
          left: 160,
          right: 1000,
          top: 0,
          bottom: 40,
        }),
      ],
    );

    expect(result.mappings[0]).toEqual(expect.objectContaining({
      segmentIds: ['recognized-collinear'],
      evidence: 'content',
    }));
    expect(result.skippedSegmentIds).toContain('human-collinear');
    expect(result.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'split',
        segmentIds: expect.arrayContaining(['human-collinear']),
      }),
    ]));
  });

  it('keeps an adjusted descendant of human-created geometry eligible as a gap-fill', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('Before', 'Human restored line', 'After'),
      [
        positionedSegment({
          id: 'before',
          text: 'Before',
          recognitionState: 'recognized',
          geometryEvidence: 'machine',
          top: 0,
          bottom: 40,
        }),
        // The production adapter derives this evidence by walking the adjusted
        // segment's parent IDs back to its human-created ancestor.
        positionedSegment({
          id: 'adjusted-human-descendant',
          text: '',
          recognitionState: 'not-attempted',
          geometryEvidence: 'human-gap-fill',
          top: 60,
          bottom: 100,
        }),
        positionedSegment({
          id: 'after',
          text: 'After',
          recognitionState: 'recognized',
          geometryEvidence: 'machine',
          top: 120,
          bottom: 160,
        }),
      ],
    );

    expect(result.mappings[1]).toEqual(expect.objectContaining({
      transcriptId: 't2',
      segmentIds: ['adjusted-human-descendant'],
      evidence: 'geometry-only',
      status: 'ambiguous',
    }));
  });

  it('still shares one detected line when a short greeting is visibly present in it', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        'Hi.',
        'Will try to answer your letter',
      ),
      segments('Hi Will try to answer your letter'),
    );

    expect(result.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
      ['s1'],
      ['s1'],
    ]);
    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: 'merge',
        transcriptIds: ['t1', 't2'],
        segmentIds: ['s1'],
      }),
    ]);
  });

  it('still shares a detected line when the visible greeting is read noisily', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        'Hi.',
        'Will try to answer your letter',
      ),
      segments('Hi Will try lo ancire your lellur'),
    );

    expect(result.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
      ['s1'],
      ['s1'],
    ]);
    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: 'merge',
        transcriptIds: ['t1', 't2'],
        segmentIds: ['s1'],
      }),
    ]);
  });

  it('does not require a missing line to be short before rejecting a dominated merge', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        'A separate marginal note was written here',
        'The train arrived yesterday',
      ),
      segments('The train arrived yesterday'),
    );

    expect(result.mappings).toEqual([
      expect.objectContaining({
        transcriptId: 't1',
        segmentIds: [],
        status: 'unlocated',
      }),
      expect.objectContaining({
        transcriptId: 't2',
        segmentIds: ['s1'],
        operation: 'match',
      }),
    ]);
  });

  it('keeps a line with editorial uncertainty and real words alignable', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('I was [illegible] and found the letter'),
      segments('I was tired and found the letter'),
    );

    expect(result.mappings[0]).toEqual(expect.objectContaining({
      segmentIds: ['s1'],
      operation: 'match',
    }));
  });

  it('does not merge real transcript lines across an editorial placeholder', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('hello', '[illegible]', 'world'),
      segments('hello world'),
    );

    expect(result.mappings[1]).toEqual(expect.objectContaining({
      segmentIds: [],
      operation: 'unlocated-transcript',
      confidence: 0,
      status: 'unlocated',
    }));
    expect(result.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'merge',
        transcriptIds: ['t1', 't3'],
      }),
    ]));
    expect(result.operations.flatMap(({ transcriptIds }) => transcriptIds))
      .toEqual(['t1', 't2', 't3']);
  });

  it('defers a minority sideways flow even when its OCR text would steal a main-flow match', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('Dear Ruth', 'I arrived yesterday'),
      [
        positionedSegment({
          id: 'sideways-duplicate',
          text: 'Dear Ruth',
          orientationDegrees: 90,
          left: 30,
          right: 80,
          top: 50,
          bottom: 400,
        }),
        positionedSegment({
          id: 'main-salutation',
          text: 'Dear Ruth',
          top: 500,
          bottom: 560,
        }),
        positionedSegment({
          id: 'main-body',
          text: 'I arrived yesterday',
          top: 620,
          bottom: 680,
        }),
      ],
    );

    expect(result.skippedSegmentIds).toContain('sideways-duplicate');
    expect(result.deferredSegmentIds).toEqual(['sideways-duplicate']);
    expect(result.mappings).toEqual([
      expect.objectContaining({ segmentIds: ['main-salutation'] }),
      expect.objectContaining({ segmentIds: ['main-body'] }),
    ]);
  });

  it('keeps a dominant rotated-page flow available for alignment', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('Dear Ruth', 'I arrived yesterday'),
      [
        positionedSegment({
          id: 'rotated-salutation',
          text: 'Dear Ruth',
          orientationDegrees: 90,
          top: 100,
          bottom: 160,
        }),
        positionedSegment({
          id: 'rotated-body',
          text: 'I arrived yesterday',
          orientationDegrees: 88,
          top: 220,
          bottom: 280,
        }),
      ],
    );

    expect(result.skippedSegmentIds).toEqual([]);
    expect(result.deferredSegmentIds).toEqual([]);
    expect(result.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
      ['rotated-salutation'],
      ['rotated-body'],
    ]);
  });

  it('repairs an adjacent inversion along a dominant rotated-page flow', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('2 Ep. Aug 10/88', 'My dear Sadie'),
      [
        positionedSegment({
          id: 'rotated-salutation',
          text: 'My dear Sadie',
          orientationDegrees: 90,
          left: 80,
          right: 150,
          top: 100,
          bottom: 500,
        }),
        positionedSegment({
          id: 'rotated-date',
          text: '2 Ep. Aug 10/88',
          orientationDegrees: 90,
          left: 420,
          right: 490,
          top: 100,
          bottom: 500,
        }),
      ],
    );

    expect(result.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
      ['rotated-date'],
      ['rotated-salutation'],
    ]);
  });

  it.each([
    {
      label: 'vertical-lr',
      flowDirectionSign: -1 as const,
      firstLeft: 420,
      secondLeft: 80,
    },
    {
      label: 'vertical-rl',
      flowDirectionSign: 1 as const,
      firstLeft: 80,
      secondLeft: 420,
    },
  ])(
    'uses the signed $label column direction when repairing an inversion',
    ({
      flowDirectionSign,
      firstLeft,
      secondLeft,
    }) => {
      const result = alignTranscriptToRecognizedSegments(
        transcript('alpha', 'beta'),
        [
          positionedSegment({
            id: 'provider-first-beta',
            text: 'beta',
            orientationDegrees: 90,
            flowDirectionSign,
            left: firstLeft,
            right: firstLeft + 70,
            top: 100,
            bottom: 500,
          }),
          positionedSegment({
            id: 'provider-second-alpha',
            text: 'alpha',
            orientationDegrees: 90,
            flowDirectionSign,
            left: secondLeft,
            right: secondLeft + 70,
            top: 100,
            bottom: 500,
          }),
        ],
      );

      expect(result.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
        ['provider-second-alpha'],
        ['provider-first-beta'],
      ]);
    },
  );

  it('uses geometry and text evidence to repair one adjacent reading-order inversion', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        '2 Ep. Aug 10/88',
        'My dear Sadie',
        'I have thought of',
      ),
      [
        positionedSegment({
          id: 'salutation',
          text: 'Br Lear Padu',
          top: 983,
          bottom: 1117,
        }),
        positionedSegment({
          id: 'date',
          text: 'Lex Ang1',
          left: 1358,
          right: 2038,
          top: 794,
          bottom: 916,
        }),
        positionedSegment({
          id: 'body',
          text: 'dhave thoughl of',
          top: 1095,
          bottom: 1252,
        }),
      ],
    );

    expect(result.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
      ['date'],
      ['salutation'],
      ['body'],
    ]);
  });

  it('does not transpose otherwise plausible lines across different regions', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('2 Ep. Aug 10/88', 'My dear Sadie'),
      [
        {
          ...positionedSegment({
            id: 'salutation',
            text: 'Br Lear Padu',
            top: 983,
            bottom: 1117,
          }),
          regionId: 'body',
        },
        {
          ...positionedSegment({
            id: 'date',
            text: 'Lex Ang1',
            top: 794,
            bottom: 916,
          }),
          regionId: 'margin',
        },
      ],
    );

    expect(result.mappings.map(({ segmentIds }) => segmentIds))
      .not.toEqual([['date'], ['salutation']]);
  });

  it('does not cross mappings on text evidence alone when geometry is absent', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('2 Ep. Aug 10/88', 'My dear Sadie'),
      segments('Br Lear Padu', 'Lex Ang1'),
    );

    expect(result.mappings.map(({ segmentIds }) => segmentIds))
      .not.toEqual([['s2'], ['s1']]);
  });

  it('does not discard a full-width line solely because OCR returned one character', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('Dear Ruth', 'I arrived yesterday'),
      [
        positionedSegment({
          id: 's1',
          text: 'Dear Ruth',
          top: 100,
          bottom: 170,
        }),
        positionedSegment({
          id: 's2',
          text: 'I',
          top: 180,
          bottom: 250,
        }),
        positionedSegment({
          id: 's3',
          text: 'I arrived yesterday',
          top: 260,
          bottom: 330,
        }),
      ],
    );

    expect(result.skippedSegmentIds).not.toContain('s2');
  });

  it('still matches a short segment when its text is genuine evidence', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('No'),
      segments('No'),
    );

    expect(result.skippedSegmentIds).toEqual([]);
    expect(result.mappings[0].segmentIds).toEqual(['s1']);
  });

  it('keeps a short genuine P.E.I. line instead of folding it into the next line', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('P.E. I', 'APO 752,'),
      segments('E', 'commun foument n n'),
    );

    expect(result.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
      ['s1'],
      ['s2'],
    ]);
  });

  it('does not let a short letterhead glyph move a date onto the logo', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('Nov. 19 1918', 'Dear Mama:', 'You must pardon'),
      segments(
        'AMPMI AN',
        '8',
        'ON ACTIVE SHMVICE',
        'WIIN THE',
        'AMAERICAN ExPEDITIONARY FORCE',
        '108. lub016',
        'Dai Eaua.',
        'con muct fadon',
      ),
    );

    expect(result.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
      ['s6'],
      ['s7'],
      ['s8'],
    ]);
  });

  it('repairs the observed 003 Sadie prefix and detaches the tall stray glyph', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        '[illegible]',
        '[illegible]',
        '[illegible]',
        '2 Ep. Aug 10/88',
        'My dear Sadie',
        'I have thought of',
        'you and Sarah, many times',
      ),
      [
        positionedSegment({
          id: '003-line-0001',
          text: '72',
          orientationDegrees: 87.441,
          left: 499,
          right: 626,
          top: 260,
          bottom: 445,
        }),
        positionedSegment({
          id: '003-line-0002',
          text: '1',
          orientationDegrees: 90,
          left: 697,
          right: 772,
          top: 258,
          bottom: 327,
        }),
        positionedSegment({
          id: '003-line-0003',
          text: 'Br Lear Padu,',
          orientationDegrees: -1.83,
          left: 275,
          right: 1310,
          top: 983,
          bottom: 1117,
        }),
        positionedSegment({
          id: '003-line-0004',
          text: 'Lex. Ang1',
          orientationDegrees: -2.196,
          left: 1358,
          right: 2038,
          top: 794,
          bottom: 916,
        }),
        positionedSegment({
          id: '003-line-0005',
          text: '22',
          left: 2397,
          right: 2475,
          top: 979,
          bottom: 1089,
        }),
        positionedSegment({
          id: '003-line-0006',
          text: 'dhave thoughl 57',
          orientationDegrees: -1.128,
          left: 957,
          right: 2484,
          top: 1095,
          bottom: 1252,
        }),
        positionedSegment({
          id: '003-line-0007',
          text: 'yon and Sarak manf ames',
          orientationDegrees: 0.457,
          left: 337,
          right: 2468,
          top: 1317,
          bottom: 1420,
        }),
      ],
    );

    expect(result.mappings.slice(0, 3).every(
      ({ segmentIds, status }) => segmentIds.length === 0 && status === 'unlocated',
    )).toBe(true);
    expect(result.mappings.slice(3).map(({ segmentIds }) => segmentIds)).toEqual([
      ['003-line-0004'],
      ['003-line-0003'],
      ['003-line-0006'],
      ['003-line-0007'],
    ]);
    expect(result.skippedSegmentIds).toEqual([
      '003-line-0001',
      '003-line-0002',
      '003-line-0005',
    ]);
  });

  it('skips an unrelated detected line without shifting every later mapping', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        'Dear Ruth',
        'I arrived yesterday evening',
        'Yours, Mason',
      ),
      segments(
        'Dear Rulh',
        'unrelated words from the neighboring page',
        'I arived yesterday evening',
        'Yours Mason',
      ),
    );

    expect(result.skippedSegmentIds).toEqual(['s2']);
    expect(result.mappings.map(({ transcriptId, segmentIds }) => ({
      transcriptId,
      segmentIds,
    }))).toEqual([
      { transcriptId: 't1', segmentIds: ['s1'] },
      { transcriptId: 't2', segmentIds: ['s3'] },
      { transcriptId: 't3', segmentIds: ['s4'] },
    ]);
  });

  it('marks a missed physical line as unlocated and recovers at the next anchor', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        'Dear Ruth',
        'The train was delayed',
        'I arrived yesterday evening',
      ),
      segments(
        'Dear Ruth',
        'I arived yesterday evening',
      ),
    );

    expect(result.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        transcriptId: 't2',
        segmentIds: [],
        status: 'unlocated',
      }),
      expect.objectContaining({
        transcriptId: 't3',
        segmentIds: ['s2'],
      }),
    ]));
  });

  it('isolates a missing transcript and foreign detection between strong anchors', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        '970 Lexington Avenue',
        'Dear Ruth',
        'The train was delayed',
        'Yours, Mason',
        'Postscript: write when you arrive',
      ),
      segments(
        '970 Lexington Avenue',
        'Dear Ruth',
        'PHOTO CAPTION FROM THE NEIGHBORING PAGE',
        'Yours Mason',
        'Postscript write when you arrive',
      ),
    );

    expect(result.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        transcriptId: 't3',
        segmentIds: [],
        status: 'unlocated',
      }),
    ]));
    expect(result.skippedSegmentIds).toEqual(['s3']);
    expect(result.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'match',
        transcriptIds: ['t3'],
        segmentIds: ['s3'],
      }),
    ]));
    expect(result.mappings.find(({ transcriptId }) => transcriptId === 't4'))
      .toEqual(expect.objectContaining({ segmentIds: ['s4'] }));
    expect(result.mappings.find(({ transcriptId }) => transcriptId === 't5'))
      .toEqual(expect.objectContaining({ segmentIds: ['s5'] }));
    const isolatedPairStart = result.operations.findIndex((operation) => (
      operation.kind === 'unlocated-transcript'
      && operation.transcriptIds[0] === 't3'
    ));
    expect(
      result.operations
        .slice(isolatedPairStart, isolatedPairStart + 2)
        .map(({ kind }) => kind),
    ).toEqual(['unlocated-transcript', 'skip-segment']);
  });

  it('maps one transcript line to two Kraken splits', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('I arrived yesterday evening'),
      segments('I arived', 'yesterday evening'),
    );

    expect(result.mappings[0]).toEqual(expect.objectContaining({
      transcriptId: 't1',
      segmentIds: ['s1', 's2'],
      operation: 'split',
    }));
  });

  it('maps two transcript lines to one Kraken merge', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('I arrived', 'yesterday evening'),
      segments('I arived yesterday evening'),
    );

    expect(result.mappings).toEqual([
      expect.objectContaining({
        transcriptId: 't1',
        segmentIds: ['s1'],
        operation: 'merge',
      }),
      expect.objectContaining({
        transcriptId: 't2',
        segmentIds: ['s1'],
        operation: 'merge',
      }),
    ]);
  });

  it('uses an affine gap for a contiguous neighboring-page block', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('Dear Ruth', 'I arrived yesterday', 'Yours Mason'),
      segments(
        'Dear Ruth',
        'neighbor alpha',
        'neighbor beta',
        'neighbor gamma',
        'I arrived yesterday',
        'Yours Mason',
      ),
    );

    expect(result.skippedSegmentIds).toEqual(['s2', 's3', 's4']);
    expect(result.mappings[1].segmentIds).toEqual(['s5']);
    expect(result.mappings[2].segmentIds).toEqual(['s6']);
  });

  it('does not abandon both noisy suffixes as opposing gap blocks', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        'Dear Ruth',
        'I hope this letter finds you well',
        'The family sends their regards',
        'Yours always',
      ),
      segments(
        'Dear Ruth',
        'I hop ths leter fnds you wel',
        'The famly send ther regard',
        'Yors alwas',
      ),
    );

    expect(result.mappings.every(({ segmentIds }) => segmentIds.length > 0))
      .toBe(true);
    expect(result.skippedSegmentIds).toEqual([]);
  });

  it('does not turn a noisy but corresponding suffix into unmatched pairs', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        'I hope this letter finds you well',
        'The family sends their regards',
        'Yours always',
      ),
      segments(
        'I hop ths leter fnds you wel',
        'The famly send ther regard',
        'Yors alwas',
      ),
    );

    expect(result.mappings.every(({ segmentIds }) => segmentIds.length > 0))
      .toBe(true);
    expect(result.skippedSegmentIds).toEqual([]);
  });

  it('preserves a long corresponding suffix even when every OCR pair is weak', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript(
        'The worst thing was the disposal of the body',
        'was left of Dan I wanted to see it for the undertaker when',
        'to come. No post-mortem. then they were, all the',
        'same. It is an insurance claim.',
        'So I would quit him and have to offer a family might watch.',
        'I was quite [illegible] and also I found the',
        'body. I telephoned and drove to [illegible]',
        'and had it cremated. I have been overseas and [illegible]',
        'M. Thomas.',
      ),
      segments(
        'The worst thing was the disposal of the body',
        '⟦dsesoetandurs quthe eith a hoit',
        '⟦testaran I Il stberhrezohen',
        'hecpemnchene driitt acc ehe',
        '⟧ tmencecitetonttorate',
        'Sthar arl Cate so a',
        '⟦ dephone hauret the ada',
        '⟦es bedr encpntales not bes ercon etcur tu Grns re',
        '⟦reur',
      ),
    );

    expect(result.mappings.every(({ segmentIds }) => segmentIds.length > 0))
      .toBe(true);
    expect(result.skippedSegmentIds).toEqual([]);
  });

  it('accepts stable exact mappings when worse paths are far more costly', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('Dear Ruth', 'I arrived yesterday', 'Yours always'),
      segments('Dear Ruth', 'I arrived yesterday', 'Yours always'),
    );

    expect(result.mappings.every(({ status }) => status === 'accepted'))
      .toBe(true);
    expect(
      result.mappings.every(
        ({ alternatives }) => alternatives[0]?.support > 0.98,
      ),
    ).toBe(true);
  });

  it('abstains when repeated lines make the mapping unstable', () => {
    const result = alignTranscriptToRecognizedSegments(
      transcript('Yes', 'Yes'),
      segments('Yes'),
    );

    expect(result.mappings.every(({ status }) => status !== 'accepted')).toBe(true);
    expect(result.mappings.some(({ alternatives }) => alternatives.length > 1)).toBe(true);
  });
});

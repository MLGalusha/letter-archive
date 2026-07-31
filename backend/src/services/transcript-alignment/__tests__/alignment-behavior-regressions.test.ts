import { describe, expect, it } from 'vitest';
import {
  alignTranscriptToRecognizedSegments,
  type RecognizedSegment,
  type TranscriptLine,
} from '../aligner.js';

type SegmentFixture = {
  id: string;
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  baselineY?: number;
  recognitionConfidence?: number;
  readingOrderIndex?: number;
};

function transcriptLines(
  entries: Array<readonly [id: string, text: string]>,
): TranscriptLine[] {
  return entries.map(([id, text]) => ({ id, text }));
}

function recognizedSegments(fixtures: SegmentFixture[]): RecognizedSegment[] {
  return fixtures.map((fixture, index) => ({
    id: fixture.id,
    text: fixture.text,
    recognitionConfidence: fixture.recognitionConfidence,
    regionId: 'page-main',
    orientationDegrees: 0,
    readingOrderIndex: fixture.readingOrderIndex ?? index,
    boundary: [
      { x: fixture.left, y: fixture.top },
      { x: fixture.right, y: fixture.top },
      { x: fixture.right, y: fixture.bottom },
      { x: fixture.left, y: fixture.bottom },
    ],
    baseline: [
      {
        x: fixture.left,
        y: fixture.baselineY ?? fixture.bottom - 20,
      },
      {
        x: fixture.right,
        y: fixture.baselineY ?? fixture.bottom - 20,
      },
    ],
  }));
}

describe('approved transcript-alignment behavior regressions', () => {
  it('moves the 009 greeting past two right-aligned date rows without shifting the body', () => {
    const transcript = transcriptLines([
      ['T03', 'Sat. Evening'],
      ['T04', 'August 30'],
      ['T06', 'Hello Molly Darling -'],
      ['T08', 'Well, that beautiful letter came and was'],
    ]);
    const segments = recognizedSegments([
      {
        id: 'S01-greeting',
        text: 'Vello Holly Darling-',
        left: 428,
        top: 384,
        right: 1335,
        bottom: 493,
        recognitionConfidence: 0.95837,
      },
      {
        id: 'S02-date-heading',
        text: 'Jat. Bvenine',
        left: 1568,
        top: 253,
        right: 2086,
        bottom: 337,
        recognitionConfidence: 0.87768,
      },
      {
        id: 'S03-date',
        text: 'August 30',
        left: 1564,
        top: 311,
        right: 1971,
        bottom: 424,
        recognitionConfidence: 0.99206,
      },
      {
        id: 'S04-body',
        text: 'Mell, that beautiful Lebter oame and was',
        left: 671,
        top: 508,
        right: 2375,
        bottom: 617,
        recognitionConfidence: 0.9115,
      },
    ]);

    const result = alignTranscriptToRecognizedSegments(transcript, segments);
    expect(Object.fromEntries(
      result.mappings.map(({ transcriptId, segmentIds }) => (
        [transcriptId, segmentIds]
      )),
    )).toEqual({
      T03: ['S02-date-heading'],
      T04: ['S03-date'],
      T06: ['S01-greeting'],
      T08: ['S04-body'],
    });
    expect(result.skippedSegmentIds).toEqual([]);
    expect(result.mappings.every(({ operation }) => operation === 'match'))
      .toBe(true);
  });

  it('repairs a bounded LLM transcript swap without changing physical row order', () => {
    const transcript = transcriptLines([
      ['T02', 'The train arrived after midnight'],
      ['T01', 'Dear Ruth,'],
    ]);
    const segments = recognizedSegments([
      {
        id: 'S01',
        text: 'Dear Ruth',
        left: 300,
        top: 200,
        right: 1800,
        bottom: 280,
      },
      {
        id: 'S02',
        text: 'The train arived after midnight',
        left: 300,
        top: 340,
        right: 1800,
        bottom: 420,
      },
    ]);

    const result = alignTranscriptToRecognizedSegments(transcript, segments);
    expect(Object.fromEntries(
      result.mappings.map(({ transcriptId, segmentIds }) => (
        [transcriptId, segmentIds]
      )),
    )).toEqual({
      T02: ['S02'],
      T01: ['S01'],
    });
    expect(result.localReorderDecisions).toEqual([
      expect.objectContaining({
        movableSide: 'transcript',
        windowSize: 2,
        beforeIds: ['T02', 'T01'],
        afterIds: ['T01', 'T02'],
      }),
    ]);
  });

  it('repairs a bounded LLM transcript swap after excluding a leading header row', () => {
    const transcript = transcriptLines([
      ['T02', 'The train arrived after midnight'],
      ['T01', 'Dear Ruth,'],
    ]);
    const segments = recognizedSegments([
      {
        id: 'S00-header',
        text: 'OFFICIAL HEADER',
        left: 100,
        top: 100,
        right: 900,
        bottom: 160,
      },
      {
        id: 'S01',
        text: 'Dear Ruth',
        left: 100,
        top: 190,
        right: 900,
        bottom: 250,
      },
      {
        id: 'S02',
        text: 'The train arived after midnight',
        left: 100,
        top: 280,
        right: 900,
        bottom: 340,
      },
    ]);

    const result = alignTranscriptToRecognizedSegments(transcript, segments);
    expect(Object.fromEntries(
      result.mappings.map(({ transcriptId, segmentIds }) => (
        [transcriptId, segmentIds]
      )),
    )).toEqual({
      T02: ['S02'],
      T01: ['S01'],
    });
    expect(result.skippedSegmentIds).toContain('S00-header');
    expect(result.localReorderDecisions).toEqual([
      expect.objectContaining({
        movableSide: 'transcript',
        windowSize: 2,
        beforeIds: ['T02', 'T01'],
        afterIds: ['T01', 'T02'],
      }),
    ]);
  });

  it('fills the real-derived 007 page-one rows between anchors instead of abandoning the suffix', () => {
    const transcript = transcriptLines([
      ['T03', 'Nov. 19 1918'],
      ['T04', 'Dear Mama:'],
      ['T05', 'You must pardon'],
      ['T06', 'me for not writing'],
      ['T07', 'you little before'],
      ['T08', 'now-'],
      ['T09', 'I know it made'],
      ['T10', 'you happy to hear'],
      ['T11', 'the news that the'],
      ['T12', 'war was over.'],
      ['T13', 'The fighting over'],
      ['T14', 'the next question'],
      ['T15', 'is when will we'],
      ['T16', 'get home? Soon'],
      ['T17', 'I hope, for I want'],
      ['T18', 'to see you all'],
      ['T19', 'so much.'],
      ['T20', 'I certainly am.'],
    ]);
    const segments = recognizedSegments([
      {
        id: 'S01',
        text: 'AMPMI AN',
        left: 697,
        top: 560,
        right: 984,
        bottom: 620,
      },
      {
        id: 'S02',
        text: '8',
        left: 693,
        top: 600,
        right: 762,
        bottom: 788,
      },
      {
        id: 'S03',
        text: 'ON ACTIVE SHMVICE',
        left: 1615,
        top: 568,
        right: 2200,
        bottom: 644,
      },
      {
        id: 'S04',
        text: 'WIIN THE',
        left: 1784,
        top: 628,
        right: 2037,
        bottom: 704,
      },
      {
        id: 'S05',
        text: 'AMAERICAN ExPEDITIONARY FORCE',
        left: 1348,
        top: 711,
        right: 2473,
        bottom: 808,
      },
      {
        id: 'S06',
        text: '108. lub016',
        left: 1611,
        top: 802,
        right: 2422,
        bottom: 931,
      },
      {
        id: 'S07',
        text: 'Dai Eaua.',
        left: 502,
        top: 960,
        right: 1824,
        bottom: 1102,
      },
      {
        id: 'S08',
        text: 'con muct fadon',
        left: 971,
        top: 1115,
        right: 2588,
        bottom: 1282,
      },
      {
        id: 'S09',
        text: 'Ct  n  n  n M',
        left: 520,
        top: 1273,
        right: 2604,
        bottom: 1411,
      },
      {
        id: 'S10',
        text: 'bo lell por',
        left: 486,
        top: 1420,
        right: 2582,
        bottom: 1580,
      },
      {
        id: 'S11',
        text: 'L',
        left: 544,
        top: 1600,
        right: 991,
        bottom: 1720,
      },
      {
        id: 'S12',
        text: 'Etonl hummemee t',
        left: 984,
        top: 1753,
        right: 1848,
        bottom: 1886,
        baselineY: 1840,
      },
      {
        id: 'S13',
        text: '⟦ de',
        left: 1977,
        top: 1760,
        right: 2531,
        bottom: 1875,
        baselineY: 1843,
      },
      {
        id: 'S14',
        text: 'osee du cmm ommonf fnonisgemment omm at',
        left: 504,
        top: 1920,
        right: 2553,
        bottom: 2080,
      },
      {
        id: 'S15',
        text: 'P Ee d',
        left: 448,
        top: 2071,
        right: 1851,
        bottom: 2195,
        baselineY: 2144,
      },
      {
        id: 'S16',
        text: 'M',
        left: 2002,
        top: 2071,
        right: 2364,
        bottom: 2186,
        baselineY: 2158,
      },
      {
        id: 'S17',
        text: 'Nnet e ereme ruemee e sette Cnumn  mm mt',
        left: 431,
        top: 2237,
        right: 2528,
        bottom: 2344,
      },
      {
        id: 'S18',
        text: 'com   lmant',
        left: 424,
        top: 2397,
        right: 2375,
        bottom: 2520,
      },
      {
        id: 'S19',
        text: 'r',
        left: 417,
        top: 2553,
        right: 2391,
        bottom: 2677,
      },
      {
        id: 'S20',
        text: 'ns arhe ⟦aem',
        left: 484,
        top: 2691,
        right: 2524,
        bottom: 2828,
      },
      {
        id: 'S21',
        text: 'Je fbme',
        left: 524,
        top: 2857,
        right: 2411,
        bottom: 3004,
      },
      {
        id: 'S22',
        text: 'dl',
        left: 386,
        top: 3008,
        right: 2575,
        bottom: 3155,
      },
      {
        id: 'S23',
        text: 'LLmsaie al',
        left: 471,
        top: 3171,
        right: 2408,
        bottom: 3293,
      },
      {
        id: 'S24',
        text: 'D',
        left: 404,
        top: 3326,
        right: 1493,
        bottom: 3475,
      },
      {
        id: 'S25',
        text: '(etf',
        left: 1022,
        top: 3495,
        right: 2328,
        bottom: 3640,
      },
    ]);

    const result = alignTranscriptToRecognizedSegments(transcript, segments);

    expect(Object.fromEntries(
      result.mappings.map(({ transcriptId, segmentIds }) => (
        [transcriptId, segmentIds]
      )),
    )).toEqual({
      T03: ['S06'],
      T04: ['S07'],
      T05: ['S08'],
      T06: ['S09'],
      T07: ['S10'],
      T08: ['S11'],
      T09: ['S12', 'S13'],
      T10: ['S14'],
      T11: ['S15', 'S16'],
      T12: ['S17'],
      T13: ['S18'],
      T14: ['S19'],
      T15: ['S20'],
      T16: ['S21'],
      T17: ['S22'],
      T18: ['S23'],
      T19: ['S24'],
      T20: ['S25'],
    });
    expect(result.skippedSegmentIds).toEqual([
      'S01',
      'S02',
      'S03',
      'S04',
      'S05',
    ]);
    expect(result.unassignedSegmentReasons).toEqual(
      ['S01', 'S02', 'S03', 'S04', 'S05'].map((segmentId) => ({
        segmentId,
        reason: 'alignment-uncertain',
      })),
    );
    expect(result.mappings.find(({ transcriptId }) => transcriptId === 'T20'))
      .toEqual(expect.objectContaining({
        segmentIds: ['S25'],
        status: expect.not.stringMatching(/^unlocated$/u),
      }));
  });

  it('keeps a low-anchor handwritten body aligned after non-transcribed stationery', () => {
    const transcript = transcriptLines([
      ['T01', 'to send a coupon'],
      ['T02', 'to be posted on the top'],
      ['T03', 'I had a letter'],
      ['T04', 'from Aunt Minnie'],
      ['T05', 'I hope your health'],
      ['T06', 'also my Dear Uncle'],
      ['T07', 'Jim the other Day'],
      ['T08', 'Certainly was glad'],
      ['T09', 'to hear from them'],
      ['T10', 'I hope you are well'],
    ]);
    const segments = recognizedSegments([
      {
        id: 'H01',
        text: 'AMTEITRN',
        left: 662,
        top: 648,
        right: 948,
        bottom: 702,
        recognitionConfidence: 0.93,
        readingOrderIndex: 0,
      },
      {
        id: 'H02',
        text: 'RGLRIN',
        left: 662,
        top: 751,
        right: 951,
        bottom: 960,
        recognitionConfidence: 0.93,
        readingOrderIndex: 1,
      },
      {
        id: 'H03',
        text: 'ON ACTIVE SBMVICE',
        left: 1584,
        top: 648,
        right: 2166,
        bottom: 717,
        recognitionConfidence: 0.93,
        readingOrderIndex: 2,
      },
      {
        id: 'H04',
        text: 'WIIN THE',
        left: 1748,
        top: 720,
        right: 2004,
        bottom: 802,
        recognitionConfidence: 0.93,
        readingOrderIndex: 3,
      },
      {
        id: 'H05',
        text: 'AMERICAN EXPEDITIONARY FORCE',
        left: 1315,
        top: 797,
        right: 2440,
        bottom: 906,
        recognitionConfidence: 0.95,
        readingOrderIndex: 4,
      },
      {
        id: 'H06',
        text: 'mmmmnenumannt 18l,ens',
        left: 1620,
        top: 942,
        right: 2362,
        bottom: 1026,
        recognitionConfidence: 0.6,
        readingOrderIndex: 5,
      },
      {
        id: 'B01',
        text: 'mmmmnenumannt',
        left: 393,
        top: 1051,
        right: 2460,
        bottom: 1193,
        recognitionConfidence: 0.6,
        readingOrderIndex: 6,
      },
      {
        id: 'B02',
        text: 'D L fn',
        left: 373,
        top: 1215,
        right: 2424,
        bottom: 1335,
        recognitionConfidence: 0.62,
        readingOrderIndex: 7,
      },
      {
        id: 'B03',
        text: 'Lme ommeee e mme uee',
        left: 446,
        top: 1382,
        right: 2304,
        bottom: 1500,
        recognitionConfidence: 0.61,
        readingOrderIndex: 8,
      },
      {
        id: 'B04',
        text: 'ie hemememem t l feue',
        left: 371,
        top: 1506,
        right: 2471,
        bottom: 1664,
        recognitionConfidence: 0.6,
        readingOrderIndex: 9,
      },
      {
        id: 'B05',
        text: 'Dine lmmeine uee seen Ln ie',
        left: 428,
        top: 1680,
        right: 2420,
        bottom: 1826,
        recognitionConfidence: 0.56,
        readingOrderIndex: 10,
      },
      {
        id: 'B06',
        text: 'L e fsm',
        left: 402,
        top: 1990,
        right: 2428,
        bottom: 2115,
        recognitionConfidence: 0.57,
        readingOrderIndex: 13,
      },
      {
        id: 'B07',
        text: 'esn Lem e Dais',
        left: 435,
        top: 2150,
        right: 2451,
        bottom: 2275,
        recognitionConfidence: 0.58,
        readingOrderIndex: 14,
      },
      {
        id: 'B08',
        text: 'enmh il h h',
        left: 402,
        top: 2310,
        right: 2486,
        bottom: 2435,
        recognitionConfidence: 0.59,
        readingOrderIndex: 15,
      },
      {
        id: 'B09',
        text: 'Condmemee',
        left: 446,
        top: 2470,
        right: 2442,
        bottom: 2595,
        recognitionConfidence: 0.58,
        readingOrderIndex: 16,
      },
      {
        id: 'B10',
        text: 'm faanns m',
        left: 753,
        top: 2630,
        right: 2420,
        bottom: 2755,
        recognitionConfidence: 0.57,
        readingOrderIndex: 17,
      },
      {
        id: 'B02-fragment',
        text: 'L',
        left: 2440,
        top: 1240,
        right: 2505,
        bottom: 1315,
        recognitionConfidence: 0.31,
        readingOrderIndex: 11,
      },
    ]);

    const result = alignTranscriptToRecognizedSegments(transcript, segments);

    expect(Object.fromEntries(
      result.mappings.map(({ transcriptId, segmentIds }) => (
        [transcriptId, segmentIds]
      )),
    )).toEqual({
      T01: ['B01'],
      T02: ['B02', 'B02-fragment'],
      T03: ['B03'],
      T04: ['B04'],
      T05: ['B05'],
      T06: ['B06'],
      T07: ['B07'],
      T08: ['B08'],
      T09: ['B09'],
      T10: ['B10'],
    });
    expect(result.skippedSegmentIds).toEqual([
      'H01',
      'H02',
      'H03',
      'H04',
      'H05',
      'H06',
    ]);
    expect(result.unassignedSegmentReasons).toEqual(
      ['H01', 'H02', 'H03', 'H04', 'H05', 'H06'].map((segmentId) => ({
        segmentId,
        reason: 'non-transcribed-text',
      })),
    );
    expect(result.mappings.every(({ status }) => status !== 'unlocated'))
      .toBe(true);
  });

  it('never removes a stationery-looking prefix that appears in the transcript', () => {
    const transcript = transcriptLines([
      ['T00', 'ON ACTIVE SBMVICE'],
      ['T01', 'to send a coupon'],
      ['T02', 'to be posted on the top'],
      ['T03', 'some time ago'],
      ['T04', 'I had a letter'],
    ]);
    const segments = recognizedSegments([
      {
        id: 'H01-transcribed',
        text: 'ON ACTIVE SBMVICE',
        left: 1500,
        top: 200,
        right: 2200,
        bottom: 290,
        recognitionConfidence: 0.96,
      },
      {
        id: 'H02',
        text: 'WIIN THE',
        left: 1750,
        top: 310,
        right: 2010,
        bottom: 390,
        recognitionConfidence: 0.94,
      },
      {
        id: 'H03',
        text: 'AMERICAN EXPEDITIONARY FORCE',
        left: 1250,
        top: 410,
        right: 2400,
        bottom: 500,
        recognitionConfidence: 0.95,
      },
      ...[
        'to send a coupon',
        'to be posted on the top',
        'one omitted handwritten row',
        'some time ago',
        'I had a letter',
      ].map((text, index) => ({
        id: `B0${index + 1}`,
        text,
        left: 350,
        top: 650 + (index * 150),
        right: 2450,
        bottom: 760 + (index * 150),
        recognitionConfidence: 0.58,
      })),
    ]);

    const result = alignTranscriptToRecognizedSegments(transcript, segments);

    expect(result.mappings.find(({ transcriptId }) => transcriptId === 'T00'))
      .toEqual(expect.objectContaining({
        segmentIds: ['H01-transcribed'],
        operation: 'match',
      }));
    expect(result.unassignedSegmentReasons).not.toContainEqual({
      segmentId: 'H01-transcribed',
      reason: 'non-transcribed-text',
    });
  });

  it('uses a surviving signature initial without shifting across a missing row', () => {
    const transcript = transcriptLines([
      ['T149', 'I Hope You all'],
      ['T150', 'are well tonight'],
      ['T151', 'lots and lots of'],
      ['T152', 'love to all,'],
      ['T153', 'You loving son,'],
      ['T154', 'Ernest)'],
      ['T156', 'P.E. I'],
      ['T157', 'APO 752,'],
    ]);
    const segments = recognizedSegments([
      {
        id: 'S01-left',
        text: 'Aosac',
        left: 300,
        top: 100,
        right: 900,
        bottom: 200,
      },
      {
        id: 'S01-right',
        text: 'Dai ailt',
        left: 950,
        top: 100,
        right: 2050,
        bottom: 200,
      },
      ...[
        'cn mice lonryht',
        'Cloane lote',
        'Ll Le li mendeeme hme Le om',
        'i Vouiry son',
        'E',
        'commun foument n n',
      ].map((text, index) => ({
        id: `S0${index + 2}`,
        text,
        left: index === 4 ? 950 : 350,
        top: index === 5 ? 1600 : 300 + (index * 160),
        right: index === 4 ? 1050 : 2400,
        bottom: index === 5 ? 1710 : 410 + (index * 160),
      })),
    ]);

    const result = alignTranscriptToRecognizedSegments(transcript, segments);

    expect(Object.fromEntries(
      result.mappings.map(({ transcriptId, segmentIds }) => (
        [transcriptId, segmentIds]
      )),
    )).toEqual({
      T149: ['S01-left', 'S01-right'],
      T150: ['S02'],
      T151: ['S03'],
      T152: ['S04'],
      T153: ['S05'],
      T154: ['S06'],
      T156: [],
      T157: ['S07'],
    });
    expect(result.mappings.find(({ transcriptId }) => transcriptId === 'T156'))
      .toEqual(expect.objectContaining({
        operation: 'unlocated-transcript',
        status: 'unlocated',
      }));
  });

  it('abstains from mapping an unrelated generic 008 transcript onto 24 image rows', () => {
    const transcript = transcriptLines([
      ['T03', 'September 12, 1943'],
      ['T05', 'Dear [recipient],'],
      ['T07', 'I hope this letter finds you well.'],
      ['T08', '[illegible] the weather has been quite'],
      ['T09', 'pleasant this [unclear: week/month].'],
      ['T11', 'The family sends their regards, and'],
      ['T12', 'we look forward to hearing from you'],
      ['T13', 'soon.'],
      ['T15', 'With warm regards,'],
      ['T16', '[sender]'],
      ['T18', 'P.S. Tell everyone hello'],
    ]);
    const recognizedTexts = [
      'oocher et le slept 2zon 1890',
      'Ar Millim fMomble',
      'Dour sen',
      'J u Reguestorr byelleis',
      'Bella Cimmpbile sa ccrite la',
      'gaà cenc state cohelhier on',
      'not et san fohre Pullavall us',
      'Sontond en faln tre c utt e',
      'corle Stale la non mai d',
      'cous cit jonesbor ssome dex',
      'douin the coute aflen the si of',
      'July. Scoent msa u Store cohère',
      'coes',
      'thère Sineral men tolheines',
      'atout ttre tenche Mudlene',
      'A Duchume hus seen some',
      'persoe preni conethein und',
      'thas lecmert the purtichulars',
      'abour te Marder Johu Pallas',
      'vle name vous mambhoneit as',
      'cne ef thare suposece la be',
      'connéclect coilte-et',
      'S Le Buchanoen',
      'Laus Vhrs Toun Pallusale cume',
    ];
    const segments = recognizedSegments(recognizedTexts.map((text, index) => ({
      id: `S${String(index + 1).padStart(2, '0')}`,
      text,
      left: 350,
      top: 200 + (index * 130),
      right: 2500,
      bottom: 300 + (index * 130),
      recognitionConfidence: 0.85,
    })));

    const result = alignTranscriptToRecognizedSegments(transcript, segments);

    expect(result.mappings).toHaveLength(transcript.length);
    expect(result.mappings.every(({ segmentIds, operation, status }) => (
      segmentIds.length === 0
      && operation === 'unlocated-transcript'
      && status === 'unlocated'
    ))).toBe(true);
    expect(result.skippedSegmentIds).toEqual(
      segments.map(({ id }) => id),
    );
    expect(result.operations.some(({ kind }) => (
      kind === 'match' || kind === 'split' || kind === 'merge'
    ))).toBe(false);
    expect(result.pageAssessment.status).toBe('transcript-mismatch');
    expect(result.unassignedSegmentReasons.every(
      ({ reason }) => reason === 'transcript-mismatch',
    )).toBe(true);
  });

  it('does not label merely poor OCR with a moderate row-count difference as a transcript mismatch', () => {
    const transcript = transcriptLines([
      ['T01', 'to send a coupon'],
      ['T02', 'to be posted on the top'],
      ['T03', 'I had a letter'],
      ['T04', 'from Aunt Minnie'],
      ['T05', 'I hope your health'],
    ]);
    const segments = recognizedSegments(
      ['mmmn', 'legr', 'l', 'rergg', 'dnier', 'condm', 'fanns', 'dates']
        .map((text, index) => ({
          id: `S${index + 1}`,
          text,
          left: 350,
          top: 200 + (index * 130),
          right: 2500,
          bottom: 300 + (index * 130),
        })),
    );

    const result = alignTranscriptToRecognizedSegments(transcript, segments);

    expect(result.pageAssessment.status).toBe('alignable');
    expect(result.unassignedSegmentReasons.some(
      ({ reason }) => reason === 'transcript-mismatch',
    )).toBe(false);
  });

  it('detaches the 003 T09 tall fragment while keeping the surrounding body stable', () => {
    const transcript = transcriptLines([
      ['T08', 'My dear Sadie,'],
      ['T09', 'I have thought of'],
      ['T10', 'you and Sarah, many times'],
    ]);
    const segments = recognizedSegments([
      {
        id: 'S03-greeting',
        text: 'Br Lear Padu,',
        left: 275,
        top: 983,
        right: 1310,
        bottom: 1117,
        recognitionConfidence: 0.86,
        readingOrderIndex: 3,
      },
      {
        id: 'S05-detached',
        text: '22',
        left: 2397,
        top: 979,
        right: 2475,
        bottom: 1089,
        recognitionConfidence: 0.5578,
        readingOrderIndex: 4,
      },
      {
        id: 'S06-main',
        text: 'dhave thoughl 57',
        left: 957,
        top: 1095,
        right: 2484,
        bottom: 1252,
        recognitionConfidence: 0.9169,
        readingOrderIndex: 5,
      },
      {
        id: 'S07-next',
        text: 'yon and Sarak manf ames',
        left: 337,
        top: 1317,
        right: 2468,
        bottom: 1420,
        recognitionConfidence: 0.89,
        readingOrderIndex: 6,
      },
    ]);

    const result = alignTranscriptToRecognizedSegments(transcript, segments);

    expect(Object.fromEntries(
      result.mappings.map(({ transcriptId, segmentIds }) => (
        [transcriptId, segmentIds]
      )),
    )).toEqual({
      T08: ['S03-greeting'],
      T09: ['S06-main'],
      T10: ['S07-next'],
    });
    expect(result.skippedSegmentIds).toEqual(['S05-detached']);
    expect(result.unassignedSegmentReasons).toEqual([{
      segmentId: 'S05-detached',
      reason: 'alignment-uncertain',
    }]);
  });

  it('preserves the 003 T13 interlinear correction as part of its main row', () => {
    const transcript = transcriptLines([
      ['T11', 'this A. M. and wondered if'],
      ['T12', 'the rain poured down in such'],
      ['T13', 'torrents as it did here. I do'],
      ['T14', 'hardly think you played out'],
    ]);
    const segments = recognizedSegments([
      {
        id: 'S08',
        text: 'Tnie A. M. and wondind J',
        left: 292,
        top: 1476,
        right: 2425,
        bottom: 1599,
        readingOrderIndex: 7,
      },
      {
        id: 'S09',
        text: 'The vain pinnd du un duch',
        left: 269,
        top: 1642,
        right: 2494,
        bottom: 1771,
        readingOrderIndex: 8,
      },
      {
        id: 'S10-correction',
        text: 'e Nobun',
        left: 624,
        top: 1743,
        right: 1033,
        bottom: 1868,
        baselineY: 1831,
        readingOrderIndex: 9,
      },
      {
        id: 'S11-main',
        text: 'vomle ae Adid hiri. Jesp',
        left: 275,
        top: 1818,
        right: 2486,
        bottom: 1939,
        baselineY: 1898,
        readingOrderIndex: 10,
      },
      {
        id: 'S12',
        text: 'Hardly Chinte jau Gelaipd out',
        left: 273,
        top: 1995,
        right: 2419,
        bottom: 2096,
        readingOrderIndex: 11,
      },
    ]);

    const result = alignTranscriptToRecognizedSegments(transcript, segments);

    expect(Object.fromEntries(
      result.mappings.map(({ transcriptId, segmentIds }) => (
        [transcriptId, segmentIds]
      )),
    )).toEqual({
      T11: ['S08'],
      T12: ['S09'],
      T13: ['S10-correction', 'S11-main'],
      T14: ['S12'],
    });
    expect(result.skippedSegmentIds).not.toContain('S10-correction');
  });

  it('keeps the short 009 "up." row between two strong lines', () => {
    const transcript = transcriptLines([
      ['T245', "you. I think I'll stop now but I won't give"],
      ['T246', 'up.'],
      ['T248', 'All my love and kisses,'],
    ]);
    const segments = recognizedSegments([
      {
        id: 'S42',
        text: "you. I thint T'Il step non but I wonlt give",
        left: 493,
        top: 3253,
        right: 2324,
        bottom: 3386,
        baselineY: 3318,
        recognitionConfidence: 0.894,
        readingOrderIndex: 41,
      },
      {
        id: 'S43-short',
        text: '17.',
        left: 497,
        top: 3311,
        right: 617,
        bottom: 3435,
        baselineY: 3364,
        recognitionConfidence: 0.755,
        readingOrderIndex: 42,
      },
      {
        id: 'S44',
        text: 'All my love and keses.',
        left: 1384,
        top: 3362,
        right: 2337,
        bottom: 3520,
        baselineY: 3460,
        recognitionConfidence: 0.959,
        readingOrderIndex: 43,
      },
    ]);

    const result = alignTranscriptToRecognizedSegments(transcript, segments);

    expect(result.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
      ['S42'],
      ['S43-short'],
      ['S44'],
    ]);
    expect(result.skippedSegmentIds).toEqual([]);
  });
});

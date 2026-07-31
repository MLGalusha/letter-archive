import { describe, expect, it } from 'vitest';
import type { PageGeometryEnvelope } from '../../../schemas/page-geometry.js';
import {
  segmentRecognitionGeometryChecksum,
  type PageRecognitionRecord,
} from '../../../schemas/page-recognition.js';
import type { LineSegment } from '../../../schemas/line-segment.js';
import { pageGeometryChecksum, pageLineSegmentsChecksum } from '../../../schemas/page-geometry.js';
import { buildProductionAlignmentPage } from '../production-page.js';
import type { TranscriptPageSlice } from '../transcript-pages.js';

const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const SHA = 'a'.repeat(64);

function machineSegment(
  id: string,
  line: number,
  y: number,
): LineSegment {
  return {
    id,
    line,
    geometryType: 'baseline',
    bbox: [100, y, 600, y + 40],
    baseline: [[100, y + 35], [600, y + 35]],
    boundary: [
      { x: 100, y },
      { x: 600, y },
      { x: 600, y: y + 40 },
      { x: 100, y: y + 40 },
    ],
    ocrText: '',
    providerOrdinal: line,
    providerTextDirection: 'horizontal-lr',
    geometryProvenance: {
      source: 'machine',
      operation: 'detected',
      parentSegmentIds: [],
    },
  };
}

function humanSegment(
  id: string,
  line: number,
  y: number,
): LineSegment {
  return {
    id,
    line,
    geometryType: 'bbox',
    bbox: [110, y, 260, y + 40],
    bboxSource: 'human-drawn-bbox',
    ocrText: '',
    geometryProvenance: {
      source: 'human-created',
      operation: 'create-box',
      parentSegmentIds: [],
    },
  };
}

function recognition(
  segment: LineSegment,
  text: string,
): PageRecognitionRecord {
  return {
    segmentId: segment.id!,
    segmentGeometryChecksumSha256:
      segmentRecognitionGeometryChecksum(segment),
    textDirection: segment.providerTextDirection ?? 'horizontal-lr',
    text,
    meanConfidence: 0.9,
    state: text.length > 0 ? 'recognized' : 'attempted-empty',
    binding: {
      kind: 'exact-current-input',
      adapter: 'direct-baseline',
    },
  };
}

function geometry(lineSegments: LineSegment[]): PageGeometryEnvelope {
  return {
    lineSegments,
    geometryRevision: 3,
    geometryChecksumSha256: pageGeometryChecksum(lineSegments),
    lineSegmentsChecksumSha256: pageLineSegmentsChecksum(lineSegments),
    reviewState: {
      trustState: 'unverified',
      approvedGeometryRevision: null,
      approvedGeometryChecksumSha256: null,
      approvedBy: null,
      approvedAt: null,
    },
  };
}

function transcriptPage(lines: string[]): TranscriptPageSlice {
  return {
    pageNumber: 1,
    marker: null,
    section: {
      byteStart: 0,
      byteEndExclusive: 0,
      byteLength: 0,
      sha256: SHA,
    },
    content: {
      text: lines.join('\n'),
      byteStart: 0,
      byteEndExclusive: 0,
      byteLength: 0,
      characterCount: lines.join('\n').length,
      sha256: SHA,
    },
    lines: lines.map((text, index) => ({
      id: `line-${index + 1}`,
      sourceLineNumber: index + 1,
      text,
      alignable: true,
      byteStart: 0,
      byteEndExclusive: 0,
      sha256: SHA,
    })),
  };
}

function build(input: {
  segments: LineSegment[];
  lines: string[];
  records: PageRecognitionRecord[];
}) {
  return buildProductionAlignmentPage({
    pageId: PAGE_ID,
    pageNumber: 1,
    sourceChecksumSha256: SHA,
    primarySourceRevision: 2,
    transcriptRevision: 4,
    transcriptChecksumSha256: SHA,
    geometry: geometry(input.segments),
    transcriptPage: transcriptPage(input.lines),
    recognitionRecords: input.records,
    recognitionExactArtifactChecksumSha256: SHA,
    recognitionSourceArtifactChecksumsSha256: [SHA],
    recognitionEvidenceChecksumSha256: SHA,
  });
}

describe('production transcript alignment page', () => {
  it('places a human-created Hi between recognized anchors without shifting the body', () => {
    const date = machineSegment('date', 1, 100);
    const hi = humanSegment('human-hi', 19, 180);
    const body = machineSegment('body', 2, 280);

    const page = build({
      segments: [date, body, hi],
      lines: [
        '24th April, 1945.',
        'Hi.',
        'Will try to answer your letter',
      ],
      records: [
        recognition(date, '24th April 1945'),
        recognition(body, 'Will try lo ancire your lellur'),
      ],
    });

    expect(page.status).toBe('ready');
    expect(page.mappings).toEqual([
      expect.objectContaining({
        transcriptText: '24th April, 1945.',
        segmentIds: ['date'],
        evidence: 'content',
      }),
      expect.objectContaining({
        transcriptText: 'Hi.',
        segmentIds: ['human-hi'],
        evidence: 'geometry-only',
        status: 'ambiguous',
      }),
      expect.objectContaining({
        transcriptText: 'Will try to answer your letter',
        segmentIds: ['body'],
        evidence: 'content',
      }),
    ]);
  });

  it('places a terminal human-created Dave after the recognized Yours line', () => {
    const yours = machineSegment('yours', 1, 100);
    const dave = humanSegment('human-dave', 99, 180);

    const page = build({
      segments: [yours, dave],
      lines: ['Yours', 'Dave'],
      records: [recognition(yours, 'Yours')],
    });

    expect(page.status).toBe('ready');
    expect(page.mappings).toEqual([
      expect.objectContaining({
        transcriptText: 'Yours',
        segmentIds: ['yours'],
      }),
      expect.objectContaining({
        transcriptText: 'Dave',
        segmentIds: ['human-dave'],
        evidence: 'geometry-only',
      }),
    ]);
  });

  it('fails visibly instead of reviving positional matching when recognition is missing', () => {
    const first = machineSegment('first', 1, 100);
    const second = machineSegment('second', 2, 180);

    const page = build({
      segments: [first, second],
      lines: ['Hi.', 'Will try to answer your letter'],
      records: [],
    });

    expect(page.status).toBe('recognition-missing');
    expect(page.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
      [],
      [],
    ]);
    expect(page.unassignedSegments).toEqual(expect.arrayContaining([
      { segmentId: 'first', reason: 'recognition-missing' },
      { segmentId: 'second', reason: 'recognition-missing' },
    ]));
  });

  it('fails visibly when recognition attempted every machine line but read no content', () => {
    const first = machineSegment('first', 1, 100);
    const second = machineSegment('second', 2, 180);

    const page = build({
      segments: [first, second],
      lines: ['Hi.', 'Will try to answer your letter'],
      records: [
        recognition(first, ''),
        recognition(second, ''),
      ],
    });

    expect(page.status).toBe('recognition-missing');
    expect(page.recognition).toMatchObject({
      status: 'missing',
      validRecordCount: 2,
      alignableSegmentCount: 2,
    });
    expect(page.mappings.map(({ segmentIds }) => segmentIds)).toEqual([
      [],
      [],
    ]);
  });
});

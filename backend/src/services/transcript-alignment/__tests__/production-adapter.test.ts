import { describe, expect, it } from 'vitest';
import {
  segmentRecognitionGeometryChecksum,
  type PageRecognitionRecord,
} from '../../../schemas/page-recognition.js';
import type { LineSegment } from '../../../schemas/line-segment.js';
import {
  adaptPageSegmentsForAlignment,
  alignmentSegmentInputChecksum,
} from '../production-adapter.js';

function machineSegment(
  id: string,
  line: number,
  y: number,
): LineSegment {
  return {
    id,
    line,
    geometryType: 'baseline',
    bbox: [100, y, 500, y + 40],
    baseline: [[100, y + 35], [500, y + 35]],
    boundary: [
      { x: 100, y },
      { x: 500, y },
      { x: 500, y: y + 40 },
      { x: 100, y: y + 40 },
    ],
    ocrText: '',
    geometryProvenance: {
      source: 'machine',
      operation: 'detected',
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

describe('production transcript alignment adapter', () => {
  it('uses exact recognition while spatially placing appended human geometry', () => {
    const date = machineSegment('date', 1, 100);
    const body = machineSegment('body', 2, 300);
    const hi: LineSegment = {
      id: 'human-hi',
      line: 19,
      geometryType: 'bbox',
      bbox: [110, 190, 220, 235],
      bboxSource: 'human-drawn-bbox',
      ocrText: '',
      geometryProvenance: {
        source: 'human-created',
        operation: 'create-box',
        parentSegmentIds: [],
      },
    };

    const result = adaptPageSegmentsForAlignment({
      lineSegments: [date, body, hi],
      recognitionRecords: [
        recognition(date, '24th April 1945'),
        recognition(body, 'Will try to answer your letter'),
      ],
    });

    expect(result.recognizedSegments).toEqual([
      expect.objectContaining({
        id: 'date',
        recognitionState: 'recognized',
        geometryEvidence: 'machine',
        readingOrderIndex: 1,
      }),
      expect.objectContaining({
        id: 'body',
        recognitionState: 'recognized',
        geometryEvidence: 'machine',
        readingOrderIndex: 2,
      }),
      expect.objectContaining({
        id: 'human-hi',
        recognitionState: 'not-attempted',
        geometryEvidence: 'human-gap-fill',
        readingOrderIndex: null,
      }),
    ]);
  });

  it('does not consume a recognition record after that segment moves', () => {
    const original = machineSegment('body', 1, 100);
    const record = recognition(original, 'Readable text');
    const moved = {
      ...original,
      bbox: [100, 120, 500, 160] as LineSegment['bbox'],
      baseline: [[100, 155], [500, 155]],
      boundary: original.boundary?.map(({ x, y }) => ({ x, y: y + 20 })),
    };

    const result = adaptPageSegmentsForAlignment({
      lineSegments: [moved],
      recognitionRecords: [record],
    });

    expect(result.validRecognitionRecordCount).toBe(0);
    expect(result.recognizedSegments[0]).toMatchObject({
      text: '',
      recognitionState: 'not-attempted',
    });
  });

  it('leaves unresolved rotated proposals out of provider body order', () => {
    const first = {
      ...machineSegment('first', 1, 100),
      providerOrdinal: 1,
    };
    const rotated = {
      ...machineSegment('rotated-note', 99, 180),
      providerOrdinal: 99,
      providerTextDirection: 'vertical-lr' as const,
      rotationEvidence: {
        evidenceContract: 'native-and-source-projected-v2' as const,
        mergePolicy:
          'baseline-plus-nonoverlapping-vertical-zones' as const,
        clusterIndex: 4,
        supportCount: 1,
        sourceRotationsDegrees: [90] as const,
        sourcePassStatuses: ['succeeded'] as const,
        representativeRotationDegrees: 90 as const,
        representativeProviderOrdinal: 7,
        memberProviderIds: ['rot90:provider-note'],
        readingOrderSource: 'unresolved-rotated-proposal' as const,
      },
    };
    const second = {
      ...machineSegment('second', 2, 300),
      providerOrdinal: 2,
    };

    const result = adaptPageSegmentsForAlignment({
      lineSegments: [first, rotated, second],
      recognitionRecords: [],
    });

    expect(result.recognizedSegments.map((segment) => ({
      id: segment.id,
      readingOrderIndex: segment.readingOrderIndex,
    }))).toEqual([
      { id: 'first', readingOrderIndex: 1 },
      { id: 'rotated-note', readingOrderIndex: null },
      { id: 'second', readingOrderIndex: 2 },
    ]);
  });

  it('treats the legacy negative unassigned sentinel as spatially ordered', () => {
    const unassigned = machineSegment('unassigned', -1, 100);
    const result = adaptPageSegmentsForAlignment({
      lineSegments: [unassigned],
      recognitionRecords: [],
    });

    expect(result.recognizedSegments[0]).toMatchObject({
      id: 'unassigned',
      readingOrderIndex: null,
    });
  });

  it('keeps mutable legacy mapping metadata out of the automatic input checksum', () => {
    const segment = machineSegment('body', 1, 100);
    expect(alignmentSegmentInputChecksum([segment])).toBe(
      alignmentSegmentInputChecksum([{
        ...segment,
        isMapped: true,
        mappedText: 'A stale mapping',
      }]),
    );
  });

  it('retains a human origin after an adjustment through its bbox source', () => {
    const segment: LineSegment = {
      id: 'adjusted-human',
      line: 4,
      geometryType: 'bbox',
      bbox: [110, 190, 220, 235],
      bboxSource: 'human-drawn-polygon',
      ocrText: '',
      geometryProvenance: {
        source: 'human-adjusted',
        operation: 'resize',
        parentSegmentIds: ['adjusted-human'],
      },
    };

    const result = adaptPageSegmentsForAlignment({
      lineSegments: [segment],
      recognitionRecords: [],
    });

    expect(result.recognizedSegments[0]).toMatchObject({
      geometryEvidence: 'human-gap-fill',
      recognitionState: 'not-attempted',
    });
  });

  it('returns deliberately ignored geometry separately', () => {
    const ignored = {
      ...machineSegment('stationery', 1, 100),
      segmentClass: 'ignore' as const,
    };

    const result = adaptPageSegmentsForAlignment({
      lineSegments: [ignored],
      recognitionRecords: [recognition(ignored, 'ON ACTIVE SERVICE')],
    });

    expect(result.recognizedSegments).toEqual([]);
    expect(result.excludedSegmentIds).toEqual(['stationery']);
  });
});

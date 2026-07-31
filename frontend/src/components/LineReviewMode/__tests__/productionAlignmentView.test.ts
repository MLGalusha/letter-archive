import { describe, expect, it } from 'vitest';
import type {
  ProductionAlignmentMapping,
  ProductionAlignmentPage,
} from '../../../api/admin/productionTranscriptAlignment';
import type { LineSegment } from '../../../types/Letter';
import {
  buildProductionReviewLines,
} from '../productionAlignmentView';

function segment(
  id: string,
  bbox: [number, number, number, number],
): LineSegment {
  return {
    id,
    line: 1,
    bbox,
    baseline: [[bbox[0], bbox[3]], [bbox[2], bbox[3]]],
    ocrText: '',
  };
}

function mapping(
  transcriptLineIndex: number,
  transcriptText: string,
  segmentIds: string[],
): ProductionAlignmentMapping {
  return {
    id: `mapping-${transcriptLineIndex}`,
    transcriptId: `transcript-${transcriptLineIndex}`,
    transcriptLineIndex,
    sourceLineNumber: transcriptLineIndex + 1,
    transcriptText,
    segmentIds,
    operation: segmentIds.length > 1
      ? 'merge'
      : segmentIds.length === 1
        ? 'match'
        : 'unlocated-transcript',
    similarity: segmentIds.length > 0 ? 0.9 : 0,
    confidence: segmentIds.length > 0 ? 0.9 : 0,
    status: segmentIds.length > 0 ? 'accepted' : 'unlocated',
    evidence: segmentIds.length > 0 ? 'content' : 'unlocated',
    alternatives: [],
  };
}

function page(
  segments: LineSegment[],
  mappings: ProductionAlignmentMapping[],
  status: ProductionAlignmentPage['status'] = 'ready',
): ProductionAlignmentPage {
  return {
    pageId: 'page-1',
    pageNumber: 1,
    sourceChecksumSha256: null,
    geometry: {
      lineSegments: segments,
      geometryRevision: 1,
      geometryChecksumSha256: 'geometry',
      lineSegmentsChecksumSha256: 'segments',
      reviewState: {
        trustState: 'unverified',
        approvedGeometryRevision: null,
        approvedGeometryChecksumSha256: null,
        approvedBy: null,
        approvedAt: null,
      },
    },
    recognition: {
      status: status === 'recognition-missing' ? 'missing' : 'ready',
      profileChecksumSha256: 'profile',
      exactArtifactChecksumSha256: status === 'recognition-missing'
        ? null
        : 'artifact',
      sourceArtifactChecksumsSha256: status === 'recognition-missing'
        ? []
        : ['artifact'],
      evidenceChecksumSha256: status === 'recognition-missing'
        ? null
        : 'evidence',
      validRecordCount: segments.length,
      alignableSegmentCount: segments.length,
    },
    inputFingerprintSha256: 'fingerprint',
    status,
    statusMessage: status === 'recognition-missing'
      ? 'Recognition missing'
      : null,
    transcriptLines: mappings.map((item) => ({
      id: item.transcriptId,
      transcriptLineIndex: item.transcriptLineIndex,
      sourceLineNumber: item.sourceLineNumber,
      text: item.transcriptText,
    })),
    mappings,
    unassignedSegments: [],
    deferredSegmentIds: [],
  };
}

describe('production alignment view', () => {
  it('uses backend transcript indices and stable IDs for middle Hi and terminal Dave', () => {
    const hi = segment('hi', [20, 20, 60, 40]);
    const yours = segment('yours', [120, 300, 220, 330]);
    const dave = segment('dave', [80, 350, 150, 380]);
    const lines = buildProductionReviewLines(page(
      [dave, hi, yours],
      [
        mapping(2, 'Dave', ['dave']),
        mapping(0, 'Hi.', ['hi']),
        mapping(1, 'Yours', ['yours']),
      ],
    ));

    expect(lines.map(({ transcriptText }) => transcriptText)).toEqual([
      'Hi.',
      'Yours',
      'Dave',
    ]);
    expect(lines.map(({ sourceSegmentIds }) => sourceSegmentIds)).toEqual([
      ['hi'],
      ['yours'],
      ['dave'],
    ]);
  });

  it('keeps split shapes separate while using their union only for placement', () => {
    const lines = buildProductionReviewLines(page(
      [
        segment('left', [10, 50, 80, 80]),
        segment('right', [120, 50, 200, 80]),
      ],
      [mapping(0, 'one logical line', ['left', 'right'])],
    ));

    expect(lines[0].sourceSegmentIds).toEqual(['left', 'right']);
    expect(lines[0].segmentGeometries).toHaveLength(2);
    expect(lines[0].bbox).toEqual([10, 50, 200, 80]);
    expect(lines[0].boundary).toBeUndefined();
  });

  it('keeps transcript rows reviewable when recognition has no location', () => {
    const lines = buildProductionReviewLines(page(
      [],
      [mapping(0, 'Hi.', [])],
      'recognition-missing',
    ));

    expect(lines[0]).toMatchObject({
      transcriptText: 'Hi.',
      sourceSegmentIds: [],
      segmentGeometries: [],
      geometrySource: 'unlocated',
      pageStatus: 'recognition-missing',
    });
  });
});

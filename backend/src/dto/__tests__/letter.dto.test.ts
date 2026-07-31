import { describe, expect, it } from 'vitest';
import {
  formatLetterDate,
  transformLetterToDTO,
  type LetterWithRelations,
} from '../letter.dto.js';
import { pageLayoutV2Schema } from '../../schemas/page-layout-v2.js';
import { pageLayoutChecksum } from '../../services/page-layout-checksum.js';
import {
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
} from '../../schemas/page-geometry.js';

type LetterDateInput = Parameters<typeof formatLetterDate>[0];

function letterDateInput(
  extractedDate: string | null,
  dateRaw: string,
): LetterDateInput {
  return { extractedDate, dateRaw } as LetterDateInput;
}

describe('letter DTO date formatting', () => {
  it('prefers the reviewed extracted date over filename identity', () => {
    expect(formatLetterDate(
      letterDateInput('1886-03-14', '18860315'),
    )).toBe('March 14th, 1886');
  });

  it('falls back to the partial filename date without JavaScript Date parsing', () => {
    expect(formatLetterDate(
      letterDateInput(null, '1947XXXX'),
    )).toBe('1947');
  });

  it('falls back when a stored extracted date is not canonical ISO', () => {
    expect(formatLetterDate(
      letterDateInput('not-a-date', '18860315'),
    )).toBe('March 15th, 1886');
  });
});

describe('letter DTO metadata fidelity', () => {
  it('preserves authoritative empty strings for lossless version snapshots', () => {
    const letter = {
      id: 'letter-1',
      type: 'L',
      collection: {
        collectionCode: '001',
        title: 'Collection One',
      },
      pages: [],
      sender: '',
      recipient: '',
      locationWritten: '',
      hook: '',
      summary: '',
      extractedDate: null,
      dateRaw: '1947XXXX',
      dateConfidence: 'unknown',
      metadataV2Json: null,
      transcriptionText: null,
      transcriptionJson: null,
      transcriptStatus: 'EMPTY',
      metadataContentStatus: 'EDITED',
      metadataStatus: 'FAILED',
      transcriptConfirmationId: '38000000-0000-4000-8000-000000000001',
      workflow: 'TRANSCRIBED',
      visibility: 'HIDDEN',
      transcriptPublished: false,
      metadataPublished: false,
      primarySourceRevision: 4,
      transcriptRevision: 3,
      transcriptChecksumSha256: checksum('d'),
      extraContentStatus: 'EMPTY',
      photoDescriptionStatus: 'EMPTY',
      flagged: false,
      createdAt: new Date('2026-07-24T12:00:00.000Z'),
    } as unknown as LetterWithRelations;

    const result = transformLetterToDTO(letter);

    expect(result.metadata).toMatchObject({
      sender: '',
      recipient: '',
      location: '',
      hook: '',
      description: '',
    });
    expect(result.metadataJobStatus).toBe(letter.metadataStatus);
    expect(result.transcriptConfirmationId).toBe(
      letter.transcriptConfirmationId,
    );
    expect(result).toMatchObject({
      transcriptRevision: 3,
      transcriptChecksumSha256: checksum('d'),
    });
  });
});

const checksum = (character: string) => character.repeat(64);

function storedLayout() {
  return pageLayoutV2Schema.parse({
    schemaVersion: 2,
    layoutId: 'layout-page-1',
    runId: 'run-page-1',
    pageId: 'page-1',
    image: {
      width: 100,
      height: 200,
      checksumSha256: checksum('a'),
      coordinateSpace: {
        unit: 'pixel',
        origin: 'top-left',
        xAxis: 'right',
        yAxis: 'down',
      },
    },
    provenance: {
      producer: { name: 'kraken', version: '7.0.3' },
      model: {
        name: 'default',
        version: '7.0.3',
        checksumSha256: checksum('b'),
      },
      config: {
        name: 'archive-default',
        version: '1',
        checksumSha256: checksum('c'),
      },
    },
    lineRepresentation: 'bbox',
    textDirection: 'vertical-lr',
    scriptDetection: false,
    language: null,
    lines: [{
      id: 'line-sideways',
      kind: 'bbox',
      text: null,
      direction: 'top-to-bottom',
      providerTextDirection: 'vertical-lr',
      boundingBox: {
        xMin: 10,
        yMin: 10,
        xMax: 30,
        yMax: 150,
      },
    }],
    regions: [],
    readingOrder: {
      primary: {
        id: 'order-primary',
        direction: 'top-to-bottom',
        lineIds: ['line-sideways'],
      },
      alternatives: [],
    },
  });
}

function letterWithPage(
  pageOverrides: Record<string, unknown> = {},
): LetterWithRelations {
  return {
    id: 'letter-1',
    type: 'L',
    collection: {
      collectionCode: '001',
      title: 'Collection One',
    },
    pages: [{
      id: 'page-1',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'letters/page-1.jpg',
      originalFilename: '001-19470101-L01-01.jpg',
      checksumSha256: checksum('a'),
      pageLayout: null,
      pageLayoutChecksumSha256: null,
      lineSegments: null,
      segmentTrustState: 'unverified',
      width: 100,
      height: 200,
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      updatedAt: new Date('2026-07-28T00:00:00.000Z'),
      ...pageOverrides,
    }],
    sender: null,
    recipient: null,
    locationWritten: null,
    hook: null,
    summary: null,
    extractedDate: null,
    dateRaw: '19470101',
    dateConfidence: 'exact',
    metadataV2Json: null,
    transcriptionText: null,
    transcriptionJson: null,
    transcriptStatus: 'EMPTY',
    metadataContentStatus: 'EMPTY',
    metadataStatus: 'PENDING',
    workflow: 'UPLOADED',
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    primarySourceRevision: 4,
    transcriptRevision: 0,
    transcriptChecksumSha256:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    extraContentStatus: 'EMPTY',
    photoDescriptionStatus: 'EMPTY',
    flagged: false,
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
  } as unknown as LetterWithRelations;
}

describe('letter DTO layout fidelity', () => {
  it('exposes the current geometry identity for safe preloaded saves', () => {
    const segments = [{
      id: 'line-1',
      line: 1,
      geometryType: 'baseline' as const,
      baseline: [[1, 2], [3, 4]],
      bbox: [1, 2, 3, 4],
      ocrText: 'rough',
    }];
    const result = transformLetterToDTO(letterWithPage({
      lineSegments: segments,
      geometryRevision: 7,
      geometryChecksumSha256: null,
    }));

    expect(result.images[0]).toMatchObject({
      geometryRevision: 7,
      geometryChecksumSha256: pageGeometryChecksum([{
        id: 'line-1',
        line: 1,
        geometryType: 'baseline',
        baseline: [[1, 2], [3, 4]],
        bbox: [1, 2, 3, 4],
        ocrText: 'rough',
      }]),
      lineSegmentsChecksumSha256: pageLineSegmentsChecksum([{
        id: 'line-1',
        line: 1,
        geometryType: 'baseline',
        baseline: [[1, 2], [3, 4]],
        bbox: [1, 2, 3, 4],
        ocrText: 'rough',
      }]),
    });
  });

  it('exposes only a strictly validated, source-bound PageLayoutV2 pair', () => {
    const layout = storedLayout();
    const result = transformLetterToDTO(letterWithPage({
      pageLayout: layout,
      pageLayoutChecksumSha256: pageLayoutChecksum(layout),
    }));

    expect(result.images[0].pageLayout).toEqual(layout);
    expect(result.images[0].pageLayoutChecksumSha256).toBe(
      pageLayoutChecksum(layout),
    );
  });

  it('omits a corrupt layout pair and malformed mutable projection', () => {
    const layout = storedLayout();
    const result = transformLetterToDTO(letterWithPage({
      pageLayout: layout,
      pageLayoutChecksumSha256: checksum('f'),
      lineSegments: [{
        id: 'line-sideways',
        line: 1,
        geometryType: 'bbox',
        baseline: [[10, 10], [30, 10]],
        bbox: [10, 10, 30, 150],
        ocrText: '',
      }],
    }));

    expect(result.images[0]).not.toHaveProperty('pageLayout');
    expect(result.images[0]).not.toHaveProperty('pageLayoutChecksumSha256');
    expect(result.images[0].lineSegments).toBeUndefined();
  });

  it('retains bbox-native review lines without inventing baselines', () => {
    const result = transformLetterToDTO(letterWithPage({
      lineSegments: [{
        id: 'line-sideways',
        line: 1,
        geometryType: 'bbox',
        providerTextDirection: 'vertical-lr',
        bbox: [10, 10, 30, 150],
        bboxSource: 'native-bbox',
        ocrText: '',
      }],
    }));

    expect(result.images[0].lineSegments).toEqual([{
      id: 'line-sideways',
      line: 1,
      geometryType: 'bbox',
      providerTextDirection: 'vertical-lr',
      bbox: [10, 10, 30, 150],
      bboxSource: 'native-bbox',
      geometryProvenance: {
        source: 'machine',
        operation: 'detected',
        parentSegmentIds: [],
      },
      ocrText: '',
    }]);
    expect(result.images[0].lineSegments?.[0]).not.toHaveProperty('baseline');
  });

  it('retains the sparse Kraken 6 group field on legacy records', () => {
    const result = transformLetterToDTO(letterWithPage({
      lineSegments: [{
        line: -1,
        baseline: [[10, 20], [90, 20]],
        bbox: [10, 10, 90, 30],
        ocrText: 'legacy',
        group: 0,
      }, {
        line: 2,
        baseline: [[10, 50], [90, 50]],
        bbox: [10, 40, 90, 60],
        ocrText: 'legacy nullable group',
        group: null,
      }],
    }));

    expect(result.images[0].lineSegments?.map((segment) => segment.group))
      .toEqual([0, null]);
  });
});

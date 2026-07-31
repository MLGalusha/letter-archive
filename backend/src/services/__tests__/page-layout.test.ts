import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pageLayoutV2Schema,
  type PageLayoutV2,
} from '../../schemas/page-layout-v2.js';

const { insertSourceBoundPageLayoutMock } = vi.hoisted(() => ({
  insertSourceBoundPageLayoutMock: vi.fn(),
}));

vi.mock('../page-source-bound-write.js', () => ({
  insertSourceBoundPageLayout: insertSourceBoundPageLayoutMock,
}));

import { pageLayoutChecksum } from '../page-layout-checksum.js';
import {
  pageLayoutToLineSegments,
  parseStoredPageLayoutV2,
  savePageLayoutV2,
} from '../page-layout.js';

const checksum = (character: string) => character.repeat(64);

function layout(): PageLayoutV2 {
  return pageLayoutV2Schema.parse({
    schemaVersion: 2,
    layoutId: 'layout-page-1',
    runId: 'run-page-1',
    pageId: 'page-1',
    image: {
      width: 100,
      height: 100,
      checksumSha256: checksum('b'),
      coordinateSpace: {
        unit: 'pixel',
        origin: 'top-left',
        xAxis: 'right',
        yAxis: 'down',
      },
      source: {
        width: 80,
        height: 100,
        checksumSha256: checksum('a'),
        mode: 'RGB',
        exifOrientation: 6,
      },
      normalization: {
        operation: 'rotate-90-cw',
        applied: true,
        exifReadError: false,
      },
    },
    provenance: {
      producer: {
        name: 'kraken',
        version: '7.0.3',
        api: 'kraken.tasks.SegmentationTaskModel',
      },
      model: {
        name: 'default',
        version: '7.0.3',
        checksumSha256: checksum('c'),
      },
      config: {
        name: 'archive-default',
        version: '1',
        checksumSha256: checksum('d'),
      },
    },
    lineRepresentation: 'mixed',
    textDirection: 'horizontal-lr',
    scriptDetection: false,
    language: null,
    lines: [{
      id: 'line-baseline',
      providerId: 'provider-baseline',
      providerOrdinal: 3,
      kind: 'baseline',
      text: 'curved',
      direction: 'left-to-right',
      providerTextDirection: 'horizontal-lr',
      baseline: [
        { x: 10, y: 20 },
        { x: 30, y: 23 },
        { x: 50, y: 20 },
      ],
      boundingBox: {
        xMin: 10,
        yMin: 15,
        xMax: 50,
        yMax: 30,
      },
      displayExtent: {
        boundingBox: {
          xMin: 10,
          yMin: 20,
          xMax: 50,
          yMax: 20,
        },
        source: 'derived-baseline-aabb',
        derived: true,
      },
    }, {
      id: 'line-sideways',
      providerId: 'provider-sideways',
      providerOrdinal: 1,
      kind: 'bbox',
      text: 'sideways',
      direction: 'top-to-bottom',
      providerTextDirection: 'vertical-lr',
      boundingBox: {
        xMin: 70,
        yMin: 10,
        xMax: 90,
        yMax: 80,
      },
      words: [{
        id: 'word-sideways',
        text: 'sideways',
        boundingBox: {
          xMin: 72,
          yMin: 12,
          xMax: 88,
          yMax: 78,
        },
      }],
    }],
    regions: [],
    readingOrder: {
      primary: {
        id: 'order-primary',
        direction: 'mixed',
        source: 'provider',
        lineIds: ['line-sideways', 'line-baseline'],
      },
      alternatives: [],
    },
  });
}

describe('PageLayoutV2 storage projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertSourceBoundPageLayoutMock.mockResolvedValue({
      saved: true,
      projectionAction: 'created',
    });
  });

  it('projects native geometry in provider reading order without inventing baselines', () => {
    expect(pageLayoutToLineSegments(layout())).toEqual([{
      id: 'line-sideways',
      line: 1,
      geometryType: 'bbox',
      providerId: 'provider-sideways',
      providerOrdinal: 1,
      providerTextDirection: 'vertical-lr',
      bbox: [70, 10, 90, 80],
      bboxSource: 'native-bbox',
      geometryProvenance: {
        source: 'machine',
        operation: 'detected',
        parentSegmentIds: [],
      },
      ocrText: 'sideways',
      words: [{
        text: 'sideways',
        bbox: [72, 12, 88, 78],
      }],
      regionIds: [],
    }, {
      id: 'line-baseline',
      line: 2,
      geometryType: 'baseline',
      providerId: 'provider-baseline',
      providerOrdinal: 3,
      providerTextDirection: 'horizontal-lr',
      baseline: [[10, 20], [30, 23], [50, 20]],
      bbox: [10, 20, 50, 21],
      bboxSource: 'derived-baseline-aabb',
      geometryProvenance: {
        source: 'machine',
        operation: 'detected',
        parentSegmentIds: [],
      },
      ocrText: 'curved',
      regionIds: [],
    }]);
  });

  it('atomically persists the validated document, digest, and review projection', async () => {
    const value = layout();
    const expected = {
      primarySourceRevision: 4,
      sourceChecksum: checksum('a'),
    };

    await expect(savePageLayoutV2(
      'page-1',
      value,
      expected,
    )).resolves.toEqual({
      saved: true,
      checksumSha256: pageLayoutChecksum(value),
      lineCount: 2,
      projectionAction: 'created',
    });

    expect(insertSourceBoundPageLayoutMock).toHaveBeenCalledOnce();
    expect(insertSourceBoundPageLayoutMock).toHaveBeenCalledWith(
      'page-1',
      expect.objectContaining({
        pageLayout: value,
        pageLayoutChecksumSha256: pageLayoutChecksum(value),
        updatedAt: expect.any(Date),
      }),
      {
        geometryRevision: 0,
        geometryChecksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        lineSegments: expect.arrayContaining([
          expect.objectContaining({ id: 'line-sideways' }),
          expect.objectContaining({ id: 'line-baseline' }),
        ]),
        segmentTrustState: 'unverified',
      },
      expected,
    );
  });

  it('rejects page and source identity mismatches before writing', async () => {
    await expect(savePageLayoutV2(
      'another-page',
      layout(),
      {
        primarySourceRevision: 4,
        sourceChecksum: checksum('a'),
      },
    )).rejects.toThrow(/pageId/);

    await expect(savePageLayoutV2(
      'page-1',
      layout(),
      {
        primarySourceRevision: 4,
        sourceChecksum: checksum('f'),
      },
    )).rejects.toThrow(/source checksum/);

    expect(insertSourceBoundPageLayoutMock).not.toHaveBeenCalled();
  });

  it('returns null for malformed stored documents', () => {
    expect(parseStoredPageLayoutV2(layout())).toEqual(layout());
    expect(parseStoredPageLayoutV2({
      ...layout(),
      schemaVersion: 3,
    })).toBeNull();
  });
});

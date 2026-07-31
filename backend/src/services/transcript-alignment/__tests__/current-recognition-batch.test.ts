import { describe, expect, it } from 'vitest';
import {
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
  type PageGeometryEnvelope,
} from '../../../schemas/page-geometry.js';
import type { LineSegment } from '../../../schemas/line-segment.js';
import {
  buildCurrentRecognitionBatchManifest,
  recognitionDirection,
} from '../current-recognition-batch.js';

const SHA = 'a'.repeat(64);

function geometry(lineSegments: LineSegment[]): PageGeometryEnvelope {
  return {
    lineSegments,
    geometryRevision: 2,
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

describe('current recognition batch manifest', () => {
  it('preserves absent legacy geometry fields while declaring direction', () => {
    const legacy: LineSegment = {
      id: 'legacy:0:1',
      line: 1,
      baseline: [[10, 30], [200, 32]],
      bbox: [10, 10, 200, 40],
      ocrText: '',
    };
    const human: LineSegment = {
      id: 'human-hi',
      line: 2,
      geometryType: 'bbox',
      bbox: [20, 60, 90, 100],
      bboxSource: 'human-drawn-bbox',
      ocrText: '',
      geometryProvenance: {
        source: 'human-created',
        operation: 'create-box',
        parentSegmentIds: [],
      },
    };

    const manifest = buildCurrentRecognitionBatchManifest({
      runId: 'test-run',
      pages: [{
        pageId: '11111111-1111-4111-8111-111111111111',
        pageKey: '011-19450424-L01-01',
        primarySourceRevision: 4,
        geometry: geometry([legacy, human]),
        raster: {
          sourcePath: '/tmp/source.jpg',
          sourceChecksumSha256: SHA,
          rasterPath: '/tmp/raster.png',
          rasterEncodedChecksumSha256: SHA,
          rasterChecksumSha256: SHA,
          width: 300,
          height: 400,
          normalization: {
            operation: 'exif-transpose-rgb-v1',
            applied: false,
            originalExifOrientation: null,
            exifReadError: false,
            original: { width: 300, height: 400, mode: 'RGB' },
            normalized: { width: 300, height: 400, mode: 'RGB' },
          },
        },
      }],
    });

    expect(manifest.pages[0].segments[0]).toMatchObject({
      id: 'legacy:0:1',
      textDirection: 'horizontal-lr',
      baseline: legacy.baseline,
    });
    expect(manifest.pages[0].segments[0]).not.toHaveProperty(
      'geometryType',
    );
    expect(manifest.pages[0].segments[0]).not.toHaveProperty('boundary');
    expect(manifest.pages[0].segments[1]).toMatchObject({
      id: 'human-hi',
      geometryType: 'bbox',
      textDirection: 'horizontal-lr',
    });
  });

  it('keeps explicit vertical direction and omits ignored geometry', () => {
    const vertical: LineSegment = {
      id: 'vertical',
      line: 1,
      geometryType: 'baseline',
      providerTextDirection: 'vertical-rl',
      baseline: [[50, 10], [52, 200]],
      bbox: [30, 10, 70, 200],
      boundary: [
        { x: 30, y: 10 },
        { x: 70, y: 10 },
        { x: 70, y: 200 },
        { x: 30, y: 200 },
      ],
      ocrText: '',
    };
    const ignored: LineSegment = {
      ...vertical,
      id: 'ignored',
      line: 2,
      segmentClass: 'ignore',
    };

    expect(recognitionDirection(vertical)).toBe('vertical-rl');
    const manifest = buildCurrentRecognitionBatchManifest({
      runId: 'test-run',
      pages: [{
        pageId: '11111111-1111-4111-8111-111111111111',
        primarySourceRevision: 1,
        geometry: geometry([vertical, ignored]),
        raster: {
          sourcePath: '/tmp/source.jpg',
          sourceChecksumSha256: SHA,
          rasterPath: '/tmp/raster.png',
          rasterEncodedChecksumSha256: SHA,
          rasterChecksumSha256: SHA,
          width: 300,
          height: 400,
          normalization: {
            operation: 'exif-transpose-rgb-v1',
            applied: false,
            originalExifOrientation: null,
            exifReadError: false,
            original: { width: 300, height: 400, mode: 'RGB' },
            normalized: { width: 300, height: 400, mode: 'RGB' },
          },
        },
      }],
    });

    expect(manifest.pages[0].segments).toHaveLength(1);
    expect(manifest.pages[0].segments[0]).toMatchObject({
      id: 'vertical',
      textDirection: 'vertical-rl',
    });
  });
});

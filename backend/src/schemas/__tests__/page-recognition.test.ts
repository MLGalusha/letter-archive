import { describe, expect, it } from 'vitest';
import {
  pageRecognitionArtifactChecksum,
  pageRecognitionArtifactSchema,
  segmentRecognitionGeometryChecksum,
} from '../page-recognition.js';

const sha = (value: string) => value.repeat(64).slice(0, 64);

describe('page recognition artifacts', () => {
  const evidence = {
    runId: 'schema-test-run',
    manifestChecksumSha256: sha('9'),
    inference: {
      accelerator: 'cpu',
      precision: '32-true',
      batchSize: 1,
      numLineWorkers: 0,
      numThreads: 1,
      padding: 16,
      segmentationType: 'baselines' as const,
    },
    raster: {
      encodedChecksumSha256: sha('7'),
      checksumAlgorithm: 'sha256-rgb8-v1' as const,
      checksumSha256: sha('8'),
      width: 1200,
      height: 1600,
    },
    normalization: {
      operation: 'exif-transpose-rgb-v1',
      applied: false,
      originalExifOrientation: null,
      exifReadError: false,
      original: {
        width: 1200,
        height: 1600,
        mode: 'RGB',
      },
      normalized: {
        width: 1200,
        height: 1600,
        mode: 'RGB' as const,
      },
    },
  };

  it('binds each reading to one exact stable segment geometry', () => {
    const artifact = pageRecognitionArtifactSchema.parse({
      schemaVersion: 2,
      kind: 'page-line-recognition',
      pageId: '40e6b19f-1982-4c5a-aa32-2b5990377629',
      source: {
        primarySourceRevision: 3,
        sourceChecksumSha256: sha('a'),
        geometryRevision: 5,
        geometryChecksumSha256: sha('b'),
        lineSegmentsChecksumSha256: sha('c'),
        alignmentSegmentInputChecksumSha256: sha('4'),
      },
      profile: {
        profileChecksumSha256: sha('d'),
        engine: 'kraken',
        engineVersion: '7.0.3',
        modelName: 'McCATMuS',
        modelChecksumSha256: sha('e'),
        configChecksumSha256: sha('f'),
      },
      evidence,
      state: 'completed',
      records: [{
        segmentId: 'legacy:0:1',
        segmentGeometryChecksumSha256: sha('1'),
        textDirection: 'horizontal-lr',
        text: 'Will try lo ancire your lellur',
        meanConfidence: 0.88,
        state: 'recognized',
        binding: {
          kind: 'exact-current-input',
          adapter: 'direct-baseline',
        },
      }, {
        segmentId: 'legacy:1:2',
        segmentGeometryChecksumSha256: sha('2'),
        textDirection: 'horizontal-lr',
        text: 'A second legacy line',
        meanConfidence: 0.74,
        state: 'recognized',
        binding: {
          kind: 'exact-current-input',
          adapter: 'legacy-baseline-bbox-boundary-v1',
        },
      }],
      createdAt: '2026-07-30T12:00:00.000Z',
    });

    expect(pageRecognitionArtifactChecksum(artifact)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects duplicate stable segment IDs', () => {
    const record = {
      segmentId: 'legacy:0:1',
      segmentGeometryChecksumSha256: sha('1'),
      textDirection: 'horizontal-lr',
      text: '',
      meanConfidence: null,
      state: 'attempted-empty',
      binding: {
        kind: 'exact-current-input',
        adapter: 'direct-baseline',
      },
    };
    const parsed = pageRecognitionArtifactSchema.safeParse({
      schemaVersion: 2,
      kind: 'page-line-recognition',
      pageId: '40e6b19f-1982-4c5a-aa32-2b5990377629',
      source: {
        primarySourceRevision: 3,
        sourceChecksumSha256: sha('a'),
        geometryRevision: 5,
        geometryChecksumSha256: sha('b'),
        lineSegmentsChecksumSha256: sha('c'),
        alignmentSegmentInputChecksumSha256: sha('4'),
      },
      profile: {
        profileChecksumSha256: sha('d'),
        engine: 'kraken',
        engineVersion: '7.0.3',
        modelName: 'McCATMuS',
        modelChecksumSha256: sha('e'),
        configChecksumSha256: sha('f'),
      },
      evidence,
      state: 'partial',
      records: [record, record],
      createdAt: '2026-07-30T12:00:00.000Z',
    });

    expect(parsed.success).toBe(false);
  });

  it('changes a segment checksum when its recognition crop changes', () => {
    const original = segmentRecognitionGeometryChecksum({
      id: 'legacy:0:1',
      geometryType: 'baseline',
      bbox: [10, 20, 110, 50],
      baseline: [[10, 45], [110, 45]],
      boundary: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 50 },
        { x: 10, y: 50 },
      ],
    });
    const moved = segmentRecognitionGeometryChecksum({
      id: 'legacy:0:1',
      geometryType: 'baseline',
      bbox: [10, 21, 110, 51],
      baseline: [[10, 46], [110, 46]],
      boundary: [
        { x: 10, y: 21 },
        { x: 110, y: 21 },
        { x: 110, y: 51 },
        { x: 10, y: 51 },
      ],
    });

    expect(moved).not.toBe(original);
  });

  it('changes a segment checksum when only recognition direction changes', () => {
    const horizontal = segmentRecognitionGeometryChecksum({
      id: 'directional',
      geometryType: 'baseline',
      providerTextDirection: 'horizontal-lr',
      bbox: [10, 20, 110, 50],
      baseline: [[10, 45], [110, 45]],
    });
    const vertical = segmentRecognitionGeometryChecksum({
      id: 'directional',
      geometryType: 'baseline',
      providerTextDirection: 'vertical-lr',
      bbox: [10, 20, 110, 50],
      baseline: [[10, 45], [110, 45]],
    });

    expect(vertical).not.toBe(horizontal);
  });
});

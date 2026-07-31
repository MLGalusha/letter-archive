import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
  normalizeLineSegments,
} from '../../schemas/page-geometry.js';
import {
  pageRecognitionArtifactChecksum,
  segmentRecognitionGeometryChecksum,
  type PageRecognitionArtifact,
} from '../../schemas/page-recognition.js';
import { createPageRecognitionArtifactRepository } from '../page-recognition-artifacts.js';
import {
  alignmentSegmentInputChecksum,
} from '../transcript-alignment/alignment-input-identity.js';
import {
  CURRENT_TRANSCRIPT_RECOGNITION_INFERENCE,
  CURRENT_TRANSCRIPT_RECOGNITION_PROFILE,
} from '../transcript-alignment/recognition-profile.js';

const sha = (character: string) => character.repeat(64);
const pageId = '61000000-0000-4000-8000-000000000001';
const letterId = '61000000-0000-4000-8000-000000000002';
const persistedAt = new Date('2026-07-30T12:01:00.000Z');

const lineSegments = normalizeLineSegments([{
  id: 'legacy:0:1',
  line: 1,
  geometryType: 'baseline',
  baseline: [[10, 45], [110, 45]],
  bbox: [10, 20, 110, 50],
  boundary: [
    { x: 10, y: 20 },
    { x: 110, y: 20 },
    { x: 110, y: 50 },
    { x: 10, y: 50 },
  ],
  ocrText: '',
}]);

const artifact: PageRecognitionArtifact = {
  schemaVersion: 2,
  kind: 'page-line-recognition',
  pageId,
  source: {
    primarySourceRevision: 3,
    sourceChecksumSha256: sha('a'),
    geometryRevision: 5,
    geometryChecksumSha256: pageGeometryChecksum(lineSegments),
    lineSegmentsChecksumSha256: pageLineSegmentsChecksum(lineSegments),
    alignmentSegmentInputChecksumSha256:
      alignmentSegmentInputChecksum(lineSegments),
  },
  profile: CURRENT_TRANSCRIPT_RECOGNITION_PROFILE,
  evidence: {
    runId: 'repository-test-run',
    manifestChecksumSha256: sha('9'),
    inference: CURRENT_TRANSCRIPT_RECOGNITION_INFERENCE,
    raster: {
      encodedChecksumSha256: sha('7'),
      checksumAlgorithm: 'sha256-rgb8-v1',
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
        mode: 'RGB',
      },
    },
  },
  state: 'completed',
  records: [{
    segmentId: 'legacy:0:1',
    segmentGeometryChecksumSha256:
      segmentRecognitionGeometryChecksum(lineSegments[0]),
    textDirection: 'horizontal-lr',
    text: 'Will try lo ancire your lellur',
    meanConfidence: 0.88,
    state: 'recognized',
    binding: {
      kind: 'exact-current-input',
      adapter: 'direct-baseline',
    },
  }],
  createdAt: '2026-07-30T12:00:00.000Z',
};

type StoredRow = {
  id: string;
  artifactChecksumSha256: string;
  artifact: PageRecognitionArtifact;
  persistedAt: Date;
};

function createHarness() {
  const rows: StoredRow[] = [];
  const insertedValues: Array<Record<string, unknown>> = [];
  const page = {
    letterId,
    checksumSha256: artifact.source.sourceChecksumSha256,
    geometryRevision: artifact.source.geometryRevision,
    geometryChecksumSha256: artifact.source.geometryChecksumSha256,
    lineSegments,
  };
  const tx = {
    query: {
      letterPages: {
        findFirst: vi.fn(({ columns }: {
          columns: Record<string, boolean>;
        }) => columns.letterId
          ? { letterId: page.letterId }
          : {
            checksumSha256: page.checksumSha256,
            geometryRevision: page.geometryRevision,
            geometryChecksumSha256: page.geometryChecksumSha256,
            lineSegments: page.lineSegments,
          }),
      },
      pageRecognitionArtifacts: {
        findFirst: vi.fn(() => rows[0]),
      },
    },
    select: vi.fn((selection: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn(() => (
            'checksumSha256' in selection
              ? [{
                checksumSha256: page.checksumSha256,
                geometryRevision: page.geometryRevision,
                geometryChecksumSha256: page.geometryChecksumSha256,
                lineSegments: page.lineSegments,
              }]
              : [{
                id: letterId,
                primarySourceRevision:
                  artifact.source.primarySourceRevision,
              }]
          )),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => {
            insertedValues.push(values);
            const checksum = values.artifactChecksumSha256 as string;
            if (rows.some((row) => (
              row.artifactChecksumSha256 === checksum
            ))) return [];
            const row = {
              id: `artifact-${rows.length + 1}`,
              artifactChecksumSha256: checksum,
              artifact: values.artifact as PageRecognitionArtifact,
              persistedAt,
            };
            rows.unshift(row);
            return [row];
          }),
        })),
      })),
    })),
  };
  const database = {
    transaction: vi.fn(async (
      operation: (executor: typeof tx) => Promise<unknown>,
    ) => {
      const priorRows = structuredClone(rows);
      try {
        return await operation(tx);
      } catch (error) {
        rows.splice(0, rows.length, ...priorRows);
        throw error;
      }
    }),
    query: {
      pageRecognitionArtifacts: {
        findMany: vi.fn(() => rows),
      },
    },
  };

  return {
    page,
    rows,
    insertedValues,
    tx,
    database,
    repository: createPageRecognitionArtifactRepository(database as never),
  };
}

describe('page recognition artifact repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a validated canonical artifact without flattening record evidence', async () => {
    const harness = createHarness();
    const result = await harness.repository.insert(artifact);

    expect(result).toMatchObject({
      kind: 'inserted',
      value: {
        artifactChecksumSha256: pageRecognitionArtifactChecksum(artifact),
        artifact,
      },
    });
    expect(harness.insertedValues).toHaveLength(1);
    expect(harness.insertedValues[0]).toMatchObject({
      pageId,
      geometryChecksumSha256: artifact.source.geometryChecksumSha256,
      lineSegmentsChecksumSha256:
        artifact.source.lineSegmentsChecksumSha256,
      artifact: {
        records: [{
          segmentGeometryChecksumSha256:
            artifact.records[0].segmentGeometryChecksumSha256,
        }],
      },
    });
  });

  it('is idempotent for an exact artifact checksum while remaining append-only', async () => {
    const harness = createHarness();

    await expect(harness.repository.insert(artifact))
      .resolves.toMatchObject({ kind: 'inserted' });
    await expect(harness.repository.insert(artifact))
      .resolves.toMatchObject({ kind: 'existing' });
    expect(harness.rows).toHaveLength(1);
  });

  it('rolls back the entire batch when any page identity is stale', async () => {
    const harness = createHarness();
    const changed = structuredClone(artifact);
    changed.createdAt = '2026-07-30T12:00:01.000Z';
    changed.source.geometryRevision += 1;

    await expect(harness.repository.insertBatch([
      artifact,
      changed,
    ])).rejects.toThrow(/changed during recognition import/);
    expect(harness.rows).toHaveLength(0);
  });

  it('rejects stale projection identity before persistence', async () => {
    const harness = createHarness();
    const stale = structuredClone(artifact);
    stale.source.lineSegmentsChecksumSha256 = sha('9');

    await expect(harness.repository.insert(stale)).resolves.toEqual({
      kind: 'source-mismatch',
      reason: 'line-segments-checksum',
    });
    expect(harness.insertedValues).toHaveLength(0);
  });

  it('rejects a recognition record whose exact geometry checksum is stale', async () => {
    const harness = createHarness();
    const stale = structuredClone(artifact);
    stale.records[0].segmentGeometryChecksumSha256 = sha('9');

    await expect(harness.repository.insert(stale)).rejects.toThrow(
      /record geometry checksum is stale/,
    );
    expect(harness.insertedValues).toHaveLength(0);
  });

  it('rejects an artifact whose alignment input digest is not reproducible', async () => {
    const harness = createHarness();
    const stale = structuredClone(artifact);
    stale.source.alignmentSegmentInputChecksumSha256 = sha('1');

    await expect(harness.repository.insert(stale)).rejects.toThrow(
      /alignment input checksum is stale/,
    );
    expect(harness.insertedValues).toHaveLength(0);
  });

  it('rejects inference evidence that does not reproduce the profile', async () => {
    const harness = createHarness();
    const stale = structuredClone(artifact);
    stale.evidence.inference.padding += 1;

    await expect(harness.repository.insert(stale)).rejects.toThrow(
      /config checksum does not match inference/,
    );
    expect(harness.insertedValues).toHaveLength(0);
  });

  it('rejects a recognition record after only its text direction changes', async () => {
    const harness = createHarness();
    const stale = structuredClone(artifact);
    stale.records[0].textDirection = 'vertical-lr';

    await expect(harness.repository.insert(stale)).rejects.toThrow(
      /text direction is stale/,
    );
    expect(harness.insertedValues).toHaveLength(0);
  });

  it('loads only the requested exact source/profile rows and revalidates integrity', async () => {
    const harness = createHarness();
    await harness.repository.insert(artifact);

    await expect(harness.repository.loadCurrentProfile({
      pageId,
      ...artifact.source,
      profileChecksumSha256: artifact.profile.profileChecksumSha256,
    })).resolves.toMatchObject([{
      artifactChecksumSha256: pageRecognitionArtifactChecksum(artifact),
      artifact,
    }]);
    expect(
      harness.database.query.pageRecognitionArtifacts.findMany,
    ).toHaveBeenCalledOnce();

    harness.rows[0].artifactChecksumSha256 = sha('0');
    await expect(harness.repository.loadCurrentProfile({
      pageId,
      ...artifact.source,
      profileChecksumSha256: artifact.profile.profileChecksumSha256,
    })).rejects.toThrow(/Stored recognition artifact checksum mismatch/);
  });

  it('loads compatible prior projections by immutable page source and profile', async () => {
    const harness = createHarness();
    await harness.repository.insert(artifact);

    await expect(harness.repository.loadCompatibleProfile({
      pageId,
      primarySourceRevision: artifact.source.primarySourceRevision,
      sourceChecksumSha256: artifact.source.sourceChecksumSha256,
      profileChecksumSha256: artifact.profile.profileChecksumSha256,
    })).resolves.toMatchObject([{
      artifactChecksumSha256: pageRecognitionArtifactChecksum(artifact),
      artifact,
    }]);
    expect(
      harness.database.query.pageRecognitionArtifacts.findMany,
    ).toHaveBeenCalledOnce();
  });
});

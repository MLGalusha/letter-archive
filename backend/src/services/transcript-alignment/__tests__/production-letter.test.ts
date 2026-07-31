import { describe, expect, it, vi } from 'vitest';
import type { db as databaseType } from '../../../db/index.js';
import {
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
} from '../../../schemas/page-geometry.js';
import {
  segmentRecognitionGeometryChecksum,
  type PageRecognitionArtifact,
} from '../../../schemas/page-recognition.js';
import type { LineSegment } from '../../../schemas/line-segment.js';
import type {
  StoredPageRecognitionArtifact,
} from '../../page-recognition-artifacts.js';
import { alignmentSegmentInputChecksum } from '../production-adapter.js';
import {
  createProductionTranscriptAlignmentReader,
  ProductionAlignmentGeometryConflictError,
} from '../production-letter.js';
import {
  CURRENT_TRANSCRIPT_RECOGNITION_INFERENCE,
  CURRENT_TRANSCRIPT_RECOGNITION_PROFILE,
} from '../recognition-profile.js';
import { transcriptDigest } from '../../letter/metadata-input-identity.js';

const LETTER_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_SHA256 = 'a'.repeat(64);
const CURRENT_ARTIFACT_SHA256 = 'b'.repeat(64);
const OLDER_ARTIFACT_SHA256 = 'c'.repeat(64);

function segment(): LineSegment {
  return {
    id: 'machine-line-1',
    line: 1,
    geometryType: 'baseline',
    bbox: [10, 20, 500, 60],
    baseline: [[10, 55], [500, 55]],
    boundary: [
      { x: 10, y: 20 },
      { x: 500, y: 20 },
      { x: 500, y: 60 },
      { x: 10, y: 60 },
    ],
    ocrText: '',
    geometryProvenance: {
      source: 'machine',
      operation: 'detected',
      parentSegmentIds: [],
    },
  };
}

function page(
  lineSegments: LineSegment[],
  geometryRevision = 4,
) {
  return {
    id: PAGE_ID,
    pageNumber: 1,
    checksumSha256: SOURCE_SHA256,
    lineSegments,
    geometryRevision,
    geometryChecksumSha256: pageGeometryChecksum(lineSegments),
    segmentTrustState: 'unverified',
    approvedGeometryRevision: null,
    approvedGeometryChecksumSha256: null,
    geometryApprovedBy: null,
    geometryApprovedAt: null,
  };
}

function humanBox(): LineSegment {
  return {
    id: 'human-hi',
    line: 99,
    geometryType: 'bbox',
    bbox: [10, 2, 90, 18],
    bboxSource: 'human-drawn-bbox',
    ocrText: '',
    geometryProvenance: {
      source: 'human-created',
      operation: 'create-box',
      parentSegmentIds: [],
    },
  };
}

function storedArtifact(input: {
  artifactChecksumSha256: string;
  text: string;
  lineSegments: LineSegment[];
}): StoredPageRecognitionArtifact {
  const geometryChecksumSha256 =
    pageGeometryChecksum(input.lineSegments);
  const artifact: PageRecognitionArtifact = {
    schemaVersion: 2,
    kind: 'page-line-recognition',
    pageId: PAGE_ID,
    source: {
      primarySourceRevision: 3,
      sourceChecksumSha256: SOURCE_SHA256,
      geometryRevision: 4,
      geometryChecksumSha256,
      lineSegmentsChecksumSha256:
        pageLineSegmentsChecksum(input.lineSegments),
      alignmentSegmentInputChecksumSha256:
        alignmentSegmentInputChecksum(input.lineSegments),
    },
    profile: CURRENT_TRANSCRIPT_RECOGNITION_PROFILE,
    evidence: {
      runId: 'production-letter-test',
      manifestChecksumSha256: 'd'.repeat(64),
      inference: CURRENT_TRANSCRIPT_RECOGNITION_INFERENCE,
      raster: {
        encodedChecksumSha256: 'e'.repeat(64),
        checksumAlgorithm: 'sha256-rgb8-v1',
        checksumSha256: 'f'.repeat(64),
        width: 1000,
        height: 1400,
      },
      normalization: {
        operation: 'exif-transpose-rgb-v1',
        applied: false,
        originalExifOrientation: null,
        exifReadError: false,
        original: {
          width: 1000,
          height: 1400,
          mode: 'RGB',
        },
        normalized: {
          width: 1000,
          height: 1400,
          mode: 'RGB',
        },
      },
    },
    state: 'completed',
    records: [{
      segmentId: input.lineSegments[0].id!,
      segmentGeometryChecksumSha256:
        segmentRecognitionGeometryChecksum(input.lineSegments[0]),
      textDirection: 'horizontal-lr',
      text: input.text,
      meanConfidence: 0.9,
      state: 'recognized',
      binding: {
        kind: 'exact-current-input',
        adapter: 'direct-baseline',
      },
    }],
    createdAt: '2026-07-30T12:00:00.000Z',
  };
  return {
    id: `${input.artifactChecksumSha256.slice(0, 8)}-0000-4000-8000-000000000000`,
    artifactChecksumSha256: input.artifactChecksumSha256,
    artifact,
    persistedAt: new Date(artifact.createdAt),
  };
}

function readerFixture(input?: {
  artifacts?: StoredPageRecognitionArtifact[];
  letterResult?: ReturnType<typeof letter> | null;
  letterResults?: Array<ReturnType<typeof letter> | null>;
}) {
  const letterResult = input && 'letterResult' in input
    ? input.letterResult
    : letter();
  let readIndex = 0;
  const findFirst = vi.fn(async () => {
    if (!input?.letterResults) return letterResult;
    const result = input.letterResults[
      Math.min(readIndex, input.letterResults.length - 1)
    ];
    readIndex += 1;
    return result;
  });
  const loadRecognitionArtifacts = vi.fn(async () => input?.artifacts ?? []);
  const database = {
    query: { letters: { findFirst } },
  } as unknown as typeof databaseType;
  const read = createProductionTranscriptAlignmentReader({
    database,
    loadRecognitionArtifacts,
  });
  return { findFirst, loadRecognitionArtifacts, read };
}

function letter() {
  const transcriptionText = 'Will try to answer your letter';
  return {
    id: LETTER_ID,
    primarySourceRevision: 3,
    transcriptRevision: 8,
    transcriptChecksumSha256: transcriptDigest(transcriptionText),
    transcriptionText,
    pages: [page([segment()])],
  };
}

describe('production transcript alignment letter read model', () => {
  it('returns null for an unknown letter', async () => {
    const { loadRecognitionArtifacts, read } = readerFixture({
      letterResult: null,
    });

    await expect(read(LETTER_ID)).resolves.toBeNull();
    expect(loadRecognitionArtifacts).not.toHaveBeenCalled();
  });

  it('uses the newest exact current-profile artifact', async () => {
    const lineSegments = [segment()];
    const current = storedArtifact({
      artifactChecksumSha256: CURRENT_ARTIFACT_SHA256,
      text: 'Will try to answer your letter',
      lineSegments,
    });
    const older = storedArtifact({
      artifactChecksumSha256: OLDER_ARTIFACT_SHA256,
      text: 'unrelated stale reading',
      lineSegments,
    });
    const { loadRecognitionArtifacts, read } = readerFixture({
      artifacts: [current, older],
    });

    const result = await read(LETTER_ID);

    expect(result?.pages[0]).toMatchObject({
      status: 'ready',
      recognition: {
        status: 'ready',
        exactArtifactChecksumSha256: CURRENT_ARTIFACT_SHA256,
        sourceArtifactChecksumsSha256: [
          CURRENT_ARTIFACT_SHA256,
        ],
        evidenceChecksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      mappings: [{
        transcriptText: 'Will try to answer your letter',
        segmentIds: ['machine-line-1'],
        evidence: 'content',
      }],
    });
    expect(loadRecognitionArtifacts).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      primarySourceRevision: 3,
      sourceChecksumSha256: SOURCE_SHA256,
      profileChecksumSha256:
        CURRENT_TRANSCRIPT_RECOGNITION_PROFILE.profileChecksumSha256,
    });
  });

  it('reports recognition-missing instead of positional alignment', async () => {
    const { read } = readerFixture();

    const result = await read(LETTER_ID);

    expect(result?.pages[0]).toMatchObject({
      status: 'recognition-missing',
      statusMessage: 'Run local line recognition for this page',
      recognition: {
        status: 'missing',
        exactArtifactChecksumSha256: null,
        sourceArtifactChecksumsSha256: [],
        evidenceChecksumSha256: null,
      },
      mappings: [{
        transcriptText: 'Will try to answer your letter',
        segmentIds: [],
        status: 'unlocated',
      }],
    });
  });

  it('reuses unchanged machine recognition after a human box is added', async () => {
    const oldMachine = segment();
    const oldArtifact = storedArtifact({
      artifactChecksumSha256: OLDER_ARTIFACT_SHA256,
      text: 'Will try to answer your letter',
      lineSegments: [oldMachine],
    });
    const transcriptionText = 'Hi.\nWill try to answer your letter';
    const currentLetter = {
      ...letter(),
      transcriptionText,
      transcriptRevision: 9,
      transcriptChecksumSha256: transcriptDigest(transcriptionText),
      pages: [page([humanBox(), oldMachine], 5)],
    };
    const { read } = readerFixture({
      artifacts: [oldArtifact],
      letterResult: currentLetter,
    });

    const result = await read(LETTER_ID);

    expect(result?.pages[0]).toMatchObject({
      status: 'ready',
      recognition: {
        status: 'ready',
        exactArtifactChecksumSha256: null,
        sourceArtifactChecksumsSha256: [OLDER_ARTIFACT_SHA256],
        evidenceChecksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        validRecordCount: 1,
      },
      mappings: [
        {
          transcriptText: 'Hi.',
          segmentIds: ['human-hi'],
          evidence: 'geometry-only',
        },
        {
          transcriptText: 'Will try to answer your letter',
          segmentIds: ['machine-line-1'],
          evidence: 'content',
        },
      ],
    });
  });

  it('does not reuse recognition after the machine segment shape changes', async () => {
    const oldMachine = segment();
    const oldArtifact = storedArtifact({
      artifactChecksumSha256: OLDER_ARTIFACT_SHA256,
      text: 'Will try to answer your letter',
      lineSegments: [oldMachine],
    });
    const resizedMachine: LineSegment = {
      ...oldMachine,
      bbox: [10, 20, 600, 60],
      baseline: [[10, 55], [600, 55]],
      boundary: [
        { x: 10, y: 20 },
        { x: 600, y: 20 },
        { x: 600, y: 60 },
        { x: 10, y: 60 },
      ],
      geometryProvenance: {
        source: 'human-adjusted',
        operation: 'resize',
        parentSegmentIds: ['machine-line-1'],
      },
    };
    const currentLetter = {
      ...letter(),
      pages: [page([resizedMachine], 5)],
    };
    const { read } = readerFixture({
      artifacts: [oldArtifact],
      letterResult: currentLetter,
    });

    const result = await read(LETTER_ID);

    expect(result?.pages[0]).toMatchObject({
      status: 'recognition-missing',
      recognition: {
        status: 'missing',
        exactArtifactChecksumSha256: null,
        sourceArtifactChecksumsSha256: [],
        evidenceChecksumSha256: null,
        validRecordCount: 0,
      },
      mappings: [{
        transcriptText: 'Will try to answer your letter',
        segmentIds: [],
        status: 'unlocated',
      }],
    });
  });

  it('rejects a transcript whose stored identity does not match its bytes', async () => {
    const staleIdentity = {
      ...letter(),
      transcriptChecksumSha256: 'f'.repeat(64),
    };
    const { loadRecognitionArtifacts, read } = readerFixture({
      letterResult: staleIdentity,
    });

    await expect(read(LETTER_ID)).rejects.toThrow(
      `Stored transcript checksum mismatch for letter ${LETTER_ID}`,
    );
    expect(loadRecognitionArtifacts).not.toHaveBeenCalled();
  });

  it('retries the complete alignment when page geometry changes mid-read', async () => {
    const revisionFour = letter();
    const revisionFive = {
      ...letter(),
      pages: [page([segment()], 5)],
    };
    const { findFirst, read } = readerFixture({
      letterResults: [
        revisionFour,
        revisionFive,
        revisionFive,
        revisionFive,
      ],
    });

    const result = await read(LETTER_ID);

    expect(result?.pages[0].geometry.geometryRevision).toBe(5);
    expect(findFirst).toHaveBeenCalledTimes(4);
  });

  it('returns an explicit conflict instead of publishing repeatedly raced geometry', async () => {
    const revisionFour = letter();
    const revisionFive = {
      ...letter(),
      pages: [page([segment()], 5)],
    };
    const revisionSix = {
      ...letter(),
      pages: [page([segment()], 6)],
    };
    const { read } = readerFixture({
      letterResults: [
        revisionFour,
        revisionFive,
        revisionFive,
        revisionSix,
      ],
    });

    const promise = read(LETTER_ID);
    await expect(promise).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAGE_GEOMETRY_CHANGED',
    });
    await expect(promise).rejects.toBeInstanceOf(
      ProductionAlignmentGeometryConflictError,
    );
  });
});

import { eq } from 'drizzle-orm';
import { db, letters } from '../../db/index.js';
import {
  productionTranscriptAlignmentEnvelopeSchema,
  type ProductionTranscriptAlignmentEnvelope,
} from '../../schemas/production-transcript-alignment.js';
import { normalizeLineSegments } from '../../schemas/page-geometry.js';
import {
  segmentRecognitionGeometryChecksum,
  type PageRecognitionRecord,
} from '../../schemas/page-recognition.js';
import type { LineSegment } from '../../schemas/line-segment.js';
import { transcriptDigest } from '../letter/metadata-input-identity.js';
import { pageGeometryEnvelopeFromRow } from '../line-segments.js';
import {
  loadCompatibleProfilePageRecognitionArtifacts,
  type StoredPageRecognitionArtifact,
} from '../page-recognition-artifacts.js';
import { canonicalJsonChecksum } from '../page-layout-checksum.js';
import { alignmentSegmentInputChecksum } from './production-adapter.js';
import { buildProductionAlignmentPage } from './production-page.js';
import {
  CURRENT_TRANSCRIPT_RECOGNITION_PROFILE,
  TRANSCRIPT_ALIGNMENT_ALGORITHM,
} from './recognition-profile.js';
import {
  parseTranscriptPages,
  type TranscriptPageSlice,
} from './transcript-pages.js';
import { AppError } from '../../utils/response-helpers.js';

interface CompatibleRecognitionSelection {
  records: PageRecognitionRecord[];
  exactArtifactChecksumSha256: string | null;
  sourceArtifactChecksumsSha256: string[];
  evidenceChecksumSha256: string | null;
}

interface CurrentRecognitionProjection {
  geometryRevision: number;
  geometryChecksumSha256: string;
  lineSegmentsChecksumSha256: string;
  alignmentSegmentInputChecksumSha256: string;
}

/**
 * Reuses recognition at segment granularity. Stable ID alone is insufficient:
 * an old reading survives only while the exact current segment shape has the
 * same geometry checksum. Artifacts are newest-first, so the first valid
 * record for a segment wins.
 */
export function selectCompatibleRecognitionEvidence(input: {
  artifacts: readonly StoredPageRecognitionArtifact[];
  lineSegments: readonly LineSegment[];
  currentProjection: CurrentRecognitionProjection;
}): CompatibleRecognitionSelection {
  const segments = normalizeLineSegments(input.lineSegments);
  const currentGeometryById = new Map(segments.map((segment) => [
    segment.id!,
    segmentRecognitionGeometryChecksum(segment),
  ]));
  const selectedBySegmentId = new Map<string, {
    artifactChecksumSha256: string;
    record: PageRecognitionRecord;
  }>();
  const sourceArtifactChecksumsSha256: string[] = [];

  for (const artifact of input.artifacts) {
    let contributed = false;
    for (const record of artifact.artifact.records) {
      if (selectedBySegmentId.has(record.segmentId)) continue;
      if (
        currentGeometryById.get(record.segmentId)
        !== record.segmentGeometryChecksumSha256
      ) continue;
      selectedBySegmentId.set(record.segmentId, {
        artifactChecksumSha256: artifact.artifactChecksumSha256,
        record,
      });
      contributed = true;
    }
    if (contributed) {
      sourceArtifactChecksumsSha256.push(
        artifact.artifactChecksumSha256,
      );
    }
  }

  const selected = segments.flatMap((segment) => {
    const evidence = selectedBySegmentId.get(segment.id!);
    return evidence ? [evidence] : [];
  });
  const exactArtifact = input.artifacts.find(({ artifact }) => (
    artifact.source.geometryRevision
      === input.currentProjection.geometryRevision
    && artifact.source.geometryChecksumSha256
      === input.currentProjection.geometryChecksumSha256
    && artifact.source.lineSegmentsChecksumSha256
      === input.currentProjection.lineSegmentsChecksumSha256
    && artifact.source.alignmentSegmentInputChecksumSha256
      === input.currentProjection.alignmentSegmentInputChecksumSha256
  ));
  const evidenceChecksumSha256 = selected.length > 0
    ? canonicalJsonChecksum({
      schemaVersion: 1,
      kind: 'production-compatible-recognition-evidence',
      sourceArtifactChecksumsSha256,
      records: selected.map((evidence) => ({
        sourceArtifactChecksumSha256:
          evidence.artifactChecksumSha256,
        record: evidence.record,
      })),
    })
    : null;

  return {
    records: selected.map(({ record }) => record),
    exactArtifactChecksumSha256:
      exactArtifact?.artifactChecksumSha256 ?? null,
    sourceArtifactChecksumsSha256,
    evidenceChecksumSha256,
  };
}

interface ProductionTranscriptAlignmentReaderDependencies {
  database: typeof db;
  loadRecognitionArtifacts:
    typeof loadCompatibleProfilePageRecognitionArtifacts;
}

const MAX_ALIGNMENT_READ_ATTEMPTS = 2;

export class ProductionAlignmentGeometryConflictError extends AppError {
  constructor(letterId: string) {
    super(
      409,
      'Page geometry changed while transcript placement was loading',
      { letterId },
      'PAGE_GEOMETRY_CHANGED',
    );
  }
}

interface ProductionAlignmentReadAttempt {
  envelope: ProductionTranscriptAlignmentEnvelope;
  sourceFenceChecksumSha256: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The transcript could not be divided into its current pages';
}

/**
 * Builds the read model consumed by the production transcript overlay.
 *
 * This performs no OCR and writes nothing. It joins only revision-bound
 * geometry, recognition, and transcript inputs so a client can never silently
 * fall back to positional matching.
 */
export function createProductionTranscriptAlignmentReader(
  dependencies: ProductionTranscriptAlignmentReaderDependencies = {
    database: db,
    loadRecognitionArtifacts:
      loadCompatibleProfilePageRecognitionArtifacts,
  },
) {
  const loadLetter = (letterId: string) => (
    dependencies.database.query.letters.findFirst({
      where: eq(letters.id, letterId),
      columns: {
        id: true,
        primarySourceRevision: true,
        transcriptRevision: true,
        transcriptChecksumSha256: true,
        transcriptionText: true,
      },
      with: {
        pages: {
          orderBy: (pages, { asc }) => [asc(pages.pageNumber)],
          columns: {
            id: true,
            pageNumber: true,
            checksumSha256: true,
            lineSegments: true,
            geometryRevision: true,
            geometryChecksumSha256: true,
            segmentTrustState: true,
            approvedGeometryRevision: true,
            approvedGeometryChecksumSha256: true,
            geometryApprovedBy: true,
            geometryApprovedAt: true,
          },
        },
      },
    })
  );

  type LoadedLetter = NonNullable<
    Awaited<ReturnType<typeof loadLetter>>
  >;

  const sourceFenceChecksum = (letter: LoadedLetter): string => (
    canonicalJsonChecksum({
      schemaVersion: 1,
      kind: 'production-transcript-alignment-source-fence',
      letterId: letter.id,
      primarySourceRevision: letter.primarySourceRevision,
      transcriptRevision: letter.transcriptRevision,
      transcriptChecksumSha256: letter.transcriptChecksumSha256,
      pages: [...letter.pages]
        .sort((left, right) => left.pageNumber - right.pageNumber)
        .map((page) => ({
          pageId: page.id,
          pageNumber: page.pageNumber,
          sourceChecksumSha256: page.checksumSha256,
          geometry: pageGeometryEnvelopeFromRow(page),
        })),
    })
  );

  const readAttempt = async (
    letterId: string,
  ): Promise<ProductionAlignmentReadAttempt | null> => {
    const letter = await loadLetter(letterId);
    if (!letter) return null;
    const sourceFenceChecksumSha256 = sourceFenceChecksum(letter);

    const transcript = letter.transcriptionText ?? '';
    const actualTranscriptChecksumSha256 = transcriptDigest(transcript);
    if (
      actualTranscriptChecksumSha256
      !== letter.transcriptChecksumSha256
    ) {
      throw new Error(
        `Stored transcript checksum mismatch for letter ${letter.id}`,
      );
    }

    const pages = [...letter.pages].sort(
      (left, right) => left.pageNumber - right.pageNumber,
    );
    const expectedPageNumbers = pages.map(({ pageNumber }) => pageNumber);
    let transcriptPagesByNumber = new Map<number, TranscriptPageSlice>();
    let transcriptPageError: string | undefined;
    try {
      transcriptPagesByNumber = new Map(
        parseTranscriptPages({
          allowUnmarkedSinglePage: pages.length === 1,
          expectedPageNumbers,
          letterKey: letter.id,
          transcript,
        }).map((page) => [page.pageNumber, page]),
      );
    } catch (error) {
      transcriptPageError = errorMessage(error);
    }

    const alignedPages = await Promise.all(pages.map(async (page) => {
      const geometry = pageGeometryEnvelopeFromRow(page);
      const alignmentSegmentInputChecksumSha256 =
        alignmentSegmentInputChecksum(geometry.lineSegments);
      let recognitionEvidence: CompatibleRecognitionSelection = {
        records: [],
        exactArtifactChecksumSha256: null,
        sourceArtifactChecksumsSha256: [],
        evidenceChecksumSha256: null,
      };

      if (page.checksumSha256) {
        const artifacts = await dependencies.loadRecognitionArtifacts({
          pageId: page.id,
          primarySourceRevision: letter.primarySourceRevision,
          sourceChecksumSha256: page.checksumSha256,
          profileChecksumSha256:
            CURRENT_TRANSCRIPT_RECOGNITION_PROFILE.profileChecksumSha256,
        });
        recognitionEvidence = selectCompatibleRecognitionEvidence({
          artifacts,
          lineSegments: geometry.lineSegments,
          currentProjection: {
            geometryRevision: geometry.geometryRevision,
            geometryChecksumSha256: geometry.geometryChecksumSha256,
            lineSegmentsChecksumSha256:
              geometry.lineSegmentsChecksumSha256,
            alignmentSegmentInputChecksumSha256,
          },
        });
      }

      return buildProductionAlignmentPage({
        pageId: page.id,
        pageNumber: page.pageNumber,
        sourceChecksumSha256: page.checksumSha256,
        primarySourceRevision: letter.primarySourceRevision,
        transcriptRevision: letter.transcriptRevision,
        transcriptChecksumSha256: letter.transcriptChecksumSha256,
        geometry,
        transcriptPage:
          transcriptPagesByNumber.get(page.pageNumber) ?? null,
        transcriptPageError,
        recognitionRecords: recognitionEvidence.records,
        recognitionExactArtifactChecksumSha256:
          recognitionEvidence.exactArtifactChecksumSha256,
        recognitionSourceArtifactChecksumsSha256:
          recognitionEvidence.sourceArtifactChecksumsSha256,
        recognitionEvidenceChecksumSha256:
          recognitionEvidence.evidenceChecksumSha256,
      });
    }));

    return {
      envelope: productionTranscriptAlignmentEnvelopeSchema.parse({
        schemaVersion: 1,
        algorithm: TRANSCRIPT_ALIGNMENT_ALGORITHM,
        source: {
          letterId: letter.id,
          primarySourceRevision: letter.primarySourceRevision,
          transcriptRevision: letter.transcriptRevision,
          transcriptChecksumSha256: letter.transcriptChecksumSha256,
        },
        pages: alignedPages,
      }),
      sourceFenceChecksumSha256,
    };
  };

  return async function readProductionTranscriptAlignment(
    letterId: string,
  ): Promise<ProductionTranscriptAlignmentEnvelope | null> {
    for (
      let attemptNumber = 0;
      attemptNumber < MAX_ALIGNMENT_READ_ATTEMPTS;
      attemptNumber += 1
    ) {
      const attempt = await readAttempt(letterId);
      if (!attempt) return null;

      // Recognition lookup and alignment can yield to a concurrent geometry
      // save. Re-read the complete source projection immediately before
      // publication and only return the response if it is still bound to the
      // same page revisions, checksums, source bytes, and review state.
      const currentLetter = await loadLetter(letterId);
      if (!currentLetter) return null;
      if (
        sourceFenceChecksum(currentLetter)
        === attempt.sourceFenceChecksumSha256
      ) {
        return attempt.envelope;
      }
    }

    throw new ProductionAlignmentGeometryConflictError(letterId);
  };
}

export const getProductionTranscriptAlignment =
  createProductionTranscriptAlignmentReader();

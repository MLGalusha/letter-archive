import type { PageGeometryEnvelope } from '../../schemas/page-geometry.js';
import type { PageRecognitionRecord } from '../../schemas/page-recognition.js';
import {
  productionAlignmentPageSchema,
  type ProductionAlignmentPage,
} from '../../schemas/production-transcript-alignment.js';
import { canonicalJsonChecksum } from '../page-layout-checksum.js';
import {
  alignTranscriptToRecognizedSegments,
} from './aligner.js';
import {
  adaptPageSegmentsForAlignment,
  alignmentSegmentInputChecksum,
} from './production-adapter.js';
import {
  CURRENT_TRANSCRIPT_RECOGNITION_PROFILE,
  TRANSCRIPT_ALIGNMENT_ALGORITHM,
} from './recognition-profile.js';
import type { TranscriptPageSlice } from './transcript-pages.js';

interface ProductionPageInput {
  pageId: string;
  pageNumber: number;
  sourceChecksumSha256: string | null;
  primarySourceRevision: number;
  transcriptRevision: number;
  transcriptChecksumSha256: string;
  geometry: PageGeometryEnvelope;
  transcriptPage: TranscriptPageSlice | null;
  transcriptPageError?: string;
  recognitionRecords: readonly PageRecognitionRecord[];
  recognitionExactArtifactChecksumSha256: string | null;
  recognitionSourceArtifactChecksumsSha256: readonly string[];
  recognitionEvidenceChecksumSha256: string | null;
}

function unlocatedMappings(
  transcriptLines: ProductionAlignmentPage['transcriptLines'],
): ProductionAlignmentPage['mappings'] {
  return transcriptLines.map((line) => ({
    id: `${line.id}:mapping`,
    transcriptId: line.id,
    transcriptLineIndex: line.transcriptLineIndex,
    sourceLineNumber: line.sourceLineNumber,
    transcriptText: line.text,
    segmentIds: [],
    operation: 'unlocated-transcript',
    similarity: 0,
    confidence: 0,
    status: 'unlocated',
    evidence: 'unlocated',
    alternatives: [],
  }));
}

export function buildProductionAlignmentPage(
  input: ProductionPageInput,
): ProductionAlignmentPage {
  const transcriptLines = (input.transcriptPage?.lines ?? [])
    .filter(({ alignable }) => alignable)
    .map(({ id, sourceLineNumber, text }, transcriptLineIndex) => ({
      id,
      transcriptLineIndex,
      sourceLineNumber,
      text,
    }));
  const adapted = adaptPageSegmentsForAlignment({
    lineSegments: input.geometry.lineSegments,
    recognitionRecords: input.recognitionRecords,
  });
  const recognitionStatus = adapted.machineSegmentCount === 0
    ? 'missing' as const
    : adapted.machineSegmentsWithUsableRecognitionCount === 0
      ? 'missing' as const
      : adapted.machineSegmentsWithUsableRecognitionCount
          < adapted.machineSegmentCount
        ? 'partial' as const
        : 'ready' as const;
  const inputFingerprintSha256 = canonicalJsonChecksum({
    algorithm: TRANSCRIPT_ALIGNMENT_ALGORITHM,
    primarySourceRevision: input.primarySourceRevision,
    transcriptRevision: input.transcriptRevision,
    transcriptChecksumSha256: input.transcriptChecksumSha256,
    pageId: input.pageId,
    sourceChecksumSha256: input.sourceChecksumSha256,
    geometryRevision: input.geometry.geometryRevision,
    geometryChecksumSha256: input.geometry.geometryChecksumSha256,
    alignmentSegmentInputChecksumSha256:
      alignmentSegmentInputChecksum(input.geometry.lineSegments),
    recognitionProfileChecksumSha256:
      CURRENT_TRANSCRIPT_RECOGNITION_PROFILE.profileChecksumSha256,
    recognitionExactArtifactChecksumSha256:
      input.recognitionExactArtifactChecksumSha256,
    recognitionSourceArtifactChecksumsSha256:
      input.recognitionSourceArtifactChecksumsSha256,
    recognitionEvidenceChecksumSha256:
      input.recognitionEvidenceChecksumSha256,
  });

  let status: ProductionAlignmentPage['status'] = 'ready';
  let statusMessage: string | null = null;
  let mappings: ProductionAlignmentPage['mappings'];
  let unassignedSegments: ProductionAlignmentPage['unassignedSegments'];
  let deferredSegmentIds: string[];

  if (input.transcriptPageError) {
    status = 'transcript-page-invalid';
    statusMessage = input.transcriptPageError;
    mappings = [];
    unassignedSegments = [
      ...adapted.recognizedSegments.map(({ id }) => ({
        segmentId: id,
        reason: 'alignment-uncertain' as const,
      })),
      ...adapted.excludedSegmentIds.map((segmentId) => ({
        segmentId,
        reason: 'excluded' as const,
      })),
    ];
    deferredSegmentIds = [];
  } else if (
    adapted.recognizedSegments.length === 0
    && transcriptLines.length > 0
  ) {
    status = 'geometry-missing';
    statusMessage = 'This page has no line geometry to align';
    mappings = unlocatedMappings(transcriptLines);
    unassignedSegments = adapted.excludedSegmentIds.map((segmentId) => ({
      segmentId,
      reason: 'excluded' as const,
    }));
    deferredSegmentIds = [];
  } else if (
    recognitionStatus === 'missing'
    && adapted.machineSegmentCount > 0
    && transcriptLines.length > 0
  ) {
    // Blank machine geometry alone is not enough to infer content order. It
    // caused the original cascading Hi/body failure, so fail visibly until a
    // revision-bound reading is available instead of reviving positional
    // matching under a new name.
    status = 'recognition-missing';
    statusMessage = 'Run local line recognition for this page';
    mappings = unlocatedMappings(transcriptLines);
    unassignedSegments = [
      ...adapted.recognizedSegments.map(({ id }) => ({
        segmentId: id,
        reason: 'recognition-missing' as const,
      })),
      ...adapted.excludedSegmentIds.map((segmentId) => ({
        segmentId,
        reason: 'excluded' as const,
      })),
    ];
    deferredSegmentIds = [];
  } else {
    const result = alignTranscriptToRecognizedSegments(
      transcriptLines.map(({ id, text }) => ({ id, text })),
      adapted.recognizedSegments,
    );
    const lineById = new Map(
      transcriptLines.map((line) => [line.id, line]),
    );
    mappings = result.mappings.map((mapping) => {
      const line = lineById.get(mapping.transcriptId);
      if (!line) {
        throw new Error(
          `Aligner returned an unknown transcript ID: ${mapping.transcriptId}`,
        );
      }
      return {
        id: `${mapping.transcriptId}:mapping`,
        transcriptId: mapping.transcriptId,
        transcriptLineIndex: line.transcriptLineIndex,
        sourceLineNumber: line.sourceLineNumber,
        transcriptText: line.text,
        segmentIds: mapping.segmentIds,
        operation: mapping.operation,
        similarity: mapping.similarity,
        confidence: mapping.confidence,
        status: mapping.status,
        evidence: mapping.status === 'unlocated'
          ? 'unlocated' as const
          : mapping.evidence,
        alternatives: mapping.alternatives,
      };
    });
    unassignedSegments = [
      ...result.unassignedSegmentReasons,
      ...adapted.excludedSegmentIds.map((segmentId) => ({
        segmentId,
        reason: 'excluded' as const,
      })),
    ];
    deferredSegmentIds = result.deferredSegmentIds;
  }

  return productionAlignmentPageSchema.parse({
    pageId: input.pageId,
    pageNumber: input.pageNumber,
    sourceChecksumSha256: input.sourceChecksumSha256,
    geometry: input.geometry,
    recognition: {
      status: recognitionStatus,
      profileChecksumSha256:
        CURRENT_TRANSCRIPT_RECOGNITION_PROFILE.profileChecksumSha256,
      exactArtifactChecksumSha256:
        input.recognitionExactArtifactChecksumSha256,
      sourceArtifactChecksumsSha256:
        input.recognitionSourceArtifactChecksumsSha256,
      evidenceChecksumSha256:
        input.recognitionEvidenceChecksumSha256,
      validRecordCount: adapted.validRecognitionRecordCount,
      alignableSegmentCount: adapted.machineSegmentCount,
    },
    inputFingerprintSha256,
    status,
    statusMessage,
    transcriptLines,
    mappings,
    unassignedSegments,
    deferredSegmentIds,
  });
}

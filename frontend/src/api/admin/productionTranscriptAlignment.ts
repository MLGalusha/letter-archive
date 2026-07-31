import { apiGet } from '../client';
import type { PageGeometryEnvelope } from './letters';

export type ProductionAlignmentPageStatus =
  | 'ready'
  | 'recognition-missing'
  | 'geometry-missing'
  | 'transcript-page-invalid';

export type ProductionAlignmentRecognitionStatus =
  | 'ready'
  | 'partial'
  | 'missing';

export type ProductionAlignmentOperation =
  | 'match'
  | 'split'
  | 'merge'
  | 'unlocated-transcript';

export type ProductionAlignmentMappingStatus =
  | 'accepted'
  | 'ambiguous'
  | 'unlocated';

export type ProductionAlignmentEvidence =
  | 'content'
  | 'geometry-only'
  | 'unlocated';

export type ProductionAlignmentUnassignedReason =
  | 'secondary-flow'
  | 'transcript-mismatch'
  | 'non-transcribed-text'
  | 'alignment-uncertain'
  | 'deferred-orientation'
  | 'recognition-missing'
  | 'human-unclassified'
  | 'excluded';

export interface ProductionTranscriptLine {
  id: string;
  transcriptLineIndex: number;
  sourceLineNumber: number;
  text: string;
}

export interface ProductionAlignmentAlternative {
  segmentIds: string[];
  support: number;
}

export interface ProductionAlignmentMapping {
  id: string;
  transcriptId: string;
  transcriptLineIndex: number;
  sourceLineNumber: number;
  transcriptText: string;
  segmentIds: string[];
  operation: ProductionAlignmentOperation;
  similarity: number;
  confidence: number;
  status: ProductionAlignmentMappingStatus;
  evidence: ProductionAlignmentEvidence;
  alternatives: ProductionAlignmentAlternative[];
}

export interface ProductionAlignmentPage {
  pageId: string;
  pageNumber: number;
  sourceChecksumSha256: string | null;
  geometry: PageGeometryEnvelope;
  recognition: {
    status: ProductionAlignmentRecognitionStatus;
    profileChecksumSha256: string;
    /** Present only when one artifact exactly matches the current geometry. */
    exactArtifactChecksumSha256: string | null;
    /** Artifacts whose per-shape records contributed to this alignment. */
    sourceArtifactChecksumsSha256: string[];
    /** Identity of the combined recognition evidence, when any source contributed. */
    evidenceChecksumSha256: string | null;
    validRecordCount: number;
    alignableSegmentCount: number;
  };
  inputFingerprintSha256: string;
  status: ProductionAlignmentPageStatus;
  statusMessage: string | null;
  transcriptLines: ProductionTranscriptLine[];
  mappings: ProductionAlignmentMapping[];
  unassignedSegments: Array<{
    segmentId: string;
    reason: ProductionAlignmentUnassignedReason;
  }>;
  deferredSegmentIds: string[];
}

export interface ProductionTranscriptAlignmentEnvelope {
  schemaVersion: 1;
  algorithm: {
    name: 'content-aware-transcript-alignment';
    version: string;
    configChecksumSha256: string;
  };
  source: {
    letterId: string;
    primarySourceRevision: number;
    transcriptRevision: number;
    transcriptChecksumSha256: string;
  };
  pages: ProductionAlignmentPage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.length > 0);
}

const PAGE_STATUSES = new Set<ProductionAlignmentPageStatus>([
  'ready',
  'recognition-missing',
  'geometry-missing',
  'transcript-page-invalid',
]);
const RECOGNITION_STATUSES = new Set<ProductionAlignmentRecognitionStatus>([
  'ready',
  'partial',
  'missing',
]);
const OPERATIONS = new Set<ProductionAlignmentOperation>([
  'match',
  'split',
  'merge',
  'unlocated-transcript',
]);
const MAPPING_STATUSES = new Set<ProductionAlignmentMappingStatus>([
  'accepted',
  'ambiguous',
  'unlocated',
]);
const EVIDENCE_TYPES = new Set<ProductionAlignmentEvidence>([
  'content',
  'geometry-only',
  'unlocated',
]);
const UNASSIGNED_REASONS = new Set<ProductionAlignmentUnassignedReason>([
  'secondary-flow',
  'transcript-mismatch',
  'non-transcribed-text',
  'alignment-uncertain',
  'deferred-orientation',
  'recognition-missing',
  'human-unclassified',
  'excluded',
]);

function isTranscriptLine(value: unknown): value is ProductionTranscriptLine {
  return isRecord(value)
    && typeof value.id === 'string'
    && isNonnegativeInteger(value.transcriptLineIndex)
    && Number.isInteger(value.sourceLineNumber)
    && Number(value.sourceLineNumber) > 0
    && typeof value.text === 'string';
}

function isAlternative(
  value: unknown,
): value is ProductionAlignmentAlternative {
  return isRecord(value)
    && isStringArray(value.segmentIds)
    && isUnitInterval(value.support);
}

function isMapping(value: unknown): value is ProductionAlignmentMapping {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.transcriptId === 'string'
    && isNonnegativeInteger(value.transcriptLineIndex)
    && Number.isInteger(value.sourceLineNumber)
    && Number(value.sourceLineNumber) > 0
    && typeof value.transcriptText === 'string'
    && isStringArray(value.segmentIds)
    && OPERATIONS.has(value.operation as ProductionAlignmentOperation)
    && isUnitInterval(value.similarity)
    && isUnitInterval(value.confidence)
    && MAPPING_STATUSES.has(value.status as ProductionAlignmentMappingStatus)
    && EVIDENCE_TYPES.has(value.evidence as ProductionAlignmentEvidence)
    && Array.isArray(value.alternatives)
    && value.alternatives.length <= 3
    && value.alternatives.every(isAlternative);
}

function isRecognition(
  value: unknown,
): value is ProductionAlignmentPage['recognition'] {
  if (
    !isRecord(value)
    || !RECOGNITION_STATUSES.has(
      value.status as ProductionAlignmentRecognitionStatus,
    )
    || typeof value.profileChecksumSha256 !== 'string'
    || !isNullableString(value.exactArtifactChecksumSha256)
    || !isStringArray(value.sourceArtifactChecksumsSha256)
    || !isNullableString(value.evidenceChecksumSha256)
    || !isNonnegativeInteger(value.validRecordCount)
    || !isNonnegativeInteger(value.alignableSegmentCount)
  ) {
    return false;
  }
  const sources = value.sourceArtifactChecksumsSha256;
  return new Set(sources).size === sources.length
    && (sources.length > 0) === Boolean(value.evidenceChecksumSha256);
}

function isPageGeometryEnvelope(
  value: unknown,
): value is PageGeometryEnvelope {
  return isRecord(value)
    && Array.isArray(value.lineSegments)
    && isNonnegativeInteger(value.geometryRevision)
    && typeof value.geometryChecksumSha256 === 'string'
    && value.geometryChecksumSha256.length > 0
    && typeof value.lineSegmentsChecksumSha256 === 'string'
    && value.lineSegmentsChecksumSha256.length > 0
    && isRecord(value.reviewState);
}

function requireProductionTranscriptAlignmentEnvelope(
  value: unknown,
): ProductionTranscriptAlignmentEnvelope {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('The transcript placement response was invalid');
  }
  const source = value.source;
  const algorithm = value.algorithm;
  const pages = value.pages;
  if (
    !isRecord(source)
    || typeof source.letterId !== 'string'
    || !Number.isInteger(source.primarySourceRevision)
    || !Number.isInteger(source.transcriptRevision)
    || typeof source.transcriptChecksumSha256 !== 'string'
    || !isRecord(algorithm)
    || algorithm.name !== 'content-aware-transcript-alignment'
    || typeof algorithm.version !== 'string'
    || typeof algorithm.configChecksumSha256 !== 'string'
    || !Array.isArray(pages)
  ) {
    throw new Error('The transcript placement response was incomplete');
  }

  for (const page of pages) {
    if (
      !isRecord(page)
      || typeof page.pageId !== 'string'
      || !Number.isInteger(page.pageNumber)
      || Number(page.pageNumber) <= 0
      || !isNullableString(page.sourceChecksumSha256)
      || !isPageGeometryEnvelope(page.geometry)
      || !isRecognition(page.recognition)
      || typeof page.inputFingerprintSha256 !== 'string'
      || !PAGE_STATUSES.has(page.status as ProductionAlignmentPageStatus)
      || !isNullableString(page.statusMessage)
      || !Array.isArray(page.transcriptLines)
      || !page.transcriptLines.every(isTranscriptLine)
      || !Array.isArray(page.mappings)
      || !page.mappings.every(isMapping)
      || page.transcriptLines.length !== page.mappings.length
      || !Array.isArray(page.unassignedSegments)
      || !page.unassignedSegments.every((unassigned) => (
        isRecord(unassigned)
        && typeof unassigned.segmentId === 'string'
        && unassigned.segmentId.length > 0
        && UNASSIGNED_REASONS.has(
          unassigned.reason as ProductionAlignmentUnassignedReason,
        )
      ))
      || !Array.isArray(page.deferredSegmentIds)
      || !isStringArray(page.deferredSegmentIds)
    ) {
      throw new Error('A transcript placement page was incomplete');
    }
    const transcriptIds = new Set(
      page.transcriptLines.map(({ id }) => id as string),
    );
    const mappedIds = page.mappings.map(
      ({ transcriptId }) => transcriptId as string,
    );
    if (
      mappedIds.some((id) => !transcriptIds.has(id))
      || new Set(mappedIds).size !== mappedIds.length
    ) {
      throw new Error('A transcript placement page had invalid mappings');
    }
  }

  return value as unknown as ProductionTranscriptAlignmentEnvelope;
}

export async function getProductionTranscriptAlignment(
  letterId: string,
  signal?: AbortSignal,
): Promise<ProductionTranscriptAlignmentEnvelope> {
  const result = await apiGet<unknown>(
    `/admin/letters/${encodeURIComponent(letterId)}/transcript-alignment`,
    undefined,
    signal,
  );
  return requireProductionTranscriptAlignmentEnvelope(result);
}

import { apiGet, apiPut } from '../client';

export type TranscriptAlignmentStatus = 'accepted' | 'ambiguous' | 'unlocated';
export type TranscriptAlignmentOperation =
  | 'match'
  | 'split'
  | 'merge'
  | 'unlocated-transcript';
export type TranscriptAlignmentSourceTier =
  | 'modern-confirmed'
  | 'legacy-confirmed'
  | 'human-edited'
  | 'ai-draft';
export type TranscriptAlignmentVerdict = 'correct' | 'incorrect' | 'unsure';
export type TranscriptAlignmentFailureMode =
  | 'wrong-line'
  | 'missed-line'
  | 'false-line'
  | 'split'
  | 'merge'
  | 'wrong-order'
  | 'neighboring-page'
  | 'sideways-text'
  | 'page-boundary'
  | 'other';
export type TranscriptAlignmentUnassignedReason =
  | 'secondary-flow'
  | 'transcript-mismatch'
  | 'non-transcribed-text'
  | 'alignment-uncertain'
  | 'deferred-orientation';

export interface TranscriptAlignmentStatusCounts {
  accepted: number;
  ambiguous: number;
  unlocated: number;
}

export interface TranscriptAlignmentLetterSummary {
  letterKey: string;
  pageKeys: string[];
  mappingCount: number;
  statusCounts: TranscriptAlignmentStatusCounts;
  unassignedMappingCount: number;
}

export interface TranscriptAlignmentRunSummary {
  runId: string;
  createdAt: string;
  letterCount: number;
  pageCount: number;
  mappingCount: number;
  statusCounts: TranscriptAlignmentStatusCounts;
  letters: TranscriptAlignmentLetterSummary[];
}

export interface TranscriptAlignmentIndexResponse {
  schemaVersion: 1;
  runs: TranscriptAlignmentRunSummary[];
  invalidRuns: Array<{
    runId: string;
    letterKey: string | null;
    error: string;
  }>;
}

export interface TranscriptAlignmentPoint {
  x: number;
  y: number;
}

export interface TranscriptAlignmentSegment {
  id: string;
  boundary: TranscriptAlignmentPoint[];
  baseline: TranscriptAlignmentPoint[] | null;
  orientationDegrees: number | null;
  readingOrderIndex: number | null;
  recognizedText: string;
  recognitionConfidence: number | null;
  unassignedReason?: TranscriptAlignmentUnassignedReason;
}

export interface TranscriptAlignmentAlternative {
  segmentIds: string[];
  support: number;
}

export interface TranscriptAlignmentMapping {
  status: TranscriptAlignmentStatus;
  operation: TranscriptAlignmentOperation;
  segmentIds: string[];
  similarity: number;
  confidence: number;
  alternatives: TranscriptAlignmentAlternative[];
}

export interface TranscriptAlignmentItem {
  id: string;
  sourceLineNumber: number;
  transcriptText: string;
  mapping: TranscriptAlignmentMapping;
  review: TranscriptAlignmentSavedReview | null;
}

export interface TranscriptAlignmentSavedReview {
  verdict: TranscriptAlignmentVerdict;
  correctSegmentIds: string[];
  failureModes: TranscriptAlignmentFailureMode[];
  activeSeconds: number;
  repairActions: number;
  updatedAt: string;
}

export interface TranscriptAlignmentReviewInput {
  expectedArtifactSha256: string;
  verdict: TranscriptAlignmentVerdict;
  correctSegmentIds?: string[];
  failureModes: TranscriptAlignmentFailureMode[];
  activeSeconds?: number;
  repairActions?: number;
}

export interface TranscriptAlignmentReviewProgress {
  reviewedCount: number;
  totalCount: number;
  percent: number;
}

export interface TranscriptAlignmentPageResponse {
  schemaVersion: 1;
  artifactSha256: string;
  run: {
    runId: string;
    createdAt: string;
    algorithm: string;
    layoutRunId: string;
    recognizer: {
      runId: string;
      modelSha256: string;
      segmentationType: string;
    };
  };
  page: {
    pageKey: string;
    letterKey: string;
    pageNumber: number;
    originalFilename: string;
    challengeTags: string[];
    image: {
      url: string;
      width: number;
      height: number;
      sha256: string;
    };
  };
  transcriptSource: {
    sha256: string;
    tier: TranscriptAlignmentSourceTier;
    label: string;
  };
  summary: {
    mappingCount: number;
    statusCounts: TranscriptAlignmentStatusCounts;
    skippedSegmentCount: number;
    unassignedMappingCount: number;
    reviewProgress: TranscriptAlignmentReviewProgress;
  };
  segments: TranscriptAlignmentSegment[];
  items: TranscriptAlignmentItem[];
  skippedSegmentIds: string[];
  deferredSegmentIds: string[];
}

export function getTranscriptAlignmentIndex(
  signal?: AbortSignal,
): Promise<TranscriptAlignmentIndexResponse> {
  return apiGet<TranscriptAlignmentIndexResponse>(
    '/admin/layout-benchmark/alignment',
    undefined,
    signal,
  );
}

export function getTranscriptAlignmentPage(
  runId: string,
  pageKey: string,
  signal?: AbortSignal,
): Promise<TranscriptAlignmentPageResponse> {
  return apiGet<TranscriptAlignmentPageResponse>(
    `/admin/layout-benchmark/alignment/runs/${encodeURIComponent(runId)}/pages/${encodeURIComponent(pageKey)}`,
    undefined,
    signal,
  );
}

export function putTranscriptAlignmentReview(
  runId: string,
  pageKey: string,
  transcriptId: string,
  input: TranscriptAlignmentReviewInput,
): Promise<{
  review: TranscriptAlignmentSavedReview;
  progress: TranscriptAlignmentReviewProgress;
}> {
  return apiPut(
    `/admin/layout-benchmark/alignment/runs/${encodeURIComponent(runId)}/pages/${encodeURIComponent(pageKey)}/reviews/${encodeURIComponent(transcriptId)}`,
    input,
  );
}

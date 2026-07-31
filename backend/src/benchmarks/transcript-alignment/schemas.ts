import { z } from 'zod';
import {
  LETTER_KEY_PATTERN,
  PAGE_KEY_PATTERN,
  SAFE_ID_PATTERN,
  pointSchema,
  safeRelativePathSchema,
} from '../layout/schemas.js';

export const transcriptAlignmentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const transcriptAlignmentRunIdSchema = z.string().regex(SAFE_ID_PATTERN);
export const transcriptAlignmentLetterKeySchema = z.string().regex(LETTER_KEY_PATTERN);
export const transcriptAlignmentPageKeySchema = z.string().regex(PAGE_KEY_PATTERN);

const nonnegativeIntegerSchema = z.number().int().nonnegative();
const unitIntervalSchema = z.number().finite().min(0).max(1);
const nullableFiniteNumberSchema = z.number().finite().nullable();
const MAXIMUM_REVIEW_SEGMENT_IDS = 12;

export const transcriptMappingStatusSchema = z.enum([
  'accepted',
  'ambiguous',
  'unlocated',
]);

export const transcriptMappingOperationSchema = z.enum([
  'match',
  'split',
  'merge',
  'unlocated-transcript',
]);

export const TRANSCRIPT_ALIGNMENT_UNASSIGNED_REASONS = [
  'secondary-flow',
  'transcript-mismatch',
  'non-transcribed-text',
  'alignment-uncertain',
  'deferred-orientation',
] as const;

export const transcriptAlignmentUnassignedReasonSchema = z.enum(
  TRANSCRIPT_ALIGNMENT_UNASSIGNED_REASONS,
);

const transcriptAlignmentUnassignedSegmentReasonSchema = z.object({
  segmentId: z.string().min(1),
  reason: transcriptAlignmentUnassignedReasonSchema,
}).strict();

export const transcriptAlignmentVerdictSchema = z.enum([
  'correct',
  'incorrect',
  'unsure',
]);

export const TRANSCRIPT_ALIGNMENT_FAILURE_MODES = [
  'wrong-line',
  'missed-line',
  'false-line',
  'split',
  'merge',
  'wrong-order',
  'neighboring-page',
  'sideways-text',
  'page-boundary',
  'other',
] as const;

export const transcriptAlignmentFailureModeSchema = z.enum(
  TRANSCRIPT_ALIGNMENT_FAILURE_MODES,
);

const transcriptAlignmentFailureModesSchema = z.array(
  transcriptAlignmentFailureModeSchema,
).max(10).default([]);

export const transcriptAlignmentReviewInputSchema = z.object({
  expectedArtifactSha256: transcriptAlignmentSha256Schema,
  verdict: transcriptAlignmentVerdictSchema,
  correctSegmentIds: z.array(z.string().min(1))
    .max(MAXIMUM_REVIEW_SEGMENT_IDS)
    .optional(),
  failureModes: transcriptAlignmentFailureModesSchema,
  activeSeconds: z.number().finite().nonnegative().max(86_400).optional(),
  repairActions: z.number().int().nonnegative().max(10_000).optional(),
}).strict().superRefine((value, context) => {
  if (
    value.correctSegmentIds
    && new Set(value.correctSegmentIds).size !== value.correctSegmentIds.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['correctSegmentIds'],
      message: 'Correct segment IDs must be unique',
    });
  }
  if (new Set(value.failureModes).size !== value.failureModes.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failureModes'],
      message: 'Failure modes must be unique',
    });
  }
});

export const transcriptAlignmentSavedReviewSchema = z.object({
  verdict: transcriptAlignmentVerdictSchema,
  correctSegmentIds: z.array(z.string().min(1))
    .max(MAXIMUM_REVIEW_SEGMENT_IDS),
  // Default preserves review documents created before failure-mode capture.
  failureModes: transcriptAlignmentFailureModesSchema,
  activeSeconds: z.number().finite().nonnegative(),
  repairActions: nonnegativeIntegerSchema,
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (
    new Set(value.correctSegmentIds).size !== value.correctSegmentIds.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['correctSegmentIds'],
      message: 'Correct segment IDs must be unique',
    });
  }
  if (new Set(value.failureModes).size !== value.failureModes.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failureModes'],
      message: 'Failure modes must be unique',
    });
  }
});

export const transcriptAlignmentReviewDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('transcript-alignment-human-review'),
  runId: transcriptAlignmentRunIdSchema,
  pageKey: transcriptAlignmentPageKeySchema,
  artifactSha256: transcriptAlignmentSha256Schema,
  reviewerId: z.string().min(1).max(512),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  reviews: z.array(z.object({
    transcriptId: z.string().min(1),
    review: transcriptAlignmentSavedReviewSchema,
  }).strict()),
}).strict().superRefine((value, context) => {
  const transcriptIds = new Set<string>();
  value.reviews.forEach(({ transcriptId }, index) => {
    if (transcriptIds.has(transcriptId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reviews', index, 'transcriptId'],
        message: 'Reviewed transcript IDs must be unique',
      });
    }
    transcriptIds.add(transcriptId);
  });
});

export const transcriptAlignmentStatusCountsSchema = z.object({
  accepted: nonnegativeIntegerSchema,
  ambiguous: nonnegativeIntegerSchema,
  unlocated: nonnegativeIntegerSchema,
}).strict();

export const transcriptAlignmentAlternativeSchema = z.object({
  segmentIds: z.array(z.string().min(1))
    .max(MAXIMUM_REVIEW_SEGMENT_IDS),
  support: unitIntervalSchema,
}).strict();

export const transcriptAlignmentMappingSchema = z.object({
  transcriptId: z.string().min(1),
  // Page-bounded runners can assign even an unlocated transcript line to its
  // known physical page without inventing geometry.
  pageKey: transcriptAlignmentPageKeySchema.optional(),
  segmentIds: z.array(z.string().min(1))
    .max(MAXIMUM_REVIEW_SEGMENT_IDS),
  operation: transcriptMappingOperationSchema,
  similarity: unitIntervalSchema,
  confidence: unitIntervalSchema,
  status: transcriptMappingStatusSchema,
  alternatives: z.array(transcriptAlignmentAlternativeSchema).max(3),
  transcriptText: z.string(),
  sourceLineNumber: z.number().int().positive().nullable(),
}).passthrough();

const alignmentRecognitionReferenceSchema = z.object({
  pageKey: transcriptAlignmentPageKeySchema,
  // Producers currently record an absolute diagnostic path. Readers must
  // ignore it and resolve the artifact by page key + SHA under a known root.
  path: z.string().min(1),
  sha256: transcriptAlignmentSha256Schema,
}).strict();

export const transcriptAlignmentArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('transcript-to-kraken-segment-alignment'),
  createdAt: z.string().datetime({ offset: true }),
  letterKey: transcriptAlignmentLetterKeySchema,
  source: z.object({
    // As above, this is provenance only and is never trusted for resolution or
    // returned through the admin API.
    snapshotPath: z.string().min(1),
    snapshotSha256: transcriptAlignmentSha256Schema,
    transcriptSha256: transcriptAlignmentSha256Schema,
    recognitions: z.array(alignmentRecognitionReferenceSchema).min(1),
  }).strict(),
  configuration: z.object({
    algorithm: z.string().min(1),
    // Retain compatibility with the first runner contract while allowing the
    // page-scoped runner to place these values in a nested parameters object.
    maximumGroupSize: z.number().int().min(1).max(3).optional(),
    maximumRetainedPaths: z.number().int().positive().optional(),
    transitions: z.array(z.string().min(1)).min(1),
    confidencePolicy: z.string().min(1),
  }).passthrough(),
  summary: z.object({
    transcriptLineCount: nonnegativeIntegerSchema,
    recognizedSegmentCount: nonnegativeIntegerSchema,
    skippedSegmentCount: nonnegativeIntegerSchema,
    averageSimilarity: unitIntervalSchema,
    totalCost: z.number().finite().nonnegative(),
    secondBestCost: nullableFiniteNumberSchema,
    pathMargin: nullableFiniteNumberSchema,
    exploredPathCount: nonnegativeIntegerSchema,
    statusCounts: transcriptAlignmentStatusCountsSchema,
    operationCounts: z.object({
      match: nonnegativeIntegerSchema,
      split: nonnegativeIntegerSchema,
      merge: nonnegativeIntegerSchema,
      'skip-segment': nonnegativeIntegerSchema,
      'unlocated-transcript': nonnegativeIntegerSchema,
    }).strict(),
  }).passthrough(),
  mappings: z.array(transcriptAlignmentMappingSchema),
  operations: z.array(z.unknown()),
  skippedSegmentIds: z.array(z.string().min(1)),
  // Secondary-orientation lines are kept visible for a later rotated-flow
  // pass. Older artifacts predate this distinction and default to none.
  deferredSegmentIds: z.array(z.string().min(1)).default([]),
  // Explain deliberate non-assignments while preserving their geometry.
  // Older artifacts predate reason capture and therefore default to none.
  unassignedSegmentReasons: z.array(
    transcriptAlignmentUnassignedSegmentReasonSchema,
  ).default([]),
  // New page-bounded runners may add a per-page aggregate without changing
  // the stable review fields consumed here.
  pages: z.array(z.unknown()).optional(),
}).passthrough().superRefine((artifact, context) => {
  const recognitionPages = new Set<string>();
  artifact.source.recognitions.forEach(({ pageKey }, index) => {
    if (recognitionPages.has(pageKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source', 'recognitions', index, 'pageKey'],
        message: 'Recognition page keys must be unique',
      });
    }
    recognitionPages.add(pageKey);
  });

  const transcriptIds = new Set<string>();
  artifact.mappings.forEach(({ transcriptId }, index) => {
    if (transcriptIds.has(transcriptId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mappings', index, 'transcriptId'],
        message: 'Transcript mapping IDs must be unique',
      });
    }
    transcriptIds.add(transcriptId);
  });

  const reasonedSegmentIds = new Set<string>();
  const skippedSegmentIds = new Set(artifact.skippedSegmentIds);
  artifact.unassignedSegmentReasons.forEach(({ segmentId }, index) => {
    if (reasonedSegmentIds.has(segmentId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unassignedSegmentReasons', index, 'segmentId'],
        message: 'Unassigned segment reason IDs must be unique',
      });
    }
    if (!skippedSegmentIds.has(segmentId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unassignedSegmentReasons', index, 'segmentId'],
        message: 'Unassigned segment reasons must reference skipped segments',
      });
    }
    reasonedSegmentIds.add(segmentId);
  });
});

export const transcriptSnapshotTrustTierSchema = z.enum([
  'modern-confirmed',
  'legacy-confirmed',
  'human-edited',
  'ai-draft',
]);

const transcriptSnapshotLineSchema = z.object({
  id: z.string().min(1),
  sourceLineNumber: z.number().int().positive(),
  text: z.string(),
  alignable: z.boolean(),
}).passthrough();

const transcriptSnapshotTextSchema = z.object({
  text: z.string(),
  sha256: transcriptAlignmentSha256Schema,
  characterCount: nonnegativeIntegerSchema,
  lines: z.array(transcriptSnapshotLineSchema),
}).passthrough();

const transcriptSnapshotPageSchema = z.object({
  pageKey: transcriptAlignmentPageKeySchema,
  pageNumber: z.number().int().positive(),
  originalFilename: z.string().min(1),
  sourceSha256: transcriptAlignmentSha256Schema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  challengeTags: z.array(z.string()),
  transcript: transcriptSnapshotTextSchema,
// The frozen snapshot also contains private database and artifact provenance
// used by offline research tools. The review API deliberately parses but does
// not project those additive fields into its response.
}).passthrough();

const transcriptSnapshotLetterSchema = z.object({
  letterKey: transcriptAlignmentLetterKeySchema,
  transcript: transcriptSnapshotTextSchema.extend({
    sourceStatus: z.object({
      tier: transcriptSnapshotTrustTierSchema,
      explanation: z.string().min(1),
    }).passthrough(),
  }).passthrough(),
  pages: z.array(transcriptSnapshotPageSchema).min(1),
}).passthrough();

export const transcriptAlignmentSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('transcript-alignment-source-snapshot'),
  createdAt: z.string().datetime({ offset: true }),
  letters: z.array(transcriptSnapshotLetterSchema),
}).passthrough();

const recognitionRecordSchema = z.object({
  segmentId: z.string().min(1),
  text: z.string(),
  meanConfidence: unitIntervalSchema.nullable(),
}).passthrough();

export const transcriptRecognitionArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('kraken-line-recognition'),
  pageKey: transcriptAlignmentPageKeySchema,
  source: z.object({
    layoutPath: z.string().min(1),
    layoutSha256: transcriptAlignmentSha256Schema,
    imagePath: z.string().min(1),
    imageSha256: transcriptAlignmentSha256Schema,
  }).strict(),
  model: z.object({
    path: z.string().min(1),
    sha256: transcriptAlignmentSha256Schema,
    krakenVersion: z.string().optional(),
    segmentationType: z.string().min(1),
  }).passthrough(),
  summary: z.object({
    inputLineCount: nonnegativeIntegerSchema,
    recognizedLineCount: nonnegativeIntegerSchema,
    nonemptyLineCount: nonnegativeIntegerSchema,
  }).strict(),
  records: z.array(recognitionRecordSchema),
}).passthrough().superRefine((artifact, context) => {
  const segmentIds = new Set<string>();
  artifact.records.forEach(({ segmentId }, index) => {
    if (segmentIds.has(segmentId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['records', index, 'segmentId'],
        message: 'Recognition segment IDs must be unique',
      });
    }
    segmentIds.add(segmentId);
  });
});

const recognitionRunPageSchema = z.discriminatedUnion('status', [
  z.object({
    pageKey: transcriptAlignmentPageKeySchema,
    status: z.enum(['succeeded', 'reused']),
    output: safeRelativePathSchema,
    summary: z.object({
      inputLineCount: nonnegativeIntegerSchema,
      recognizedLineCount: nonnegativeIntegerSchema,
      nonemptyLineCount: nonnegativeIntegerSchema,
    }).strict(),
    elapsedSeconds: z.number().finite().nonnegative(),
  }).strict(),
  z.object({
    pageKey: transcriptAlignmentPageKeySchema,
    status: z.literal('failed'),
    errorType: z.string().min(1),
    message: z.string(),
  }).passthrough(),
]);

export const transcriptRecognitionRunSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('kraken-cohort-recognition-run'),
  runId: transcriptAlignmentRunIdSchema,
  state: z.enum(['completed', 'completed-with-failures']),
  source: z.object({
    layoutRunId: transcriptAlignmentRunIdSchema,
    layoutRunManifest: z.string().min(1),
    layoutRunManifestSha256: transcriptAlignmentSha256Schema,
  }).strict(),
  model: z.object({
    path: z.string().min(1),
    sha256: transcriptAlignmentSha256Schema,
    segmentationType: z.string().min(1),
  }).strict(),
  pages: z.array(recognitionRunPageSchema),
}).passthrough();

export const transcriptAlignmentReviewSegmentSchema = z.object({
  id: z.string().min(1),
  boundary: z.array(pointSchema).min(3),
  baseline: z.array(pointSchema).min(2).nullable(),
  orientationDegrees: nullableFiniteNumberSchema,
  readingOrderIndex: nonnegativeIntegerSchema.nullable(),
  recognizedText: z.string(),
  recognitionConfidence: unitIntervalSchema.nullable(),
  unassignedReason: transcriptAlignmentUnassignedReasonSchema.optional(),
}).strict();

export const transcriptAlignmentReviewItemSchema = z.object({
  id: z.string().min(1),
  sourceLineNumber: z.number().int().positive(),
  transcriptText: z.string(),
  mapping: z.object({
    status: transcriptMappingStatusSchema,
    operation: transcriptMappingOperationSchema,
    segmentIds: z.array(z.string().min(1)),
    similarity: unitIntervalSchema,
    confidence: unitIntervalSchema,
    alternatives: z.array(transcriptAlignmentAlternativeSchema),
  }).strict(),
  review: transcriptAlignmentSavedReviewSchema.nullable(),
}).strict();

const alignmentLetterSummarySchema = z.object({
  letterKey: transcriptAlignmentLetterKeySchema,
  pageKeys: z.array(transcriptAlignmentPageKeySchema),
  mappingCount: nonnegativeIntegerSchema,
  statusCounts: transcriptAlignmentStatusCountsSchema,
  unassignedMappingCount: nonnegativeIntegerSchema,
}).strict();

export const transcriptAlignmentListResponseSchema = z.object({
  schemaVersion: z.literal(1),
  runs: z.array(z.object({
    runId: transcriptAlignmentRunIdSchema,
    createdAt: z.string().datetime({ offset: true }),
    letterCount: nonnegativeIntegerSchema,
    pageCount: nonnegativeIntegerSchema,
    mappingCount: nonnegativeIntegerSchema,
    statusCounts: transcriptAlignmentStatusCountsSchema,
    letters: z.array(alignmentLetterSummarySchema),
  }).strict()),
  invalidRuns: z.array(z.object({
    runId: z.string(),
    letterKey: z.string().nullable(),
    error: z.string(),
  }).strict()),
}).strict();

export const transcriptAlignmentPageResponseSchema = z.object({
  schemaVersion: z.literal(1),
  artifactSha256: transcriptAlignmentSha256Schema,
  run: z.object({
    runId: transcriptAlignmentRunIdSchema,
    createdAt: z.string().datetime({ offset: true }),
    algorithm: z.string().min(1),
    layoutRunId: transcriptAlignmentRunIdSchema,
    recognizer: z.object({
      runId: transcriptAlignmentRunIdSchema,
      modelSha256: transcriptAlignmentSha256Schema,
      segmentationType: z.string().min(1),
    }).strict(),
  }).strict(),
  page: z.object({
    pageKey: transcriptAlignmentPageKeySchema,
    letterKey: transcriptAlignmentLetterKeySchema,
    pageNumber: z.number().int().positive(),
    originalFilename: z.string().min(1),
    challengeTags: z.array(z.string()),
    image: z.object({
      url: z.string().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      sha256: transcriptAlignmentSha256Schema,
    }).strict(),
  }).strict(),
  transcriptSource: z.object({
    sha256: transcriptAlignmentSha256Schema,
    tier: transcriptSnapshotTrustTierSchema,
    label: z.string().min(1),
  }).strict(),
  summary: z.object({
    mappingCount: nonnegativeIntegerSchema,
    statusCounts: transcriptAlignmentStatusCountsSchema,
    skippedSegmentCount: nonnegativeIntegerSchema,
    unassignedMappingCount: nonnegativeIntegerSchema,
    reviewProgress: z.object({
      reviewedCount: nonnegativeIntegerSchema,
      totalCount: nonnegativeIntegerSchema,
      percent: z.number().finite().min(0).max(100),
    }).strict(),
  }).strict(),
  segments: z.array(transcriptAlignmentReviewSegmentSchema),
  items: z.array(transcriptAlignmentReviewItemSchema),
  skippedSegmentIds: z.array(z.string().min(1)),
  deferredSegmentIds: z.array(z.string().min(1)),
}).strict();

export type TranscriptAlignmentArtifact = z.infer<
  typeof transcriptAlignmentArtifactSchema
>;
export type TranscriptAlignmentSnapshot = z.infer<
  typeof transcriptAlignmentSnapshotSchema
>;
export type TranscriptRecognitionArtifact = z.infer<
  typeof transcriptRecognitionArtifactSchema
>;
export type TranscriptRecognitionRun = z.infer<
  typeof transcriptRecognitionRunSchema
>;
export type TranscriptAlignmentListResponse = z.infer<
  typeof transcriptAlignmentListResponseSchema
>;
export type TranscriptAlignmentPageResponse = z.infer<
  typeof transcriptAlignmentPageResponseSchema
>;
export type TranscriptAlignmentReviewInput = z.input<
  typeof transcriptAlignmentReviewInputSchema
>;
export type TranscriptAlignmentSavedReview = z.infer<
  typeof transcriptAlignmentSavedReviewSchema
>;
export type TranscriptAlignmentFailureMode = z.infer<
  typeof transcriptAlignmentFailureModeSchema
>;
export type TranscriptAlignmentUnassignedReason = z.infer<
  typeof transcriptAlignmentUnassignedReasonSchema
>;
export type TranscriptAlignmentReviewDocument = z.infer<
  typeof transcriptAlignmentReviewDocumentSchema
>;

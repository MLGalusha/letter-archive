import { z } from 'zod';
import { pageGeometryEnvelopeSchema } from './page-geometry.js';
import { recognitionSha256Schema } from './page-recognition.js';

const unitIntervalSchema = z.number().finite().min(0).max(1);

export const productionAlignmentPageStatusSchema = z.enum([
  'ready',
  'recognition-missing',
  'geometry-missing',
  'transcript-page-invalid',
]);

export const productionAlignmentRecognitionStatusSchema = z.enum([
  'ready',
  'partial',
  'missing',
]);

export const productionAlignmentOperationSchema = z.enum([
  'match',
  'split',
  'merge',
  'unlocated-transcript',
]);

export const productionAlignmentMappingStatusSchema = z.enum([
  'accepted',
  'ambiguous',
  'unlocated',
]);

export const productionAlignmentEvidenceSchema = z.enum([
  'content',
  'geometry-only',
  'unlocated',
]);

export const productionAlignmentUnassignedReasonSchema = z.enum([
  'secondary-flow',
  'transcript-mismatch',
  'non-transcribed-text',
  'alignment-uncertain',
  'deferred-orientation',
  'recognition-missing',
  'human-unclassified',
  'excluded',
]);

export const productionTranscriptLineSchema = z.object({
  id: z.string().min(1),
  transcriptLineIndex: z.number().int().nonnegative(),
  sourceLineNumber: z.number().int().positive(),
  text: z.string(),
}).strict();

export const productionAlignmentAlternativeSchema = z.object({
  segmentIds: z.array(z.string().min(1)),
  support: unitIntervalSchema,
}).strict();

export const productionAlignmentMappingSchema = z.object({
  id: z.string().min(1),
  transcriptId: z.string().min(1),
  transcriptLineIndex: z.number().int().nonnegative(),
  sourceLineNumber: z.number().int().positive(),
  transcriptText: z.string(),
  segmentIds: z.array(z.string().min(1)),
  operation: productionAlignmentOperationSchema,
  similarity: unitIntervalSchema,
  confidence: unitIntervalSchema,
  status: productionAlignmentMappingStatusSchema,
  evidence: productionAlignmentEvidenceSchema,
  alternatives: z.array(productionAlignmentAlternativeSchema).max(3),
}).strict();

export const productionAlignmentPageSchema = z.object({
  pageId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  sourceChecksumSha256: recognitionSha256Schema.nullable(),
  geometry: pageGeometryEnvelopeSchema,
  recognition: z.object({
    status: productionAlignmentRecognitionStatusSchema,
    profileChecksumSha256: recognitionSha256Schema,
    // Non-null only when one stored artifact matches the complete current
    // geometry projection. Compatible per-segment reuse is represented below
    // and must never masquerade as a newly generated exact artifact.
    exactArtifactChecksumSha256: recognitionSha256Schema.nullable(),
    sourceArtifactChecksumsSha256: z.array(
      recognitionSha256Schema,
    ),
    evidenceChecksumSha256: recognitionSha256Schema.nullable(),
    validRecordCount: z.number().int().nonnegative(),
    alignableSegmentCount: z.number().int().nonnegative(),
  }).strict().superRefine((recognition, context) => {
    if (
      new Set(recognition.sourceArtifactChecksumsSha256).size
      !== recognition.sourceArtifactChecksumsSha256.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceArtifactChecksumsSha256'],
        message: 'Recognition source artifact checksums must be unique',
      });
    }
    const hasEvidence = recognition.sourceArtifactChecksumsSha256.length > 0;
    if (hasEvidence !== Boolean(recognition.evidenceChecksumSha256)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidenceChecksumSha256'],
        message:
          'Recognition evidence checksum must exist exactly when source artifacts contribute records',
      });
    }
  }),
  inputFingerprintSha256: recognitionSha256Schema,
  status: productionAlignmentPageStatusSchema,
  statusMessage: z.string().nullable(),
  transcriptLines: z.array(productionTranscriptLineSchema),
  mappings: z.array(productionAlignmentMappingSchema),
  unassignedSegments: z.array(z.object({
    segmentId: z.string().min(1),
    reason: productionAlignmentUnassignedReasonSchema,
  }).strict()),
  deferredSegmentIds: z.array(z.string().min(1)),
}).strict().superRefine((page, context) => {
  if (page.transcriptLines.length !== page.mappings.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mappings'],
      message: 'Every transcript line must have exactly one production mapping',
    });
  }

  const transcriptIds = new Set(page.transcriptLines.map(({ id }) => id));
  const mappedIds = new Set<string>();
  page.mappings.forEach(({ transcriptId }, index) => {
    if (!transcriptIds.has(transcriptId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mappings', index, 'transcriptId'],
        message: `Mapping references an unknown transcript line: ${transcriptId}`,
      });
    }
    if (mappedIds.has(transcriptId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mappings', index, 'transcriptId'],
        message: `Transcript line is mapped more than once: ${transcriptId}`,
      });
    }
    mappedIds.add(transcriptId);
  });
});

export const productionTranscriptAlignmentEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.object({
    name: z.literal('content-aware-transcript-alignment'),
    version: z.string().min(1).max(128),
    configChecksumSha256: recognitionSha256Schema,
  }).strict(),
  source: z.object({
    letterId: z.string().uuid(),
    primarySourceRevision: z.number().int().nonnegative(),
    transcriptRevision: z.number().int().nonnegative(),
    transcriptChecksumSha256: recognitionSha256Schema,
  }).strict(),
  pages: z.array(productionAlignmentPageSchema),
}).strict();

export type ProductionTranscriptAlignmentEnvelope =
  z.infer<typeof productionTranscriptAlignmentEnvelopeSchema>;
export type ProductionAlignmentPage =
  z.infer<typeof productionAlignmentPageSchema>;
export type ProductionAlignmentMapping =
  z.infer<typeof productionAlignmentMappingSchema>;

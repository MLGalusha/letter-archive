import { z } from 'zod';
import {
  lineSegmentStableIdSchema,
  type LineSegment,
} from './line-segment.js';
import { canonicalJsonChecksum } from '../services/page-layout-checksum.js';

export const recognitionSha256Schema = z.string()
  .regex(/^[0-9a-f]{64}$/);

export const pageRecognitionStateSchema = z.enum([
  'completed',
  'partial',
]);

export const segmentRecognitionStateSchema = z.enum([
  'recognized',
  'attempted-empty',
]);

export const recognitionTextDirectionSchema = z.enum([
  'horizontal-lr',
  'horizontal-rl',
  'vertical-lr',
  'vertical-rl',
]);

export const recognitionInferenceSchema = z.object({
  accelerator: z.string().min(1).max(64),
  precision: z.string().min(1).max(64),
  batchSize: z.number().int().positive(),
  numLineWorkers: z.number().int().nonnegative(),
  numThreads: z.number().int().positive(),
  padding: z.number().int().nonnegative(),
  segmentationType: z.literal('baselines'),
}).strict();

export const recognitionBindingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('exact-current-input'),
    adapter: z.enum([
      'direct-baseline',
      'bbox-to-baseline-v1',
      'legacy-baseline-bbox-boundary-v1',
    ]),
  }).strict(),
  z.object({
    kind: z.literal('source-layout-boundary-match'),
    sourceSegmentId: z.string().min(1).max(512),
    sourceBoundaryChecksumSha256: recognitionSha256Schema,
  }).strict(),
]);

export const pageRecognitionRecordSchema = z.object({
  segmentId: lineSegmentStableIdSchema,
  segmentGeometryChecksumSha256: recognitionSha256Schema,
  textDirection: recognitionTextDirectionSchema,
  text: z.string(),
  meanConfidence: z.number().finite().min(0).max(1).nullable(),
  state: segmentRecognitionStateSchema,
  binding: recognitionBindingSchema,
}).strict();

export const pageRecognitionArtifactSchema = z.object({
  // Version 1 artifacts predate durable raster/inference evidence and did not
  // bind a reading to its effective text direction. They remain append-only
  // historical rows, but production alignment only consumes strict v2 rows.
  schemaVersion: z.literal(2),
  kind: z.literal('page-line-recognition'),
  pageId: z.string().uuid(),
  source: z.object({
    primarySourceRevision: z.number().int().nonnegative(),
    sourceChecksumSha256: recognitionSha256Schema,
    geometryRevision: z.number().int().nonnegative(),
    geometryChecksumSha256: recognitionSha256Schema,
    lineSegmentsChecksumSha256: recognitionSha256Schema,
    alignmentSegmentInputChecksumSha256: recognitionSha256Schema,
  }).strict(),
  profile: z.object({
    profileChecksumSha256: recognitionSha256Schema,
    engine: z.string().min(1).max(128),
    engineVersion: z.string().min(1).max(128),
    modelName: z.string().min(1).max(512),
    modelChecksumSha256: recognitionSha256Schema,
    configChecksumSha256: recognitionSha256Schema,
  }).strict(),
  evidence: z.object({
    runId: z.string().min(1).max(128),
    manifestChecksumSha256: recognitionSha256Schema,
    inference: recognitionInferenceSchema,
    raster: z.object({
      encodedChecksumSha256: recognitionSha256Schema,
      checksumAlgorithm: z.literal('sha256-rgb8-v1'),
      checksumSha256: recognitionSha256Schema,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }).strict(),
    normalization: z.object({
      operation: z.string().min(1).max(128),
      applied: z.boolean(),
      originalExifOrientation: z.number().int().min(1).max(8).nullable(),
      exifReadError: z.boolean(),
      original: z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        mode: z.string().min(1).max(64),
      }).strict(),
      normalized: z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        mode: z.literal('RGB'),
      }).strict(),
    }).strict(),
  }).strict(),
  state: pageRecognitionStateSchema,
  records: z.array(pageRecognitionRecordSchema),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((artifact, context) => {
  const ids = new Set<string>();
  artifact.records.forEach(({ segmentId }, index) => {
    if (ids.has(segmentId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['records', index, 'segmentId'],
        message: `Recognition segment IDs must be unique: ${segmentId}`,
      });
    }
    ids.add(segmentId);
  });
});

export type PageRecognitionArtifact =
  z.infer<typeof pageRecognitionArtifactSchema>;
export type PageRecognitionRecord =
  z.infer<typeof pageRecognitionRecordSchema>;
export type RecognitionInference =
  z.infer<typeof recognitionInferenceSchema>;

/**
 * This is the direction actually supplied to Kraken. When a provider did not
 * record one, derive it deterministically from the stored baseline.
 */
export function effectiveRecognitionDirection(
  segment: Pick<LineSegment, 'providerTextDirection' | 'baseline'>,
): z.infer<typeof recognitionTextDirectionSchema> {
  if (segment.providerTextDirection) {
    return segment.providerTextDirection;
  }
  const baseline = segment.baseline;
  if (!baseline || baseline.length < 2) return 'horizontal-lr';
  const [startX, startY] = baseline[0];
  const [endX, endY] = baseline.at(-1)!;
  return Math.abs(endY - startY) > Math.abs(endX - startX)
    ? 'vertical-lr'
    : 'horizontal-lr';
}

/**
 * Recognition is valid for an exact shape, not merely for a page revision.
 * This lets a later human-created box coexist with still-valid recognition
 * for unchanged machine lines while invalidating only shapes that moved.
 */
export function segmentRecognitionGeometryChecksum(
  segment: Pick<
    LineSegment,
    | 'id'
    | 'geometryType'
    | 'baseline'
    | 'bbox'
    | 'boundary'
    | 'providerTextDirection'
  >,
): string {
  return canonicalJsonChecksum({
    id: segment.id,
    geometryType: segment.geometryType,
    baseline: segment.baseline,
    bbox: segment.bbox,
    boundary: segment.boundary,
    textDirection: effectiveRecognitionDirection(segment),
  });
}

export function pageRecognitionArtifactChecksum(
  artifact: PageRecognitionArtifact,
): string {
  return canonicalJsonChecksum(pageRecognitionArtifactSchema.parse(artifact));
}

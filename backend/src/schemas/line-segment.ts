import { z } from 'zod';

const coordinateSchema = z.number().finite().nonnegative();
const pointTupleSchema = z.tuple([coordinateSchema, coordinateSchema]);
export const lineSegmentStableIdSchema = z.string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

export const segmentGeometryOperationSchema = z.enum([
  'detected',
  'create-box',
  'create-polygon',
  'create-freehand',
  'duplicate',
  'resize',
  'move',
  'move-vertex',
  'add-vertex',
  'delete-vertex',
  'reshape',
  'rotate',
  'extend',
  'subtract',
  'delete',
]);

const humanCreatedGeometryOperations = new Set([
  'create-box',
  'create-polygon',
  'create-freehand',
  'duplicate',
]);
const humanAdjustedGeometryOperations = new Set([
  'resize',
  'move',
  'move-vertex',
  'add-vertex',
  'delete-vertex',
  'reshape',
  'rotate',
  'extend',
  'subtract',
  'delete',
]);

export const segmentGeometryProvenanceSchema = z.object({
  source: z.enum(['machine', 'human-created', 'human-adjusted']),
  operation: segmentGeometryOperationSchema,
  parentSegmentIds: z.array(lineSegmentStableIdSchema),
}).strict().superRefine((provenance, context) => {
  if (new Set(provenance.parentSegmentIds).size !== provenance.parentSegmentIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['parentSegmentIds'],
      message: 'Geometry parent IDs must be unique',
    });
  }
  if (
    provenance.source === 'machine'
    && (
      provenance.operation !== 'detected'
      || provenance.parentSegmentIds.length !== 0
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Machine geometry must use detected with no human parents',
    });
  }
  if (
    provenance.source === 'human-created'
    && !humanCreatedGeometryOperations.has(provenance.operation)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['operation'],
      message: 'Human-created geometry must use a creation operation',
    });
  }
  if (
    provenance.source === 'human-adjusted'
    && (
      !humanAdjustedGeometryOperations.has(provenance.operation)
      || provenance.parentSegmentIds.length === 0
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Human-adjusted geometry requires an edit operation and a parent ID',
    });
  }
  if (
    provenance.operation === 'duplicate'
    && provenance.parentSegmentIds.length === 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['parentSegmentIds'],
      message: 'Duplicated geometry must identify its source segment',
    });
  }
});
const bboxSchema = z.tuple([
  coordinateSchema,
  coordinateSchema,
  coordinateSchema,
  coordinateSchema,
]).superRefine(([xMin, yMin, xMax, yMax], context) => {
  if (xMax <= xMin || yMax <= yMin) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Segment bounding boxes must have positive area',
    });
  }
});

export const lineSegmentSchema = z.object({
  id: lineSegmentStableIdSchema.optional(),
  // Legacy detector/editor records use -1 as an "unassigned" sentinel.
  // Native PageLayout projections are always persisted in positive order.
  line: z.number().int(),
  geometryType: z.enum(['baseline', 'bbox']).optional(),
  providerId: z.string().min(1).max(512).optional(),
  providerOrdinal: z.number().int().nonnegative().optional(),
  providerTextDirection: z.enum([
    'horizontal-lr',
    'horizontal-rl',
    'vertical-lr',
    'vertical-rl',
  ]).optional(),
  baseline: z.array(pointTupleSchema).min(2).optional(),
  bbox: bboxSchema,
  bboxSource: z.string().min(1).max(128).optional(),
  geometryProvenance: segmentGeometryProvenanceSchema.optional(),
  ocrText: z.string(),
  words: z.array(z.object({
    text: z.string(),
    bbox: bboxSchema,
  }).strict()).optional(),
  boundary: z.array(z.object({
    x: coordinateSchema,
    y: coordinateSchema,
  }).strict()).min(3).optional(),
  // Kraken 6 compatibility field. It was sparsely populated by the legacy
  // detector and is retained losslessly until those records are migrated.
  group: z.number().int().nonnegative().nullable().optional(),
  regionIds: z.array(
    z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  ).optional(),
  excluded: z.boolean().optional(),
  segmentClass: z.enum([
    'body',
    'continuation',
    'addition',
    'ignore',
  ]).optional(),
  isMapped: z.boolean().optional(),
  mappedText: z.string().optional(),
}).strict().superRefine((segment, context) => {
  if (segment.geometryType === 'bbox' && segment.baseline !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['baseline'],
      message: 'BBox-native lines cannot contain an invented baseline',
    });
  }
  if (segment.geometryType !== 'bbox' && !segment.baseline) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['baseline'],
      message: 'Baseline-native and legacy lines require a baseline',
    });
  }
  if (segment.geometryType && !segment.id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['id'],
      message: 'Native line review records require a stable ID',
    });
  }
});

export const lineSegmentsSchema = z.array(lineSegmentSchema)
  .superRefine((segments, context) => {
    const seen = new Set<string>();
    for (const [index, segment] of segments.entries()) {
      if (!segment.id) continue;
      if (seen.has(segment.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: `Duplicate stable segment ID: ${segment.id}`,
        });
      }
      seen.add(segment.id);
    }
  });
export type LineSegment = z.infer<typeof lineSegmentSchema>;
export type SegmentGeometryProvenance =
  z.infer<typeof segmentGeometryProvenanceSchema>;
export type SegmentGeometryOperation =
  z.infer<typeof segmentGeometryOperationSchema>;

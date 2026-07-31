import { z } from 'zod';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const finiteCoordinateSchema = z.number().finite().nonnegative();
const versionSchema = z.string().trim().min(1).max(128);
const nameSchema = z.string().trim().min(1).max(256);
const providerIdSchema = z.string().trim().min(1).max(512);

export const pageLayoutStableIdSchema = z.string().regex(STABLE_ID_PATTERN);
export const pageLayoutChecksumSchema = z.string().regex(SHA256_PATTERN);

export const pageLayoutPointSchema = z.object({
  x: finiteCoordinateSchema,
  y: finiteCoordinateSchema,
}).strict();

function polygonArea(points: Array<{ x: number; y: number }>): number {
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + (point.x * next.y) - (next.x * point.y);
  }, 0)) / 2;
}

export const pageLayoutPolylineSchema = z.array(pageLayoutPointSchema)
  .min(2)
  .superRefine((points, context) => {
    const distinct = new Set(points.map((point) => `${point.x},${point.y}`));
    if (distinct.size < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A polyline must contain at least two distinct points',
      });
    }
  });

export const pageLayoutPolygonSchema = z.array(pageLayoutPointSchema)
  .min(3)
  .superRefine((points, context) => {
    const distinct = new Set(points.map((point) => `${point.x},${point.y}`));
    if (distinct.size < 3 || polygonArea(points) === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A polygon must contain at least three distinct, non-collinear points',
      });
    }
  });

export const pageLayoutBoundingBoxSchema = z.object({
  xMin: finiteCoordinateSchema,
  yMin: finiteCoordinateSchema,
  xMax: finiteCoordinateSchema,
  yMax: finiteCoordinateSchema,
}).strict().superRefine((box, context) => {
  if (box.xMax <= box.xMin) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['xMax'],
      message: 'xMax must be greater than xMin',
    });
  }
  if (box.yMax <= box.yMin) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['yMax'],
      message: 'yMax must be greater than yMin',
    });
  }
});

export const pageLayoutDisplayExtentSchema = z.object({
  xMin: finiteCoordinateSchema,
  yMin: finiteCoordinateSchema,
  xMax: finiteCoordinateSchema,
  yMax: finiteCoordinateSchema,
}).strict().superRefine((box, context) => {
  if (box.xMax < box.xMin || box.yMax < box.yMin) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Display extent coordinates must be ordered',
    });
  }
});

export const pageLayoutDirectionSchema = z.enum([
  'left-to-right',
  'right-to-left',
  'top-to-bottom',
  'bottom-to-top',
  'mixed',
  'unknown',
]);

export const pageLayoutTextDirectionSchema = z.enum([
  'horizontal-lr',
  'horizontal-rl',
  'vertical-lr',
  'vertical-rl',
]);

export const pageLayoutRotationDegreeSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

export const pageLayoutRotationEvidenceContractSchema = z.literal(
  'native-and-source-projected-v2',
);

export const pageLayoutRotationMergePolicySchema = z.literal(
  'baseline-plus-nonoverlapping-vertical-zones',
);

/**
 * The first production rotation profile is intentionally pinned. Changing a
 * threshold creates a different experiment and must therefore introduce a
 * new named profile instead of silently changing stored detector evidence.
 */
export const pageLayoutRotationProfileSchema = z.object({
  name: z.literal('sideways-recovery-v1'),
  evidenceContract: pageLayoutRotationEvidenceContractSchema,
  rotationsDegrees: z.tuple([
    z.literal(0),
    z.literal(90),
    z.literal(270),
  ]),
  mergePolicy: pageLayoutRotationMergePolicySchema,
  coordinateTransform: z.literal('pil-pixel-centers-to-source-v1'),
  selectionParameters: z.object({
    verticalAxisToleranceDegrees: z.literal(15),
    strongBaselineLongEdgeRatio: z.literal(0.025),
    zoneJoinPaddingLongEdgeRatio: z.literal(0.06),
    zoneMemberPaddingLongEdgeRatio: z.literal(0.02),
    minimumStrongProposalClustersPerZone: z.literal(2),
    minimumProposalClustersPerZone: z.literal(3),
    baselineInterferencePaddingLongEdgeRatio: z.literal(0),
    baselineInterferenceHorizontalAxisToleranceDegrees: z.literal(20),
    maximumHorizontalBaselineCentroidRatioPerZone: z.literal(0.1),
    minimumHorizontalBaselineCentroidAllowancePerZone: z.literal(2),
  }).strict(),
  selectionSummary: z.object({
    rawInputLineCount: z.number().int().nonnegative(),
    inputLineCount: z.number().int().nonnegative(),
    clusterCount: z.number().int().nonnegative(),
    includedClusterCount: z.number().int().nonnegative(),
    rejectedClusterCount: z.number().int().nonnegative(),
    appendedRotatedLineCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const pageLayoutRotationEvidenceSchema = z.object({
  evidenceContract: pageLayoutRotationEvidenceContractSchema,
  mergePolicy: pageLayoutRotationMergePolicySchema,
  clusterIndex: z.number().int().nonnegative(),
  supportCount: z.number().int().positive(),
  sourceRotationsDegrees: z.array(pageLayoutRotationDegreeSchema).min(1),
  sourcePassStatuses: z.array(z.literal('succeeded')).min(1),
  representativeRotationDegrees: pageLayoutRotationDegreeSchema,
  representativeProviderOrdinal: z.number().int().nonnegative(),
  memberProviderIds: z.array(providerIdSchema).min(1),
  readingOrderSource: z.enum([
    'provider-unrotated',
    'unresolved-rotated-proposal',
  ]),
}).strict().superRefine((evidence, context) => {
  if (
    new Set(evidence.sourceRotationsDegrees).size
    !== evidence.sourceRotationsDegrees.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceRotationsDegrees'],
      message: 'Rotation evidence may reference each source pass only once',
    });
  }
  if (
    evidence.supportCount !== evidence.sourceRotationsDegrees.length
    || evidence.supportCount !== evidence.sourcePassStatuses.length
    || evidence.supportCount !== evidence.memberProviderIds.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Rotation support count must match every member evidence list',
    });
  }
  if (
    !evidence.sourceRotationsDegrees.includes(
      evidence.representativeRotationDegrees,
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['representativeRotationDegrees'],
      message: 'Representative rotation must be one of the supporting passes',
    });
  }
  if (
    evidence.readingOrderSource === 'provider-unrotated'
    && evidence.representativeRotationDegrees !== 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['readingOrderSource'],
      message: 'Provider reading order is only valid for the unrotated pass',
    });
  }
  if (
    evidence.readingOrderSource === 'unresolved-rotated-proposal'
    && evidence.representativeRotationDegrees === 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['readingOrderSource'],
      message: 'A rotated proposal must not claim the unrotated reading order',
    });
  }
});

export const pageLayoutJsonValueSchema: z.ZodType<
  null | boolean | number | string | unknown[] | Record<string, unknown>
> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(pageLayoutJsonValueSchema),
  z.record(pageLayoutJsonValueSchema),
]));

export const pageLayoutProvenanceSchema = z.object({
  producer: z.object({
    name: nameSchema,
    version: versionSchema,
    api: z.string().trim().min(1).max(512).optional(),
    providerRunId: providerIdSchema.optional(),
  }).strict(),
  model: z.object({
    name: nameSchema,
    version: versionSchema,
    checksumSha256: pageLayoutChecksumSchema,
    kind: z.string().trim().min(1).max(256).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
  }).strict(),
  config: z.object({
    name: nameSchema,
    version: versionSchema,
    checksumSha256: pageLayoutChecksumSchema,
    parameters: z.record(pageLayoutJsonValueSchema).optional(),
  }).strict(),
}).strict();

export const pageLayoutImageSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  checksumSha256: pageLayoutChecksumSchema,
  rasterChecksumSha256: pageLayoutChecksumSchema.optional(),
  rasterChecksumAlgorithm: z.literal('sha256-rgb8-v1').optional(),
  coordinateSpace: z.object({
    unit: z.literal('pixel'),
    origin: z.literal('top-left'),
    xAxis: z.literal('right'),
    yAxis: z.literal('down'),
  }).strict(),
  source: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    checksumSha256: pageLayoutChecksumSchema,
    mode: z.string().trim().min(1).max(64),
    exifOrientation: z.number().int().min(1).max(8).nullable(),
  }).strict().optional(),
  normalization: z.object({
    operation: z.string().trim().min(1).max(128),
    applied: z.boolean(),
    exifReadError: z.boolean(),
  }).strict().optional(),
}).strict().superRefine((image, context) => {
  if (
    (image.rasterChecksumSha256 === undefined)
    !== (image.rasterChecksumAlgorithm === undefined)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Raster checksum and algorithm must be stored together',
    });
  }
});

const pageLayoutWordSchema = z.object({
  id: pageLayoutStableIdSchema,
  text: z.string(),
  boundingBox: pageLayoutBoundingBoxSchema,
}).strict();

const lineCommonShape = {
  id: pageLayoutStableIdSchema,
  providerId: providerIdSchema.optional(),
  providerOrdinal: z.number().int().nonnegative().optional(),
  text: z.string().nullable(),
  direction: pageLayoutDirectionSchema,
  providerTextDirection: pageLayoutTextDirectionSchema.optional(),
  rotationEvidence: pageLayoutRotationEvidenceSchema.optional(),
  baseDirection: z.enum(['L', 'R']).nullable().optional(),
  tags: z.record(pageLayoutJsonValueSchema).nullable().optional(),
  regionIds: z.array(pageLayoutStableIdSchema).optional(),
  unresolvedProviderRegionIds: z.array(pageLayoutJsonValueSchema).optional(),
  language: z.array(z.string()).nullable().optional(),
  words: z.array(pageLayoutWordSchema).optional(),
  // Lossless legacy import permits the historical -1 "unassigned" sentinel.
  sourceLineNumber: z.number().int().optional(),
  displayExtent: z.object({
    boundingBox: pageLayoutDisplayExtentSchema.nullable(),
    source: z.string().trim().min(1).max(128),
    derived: z.boolean(),
  }).strict().optional(),
};

export const pageLayoutBaselineLineSchema = z.object({
  ...lineCommonShape,
  kind: z.literal('baseline'),
  baseline: pageLayoutPolylineSchema,
  boundary: pageLayoutPolygonSchema.optional(),
  boundingBox: pageLayoutBoundingBoxSchema.optional(),
}).strict();

export const pageLayoutBboxLineSchema = z.object({
  ...lineCommonShape,
  kind: z.literal('bbox'),
  boundingBox: pageLayoutBoundingBoxSchema,
}).strict();

export const pageLayoutLineSchema = z.discriminatedUnion('kind', [
  pageLayoutBaselineLineSchema,
  pageLayoutBboxLineSchema,
]);

export const pageLayoutRegionSchema = z.object({
  id: pageLayoutStableIdSchema,
  providerId: providerIdSchema.optional(),
  providerOrdinal: z.number().int().nonnegative().optional(),
  type: z.string().trim().min(1).max(128),
  boundary: pageLayoutPolygonSchema,
  lineIds: z.array(pageLayoutStableIdSchema),
  tags: z.record(pageLayoutJsonValueSchema).nullable().optional(),
  language: z.array(z.string()).nullable().optional(),
}).strict();

export const pageLayoutReadingOrderPathSchema = z.object({
  id: pageLayoutStableIdSchema,
  direction: pageLayoutDirectionSchema,
  lineIds: z.array(pageLayoutStableIdSchema),
  source: z.enum(['provider', 'geometry', 'legacy', 'human']).optional(),
  providerOrdinal: z.number().int().nonnegative().optional(),
  providerIndices: z.array(z.number().int().nonnegative()).optional(),
  providerMappingComplete: z.boolean().optional(),
  complete: z.boolean().optional(),
}).strict();

function addDuplicateIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  id: string,
): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message: `Duplicate stable ID ${id}`,
  });
}

function addDuplicateReferenceIssues(
  values: string[],
  context: z.RefinementCtx,
  path: Array<string | number>,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: `Duplicate line reference ${value}`,
      });
    }
    seen.add(value);
  });
}

function validatePointsWithinImage(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
  context: z.RefinementCtx,
  path: Array<string | number>,
): void {
  points.forEach((point, index) => {
    if (point.x > width || point.y > height) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: 'Point lies outside the declared image coordinate space',
      });
    }
  });
}

function validateBoxWithinImage(
  box: z.infer<typeof pageLayoutBoundingBoxSchema>,
  width: number,
  height: number,
  context: z.RefinementCtx,
  path: Array<string | number>,
): void {
  if (box.xMax > width || box.yMax > height) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: 'Bounding box lies outside the declared image coordinate space',
    });
  }
}

export const pageLayoutV2Schema = z.object({
  schemaVersion: z.literal(2),
  layoutId: pageLayoutStableIdSchema,
  runId: pageLayoutStableIdSchema,
  pageId: pageLayoutStableIdSchema,
  image: pageLayoutImageSchema,
  provenance: pageLayoutProvenanceSchema,
  lineRepresentation: z.enum(['baselines', 'bbox', 'mixed']),
  textDirection: pageLayoutTextDirectionSchema,
  scriptDetection: z.boolean(),
  language: z.array(z.string()).nullable(),
  pageBoundary: pageLayoutPolygonSchema.optional(),
  lines: z.array(pageLayoutLineSchema),
  regions: z.array(pageLayoutRegionSchema),
  readingOrder: z.object({
    primary: pageLayoutReadingOrderPathSchema,
    alternatives: z.array(pageLayoutReadingOrderPathSchema),
  }).strict(),
}).strict().superRefine((layout, context) => {
  const entityIds = new Set<string>();
  const registerId = (id: string, path: Array<string | number>) => {
    if (entityIds.has(id)) {
      addDuplicateIssue(context, path, id);
    }
    entityIds.add(id);
  };

  const lineIds = new Set(layout.lines.map((line) => line.id));
  layout.lines.forEach((line, lineIndex) => {
    registerId(line.id, ['lines', lineIndex, 'id']);
    line.words?.forEach((word, wordIndex) => {
      registerId(word.id, ['lines', lineIndex, 'words', wordIndex, 'id']);
      validateBoxWithinImage(
        word.boundingBox,
        layout.image.width,
        layout.image.height,
        context,
        ['lines', lineIndex, 'words', wordIndex, 'boundingBox'],
      );
    });

    if (line.kind === 'baseline') {
      validatePointsWithinImage(
        line.baseline,
        layout.image.width,
        layout.image.height,
        context,
        ['lines', lineIndex, 'baseline'],
      );
      if (line.boundary) {
        validatePointsWithinImage(
          line.boundary,
          layout.image.width,
          layout.image.height,
          context,
          ['lines', lineIndex, 'boundary'],
        );
      }
      if (line.boundingBox) {
        validateBoxWithinImage(
          line.boundingBox,
          layout.image.width,
          layout.image.height,
          context,
          ['lines', lineIndex, 'boundingBox'],
        );
      }
    } else {
      validateBoxWithinImage(
        line.boundingBox,
        layout.image.width,
        layout.image.height,
        context,
        ['lines', lineIndex, 'boundingBox'],
      );
    }
  });

  if (layout.pageBoundary) {
    validatePointsWithinImage(
      layout.pageBoundary,
      layout.image.width,
      layout.image.height,
      context,
      ['pageBoundary'],
    );
  }

  layout.regions.forEach((region, regionIndex) => {
    registerId(region.id, ['regions', regionIndex, 'id']);
    validatePointsWithinImage(
      region.boundary,
      layout.image.width,
      layout.image.height,
      context,
      ['regions', regionIndex, 'boundary'],
    );
    addDuplicateReferenceIssues(
      region.lineIds,
      context,
      ['regions', regionIndex, 'lineIds'],
    );
    region.lineIds.forEach((lineId, referenceIndex) => {
      const line = layout.lines.find((candidate) => candidate.id === lineId);
      if (!lineIds.has(lineId) || !line) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['regions', regionIndex, 'lineIds', referenceIndex],
          message: `Region references unknown line ${lineId}`,
        });
      } else if (!(line.regionIds ?? []).includes(region.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['regions', regionIndex, 'lineIds', referenceIndex],
          message: `Line ${lineId} does not reference region ${region.id}`,
        });
      }
    });
  });

  const regionIds = new Set(layout.regions.map((region) => region.id));
  layout.lines.forEach((line, lineIndex) => {
    const references = line.regionIds ?? [];
    addDuplicateReferenceIssues(
      references,
      context,
      ['lines', lineIndex, 'regionIds'],
    );
    references.forEach((regionId, referenceIndex) => {
      const region = layout.regions.find((candidate) => candidate.id === regionId);
      if (!regionIds.has(regionId) || !region) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lines', lineIndex, 'regionIds', referenceIndex],
          message: `Line references unknown region ${regionId}`,
        });
      } else if (!region.lineIds.includes(line.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lines', lineIndex, 'regionIds', referenceIndex],
          message: `Region ${regionId} does not reference line ${line.id}`,
        });
      }
    });
  });

  const actualRepresentations = new Set(
    layout.lines.map((line) => (
      line.kind === 'baseline' ? 'baselines' : 'bbox'
    )),
  );
  const expectedRepresentation = actualRepresentations.size > 1
    ? 'mixed'
    : actualRepresentations.values().next().value;
  if (
    expectedRepresentation
    && layout.lineRepresentation !== expectedRepresentation
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lineRepresentation'],
      message: 'Declared line representation does not match the line records',
    });
  }

  const orders = [
    {
      order: layout.readingOrder.primary,
      path: ['readingOrder', 'primary'] as Array<string | number>,
    },
    ...layout.readingOrder.alternatives.map((order, index) => ({
      order,
      path: ['readingOrder', 'alternatives', index] as Array<string | number>,
    })),
  ];

  orders.forEach(({ order, path }, orderIndex) => {
    registerId(order.id, [...path, 'id']);
    addDuplicateReferenceIssues(order.lineIds, context, [...path, 'lineIds']);
    order.lineIds.forEach((lineId, referenceIndex) => {
      if (!lineIds.has(lineId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, 'lineIds', referenceIndex],
          message: `Reading order references unknown line ${lineId}`,
        });
      }
    });
    const mustBeComplete = orderIndex === 0 || order.complete !== false;
    if (mustBeComplete && (
      order.lineIds.length !== lineIds.size
      || order.lineIds.some((lineId) => !lineIds.has(lineId))
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, 'lineIds'],
        message: 'Each reading order must reference every page line exactly once',
      });
    }
  });
});

export type PageLayoutV2 = z.infer<typeof pageLayoutV2Schema>;
export type PageLayoutPoint = z.infer<typeof pageLayoutPointSchema>;
export type PageLayoutBoundingBox = z.infer<typeof pageLayoutBoundingBoxSchema>;
export type PageLayoutDirection = z.infer<typeof pageLayoutDirectionSchema>;
export type PageLayoutTextDirection = z.infer<
  typeof pageLayoutTextDirectionSchema
>;
export type PageLayoutRotationEvidence = z.infer<
  typeof pageLayoutRotationEvidenceSchema
>;
export type PageLayoutRotationProfile = z.infer<
  typeof pageLayoutRotationProfileSchema
>;
export type PageLayoutProvenance = z.infer<typeof pageLayoutProvenanceSchema>;
export type PageLayoutLine = z.infer<typeof pageLayoutLineSchema>;

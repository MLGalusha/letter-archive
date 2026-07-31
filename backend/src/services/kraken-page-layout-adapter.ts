import { z } from 'zod';
import {
  pageLayoutRotationEvidenceSchema,
  pageLayoutRotationProfileSchema,
  pageLayoutV2Schema,
  type PageLayoutDirection,
  type PageLayoutTextDirection,
  type PageLayoutV2,
} from '../schemas/page-layout-v2.js';
import { pageLayoutChecksum } from './page-layout-checksum.js';

export { pageLayoutChecksum } from './page-layout-checksum.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const coordinateSchema = z.number().int().nonnegative();
const pointSchema = z.object({
  x: coordinateSchema,
  y: coordinateSchema,
}).strict();
const pointListSchema = z.array(pointSchema);
const bboxSchema = z.tuple([
  coordinateSchema,
  coordinateSchema,
  coordinateSchema,
  coordinateSchema,
]);
const jsonValueSchema: z.ZodType<
  null | boolean | number | string | unknown[] | Record<string, unknown>
> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema),
]));
const nullableStringSchema = z.string().nullable();
const providerTagsSchema = z.record(jsonValueSchema).nullable();
const nativeDeviceSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.number()),
]);

const nativeSourceSchema = z.object({
  name: z.string().nullable(),
  coordinateSpace: z.literal('normalized-image-pixels'),
  original: z.object({
    sha256: sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mode: z.string().min(1),
    exifOrientation: z.number().int().min(1).max(8).nullable(),
  }).strict(),
  normalized: z.object({
    sha256: sha256Schema,
    rasterSha256: sha256Schema,
    rasterChecksumAlgorithm: z.literal('sha256-rgb8-v1'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mode: z.literal('RGB'),
    format: z.literal('PNG'),
  }).strict(),
  normalization: z.object({
    operation: z.enum([
      'identity',
      'flip-horizontal',
      'rotate-180',
      'flip-vertical',
      'transpose',
      'rotate-90-cw',
      'transverse',
      'rotate-90-ccw',
    ]),
    applied: z.boolean(),
    exifReadError: z.boolean(),
  }).strict(),
}).strict();

const nativeProducerSchema = z.object({
  engine: z.literal('kraken'),
  engineVersion: z.literal('7.0.3'),
  api: z.literal('kraken.tasks.SegmentationTaskModel'),
  model: z.object({
    name: z.string().min(1),
    kind: z.string().min(1),
    sha256: sha256Schema,
    sizeBytes: z.number().int().nonnegative(),
  }).strict(),
  config: z.object({
    accelerator: z.string().min(1),
    device: nativeDeviceSchema,
    precision: z.string().min(1),
    batchSize: z.number().int().positive(),
    raiseOnError: z.boolean(),
    numThreads: z.number().int().positive(),
    inputPadding: z.union([
      z.number().int().nonnegative(),
      z.array(z.number().int().nonnegative()),
    ]),
    textDirection: z.enum([
      'horizontal-lr',
      'horizontal-rl',
      'vertical-lr',
      'vertical-rl',
    ]),
    effective: z.record(jsonValueSchema),
    rotationProfile: pageLayoutRotationProfileSchema.optional(),
  }).strict(),
  runtime: z.object({
    python: z.object({
      version: z.string().min(1),
      implementation: z.string().min(1),
    }).strict(),
    platform: z.object({
      system: z.string().min(1),
      release: z.string().min(1),
      machine: z.string().min(1),
    }).strict(),
    packages: z.object({
      kraken: z.literal('7.0.3'),
      torch: z.string().min(1),
      pillow: z.string().min(1),
      numpy: z.string().min(1),
      coremltools: z.string().min(1),
      lightning: z.string().min(1),
      safetensors: z.string().min(1),
      scikitImage: z.string().min(1),
      scikitLearn: z.string().min(1),
      scipy: z.string().min(1),
      shapely: z.string().min(1),
      torchmetrics: z.string().min(1),
      torchvision: z.string().min(1),
    }).strict(),
    artifacts: z.object({
      adapter: z.object({
        name: z.literal('letter-archive-kraken-native-layout'),
        contractVersion: z.literal(2),
        sha256: sha256Schema,
      }).strict(),
      constraints: z.object({
        name: z.literal('constraints-runtime.txt'),
        sha256: sha256Schema,
      }).strict(),
    }).strict(),
    execution: z.object({
      processMode: z.enum(['one-shot', 'persistent-worker']),
      accelerator: z.string().min(1),
      configuredDevice: nativeDeviceSchema,
      resolvedDevice: z.string().min(1),
      resolutionSource: z.enum([
        'model-parameters',
        'configured-accelerator',
        'configured-device',
      ]),
      precision: z.string().min(1),
      modelParameterDevices: z.array(z.string().min(1)),
      modelParameterDtypes: z.array(z.string().min(1)),
    }).strict(),
  }).strict(),
}).strict();

const existingIdentitySource =
  'derived-source-raster-model-provider-order-geometry-v2';
const rotatedIdentitySource =
  'derived-source-raster-model-rotation-provider-geometry-v3';
const nativeIdentityShape = {
  identityVersion: z.union([z.literal(1), z.literal(3)]),
  idSource: z.enum([existingIdentitySource, rotatedIdentitySource]),
};

function validateNativeIdentity(
  value: {
    identityVersion: 1 | 3;
    idSource: typeof existingIdentitySource | typeof rotatedIdentitySource;
  },
  context: z.RefinementCtx,
): void {
  const valid = (
    value.identityVersion === 1
      ? value.idSource === existingIdentitySource
      : value.idSource === rotatedIdentitySource
  );
  if (!valid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['idSource'],
      message: 'Native identity version and source must describe the same contract',
    });
  }
}

const nativeLineCommon = {
  id: z.string().regex(/^line-sha256-[a-f0-9]{64}$/),
  providerId: nullableStringSchema,
  ...nativeIdentityShape,
  providerOrdinal: z.number().int().nonnegative(),
  providerTextDirection: z.enum([
    'horizontal-lr',
    'horizontal-rl',
    'vertical-lr',
    'vertical-rl',
  ]).optional(),
  rotationEvidence: pageLayoutRotationEvidenceSchema.optional(),
  text: nullableStringSchema,
  baseDirection: z.enum(['L', 'R']).nullable(),
  tags: providerTagsSchema,
  providerRegionIds: z.array(jsonValueSchema),
  regionIds: z.array(z.string().regex(/^region-sha256-[a-f0-9]{64}$/)),
  unresolvedProviderRegionIds: z.array(jsonValueSchema),
  language: z.array(z.string()).nullable(),
};

const nativeBaselineLineSchema = z.object({
  ...nativeLineCommon,
  geometry: z.object({
    type: z.literal('baselines'),
    baseline: pointListSchema.min(2),
    boundary: pointListSchema.min(3).nullable(),
  }).strict(),
  displayExtent: z.object({
    bbox: bboxSchema.nullable(),
    source: z.enum([
      'derived-boundary-aabb',
      'derived-baseline-aabb',
      'unavailable',
    ]),
    derived: z.boolean(),
  }).strict(),
}).strict().superRefine((line, context) => {
  validateNativeIdentity(line, context);
  if (line.identityVersion === 3 && !line.rotationEvidence) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rotationEvidence'],
      message: 'Rotation-derived lines require explicit rotation evidence',
    });
  }
  if (line.identityVersion === 3 && !line.providerTextDirection) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['providerTextDirection'],
      message: 'Rotation-derived baseline lines require an explicit direction',
    });
  }
  if (line.identityVersion === 1 && line.rotationEvidence) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rotationEvidence'],
      message: 'Legacy line identity cannot carry rotation-derived evidence',
    });
  }
});

const nativeBboxLineSchema = z.object({
  ...nativeLineCommon,
  geometry: z.object({
    type: z.literal('bbox'),
    bbox: bboxSchema,
    textDirection: z.enum([
      'horizontal-lr',
      'horizontal-rl',
      'vertical-lr',
      'vertical-rl',
    ]),
  }).strict(),
  displayExtent: z.object({
    bbox: bboxSchema,
    source: z.literal('native-bbox'),
    derived: z.literal(false),
  }).strict(),
}).strict().superRefine((line, context) => {
  validateNativeIdentity(line, context);
  if (line.identityVersion === 3 && !line.rotationEvidence) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rotationEvidence'],
      message: 'Rotation-derived lines require explicit rotation evidence',
    });
  }
  if (line.identityVersion === 3 && !line.providerTextDirection) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['providerTextDirection'],
      message: 'Rotation-derived bbox lines require an explicit direction',
    });
  }
  if (
    line.providerTextDirection
    && line.providerTextDirection !== line.geometry.textDirection
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['providerTextDirection'],
      message: 'Line and bbox geometry directions must agree',
    });
  }
  if (line.identityVersion === 1 && line.rotationEvidence) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rotationEvidence'],
      message: 'Legacy line identity cannot carry rotation-derived evidence',
    });
  }
});

const nativeLineSchema = z.union([
  nativeBaselineLineSchema,
  nativeBboxLineSchema,
]);

const nativeRegionSchema = z.object({
  id: z.string().regex(/^region-sha256-[a-f0-9]{64}$/),
  providerId: nullableStringSchema,
  identityVersion: z.literal(1),
  idSource: z.literal(existingIdentitySource),
  class: z.string().min(1),
  providerOrdinal: z.number().int().nonnegative(),
  boundary: pointListSchema.min(3),
  tags: providerTagsSchema,
  language: z.array(z.string()).nullable(),
}).strict();

const nativeAlternateOrderSchema = z.object({
  providerOrdinal: z.number().int().nonnegative(),
  providerIndices: z.array(z.number().int().nonnegative()),
  lineIds: z.array(z.string().regex(/^line-sha256-[a-f0-9]{64}$/)),
  complete: z.boolean(),
}).strict();

export const krakenNativePageLayoutV2Schema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal('PageLayout'),
  source: nativeSourceSchema,
  producer: nativeProducerSchema,
  segmentation: z.object({
    type: z.enum(['baselines', 'bbox']),
    textDirection: z.enum([
      'horizontal-lr',
      'horizontal-rl',
      'vertical-lr',
      'vertical-rl',
    ]),
    scriptDetection: z.boolean(),
    language: z.array(z.string()).nullable(),
    readingOrder: z.object({
      source: z.literal('segmentation.lines'),
      lineIds: z.array(z.string().regex(/^line-sha256-[a-f0-9]{64}$/)),
    }).strict(),
    alternateReadingOrders: z.array(nativeAlternateOrderSchema),
    regions: z.array(nativeRegionSchema),
    lines: z.array(nativeLineSchema),
  }).strict(),
}).strict().superRefine((layout, context) => {
  const profile = layout.producer.config.rotationProfile;
  const rotationLines = layout.segmentation.lines.filter(
    (line) => line.identityVersion === 3,
  );
  if (rotationLines.length > 0 && !profile) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['producer', 'config', 'rotationProfile'],
      message: 'Rotation-derived lines require a pinned rotation profile',
    });
  }
  if (!profile) return;
  const configuredRotations = new Set<number>(profile.rotationsDegrees);
  if (layout.producer.config.textDirection !== 'horizontal-lr') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['producer', 'config', 'textDirection'],
      message: 'The pinned sideways recovery profile requires horizontal-lr passes',
    });
  }

  const unresolvedCount = rotationLines.filter(
    (line) => (
      line.rotationEvidence?.readingOrderSource
      === 'unresolved-rotated-proposal'
    ),
  ).length;
  if (
    profile.selectionSummary.appendedRotatedLineCount !== unresolvedCount
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [
        'producer',
        'config',
        'rotationProfile',
        'selectionSummary',
        'appendedRotatedLineCount',
      ],
      message: 'Rotation summary must equal the unresolved rotated line count',
    });
  }

  layout.segmentation.lines.forEach((line, index) => {
    const evidence = line.rotationEvidence;
    if (!evidence) return;
    if (
      evidence.evidenceContract !== profile.evidenceContract
      || evidence.mergePolicy !== profile.mergePolicy
      || evidence.sourceRotationsDegrees.some(
        (rotation) => !configuredRotations.has(rotation),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['segmentation', 'lines', index, 'rotationEvidence'],
        message: 'Line rotation evidence must match the pinned run profile',
      });
    }
    const expectedRotatedDirection = (
      evidence.representativeRotationDegrees === 90
        ? 'vertical-lr'
        : evidence.representativeRotationDegrees === 270
          ? 'vertical-rl'
          : null
    );
    if (
      expectedRotatedDirection
      && line.providerTextDirection !== expectedRotatedDirection
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          'segmentation',
          'lines',
          index,
          'providerTextDirection',
        ],
        message: 'Rotated line direction must be projected into source space',
      });
    }
  });
});

export type KrakenNativePageLayoutV2 = z.infer<
  typeof krakenNativePageLayoutV2Schema
>;

function direction(
  value: PageLayoutTextDirection,
): PageLayoutDirection {
  switch (value) {
    case 'horizontal-lr':
      return 'left-to-right';
    case 'horizontal-rl':
      return 'right-to-left';
    case 'vertical-lr':
      return 'top-to-bottom';
    case 'vertical-rl':
      return 'bottom-to-top';
  }
}

function box(value: [number, number, number, number]) {
  return {
    xMin: value[0],
    yMin: value[1],
    xMax: value[2],
    yMax: value[3],
  };
}

function positiveBox(value: [number, number, number, number]) {
  return value[2] > value[0] && value[3] > value[1]
    ? box(value)
    : undefined;
}

export interface KrakenPageLayoutAdapterContext {
  pageId: string;
  expectedSourceChecksumSha256: string;
  runId?: string;
}

/**
 * Validates the provider envelope before mapping it into the application's
 * provider-neutral PageLayoutV2 contract.
 */
export function adaptKrakenNativePageLayoutV2(
  input: unknown,
  context: KrakenPageLayoutAdapterContext,
): PageLayoutV2 {
  const native = krakenNativePageLayoutV2Schema.parse(input);
  if (native.source.original.sha256 !== context.expectedSourceChecksumSha256) {
    throw new Error(
      'Kraken layout source checksum does not match the current page source',
    );
  }

  const layoutHash = pageLayoutChecksum({
    source: native.source,
    producer: native.producer,
    segmentation: native.segmentation,
  });
  const configParameters = {
    api: native.producer.api,
    modelKind: native.producer.model.kind,
    modelSizeBytes: native.producer.model.sizeBytes,
    ...native.producer.config,
    runtime: native.producer.runtime,
  };
  const configHash = pageLayoutChecksum(configParameters);
  const layoutDirection = direction(native.segmentation.textDirection);

  const lines = native.segmentation.lines.map((line) => {
    const providerTextDirection = line.providerTextDirection
      ?? (
        line.geometry.type === 'bbox'
          ? line.geometry.textDirection
          : native.segmentation.textDirection
      );
    const hasUnresolvedReadingOrder = (
      line.rotationEvidence?.readingOrderSource
      === 'unresolved-rotated-proposal'
    );
    const common = {
      id: line.id,
      ...(line.providerId ? { providerId: line.providerId } : {}),
      ...(!hasUnresolvedReadingOrder
        ? {
          providerOrdinal: line.providerOrdinal,
          sourceLineNumber: line.providerOrdinal,
        }
        : {}),
      text: line.text,
      direction: direction(providerTextDirection),
      providerTextDirection,
      ...(line.rotationEvidence
        ? { rotationEvidence: line.rotationEvidence }
        : {}),
      baseDirection: line.baseDirection,
      tags: line.tags,
      regionIds: line.regionIds,
      unresolvedProviderRegionIds: line.unresolvedProviderRegionIds,
      language: line.language,
      displayExtent: {
        boundingBox: line.displayExtent.bbox
          ? box(line.displayExtent.bbox)
          : null,
        source: line.displayExtent.source,
        derived: line.displayExtent.derived,
      },
    };
    if (line.geometry.type === 'bbox') {
      return {
        ...common,
        kind: 'bbox' as const,
        boundingBox: box(line.geometry.bbox),
      };
    }
    const derivedBoundingBox = line.displayExtent.bbox
      ? positiveBox(line.displayExtent.bbox)
      : undefined;
    return {
      ...common,
      kind: 'baseline' as const,
      baseline: line.geometry.baseline,
      ...(line.geometry.boundary
        ? { boundary: line.geometry.boundary }
        : {}),
      ...(derivedBoundingBox
        ? { boundingBox: derivedBoundingBox }
        : {}),
    };
  });

  const regions = native.segmentation.regions.map((region) => ({
    id: region.id,
    ...(region.providerId ? { providerId: region.providerId } : {}),
    providerOrdinal: region.providerOrdinal,
    type: region.class,
    boundary: region.boundary,
    lineIds: lines
      .filter((_, lineIndex) => (
        native.segmentation.lines[lineIndex].regionIds.includes(region.id)
      ))
      .map((line) => line.id),
    tags: region.tags,
    language: region.language,
  }));

  const primaryId = `order-primary-${layoutHash.slice(0, 16)}`;
  const alternatives = native.segmentation.alternateReadingOrders
    .map((order) => ({
      id: `order-provider-${order.providerOrdinal}-${layoutHash.slice(0, 12)}`,
      direction: layoutDirection,
      lineIds: order.lineIds,
      source: 'provider' as const,
      providerOrdinal: order.providerOrdinal,
      providerIndices: order.providerIndices,
      providerMappingComplete: order.complete,
      complete: order.lineIds.length === lines.length,
    }));

  return pageLayoutV2Schema.parse({
    schemaVersion: 2,
    layoutId: `layout-sha256-${layoutHash}`,
    runId: context.runId ?? `run-sha256-${pageLayoutChecksum({
      source: native.source.normalized.sha256,
      producer: native.producer,
    })}`,
    pageId: context.pageId,
    image: {
      width: native.source.normalized.width,
      height: native.source.normalized.height,
      checksumSha256: native.source.normalized.sha256,
      rasterChecksumSha256: native.source.normalized.rasterSha256,
      rasterChecksumAlgorithm:
        native.source.normalized.rasterChecksumAlgorithm,
      coordinateSpace: {
        unit: 'pixel',
        origin: 'top-left',
        xAxis: 'right',
        yAxis: 'down',
      },
      source: {
        width: native.source.original.width,
        height: native.source.original.height,
        checksumSha256: native.source.original.sha256,
        mode: native.source.original.mode,
        exifOrientation: native.source.original.exifOrientation,
      },
      normalization: native.source.normalization,
    },
    provenance: {
      producer: {
        name: native.producer.engine,
        version: native.producer.engineVersion,
        api: native.producer.api,
      },
      model: {
        name: native.producer.model.name,
        version: `bundled-with-${native.producer.engineVersion}`,
        checksumSha256: native.producer.model.sha256,
        kind: native.producer.model.kind,
        sizeBytes: native.producer.model.sizeBytes,
      },
      config: {
        name: 'kraken-segmentation-task',
        version: '1',
        checksumSha256: configHash,
        parameters: configParameters,
      },
    },
    lineRepresentation: native.segmentation.type,
    textDirection: native.segmentation.textDirection,
    scriptDetection: native.segmentation.scriptDetection,
    language: native.segmentation.language,
    lines,
    regions,
    readingOrder: {
      primary: {
        id: primaryId,
        direction: layoutDirection,
        lineIds: native.segmentation.readingOrder.lineIds,
        source: 'provider',
        complete: true,
      },
      alternatives,
    },
  });
}

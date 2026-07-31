import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseFilename } from '../../services/filename-parser.js';

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const PAGE_KEY_PATTERN = /^\d{3}-[\dX]{8}-[A-Z]\d{2}-\d{2}$/;
export const LETTER_KEY_PATTERN = /^\d{3}-[\dX]{8}-[A-Z]\d{2}$/;
export const RUN_MANIFEST_FILENAME = 'run.v2.json';
export const REQUIRED_LAYOUT_BENCHMARK_SOURCE_PATHS = [
  'benchmarks/layout/engine-configs/smoke.v1.json',
  'package-lock.json',
  'package.json',
  'python/layout_benchmark/__init__.py',
  'python/layout_benchmark/__main__.py',
  'python/layout_benchmark/cli.py',
  'python/layout_benchmark/cohort.py',
  'python/layout_benchmark/engines.py',
  'python/layout_benchmark/kraken_worker.py',
  'python/layout_benchmark/normalization.py',
  'python/layout_benchmark/overlay.py',
  'python/layout_benchmark/paths.py',
  'python/layout_benchmark/preparation.py',
  'python/layout_benchmark/runner.py',
  'python/layout_benchmark/util.py',
  'python/requirements.txt',
  'scripts/run-layout-benchmark.ts',
  'scripts/validate-layout-benchmark-run.ts',
  'src/benchmarks/layout/schemas.ts',
  'src/services/filename-parser.ts',
  'tsconfig.json',
] as const;

const isoTimestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(SHA256_PATTERN);
const safeIdSchema = z.string().regex(SAFE_ID_PATTERN);
const pageKeySchema = z.string().regex(PAGE_KEY_PATTERN);
const finiteNonnegativeSchema = z.number().finite().nonnegative();

export const preparedRasterFingerprintSchema = z.object({
  algorithm: z.literal('sha256-rgb8-v1'),
  sha256: sha256Schema,
}).strict();

const pageMaskPngArtifactSchema = z.object({
  format: z.literal('PNG'),
  mode: z.enum(['L', 'RGB']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
  rasterFingerprint: z.object({
    algorithm: z.enum(['sha256-l8-v1', 'sha256-rgb8-v1']),
    sha256: sha256Schema,
  }).strict(),
}).strict();

export const pageMaskInputStageSchema = z.object({
  schemaVersion: z.literal(1),
  stage: z.literal('source-bound-page-mask-to-kraken-input'),
  coordinateTransform: z.object({
    name: z.literal('identity'),
    coordinateSpace: z.literal('prepared-pixels-top-left'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).passthrough(),
  includeMask: z.object({
    artifact: pageMaskPngArtifactSchema,
  }).passthrough(),
  engineInput: z.object({
    artifact: pageMaskPngArtifactSchema,
  }).passthrough(),
}).passthrough();

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

export function canonicalSourceSnapshotBundleBytes(
  files: Record<string, { sha256: string }>,
): Buffer {
  const entries = Object.entries(files)
    .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
    .map(([originalPath, entry]) => (
      `${JSON.stringify(originalPath)}:${JSON.stringify(entry.sha256)}`
    ));
  return Buffer.from(`{${entries.join(',')}}\n`, 'utf8');
}

export function sourceSnapshotBundleSha256(
  files: Record<string, { sha256: string }>,
): string {
  return createHash('sha256')
    .update(canonicalSourceSnapshotBundleBytes(files))
    .digest('hex');
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const safeRelativePathSchema = z.string()
  .min(1)
  .max(1_024)
  .refine((value) => !value.startsWith('/') && !value.startsWith('\\'), {
    message: 'Path must be relative',
  })
  .refine((value) => !value.includes('\\'), {
    message: 'Path must use POSIX separators',
  })
  .refine((value) => !value.includes('\0') && !/[\u0000-\u001f]/.test(value), {
    message: 'Path cannot contain control characters',
  })
  .refine((value) => {
    const parts = value.split('/');
    return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
  }, {
    message: 'Path cannot contain empty, current-directory, or parent-directory segments',
  });

export const challengeTagSchema = z.enum([
  'ordinary-horizontal',
  'dense-handwriting',
  'faint-ink',
  'bleed-through',
  'adjacent-page-text',
  'background-clutter',
  'skewed-page',
  'curved-lines',
  'marginalia',
  'sideways-text',
  'vertical-text',
  'multi-column',
  'mixed-image-and-text',
  'low-resolution',
  'cropped-text',
  'typed-text',
  'strikeovers',
  'sparse-page',
  'ruled-paper',
  'folded-paper',
  'printed-letterhead',
  'exif-orientation',
]);

const cohortPageSchema = z.object({
  pageNumber: z.number().int().positive().max(99),
  originalFilename: z.string()
    .min(1)
    .max(255)
    .regex(/\.(jpe?g|png|webp|tiff?)$/i),
  checksumSha256: sha256Schema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  challengeTags: z.array(challengeTagSchema),
}).strict();

const cohortLetterSchema = z.object({
  identity: z.object({
    collectionCode: z.string().regex(/^\d{3}$/),
    dateRaw: z.string().regex(/^[\dX]{8}$/),
    type: z.literal('L'),
    typeSequence: z.number().int().min(1).max(99),
  }).strict(),
  selection: z.object({
    kind: z.enum(['user_requested', 'collection_coverage']),
    reason: z.string().min(1).max(2_000),
  }).strict(),
  pages: z.array(cohortPageSchema).min(1),
}).strict();

export const cohortSchema = z.object({
  schemaVersion: z.literal(1),
  cohortId: safeIdSchema,
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(5_000),
  sourceDimensionConvention: z.literal('encoded pixels before EXIF normalization'),
  preprocessingRequirements: z.object({
    applyExifOrientation: z.literal(true),
    recordPreparedInputChecksum: z.literal(true),
    recordPreparedInputDimensions: z.literal(true),
  }).strict(),
  coverage: z.object({
    policy: z.literal('at-least-one-complete-L-record-per-collection'),
    collectionCodesAtSelection: z.array(z.string().regex(/^\d{3}$/)).min(1),
    letterCount: z.number().int().positive(),
    pageCount: z.number().int().positive(),
  }).strict(),
  groundTruth: z.object({
    defaultStatus: z.literal('unannotated'),
    artifactDirectory: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
  }).strict(),
  letters: z.array(cohortLetterSchema).min(1),
}).strict().superRefine((cohort, context) => {
  const pageKeys = new Set<string>();
  const filenames = new Set<string>();
  const letterKeys = new Set<string>();
  const actualCollectionCodes = new Set<string>();
  let pageCount = 0;

  cohort.letters.forEach((letter, letterIndex) => {
    const letterKey = buildLetterKey(letter.identity);
    if (letterKeys.has(letterKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['letters', letterIndex, 'identity'],
        message: `Duplicate letter identity ${letterKey}`,
      });
    }
    letterKeys.add(letterKey);
    actualCollectionCodes.add(letter.identity.collectionCode);

    const pageNumbers = new Set<number>();
    letter.pages.forEach((page, pageIndex) => {
      pageCount += 1;
      const parsed = parseFilename(page.originalFilename);
      if (!parsed) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['letters', letterIndex, 'pages', pageIndex, 'originalFilename'],
          message: 'Filename does not match the archive identity pattern',
        });
        return;
      }

      const filenameMatchesIdentity = (
        parsed.collectionCode === letter.identity.collectionCode
        && parsed.dateRaw === letter.identity.dateRaw
        && parsed.type === letter.identity.type
        && parsed.typeSequence === letter.identity.typeSequence
        && parsed.pageNumber === page.pageNumber
      );
      if (!filenameMatchesIdentity) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['letters', letterIndex, 'pages', pageIndex, 'originalFilename'],
          message: 'Filename identity does not match its enclosing letter/page',
        });
      }

      const pageKey = buildPageKey(letter.identity, page.pageNumber);
      if (pageKeys.has(pageKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['letters', letterIndex, 'pages', pageIndex],
          message: `Duplicate page identity ${pageKey}`,
        });
      }
      if (filenames.has(page.originalFilename)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['letters', letterIndex, 'pages', pageIndex, 'originalFilename'],
          message: `Duplicate source filename ${page.originalFilename}`,
        });
      }
      if (pageNumbers.has(page.pageNumber)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['letters', letterIndex, 'pages', pageIndex, 'pageNumber'],
          message: `Duplicate page number ${page.pageNumber}`,
        });
      }
      if (new Set(page.challengeTags).size !== page.challengeTags.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['letters', letterIndex, 'pages', pageIndex, 'challengeTags'],
          message: 'Challenge tags must be unique per page',
        });
      }
      pageKeys.add(pageKey);
      filenames.add(page.originalFilename);
      pageNumbers.add(page.pageNumber);
    });
    letter.pages.forEach((page, pageIndex) => {
      if (page.pageNumber !== pageIndex + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['letters', letterIndex, 'pages', pageIndex, 'pageNumber'],
          message: 'Complete-letter pages must be sorted and consecutive from page 1',
        });
      }
    });
  });

  if (cohort.coverage.letterCount !== cohort.letters.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['coverage', 'letterCount'],
      message: 'Declared letter count does not match the manifest',
    });
  }
  if (cohort.coverage.pageCount !== pageCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['coverage', 'pageCount'],
      message: 'Declared page count does not match the manifest',
    });
  }

  const declaredCodes = cohort.coverage.collectionCodesAtSelection;
  if (new Set(declaredCodes).size !== declaredCodes.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['coverage', 'collectionCodesAtSelection'],
      message: 'Collection coverage codes must be unique',
    });
  }
  const declaredSorted = [...declaredCodes].sort();
  const actualSorted = [...actualCollectionCodes].sort();
  if (JSON.stringify(declaredSorted) !== JSON.stringify(actualSorted)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['coverage', 'collectionCodesAtSelection'],
      message: 'Declared collection coverage does not match selected letters',
    });
  }
});

export type LayoutCohort = z.infer<typeof cohortSchema>;
export type CohortLetter = z.infer<typeof cohortLetterSchema>;
export type CohortPage = z.infer<typeof cohortPageSchema>;

export interface LetterIdentity {
  collectionCode: string;
  dateRaw: string;
  type: string;
  typeSequence: number;
}

export function buildLetterKey(identity: LetterIdentity): string {
  return [
    identity.collectionCode,
    identity.dateRaw,
    `${identity.type}${String(identity.typeSequence).padStart(2, '0')}`,
  ].join('-');
}

export function buildPageKey(identity: LetterIdentity, pageNumber: number): string {
  return `${buildLetterKey(identity)}-${String(pageNumber).padStart(2, '0')}`;
}

export const canonicalClassSchema = z.enum([
  'text',
  'marginalia',
  'foreign_page',
  'illustration',
  'background',
  'table',
  'header',
  'footer',
  'other',
]);

export const pointSchema = z.object({
  x: finiteNonnegativeSchema.int().max(10_000_000),
  y: finiteNonnegativeSchema.int().max(10_000_000),
}).strict();

function distinctPointCount(points: Array<{ x: number; y: number }>): number {
  return new Set(points.map((point) => `${point.x}:${point.y}`)).size;
}

export const polygonSchema = z.array(pointSchema)
  .min(3)
  .max(10_000)
  .superRefine((points, context) => {
    if (distinctPointCount(points) < 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Polygon must contain at least three distinct points',
      });
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (first && last && first.x === last.x && first.y === last.y) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Polygon must not repeat its first point at the end',
      });
    }
  });

export const baselineSchema = z.array(pointSchema)
  .min(2)
  .max(10_000)
  .refine((points) => distinctPointCount(points) >= 2, {
    message: 'Baseline must contain at least two distinct points',
  });

const orientationSchema = z.number().finite().min(-360).max(360).nullable();
const confidenceSchema = z.number().finite().min(0).max(1).nullable();
const measurableWarningSchema = z.object({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(2_000),
}).strict();

const providerReadingOrderSchema = z.object({
  index: z.number().int().nonnegative(),
  scope: z.enum(['page', 'region']),
  source: z.enum(['provider', 'geometry']),
}).strict().nullable();

const providerProvenanceSchema = z.object({
  provider: z.string().min(1).max(128),
  providerId: z.string().min(1).max(512).nullable(),
  rawClass: z.string().min(1).max(512).nullable(),
  attributes: z.record(jsonValueSchema),
}).strict();

export const normalizedRegionSchema = z.object({
  id: safeIdSchema,
  class: canonicalClassSchema,
  boundary: polygonSchema,
  orientationDegrees: orientationSchema,
  readingOrder: providerReadingOrderSchema,
  confidence: confidenceSchema,
  lineIds: z.array(safeIdSchema),
  provenance: providerProvenanceSchema,
}).strict();

export const normalizedLineSchema = z.object({
  id: safeIdSchema,
  class: canonicalClassSchema,
  boundary: polygonSchema,
  baseline: baselineSchema.nullable(),
  orientationDegrees: orientationSchema,
  readingOrder: providerReadingOrderSchema,
  confidence: confidenceSchema,
  regionId: safeIdSchema.nullable(),
  provenance: providerProvenanceSchema,
}).strict();

const normalizedImageSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  coordinateSpace: z.literal('prepared-pixels-top-left'),
  sourceSha256: sha256Schema,
  preparedSha256: sha256Schema,
  rasterFingerprint: preparedRasterFingerprintSchema.optional(),
}).strict();

function validateGeometryDocument(
  value: {
    image: { width: number; height: number };
    pageBoundary: Array<{ x: number; y: number }>;
    regions: Array<{
      id: string;
      boundary: Array<{ x: number; y: number }>;
      lineIds: string[];
    }>;
    lines: Array<{
      id: string;
      boundary: Array<{ x: number; y: number }>;
      baseline: Array<{ x: number; y: number }> | null;
      regionId: string | null;
    }>;
  },
  context: z.RefinementCtx,
): void {
  const regionIds = new Set<string>();
  const lineIds = new Set<string>();

  value.regions.forEach((region, index) => {
    if (regionIds.has(region.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['regions', index, 'id'],
        message: `Duplicate region id ${region.id}`,
      });
    }
    regionIds.add(region.id);
  });
  value.lines.forEach((line, index) => {
    if (lineIds.has(line.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lines', index, 'id'],
        message: `Duplicate line id ${line.id}`,
      });
    }
    lineIds.add(line.id);
  });

  value.regions.forEach((region, regionIndex) => {
    if (new Set(region.lineIds).size !== region.lineIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['regions', regionIndex, 'lineIds'],
        message: 'Region lineIds must be unique',
      });
    }
    region.lineIds.forEach((lineId, lineIndex) => {
      const line = value.lines.find((candidate) => candidate.id === lineId);
      if (!line) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['regions', regionIndex, 'lineIds', lineIndex],
          message: `Unknown line id ${lineId}`,
        });
      } else if (line.regionId !== region.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['regions', regionIndex, 'lineIds', lineIndex],
          message: `Line ${lineId} does not reference region ${region.id}`,
        });
      }
    });
  });
  value.lines.forEach((line, lineIndex) => {
    if (line.regionId) {
      const owningRegion = value.regions.find((region) => region.id === line.regionId);
      if (!owningRegion) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lines', lineIndex, 'regionId'],
          message: `Unknown region id ${line.regionId}`,
        });
      } else if (!owningRegion.lineIds.includes(line.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lines', lineIndex, 'regionId'],
          message: `Owning region ${line.regionId} does not list line ${line.id}`,
        });
      }
    }
  });

  const geometrySets = [
    { path: ['pageBoundary'] as Array<string | number>, points: value.pageBoundary },
    ...value.regions.map((region, index) => ({
      path: ['regions', index, 'boundary'] as Array<string | number>,
      points: region.boundary,
    })),
    ...value.lines.flatMap((line, index) => [
      {
        path: ['lines', index, 'boundary'] as Array<string | number>,
        points: line.boundary,
      },
      ...(line.baseline ? [{
        path: ['lines', index, 'baseline'] as Array<string | number>,
        points: line.baseline,
      }] : []),
    ]),
  ];
  geometrySets.forEach(({ path, points }) => {
    points.forEach((point, pointIndex) => {
      if (point.x > value.image.width || point.y > value.image.height) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, pointIndex],
          message: 'Geometry point lies outside the declared prepared image',
        });
      }
    });
  });
}

export const normalizedLayoutSchema = z.object({
  schemaVersion: z.literal(1),
  pageKey: pageKeySchema,
  runId: safeIdSchema,
  engineId: safeIdSchema,
  image: normalizedImageSchema,
  pageBoundary: polygonSchema,
  regions: z.array(normalizedRegionSchema),
  lines: z.array(normalizedLineSchema),
  warnings: z.array(measurableWarningSchema),
}).strict().superRefine(validateGeometryDocument);

export type NormalizedLayout = z.infer<typeof normalizedLayoutSchema>;
export type NormalizedRegion = z.infer<typeof normalizedRegionSchema>;
export type NormalizedLine = z.infer<typeof normalizedLineSchema>;

const modelSchema = z.object({
  name: z.string().min(1).max(512),
  sha256: sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
}).strict();

const runErrorSchema = z.object({
  stage: z.string().min(1).max(128),
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(10_000),
  details: jsonValueSchema.optional(),
}).strict();

const artifactRefsSchema = z.object({
  raw: safeRelativePathSchema.optional(),
  normalized: safeRelativePathSchema.optional(),
  overlay: safeRelativePathSchema.optional(),
  error: safeRelativePathSchema.optional(),
  pageMask: safeRelativePathSchema.optional(),
  engineInput: safeRelativePathSchema.optional(),
  inputStage: safeRelativePathSchema.optional(),
}).strict();

const integrityEntrySchema = z.object({
  sha256: sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
}).strict();

const sourceSnapshotEntrySchema = integrityEntrySchema.extend({
  snapshotPath: safeRelativePathSchema,
}).strict();

const runPageSchema = z.object({
  pageKey: pageKeySchema,
  status: z.enum(['succeeded', 'failed']),
  timestamps: z.object({
    startedAt: isoTimestampSchema,
    completedAt: isoTimestampSchema,
  }).strict(),
  durationMs: z.number().int().nonnegative(),
  timings: z.object({
    preparationMs: z.number().int().nonnegative().nullable(),
    engineMs: z.number().int().nonnegative().nullable(),
    inputStageMs: z.number().int().nonnegative().nullable().optional(),
    normalizationMs: z.number().int().nonnegative().nullable(),
    overlayMs: z.number().int().nonnegative().nullable(),
    totalMs: z.number().int().nonnegative(),
    engineUserCpuMs: z.number().int().nonnegative().nullable(),
    engineSystemCpuMs: z.number().int().nonnegative().nullable(),
    providerModelLoadMs: z.number().int().nonnegative().nullable(),
    providerInferenceMs: z.number().int().nonnegative().nullable(),
  }).strict(),
  peakRssBytes: z.number().int().nonnegative().nullable(),
  resourceMeasurement: z.object({
    method: z.enum([
      'usr-bin-time',
      'docker-stats',
      'cgroup-v2-memory.peak',
      'unavailable',
    ]),
    caveat: z.string().min(1).max(2_000).nullable(),
  }).strict(),
  source: z.object({
    relativePath: safeRelativePathSchema,
    filename: z.string().min(1).max(255),
    sha256: sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    exifOrientation: z.number().int().min(1).max(8).nullable(),
  }).strict(),
  prepared: z.object({
    artifact: safeRelativePathSchema,
    sha256: sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    // Optional keeps already-published immutable v2 manifests valid. The
    // store deterministically derives this from prepared.png when absent.
    rasterFingerprint: preparedRasterFingerprintSchema.optional(),
  }).strict().nullable(),
  artifacts: artifactRefsSchema,
  counts: z.object({
    regions: z.number().int().nonnegative(),
    lines: z.number().int().nonnegative(),
  }).strict(),
  warnings: z.array(measurableWarningSchema),
  error: runErrorSchema.nullable(),
}).strict().superRefine((page, context) => {
  if (page.durationMs !== page.timings.totalMs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['timings', 'totalMs'],
      message: 'timings.totalMs must equal durationMs',
    });
  }
  const expectedPrefix = `pages/${page.pageKey}/`;
  const artifactEntries = [
    ...(page.prepared ? [['prepared', page.prepared.artifact] as const] : []),
    ...Object.entries(page.artifacts),
  ];
  artifactEntries.forEach(([kind, artifact]) => {
    if (!artifact.startsWith(expectedPrefix)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: kind === 'prepared' ? ['prepared', 'artifact'] : ['artifacts', kind],
        message: `Artifact must be stored beneath ${expectedPrefix}`,
      });
    }
  });
  if (page.prepared && !page.prepared.artifact.endsWith('/prepared.png')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['prepared', 'artifact'],
      message: 'Prepared artifact must be named prepared.png',
    });
  }
  if (page.artifacts.normalized && !page.artifacts.normalized.endsWith('/normalized-layout.v1.json')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifacts', 'normalized'],
      message: 'Normalized artifact must be named normalized-layout.v1.json',
    });
  }
  if (page.artifacts.overlay && !page.artifacts.overlay.endsWith('/overlay.png')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifacts', 'overlay'],
      message: 'Overlay artifact must be named overlay.png',
    });
  }
  if (page.artifacts.raw && !/\/raw\.(json|xml)$/.test(page.artifacts.raw)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifacts', 'raw'],
      message: 'Raw artifact must be named raw.json or raw.xml',
    });
  }
  if (page.artifacts.error && !page.artifacts.error.endsWith('/error.json')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifacts', 'error'],
      message: 'Error artifact must be named error.json',
    });
  }
  if (page.artifacts.pageMask && !page.artifacts.pageMask.endsWith('/page-mask.png')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifacts', 'pageMask'],
      message: 'Page-mask artifact must be named page-mask.png',
    });
  }
  if (page.artifacts.engineInput && !page.artifacts.engineInput.endsWith('/engine-input.png')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifacts', 'engineInput'],
      message: 'Engine-input artifact must be named engine-input.png',
    });
  }
  if (page.artifacts.inputStage && !page.artifacts.inputStage.endsWith('/input-stage.v1.json')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifacts', 'inputStage'],
      message: 'Input-stage artifact must be named input-stage.v1.json',
    });
  }
  const inputStageArtifactCount = [
    page.artifacts.pageMask,
    page.artifacts.engineInput,
    page.artifacts.inputStage,
  ].filter(Boolean).length;
  if (inputStageArtifactCount !== 0 && inputStageArtifactCount !== 3) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifacts'],
      message: 'Page-mask, engine-input, and input-stage artifacts must be declared together',
    });
  }

  if (page.status === 'succeeded') {
    const requiredTimingStages = [
      'preparationMs',
      'engineMs',
      'normalizationMs',
      'overlayMs',
    ] as const;
    requiredTimingStages.forEach((stage) => {
      if (page.timings[stage] === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['timings', stage],
          message: `Successful pages require a ${stage} timing`,
        });
      }
    });
    if (page.error !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['error'],
        message: 'Successful pages cannot contain an error',
      });
    }
    if (
      !page.prepared
      || !page.artifacts.raw
      || !page.artifacts.normalized
      || !page.artifacts.overlay
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['artifacts'],
        message: 'Successful pages require prepared, raw, normalized, and overlay artifacts',
      });
    }
  } else {
    if (page.error === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['error'],
        message: 'Failed pages require an error',
      });
    }
    if (!page.artifacts.error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['artifacts', 'error'],
        message: 'Failed pages require an error artifact',
      });
    }
  }
});

export const runManifestSchema = z.object({
  schemaVersion: z.literal(2),
  runId: safeIdSchema,
  state: z.enum(['completed', 'completed_with_failures']),
  createdAt: isoTimestampSchema,
  completedAt: isoTimestampSchema,
  cohort: z.object({
    id: safeIdSchema,
    manifestPath: safeRelativePathSchema,
    sha256: sha256Schema,
    selection: z.object({
      scope: z.enum(['smoke', 'full', 'explicit']),
      pageKeys: z.array(pageKeySchema).min(1),
    }).strict(),
  }).strict(),
  engine: z.object({
    id: safeIdSchema,
    adapterVersion: z.string().min(1).max(128),
    package: z.object({
      name: z.string().min(1).max(256),
      version: z.string().min(1).max(128),
    }).strict(),
    models: z.array(modelSchema),
    configuration: z.object({
      profileId: safeIdSchema,
      path: safeRelativePathSchema,
      sha256: sha256Schema,
      values: z.record(jsonValueSchema),
    }).strict(),
    execution: z.object({
      kind: z.enum(['host', 'venv', 'docker']),
      image: z.string().min(1).max(1_024).optional(),
      imageDigest: z.string().min(1).max(512).optional(),
      commandFingerprint: z.string().min(1).max(512),
      pythonVersion: z.string().min(1).max(128),
      inferenceProvider: z.string().min(1).max(512),
      runtimeInference: z.record(jsonValueSchema).optional(),
      dependencies: z.record(z.string().min(1).max(512)),
    }).strict(),
  }).strict(),
  preprocessing: z.object({
    profileId: safeIdSchema,
    path: safeRelativePathSchema,
    profileSha256: sha256Schema,
    library: z.string().min(1).max(256),
    libraryVersion: z.string().min(1).max(128),
    exifPolicy: z.literal('transpose'),
    colorMode: z.literal('RGB'),
    format: z.literal('PNG'),
    encoder: z.record(jsonValueSchema),
  }).strict(),
  environment: z.object({
    git: z.object({
      commit: z.string().min(1).max(128),
      dirty: z.boolean(),
    }).strict(),
    host: z.object({
      os: z.string().min(1).max(128),
      release: z.string().min(1).max(256),
      arch: z.string().min(1).max(128),
      cpuCount: z.number().int().positive(),
      memoryBytes: z.number().int().positive(),
    }).strict(),
    docker: z.record(jsonValueSchema).optional(),
    platformCaveat: z.string().min(1).max(2_000).nullable(),
  }).strict(),
  sourceSnapshot: z.object({
    algorithm: z.literal('sha256'),
    bundleSha256: sha256Schema,
    files: z.record(safeRelativePathSchema, sourceSnapshotEntrySchema)
      .refine((files) => Object.keys(files).length > 0, {
        message: 'Source snapshot must contain at least one file',
      }),
  }).strict(),
  integrity: z.object({
    algorithm: z.literal('sha256'),
    artifacts: z.record(safeRelativePathSchema, integrityEntrySchema)
      .refine((artifacts) => Object.keys(artifacts).length > 0, {
        message: 'Integrity manifest must contain at least one artifact',
      }),
  }).strict(),
  pages: z.array(runPageSchema).min(1),
  summary: z.object({
    selected: z.number().int().positive(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }).strict(),
}).strict().superRefine((run, context) => {
  const pageKeys = run.pages.map((page) => page.pageKey);
  const selectionKeys = run.cohort.selection.pageKeys;
  if (new Set(pageKeys).size !== pageKeys.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pages'],
      message: 'Run page keys must be unique',
    });
  }
  if (new Set(selectionKeys).size !== selectionKeys.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cohort', 'selection', 'pageKeys'],
      message: 'Selected page keys must be unique',
    });
  }
  const actual = [...pageKeys].sort();
  const selected = [...selectionKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(selected)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pages'],
      message: 'Run pages must exactly match the selected cohort pages',
    });
  }

  const succeeded = run.pages.filter((page) => page.status === 'succeeded').length;
  const failed = run.pages.length - succeeded;
  if (
    run.summary.selected !== run.pages.length
    || run.summary.succeeded !== succeeded
    || run.summary.failed !== failed
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['summary'],
      message: 'Run summary counts do not match page results',
    });
  }
  if (
    (failed === 0 && run.state !== 'completed')
    || (failed > 0 && run.state !== 'completed_with_failures')
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['state'],
      message: 'Run state does not agree with page failures',
    });
  }

  const requiredSourcePaths = new Set<string>([
    ...REQUIRED_LAYOUT_BENCHMARK_SOURCE_PATHS,
    run.cohort.manifestPath,
    run.engine.configuration.path,
    run.preprocessing.path,
  ]);
  if (run.pages.some((page) => page.prepared?.rasterFingerprint !== undefined)) {
    requiredSourcePaths.add(
      'src/benchmarks/layout/raster-fingerprint.ts',
    );
  }
  if (run.engine.execution.kind === 'docker') {
    const configuredExecution = run.engine.configuration.values.execution;
    const dockerfile = (
      configuredExecution
      && typeof configuredExecution === 'object'
      && !Array.isArray(configuredExecution)
    )
      ? configuredExecution.dockerfile
      : undefined;
    if (typeof dockerfile !== 'string') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['engine', 'configuration', 'values', 'execution', 'dockerfile'],
        message: 'Docker runs require a configured Dockerfile path',
      });
    } else {
      const dockerfileResult = safeRelativePathSchema.safeParse(dockerfile);
      if (!dockerfileResult.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['engine', 'configuration', 'values', 'execution', 'dockerfile'],
          message: 'Dockerfile path must be a safe backend-relative path',
        });
      } else {
        requiredSourcePaths.add(dockerfile);
      }
    }
  }
  requiredSourcePaths.forEach((requiredPath) => {
    if (!run.sourceSnapshot.files[requiredPath]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceSnapshot', 'files', requiredPath],
        message: `Source snapshot is missing required run input ${requiredPath}`,
      });
    }
  });
  const boundSourceInputs = [
    {
      path: run.cohort.manifestPath,
      sha256: run.cohort.sha256,
      ownerPath: ['cohort', 'sha256'],
      label: 'cohort manifest',
    },
    {
      path: run.engine.configuration.path,
      sha256: run.engine.configuration.sha256,
      ownerPath: ['engine', 'configuration', 'sha256'],
      label: 'engine configuration',
    },
    {
      path: run.preprocessing.path,
      sha256: run.preprocessing.profileSha256,
      ownerPath: ['preprocessing', 'profileSha256'],
      label: 'preprocessing profile',
    },
  ] as const;
  boundSourceInputs.forEach((input) => {
    const snapshot = run.sourceSnapshot.files[input.path];
    if (snapshot && snapshot.sha256 !== input.sha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...input.ownerPath],
        message: `Declared ${input.label} checksum must match its source snapshot`,
      });
    }
  });

  Object.entries(run.sourceSnapshot.files).forEach(([originalPath, snapshot]) => {
    const expectedSnapshotPath = `source-snapshot/${originalPath}`;
    if (snapshot.snapshotPath !== expectedSnapshotPath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceSnapshot', 'files', originalPath, 'snapshotPath'],
        message: `Snapshot path must be ${expectedSnapshotPath}`,
      });
    }
    const integrityEntry = run.integrity.artifacts[snapshot.snapshotPath];
    if (
      integrityEntry
      && (
        integrityEntry.sha256 !== snapshot.sha256
        || integrityEntry.sizeBytes !== snapshot.sizeBytes
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['integrity', 'artifacts', snapshot.snapshotPath],
        message: 'Snapshot integrity entry must match sourceSnapshot metadata',
      });
    }
  });

  run.pages.forEach((page) => {
    if (page.prepared) {
      const preparedIntegrity = run.integrity.artifacts[page.prepared.artifact];
      if (
        preparedIntegrity
        && preparedIntegrity.sha256 !== page.prepared.sha256
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['integrity', 'artifacts', page.prepared.artifact, 'sha256'],
          message: `Prepared integrity checksum must match page metadata for ${page.pageKey}`,
        });
      }
    }
  });

  const expectedBundleSha256 = sourceSnapshotBundleSha256(
    run.sourceSnapshot.files,
  );
  if (run.sourceSnapshot.bundleSha256 !== expectedBundleSha256) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceSnapshot', 'bundleSha256'],
      message: 'Source snapshot bundle checksum does not match canonical path/checksum JSON',
    });
  }

  const integrityReferences: Array<{ path: string; owner: string }> = [];
  run.pages.forEach((page) => {
    if (page.prepared) {
      integrityReferences.push({
        path: page.prepared.artifact,
        owner: `${page.pageKey}:prepared`,
      });
    }
    Object.entries(page.artifacts).forEach(([kind, artifact]) => {
      integrityReferences.push({
        path: artifact,
        owner: `${page.pageKey}:${kind}`,
      });
    });
  });
  Object.entries(run.sourceSnapshot.files).forEach(([originalPath, snapshot]) => {
    integrityReferences.push({
      path: snapshot.snapshotPath,
      owner: `source:${originalPath}`,
    });
  });
  const ownersByPath = new Map<string, string>();
  integrityReferences.forEach((reference) => {
    const existingOwner = ownersByPath.get(reference.path);
    if (existingOwner) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['integrity', 'artifacts', reference.path],
        message: `Artifact path is reused by ${existingOwner} and ${reference.owner}`,
      });
    } else {
      ownersByPath.set(reference.path, reference.owner);
    }
  });
  const expectedIntegrityPaths = [...ownersByPath.keys()].sort(compareUnicodeCodePoints);
  const declaredIntegrityPaths = Object.keys(run.integrity.artifacts)
    .sort(compareUnicodeCodePoints);
  if (JSON.stringify(expectedIntegrityPaths) !== JSON.stringify(declaredIntegrityPaths)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['integrity', 'artifacts'],
      message: 'Integrity coverage must exactly match page artifacts and source snapshots',
    });
  }
});

export type LayoutRunManifest = z.infer<typeof runManifestSchema>;
export type LayoutRunPage = z.infer<typeof runPageSchema>;

export function runManifestPhysicalFiles(run: LayoutRunManifest): string[] {
  return [
    RUN_MANIFEST_FILENAME,
    ...Object.keys(run.integrity.artifacts),
  ].sort(compareUnicodeCodePoints);
}

const humanReadingOrderSchema = z.object({
  index: z.number().int().nonnegative(),
  scope: z.enum(['page', 'region']),
  source: z.literal('human'),
}).strict().nullable();

const annotationRegionSchema = z.object({
  id: safeIdSchema,
  class: canonicalClassSchema,
  boundary: polygonSchema,
  orientationDegrees: orientationSchema,
  readingOrder: humanReadingOrderSchema,
  lineIds: z.array(safeIdSchema),
}).strict();

const annotationLineSchema = z.object({
  id: safeIdSchema,
  class: canonicalClassSchema,
  boundary: polygonSchema,
  baseline: baselineSchema.nullable(),
  orientationDegrees: orientationSchema,
  readingOrder: humanReadingOrderSchema,
  regionId: safeIdSchema.nullable(),
}).strict();

export const annotationUpdateSchema = z.object({
  status: z.enum(['unannotated', 'in_progress', 'complete']),
  image: normalizedImageSchema,
  pageBoundary: polygonSchema,
  regions: z.array(annotationRegionSchema),
  lines: z.array(annotationLineSchema),
  notes: z.string().max(10_000).nullable(),
}).strict().superRefine(validateGeometryDocument);

export const annotationDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  cohortId: safeIdSchema,
  pageKey: pageKeySchema,
  status: z.enum(['unannotated', 'in_progress', 'complete']),
  image: normalizedImageSchema,
  pageBoundary: polygonSchema,
  regions: z.array(annotationRegionSchema),
  lines: z.array(annotationLineSchema),
  notes: z.string().max(10_000).nullable(),
  audit: z.object({
    createdAt: isoTimestampSchema,
    createdBy: safeIdSchema,
    updatedAt: isoTimestampSchema,
    updatedBy: safeIdSchema,
  }).strict(),
}).strict().superRefine(validateGeometryDocument);

export type AnnotationUpdate = z.infer<typeof annotationUpdateSchema>;
export type LayoutAnnotation = z.infer<typeof annotationDocumentSchema>;

export const evaluationFlagSchema = z.enum([
  'missed_line',
  'false_line',
  'split_line',
  'merged_lines',
  'wrong_orientation',
  'wrong_reading_order',
  'foreign_page_detection',
  'foreign_page_false_positive',
  'bad_region',
  'other',
]);

export const repairCountsSchema = z.object({
  missedLinesAdded: z.number().int().nonnegative(),
  falseLinesRemoved: z.number().int().nonnegative(),
  splitLinesJoined: z.number().int().nonnegative(),
  mergedLinesSplit: z.number().int().nonnegative(),
  orientationCorrections: z.number().int().nonnegative(),
  readingOrderCorrections: z.number().int().nonnegative(),
  regionCorrections: z.number().int().nonnegative(),
  other: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}).strict().superRefine((repairs, context) => {
  const computed = (
    repairs.missedLinesAdded
    + repairs.falseLinesRemoved
    + repairs.splitLinesJoined
    + repairs.mergedLinesSplit
    + repairs.orientationCorrections
    + repairs.readingOrderCorrections
    + repairs.regionCorrections
    + repairs.other
  );
  if (repairs.total !== computed) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['total'],
      message: `Total must equal the repair category sum (${computed})`,
    });
  }
});

export const engineAssessmentSchema = z.object({
  flags: z.array(evaluationFlagSchema).max(10),
  repairs: repairCountsSchema,
}).strict().superRefine((assessment, context) => {
  if (new Set(assessment.flags).size !== assessment.flags.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['flags'],
      message: 'Flags must be unique within an engine assessment',
    });
  }
});

const evaluationDecisionInputBaseSchema = z.object({
  leftRunId: safeIdSchema,
  rightRunId: safeIdSchema,
  preference: z.enum(['left', 'right', 'tie', 'neither', 'unreviewed']),
  assessments: z.object({
    left: engineAssessmentSchema,
    right: engineAssessmentSchema,
  }).strict(),
  elapsedMs: z.number().int().nonnegative().max(86_400_000).optional(),
  confidence: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(5_000).optional(),
}).strict();

export const evaluationDecisionInputSchema = evaluationDecisionInputBaseSchema
  .superRefine((decision, context) => {
  if (decision.leftRunId === decision.rightRunId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rightRunId'],
      message: 'A comparison requires two different runs',
    });
  }
  if (decision.elapsedMs === undefined || decision.elapsedMs <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['elapsedMs'],
      message: 'A positive timed review duration is required',
    });
  }
});

const evaluationDecisionSchema = evaluationDecisionInputBaseSchema
  .omit({ leftRunId: true, rightRunId: true })
  .extend({
    pageKey: pageKeySchema,
    comparisonKey: z.string().min(3).max(260),
    leftRunId: safeIdSchema,
    rightRunId: safeIdSchema,
    reviewedAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const evaluationDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  cohortId: safeIdSchema,
  reviewerId: safeIdSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  decisions: z.array(evaluationDecisionSchema),
}).strict().superRefine((evaluation, context) => {
  const keys = new Set<string>();
  evaluation.decisions.forEach((decision, index) => {
    if (decision.leftRunId === decision.rightRunId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decisions', index, 'rightRunId'],
        message: 'A comparison requires two different runs',
      });
    }
    const expectedComparisonKey = [
      decision.leftRunId,
      decision.rightRunId,
    ].sort().join('__');
    if (decision.comparisonKey !== expectedComparisonKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decisions', index, 'comparisonKey'],
        message: 'Comparison key does not match the compared run IDs',
      });
    }
    const key = `${decision.pageKey}:${decision.comparisonKey}`;
    if (keys.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decisions', index],
        message: 'Only one decision may exist per page/comparison',
      });
    }
    keys.add(key);
  });
});

export type EvaluationDecisionInput = z.infer<typeof evaluationDecisionInputSchema>;
export type EvaluationDecision = z.infer<typeof evaluationDecisionSchema>;
export type LayoutEvaluation = z.infer<typeof evaluationDocumentSchema>;

export const pageListQuerySchema = z.object({
  collectionCode: z.string().regex(/^\d{3}$/).optional(),
  challengeTag: challengeTagSchema.optional(),
  groundTruthStatus: z.enum(['unannotated', 'in_progress', 'complete']).optional(),
  runId: safeIdSchema.optional(),
  runStatus: z.enum(['succeeded', 'failed', 'not_selected']).optional(),
}).strict().superRefine((query, context) => {
  if (query.runStatus && !query.runId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['runStatus'],
      message: 'runStatus requires runId',
    });
  }
});

export const scorecardQuerySchema = z.object({
  runIds: z.string().min(1).transform((value, context) => {
    const ids = value.split(',').map((id) => id.trim());
    if (
      ids.length === 0
      || ids.length > 4
      || new Set(ids).size !== ids.length
      || ids.some((id) => !SAFE_ID_PATTERN.test(id))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'runIds must contain 1-4 unique, comma-separated safe IDs',
      });
      return z.NEVER;
    }
    return ids;
  }),
  lineTolerancePx: z.coerce.number().finite().positive().max(1_000).default(20),
  lineIouThreshold: z.coerce.number().finite().min(0).max(1).default(0.3),
  orientationToleranceDegrees: z.coerce.number().finite().positive().max(180).default(10),
}).strict();

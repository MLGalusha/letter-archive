import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  pageLayoutV2Schema,
  type PageLayoutDirection,
  type PageLayoutPoint,
  type PageLayoutProvenance,
  type PageLayoutTextDirection,
  type PageLayoutV2,
} from '../schemas/page-layout-v2.js';
import type { LineSegment } from './line-segments.js';

const finiteCoordinateSchema = z.number().finite().nonnegative();
const legacyBoundingBoxSchema = z.tuple([
  finiteCoordinateSchema,
  finiteCoordinateSchema,
  finiteCoordinateSchema,
  finiteCoordinateSchema,
]).superRefine(([xMin, yMin, xMax, yMax], context) => {
  if (xMax <= xMin || yMax <= yMin) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Legacy bounding boxes must have positive width and height',
    });
  }
});

const legacyPointSchema = z.tuple([
  finiteCoordinateSchema,
  finiteCoordinateSchema,
]);

const legacyBoundaryPointSchema = z.object({
  x: finiteCoordinateSchema,
  y: finiteCoordinateSchema,
}).strict();

const legacyLineSegmentSchema = z.object({
  line: z.number().int(),
  baseline: z.array(legacyPointSchema).min(2),
  bbox: legacyBoundingBoxSchema,
  ocrText: z.string(),
  words: z.array(z.object({
    text: z.string(),
    bbox: legacyBoundingBoxSchema,
  }).strict()).optional(),
  boundary: z.array(legacyBoundaryPointSchema).min(3).optional(),
}).strict();

const legacyLineSegmentsSchema = z.array(legacyLineSegmentSchema);

export interface LegacyLineSegmentReadContext {
  layoutId?: string;
  runId?: string;
  pageId: string;
  image: {
    width: number;
    height: number;
    checksumSha256: string;
  };
  provenance: PageLayoutProvenance;
  direction?: PageLayoutDirection;
  textDirection?: PageLayoutTextDirection;
  pageBoundary?: PageLayoutPoint[];
}

function contentHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 16);
}

function uniqueStableId(
  base: string,
  occurrences: Map<string, number>,
): string {
  const occurrence = (occurrences.get(base) ?? 0) + 1;
  occurrences.set(base, occurrence);
  return occurrence === 1 ? base : `${base}-${occurrence}`;
}

function boundingBox([xMin, yMin, xMax, yMax]: [
  number,
  number,
  number,
  number,
]) {
  return { xMin, yMin, xMax, yMax };
}

function textDirection(
  value: PageLayoutDirection | undefined,
): PageLayoutTextDirection {
  switch (value) {
    case 'right-to-left':
      return 'horizontal-rl';
    case 'top-to-bottom':
      return 'vertical-lr';
    case 'bottom-to-top':
      return 'vertical-rl';
    case 'left-to-right':
    case 'mixed':
    case 'unknown':
    default:
      return 'horizontal-lr';
  }
}

/**
 * Reads the current persisted LineSegment[] shape into the V2 domain contract.
 *
 * IDs are derived from the archive page identity and legacy line/word ordinals,
 * not from provider IDs or editable OCR text, so repeated reads stay stable.
 * The legacy line number, OCR text, baseline, fallback box, optional boundary,
 * word text, word boxes, and array reading order are all retained.
 */
export function readLegacyLineSegmentsAsPageLayoutV2(
  input: readonly LineSegment[],
  context: LegacyLineSegmentReadContext,
): PageLayoutV2 {
  const segments = legacyLineSegmentsSchema.parse(input);
  const lineIdOccurrences = new Map<string, number>();
  const pageIdentityHash = contentHash(context.pageId);

  const lines = segments.map((segment) => {
    const id = uniqueStableId(
      `legacy-line-${pageIdentityHash}-${segment.line}`,
      lineIdOccurrences,
    );

    return {
      id,
      kind: 'baseline' as const,
      sourceLineNumber: segment.line,
      text: segment.ocrText,
      direction: context.direction ?? 'unknown' as const,
      providerTextDirection: context.textDirection
        ?? textDirection(context.direction),
      regionIds: [],
      baseline: segment.baseline.map(([x, y]) => ({ x, y })),
      boundingBox: boundingBox(segment.bbox),
      ...(segment.boundary
        ? { boundary: segment.boundary.map(({ x, y }) => ({ x, y })) }
        : {}),
      ...(segment.words
        ? {
          words: segment.words.map((word, wordIndex) => ({
            id: `${id}-word-${wordIndex + 1}`,
            text: word.text,
            boundingBox: boundingBox(word.bbox),
          })),
        }
        : {}),
    };
  });

  const legacyContentFingerprint = contentHash({
    pageId: context.pageId,
    image: context.image,
    segments,
  });
  const provenanceFingerprint = contentHash(context.provenance);

  return pageLayoutV2Schema.parse({
    schemaVersion: 2,
    layoutId: context.layoutId ?? `legacy-layout-${legacyContentFingerprint}`,
    runId: context.runId ?? `legacy-run-${provenanceFingerprint}`,
    pageId: context.pageId,
    image: {
      ...context.image,
      coordinateSpace: {
        unit: 'pixel',
        origin: 'top-left',
        xAxis: 'right',
        yAxis: 'down',
      },
    },
    provenance: context.provenance,
    lineRepresentation: 'baselines',
    textDirection: context.textDirection ?? textDirection(context.direction),
    scriptDetection: false,
    language: null,
    ...(context.pageBoundary ? { pageBoundary: context.pageBoundary } : {}),
    lines,
    regions: [],
    readingOrder: {
      primary: {
        id: 'legacy-reading-order-primary',
        direction: context.direction ?? 'unknown',
        lineIds: lines.map((line) => line.id),
        source: 'legacy',
        complete: true,
      },
      alternatives: [],
    },
  });
}

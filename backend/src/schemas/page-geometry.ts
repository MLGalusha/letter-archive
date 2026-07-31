import { z } from 'zod';
import {
  lineSegmentsSchema,
  type LineSegment,
  type SegmentGeometryProvenance,
} from './line-segment.js';
import { canonicalJsonChecksum } from '../services/page-layout-checksum.js';

export const geometryChecksumSha256Schema = z.string()
  .regex(/^[0-9a-f]{64}$/);

export const lineSegmentsChecksumSha256Schema = z.string()
  .regex(/^[0-9a-f]{64}$/);

export const geometryReviewStateSchema = z.object({
  trustState: z.enum(['unverified', 'trusted']),
  approvedGeometryRevision: z.number().int().nonnegative().nullable(),
  approvedGeometryChecksumSha256: geometryChecksumSha256Schema.nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
}).strict();

export const pageGeometryEnvelopeSchema = z.object({
  lineSegments: lineSegmentsSchema,
  geometryRevision: z.number().int().nonnegative(),
  geometryChecksumSha256: geometryChecksumSha256Schema,
  lineSegmentsChecksumSha256: lineSegmentsChecksumSha256Schema,
  reviewState: geometryReviewStateSchema,
}).strict();

export type PageGeometryEnvelope = z.infer<typeof pageGeometryEnvelopeSchema>;

const machineProvenance: SegmentGeometryProvenance = {
  source: 'machine',
  operation: 'detected',
  parentSegmentIds: [],
};

export function normalizeGeometryProvenance(
  segment: LineSegment,
): LineSegment {
  return segment.geometryProvenance
    ? segment
    : {
      ...segment,
      geometryProvenance: machineProvenance,
    };
}

export function normalizeLineSegments(value: unknown): LineSegment[] {
  const withStableIds = Array.isArray(value)
    ? value.map((item, index) => (
      item && typeof item === 'object' && !Array.isArray(item)
        ? {
          ...item,
          // Assign before schema validation because native geometry requires
          // an ID even when reading records written before IDs existed.
          id: (item as { id?: unknown }).id === undefined
            ? `legacy:${index}:${String((item as { line?: unknown }).line)}`
            : (item as { id: unknown }).id,
        }
        : item
    ))
    : value;
  return lineSegmentsSchema.parse(withStableIds)
    .map(normalizeGeometryProvenance);
}

export interface SegmentGeometrySnapshot {
  id: string;
  line: number;
  geometryType?: LineSegment['geometryType'];
  providerTextDirection?: LineSegment['providerTextDirection'];
  baseline?: LineSegment['baseline'];
  bbox: LineSegment['bbox'];
  boundary?: LineSegment['boundary'];
  wordBoxes?: Array<LineSegment['bbox']>;
  geometryProvenance: SegmentGeometryProvenance;
}

/**
 * Produces the exact geometry identity that reviewers approve.
 *
 * OCR text, transcript mapping, exclusion, and semantic classification remain
 * mutable review metadata. They cannot silently invalidate a shape approval or
 * pretend that a human changed detector geometry.
 */
export function geometrySnapshot(
  segments: readonly LineSegment[],
): SegmentGeometrySnapshot[] {
  return segments.map((rawSegment, index) => {
    const segment = normalizeGeometryProvenance(rawSegment);
    return {
      id: segment.id ?? `legacy:${index}:${segment.line}`,
      line: segment.line,
      ...(segment.geometryType
        ? { geometryType: segment.geometryType }
        : {}),
      ...(segment.providerTextDirection
        ? { providerTextDirection: segment.providerTextDirection }
        : {}),
      ...(segment.baseline ? { baseline: segment.baseline } : {}),
      bbox: segment.bbox,
      ...(segment.boundary ? { boundary: segment.boundary } : {}),
      ...(segment.words
        ? { wordBoxes: segment.words.map((word) => word.bbox) }
        : {}),
      geometryProvenance: segment.geometryProvenance!,
    };
  });
}

export function pageGeometryChecksum(
  segments: readonly LineSegment[],
): string {
  return canonicalJsonChecksum(geometrySnapshot(segments));
}

/**
 * Produces the optimistic-concurrency identity for the complete editable
 * projection. Unlike the geometry checksum, this intentionally includes OCR,
 * mappings, exclusions, classifications, and every other persisted field.
 */
export function pageLineSegmentsChecksum(value: unknown): string {
  return canonicalJsonChecksum(normalizeLineSegments(value));
}

export interface GeometryChangeEntry {
  segmentId: string;
  provenance: SegmentGeometryProvenance;
}

export interface GeometryChangeSummary {
  created: GeometryChangeEntry[];
  updated: GeometryChangeEntry[];
  deleted: GeometryChangeEntry[];
  reordered: Array<{
    segmentId: string;
    fromLine: number;
    toLine: number;
  }>;
}

function geometryShape(
  segment: SegmentGeometrySnapshot,
): Omit<
  SegmentGeometrySnapshot,
  'id' | 'line' | 'geometryProvenance' | 'providerTextDirection'
> {
  return {
    ...(segment.geometryType
      ? { geometryType: segment.geometryType }
      : {}),
    ...(segment.baseline ? { baseline: segment.baseline } : {}),
    bbox: segment.bbox,
    ...(segment.boundary ? { boundary: segment.boundary } : {}),
    ...(segment.wordBoxes ? { wordBoxes: segment.wordBoxes } : {}),
  };
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalJsonChecksum(left) === canonicalJsonChecksum(right);
}

const creationOperations = new Set([
  'create-box',
  'create-polygon',
  'create-freehand',
  'duplicate',
]);
const editOperations = new Set([
  'resize',
  'move',
  'move-vertex',
  'add-vertex',
  'delete-vertex',
  'reshape',
  'rotate',
  'extend',
  'subtract',
]);

/**
 * Verifies that submitted provenance describes the actual transition from the
 * locked previous snapshot. The client may propose provenance, but it cannot
 * relabel detector evidence or forge training lineage.
 */
export function validateGeometryProvenanceTransition(
  previousSegments: readonly LineSegment[],
  nextSegments: readonly LineSegment[],
): string[] {
  const previous = geometrySnapshot(previousSegments);
  const next = geometrySnapshot(nextSegments);
  const previousById = new Map(previous.map((segment) => [segment.id, segment]));
  const issues: string[] = [];

  for (const segment of next) {
    const prior = previousById.get(segment.id);
    if (!prior) {
      if (
        segment.geometryProvenance.source !== 'human-created'
        || !creationOperations.has(segment.geometryProvenance.operation)
      ) {
        issues.push(
          `New segment ${segment.id} must be human-created with a creation operation`,
        );
      }
      if (
        segment.geometryProvenance.operation === 'duplicate'
        && !segment.geometryProvenance.parentSegmentIds.some((parentId) => (
          previousById.has(parentId)
        ))
      ) {
        issues.push(
          `Duplicated segment ${segment.id} must identify an existing source segment`,
        );
      }
      if (
        segment.geometryProvenance.operation !== 'duplicate'
        && segment.geometryProvenance.parentSegmentIds.length > 0
      ) {
        issues.push(
          `Newly drawn segment ${segment.id} cannot claim source-segment lineage`,
        );
      }
      continue;
    }

    const shapeChanged = !sameCanonicalValue(
      geometryShape(prior),
      geometryShape(segment),
    );
    if (shapeChanged) {
      if (
        segment.geometryProvenance.source !== 'human-adjusted'
        || !editOperations.has(segment.geometryProvenance.operation)
        || !segment.geometryProvenance.parentSegmentIds.includes(segment.id)
      ) {
        issues.push(
          `Changed segment ${segment.id} must be human-adjusted with an edit operation and its stable ID in lineage`,
        );
      }
    } else if (!sameCanonicalValue(
      prior.geometryProvenance,
      segment.geometryProvenance,
    )) {
      issues.push(
        `Unchanged segment ${segment.id} cannot rewrite geometry provenance`,
      );
    }
  }

  return issues;
}

export function geometryChangeSummary(
  previousSegments: readonly LineSegment[],
  nextSegments: readonly LineSegment[],
): GeometryChangeSummary {
  const previous = geometrySnapshot(previousSegments);
  const next = geometrySnapshot(nextSegments);
  const previousById = new Map(previous.map((segment) => [segment.id, segment]));
  const nextById = new Map(next.map((segment) => [segment.id, segment]));
  const created: GeometryChangeEntry[] = [];
  const updated: GeometryChangeEntry[] = [];
  const deleted: GeometryChangeEntry[] = [];
  const reordered: GeometryChangeSummary['reordered'] = [];

  for (const segment of next) {
    const prior = previousById.get(segment.id);
    const entry = {
      segmentId: segment.id,
      provenance: segment.geometryProvenance,
    };
    if (!prior) {
      created.push(entry);
    } else if (
      !sameCanonicalValue(geometryShape(prior), geometryShape(segment))
      || !sameCanonicalValue(
        prior.geometryProvenance,
        segment.geometryProvenance,
      )
    ) {
      updated.push(entry);
    }
    if (prior && prior.line !== segment.line) {
      reordered.push({
        segmentId: segment.id,
        fromLine: prior.line,
        toLine: segment.line,
      });
    }
  }
  for (const segment of previous) {
    if (nextById.has(segment.id)) continue;
    deleted.push({
      segmentId: segment.id,
      provenance: {
        source: 'human-adjusted',
        operation: 'delete',
        parentSegmentIds: [segment.id],
      },
    });
  }

  return { created, updated, deleted, reordered };
}

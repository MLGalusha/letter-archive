import {
  normalizeLineSegments,
} from '../../schemas/page-geometry.js';
import type { LineSegment } from '../../schemas/line-segment.js';
import { canonicalJsonChecksum } from '../page-layout-checksum.js';

function stableId(segment: LineSegment, index: number): string {
  return segment.id ?? `legacy:${index}:${segment.line}`;
}

/**
 * Hash only stored fields that influence automatic alignment. Mutable legacy
 * transcript mappings and OCR text are intentionally excluded: production
 * text evidence must come from a revision-bound recognition artifact.
 */
export function alignmentSegmentInputChecksum(value: unknown): string {
  const segments = normalizeLineSegments(value);
  return canonicalJsonChecksum(segments.map((segment, index) => ({
    id: stableId(segment, index),
    line: segment.line,
    geometryType: segment.geometryType,
    providerOrdinal: segment.providerOrdinal,
    providerTextDirection: segment.providerTextDirection,
    baseline: segment.baseline,
    bbox: segment.bbox,
    bboxSource: segment.bboxSource,
    boundary: segment.boundary,
    regionIds: segment.regionIds,
    geometryProvenance: segment.geometryProvenance,
    excluded: segment.excluded === true,
    segmentClass: segment.segmentClass,
  })));
}

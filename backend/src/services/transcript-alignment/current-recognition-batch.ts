import {
  effectiveRecognitionDirection,
  segmentRecognitionGeometryChecksum,
} from '../../schemas/page-recognition.js';
import type { LineSegment } from '../../schemas/line-segment.js';
import type { PageGeometryEnvelope } from '../../schemas/page-geometry.js';
import {
  CURRENT_TRANSCRIPT_RECOGNITION_INFERENCE,
  CURRENT_TRANSCRIPT_RECOGNITION_PROFILE,
} from './recognition-profile.js';
import {
  alignmentSegmentInputChecksum,
} from './alignment-input-identity.js';

export interface NormalizedRecognitionRaster {
  sourcePath: string;
  sourceChecksumSha256: string;
  rasterPath: string;
  rasterEncodedChecksumSha256: string;
  rasterChecksumSha256: string;
  width: number;
  height: number;
  normalization: {
    operation: string;
    applied: boolean;
    originalExifOrientation: number | null;
    exifReadError: boolean;
    original: {
      width: number;
      height: number;
      mode: string;
    };
    normalized: {
      width: number;
      height: number;
      mode: 'RGB';
    };
  };
}

export interface CurrentRecognitionManifestPageInput {
  pageId: string;
  pageKey?: string;
  primarySourceRevision: number;
  geometry: PageGeometryEnvelope;
  raster: NormalizedRecognitionRaster;
}

function stableId(segment: LineSegment, index: number): string {
  return segment.id ?? `legacy:${index}:${segment.line}`;
}

/**
 * Recognition direction must be explicit in the durable input. Existing
 * provider direction wins; otherwise the stored baseline supplies a
 * deterministic orientation without changing its geometry.
 */
export function recognitionDirection(
  segment: LineSegment,
): NonNullable<LineSegment['providerTextDirection']> {
  return effectiveRecognitionDirection(segment);
}

function manifestSegment(segment: LineSegment, index: number) {
  const id = stableId(segment, index);
  return {
    id,
    segmentGeometryChecksumSha256:
      segmentRecognitionGeometryChecksum({ ...segment, id }),
    textDirection: recognitionDirection(segment),
    bbox: segment.bbox,
    ...(segment.geometryType
      ? { geometryType: segment.geometryType }
      : {}),
    ...(segment.baseline ? { baseline: segment.baseline } : {}),
    ...(segment.boundary ? { boundary: segment.boundary } : {}),
  };
}

export function buildCurrentRecognitionBatchManifest(input: {
  runId: string;
  pages: CurrentRecognitionManifestPageInput[];
}) {
  return {
    schemaVersion: 1 as const,
    kind: 'current-page-recognition-batch' as const,
    runId: input.runId,
    profile: CURRENT_TRANSCRIPT_RECOGNITION_PROFILE,
    inference: CURRENT_TRANSCRIPT_RECOGNITION_INFERENCE,
    pages: input.pages.map((page) => ({
      pageId: page.pageId,
      ...(page.pageKey ? { pageKey: page.pageKey } : {}),
      source: {
        primarySourceRevision: page.primarySourceRevision,
        sourcePath: page.raster.sourcePath,
        sourceChecksumSha256: page.raster.sourceChecksumSha256,
        rasterPath: page.raster.rasterPath,
        rasterEncodedChecksumSha256:
          page.raster.rasterEncodedChecksumSha256,
        rasterChecksumAlgorithm: 'sha256-rgb8-v1' as const,
        rasterChecksumSha256: page.raster.rasterChecksumSha256,
        width: page.raster.width,
        height: page.raster.height,
        normalization: page.raster.normalization,
      },
      geometry: {
        geometryRevision: page.geometry.geometryRevision,
        geometryChecksumSha256: page.geometry.geometryChecksumSha256,
        lineSegmentsChecksumSha256:
          page.geometry.lineSegmentsChecksumSha256,
        alignmentSegmentInputChecksumSha256:
          alignmentSegmentInputChecksum(page.geometry.lineSegments),
      },
      segments: page.geometry.lineSegments.flatMap((segment, index) => (
        segment.excluded === true || segment.segmentClass === 'ignore'
          ? []
          : [manifestSegment(segment, index)]
      )),
    })),
  };
}

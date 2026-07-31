import type {
  TranscriptAlignmentPoint,
  TranscriptAlignmentSegment,
} from '../../../api/admin/transcriptAlignment';

export interface AlignmentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface AlignmentSurfaceSize {
  width: number;
  height: number;
}

function finitePoints(segment: TranscriptAlignmentSegment): TranscriptAlignmentPoint[] {
  return [...segment.boundary, ...(segment.baseline ?? [])].filter(
    ({ x, y }) => Number.isFinite(x) && Number.isFinite(y),
  );
}

export function unionSegmentBounds(
  segments: TranscriptAlignmentSegment[],
  segmentIds: string[],
): AlignmentBounds | null {
  const selectedIds = new Set(segmentIds);
  const points = segments
    .filter((segment) => selectedIds.has(segment.id))
    .flatMap(finitePoints);
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxX: Math.max(...points.map(({ x }) => x)),
    maxY: Math.max(...points.map(({ y }) => y)),
  };
}

export function containedZoomSurfaceSize({
  viewportWidth,
  viewportHeight,
  imageWidth,
  imageHeight,
  zoom,
}: {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
}): AlignmentSurfaceSize {
  if (
    viewportWidth <= 0
    || viewportHeight <= 0
    || imageWidth <= 0
    || imageHeight <= 0
  ) {
    return { width: 0, height: 0 };
  }
  const safeZoom = Math.max(1, zoom);
  const containScale = Math.min(
    viewportWidth / imageWidth,
    viewportHeight / imageHeight,
  );
  return {
    width: imageWidth * containScale * safeZoom,
    height: imageHeight * containScale * safeZoom,
  };
}

export function centeredAlignmentScrollTarget({
  viewportWidth,
  viewportHeight,
  contentWidth,
  contentHeight,
  surfaceLeft,
  surfaceTop,
  surfaceWidth,
  surfaceHeight,
  imageWidth,
  imageHeight,
  bounds,
}: {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
  surfaceLeft: number;
  surfaceTop: number;
  surfaceWidth: number;
  surfaceHeight: number;
  imageWidth: number;
  imageHeight: number;
  bounds: AlignmentBounds | null;
}): { left: number; top: number } {
  const imageCenterX = bounds
    ? (bounds.minX + bounds.maxX) / 2
    : imageWidth / 2;
  const imageCenterY = bounds
    ? (bounds.minY + bounds.maxY) / 2
    : imageHeight / 2;
  const surfaceCenterX = surfaceLeft + (imageCenterX / imageWidth) * surfaceWidth;
  const surfaceCenterY = surfaceTop + (imageCenterY / imageHeight) * surfaceHeight;
  const maxLeft = Math.max(0, contentWidth - viewportWidth);
  const maxTop = Math.max(0, contentHeight - viewportHeight);
  return {
    left: Math.max(0, Math.min(maxLeft, surfaceCenterX - viewportWidth / 2)),
    top: Math.max(0, Math.min(maxTop, surfaceCenterY - viewportHeight / 2)),
  };
}

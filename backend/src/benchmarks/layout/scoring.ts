import type {
  EvaluationDecision,
  LayoutAnnotation,
  LayoutEvaluation,
  LayoutRunManifest,
  NormalizedLayout,
  NormalizedLine,
  NormalizedRegion,
} from './schemas.js';
import { evaluationFlagSchema } from './schemas.js';
import type { CohortPageRecord, LayoutBenchmarkStore } from './store.js';
import { preparedRastersMatch } from './raster-fingerprint.js';

interface Point {
  x: number;
  y: number;
}

interface GeometryItem {
  id: string;
  boundary: Point[];
  baseline?: Point[] | null;
  orientationDegrees?: number | null;
  readingOrder?: { index: number; scope: 'page' | 'region' } | null;
  regionId?: string | null;
}

interface Match {
  leftIndex: number;
  rightIndex: number;
  score: number;
  iou: number;
  distance: number;
}

interface MatchResult {
  matches: Match[];
  leftOnly: number[];
  rightOnly: number[];
  split: number;
  merge: number;
}

export interface ScorecardOptions {
  lineTolerancePx: number;
  lineIouThreshold: number;
  orientationToleranceDegrees: number;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const NON_TARGET_CLASSES = new Set(['foreign_page', 'background', 'illustration']);
const TOLERANCE_REFERENCE_LONG_EDGE_PX = 1_600;
const PAGE_BOUNDARY_RASTER_LONG_EDGE_PX = 256;
const PAGE_BOUNDARY_METHOD = 'rasterized-polygon-iou';
const FOREIGN_PAGE_RASTER_LONG_EDGE_PX = 256;
const FOREIGN_PAGE_RASTER_MIN_EDGE_PX = 16;
const PAGE_BOUNDARY_UNAVAILABLE_WARNING = 'PAGE_BOUNDARY_UNAVAILABLE';
const DERIVED_LINE_BOUNDARY_WARNING = 'LINE_BOUNDARY_DERIVED_FROM_BASELINE';
const DERIVED_LINE_BOUNDARY_SOURCE = 'baseline-envelope';

type CoverageUnavailableReason =
  | 'both_line_boundaries_derived_from_baselines'
  | 'left_line_boundaries_derived_from_baselines'
  | 'right_line_boundaries_derived_from_baselines';

export function effectiveLineTolerancePx(
  configuredTolerancePx: number,
  width: number,
  height: number,
): number {
  return Number((
    configuredTolerancePx
    * (Math.max(width, height) / TOLERANCE_REFERENCE_LONG_EDGE_PX)
  ).toFixed(3));
}

function box(points: Point[]): Box {
  return points.reduce<Box>((result, point) => ({
    minX: Math.min(result.minX, point.x),
    minY: Math.min(result.minY, point.y),
    maxX: Math.max(result.maxX, point.x),
    maxY: Math.max(result.maxY, point.y),
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
}

function boxArea(value: Box): number {
  return Math.max(0, value.maxX - value.minX) * Math.max(0, value.maxY - value.minY);
}

function intersectionArea(left: Box, right: Box): number {
  return (
    Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX))
    * Math.max(0, Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY))
  );
}

function smallerBoxOverlapRatio(left: Box, right: Box): number {
  const smallerArea = Math.min(boxArea(left), boxArea(right));
  return smallerArea > 0 ? intersectionArea(left, right) / smallerArea : 0;
}

function boxIou(leftPoints: Point[], rightPoints: Point[]): number {
  const left = box(leftPoints);
  const right = box(rightPoints);
  const intersection = intersectionArea(left, right);
  const union = boxArea(left) + boxArea(right) - intersection;
  return union > 0 ? intersection / union : 0;
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const crossesRay = (
      (current.y > point.y) !== (previous.y > point.y)
      && point.x < (
        ((previous.x - current.x) * (point.y - current.y))
        / (previous.y - current.y)
      ) + current.x
    );
    if (crossesRay) inside = !inside;
  }
  return inside;
}

/**
 * Deterministic page-polygon intersection sampling. Boundaries are sampled at
 * cell centers after scaling the prepared image to a fixed 256-pixel long edge
 * (or at native resolution for smaller images).
 */
function rasterizedPolygonCellCounts(
  left: Point[],
  right: Point[],
  width: number,
  height: number,
): {
  intersectionCells: number;
  unionCells: number;
  leftCells: number;
} {
  const scale = Math.min(
    1,
    PAGE_BOUNDARY_RASTER_LONG_EDGE_PX / Math.max(width, height),
  );
  const rasterWidth = Math.max(1, Math.ceil(width * scale));
  const rasterHeight = Math.max(1, Math.ceil(height * scale));
  const leftBox = box(left);
  const rightBox = box(right);
  const unionBox = {
    minX: Math.min(leftBox.minX, rightBox.minX),
    minY: Math.min(leftBox.minY, rightBox.minY),
    maxX: Math.max(leftBox.maxX, rightBox.maxX),
    maxY: Math.max(leftBox.maxY, rightBox.maxY),
  };
  const startX = Math.max(0, Math.floor(unionBox.minX * scale));
  const startY = Math.max(0, Math.floor(unionBox.minY * scale));
  const endX = Math.min(rasterWidth, Math.ceil(unionBox.maxX * scale));
  const endY = Math.min(rasterHeight, Math.ceil(unionBox.maxY * scale));

  let intersectionCells = 0;
  let unionCells = 0;
  let leftCells = 0;
  for (let rasterY = startY; rasterY < endY; rasterY += 1) {
    for (let rasterX = startX; rasterX < endX; rasterX += 1) {
      const sample = {
        x: (rasterX + 0.5) / scale,
        y: (rasterY + 0.5) / scale,
      };
      const inLeft = pointInPolygon(sample, left);
      const inRight = pointInPolygon(sample, right);
      if (inLeft || inRight) unionCells += 1;
      if (inLeft && inRight) intersectionCells += 1;
      if (inLeft) leftCells += 1;
    }
  }
  return { intersectionCells, unionCells, leftCells };
}

function rasterizedPolygonIou(
  left: Point[],
  right: Point[],
  width: number,
  height: number,
): number | null {
  const { intersectionCells, unionCells } = rasterizedPolygonCellCounts(
    left,
    right,
    width,
    height,
  );
  return unionCells > 0
    ? Number((intersectionCells / unionCells).toFixed(6))
    : null;
}

function rasterizedCandidateOverlapRatio(
  candidate: Point[],
  exclusion: Point[],
  width: number,
  height: number,
): number | null {
  const candidateBox = box(candidate);
  const minX = Math.max(0, candidateBox.minX);
  const minY = Math.max(0, candidateBox.minY);
  const maxX = Math.min(width, candidateBox.maxX);
  const maxY = Math.min(height, candidateBox.maxY);
  const candidateWidth = maxX - minX;
  const candidateHeight = maxY - minY;
  if (candidateWidth <= 0 || candidateHeight <= 0) return null;

  // Foreign-page candidates are commonly narrow text-line polygons. Sampling
  // them on the page-wide 256px grid can yield zero cells on full-resolution
  // scans. Rasterize within each candidate's own bounds instead, preserving a
  // minimum resolution on its short edge while keeping work bounded.
  const scale = FOREIGN_PAGE_RASTER_LONG_EDGE_PX
    / Math.max(candidateWidth, candidateHeight);
  const rasterWidth = Math.min(
    FOREIGN_PAGE_RASTER_LONG_EDGE_PX,
    Math.max(FOREIGN_PAGE_RASTER_MIN_EDGE_PX, Math.ceil(candidateWidth * scale)),
  );
  const rasterHeight = Math.min(
    FOREIGN_PAGE_RASTER_LONG_EDGE_PX,
    Math.max(FOREIGN_PAGE_RASTER_MIN_EDGE_PX, Math.ceil(candidateHeight * scale)),
  );
  const cellWidth = candidateWidth / rasterWidth;
  const cellHeight = candidateHeight / rasterHeight;
  let candidateCells = 0;
  let intersectionCells = 0;
  for (let rasterY = 0; rasterY < rasterHeight; rasterY += 1) {
    for (let rasterX = 0; rasterX < rasterWidth; rasterX += 1) {
      const sample = {
        x: minX + ((rasterX + 0.5) * cellWidth),
        y: minY + ((rasterY + 0.5) * cellHeight),
      };
      if (!pointInPolygon(sample, candidate)) continue;
      candidateCells += 1;
      if (pointInPolygon(sample, exclusion)) intersectionCells += 1;
    }
  }
  return candidateCells > 0
    ? Number((intersectionCells / candidateCells).toFixed(6))
    : null;
}

function hasProviderPageBoundary(layout: NormalizedLayout): boolean {
  return !layout.warnings.some(
    (warning) => warning.code === PAGE_BOUNDARY_UNAVAILABLE_WARNING,
  );
}

function pageBoundaryAgreement(
  left: NormalizedLayout,
  right: NormalizedLayout,
) {
  const leftAvailable = hasProviderPageBoundary(left);
  const rightAvailable = hasProviderPageBoundary(right);
  let reason: string | null = null;
  if (!leftAvailable && !rightAvailable) reason = 'both_provider_boundaries_unavailable';
  else if (!leftAvailable) reason = 'left_provider_boundary_unavailable';
  else if (!rightAvailable) reason = 'right_provider_boundary_unavailable';

  const iou = reason === null
    ? rasterizedPolygonIou(
      left.pageBoundary,
      right.pageBoundary,
      left.image.width,
      left.image.height,
    )
    : null;
  if (reason === null && iou === null) reason = 'boundary_geometry_has_no_raster_area';
  return {
    method: PAGE_BOUNDARY_METHOD,
    rasterLongEdgePx: PAGE_BOUNDARY_RASTER_LONG_EDGE_PX,
    available: reason === null,
    leftAvailable,
    rightAvailable,
    iou,
    reason,
  };
}

function pageBoundaryAccuracy(
  predicted: NormalizedLayout,
  annotation: LayoutAnnotation,
) {
  if (!hasProviderPageBoundary(predicted)) {
    return {
      method: PAGE_BOUNDARY_METHOD,
      rasterLongEdgePx: PAGE_BOUNDARY_RASTER_LONG_EDGE_PX,
      available: false,
      iou: null,
      reason: 'provider_boundary_unavailable',
    };
  }
  const iou = rasterizedPolygonIou(
    annotation.pageBoundary,
    predicted.pageBoundary,
    annotation.image.width,
    annotation.image.height,
  );
  return {
    method: PAGE_BOUNDARY_METHOD,
    rasterLongEdgePx: PAGE_BOUNDARY_RASTER_LONG_EDGE_PX,
    available: iou !== null,
    iou,
    reason: iou === null ? 'boundary_geometry_has_no_raster_area' : null,
  };
}

function boxGap(left: Box, right: Box): number {
  const dx = Math.max(left.minX - right.maxX, right.minX - left.maxX, 0);
  const dy = Math.max(left.minY - right.maxY, right.minY - left.maxY, 0);
  return Math.hypot(dx, dy);
}

function axisOverlapRatio(left: Box, right: Box): number {
  const leftWidth = left.maxX - left.minX;
  const leftHeight = left.maxY - left.minY;
  const horizontal = Math.max(leftWidth, right.maxX - right.minX)
    >= Math.max(leftHeight, right.maxY - right.minY);
  if (horizontal) {
    const overlap = Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX));
    const shorter = Math.min(leftWidth, right.maxX - right.minX);
    return shorter > 0 ? overlap / shorter : 0;
  }
  const overlap = Math.max(0, Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY));
  const shorter = Math.min(leftHeight, right.maxY - right.minY);
  return shorter > 0 ? overlap / shorter : 0;
}

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const projected = (
    ((point.x - start.x) * dx + (point.y - start.y) * dy)
    / ((dx * dx) + (dy * dy))
  );
  const t = Math.max(0, Math.min(1, projected));
  return Math.hypot(
    point.x - (start.x + (t * dx)),
    point.y - (start.y + (t * dy)),
  );
}

function pointToPolylineDistance(point: Point, polyline: Point[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    minimum = Math.min(
      minimum,
      pointToSegmentDistance(point, polyline[index - 1], polyline[index]),
    );
  }
  return minimum;
}

function symmetricPolylineDistance(left: Point[], right: Point[]): number {
  const directed = (from: Point[], to: Point[]) => (
    from.reduce((sum, point) => sum + pointToPolylineDistance(point, to), 0) / from.length
  );
  return (directed(left, right) + directed(right, left)) / 2;
}

function centroid(points: Point[]): Point {
  const sum = points.reduce((result, point) => ({
    x: result.x + point.x,
    y: result.y + point.y,
  }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function geometryDistance(left: GeometryItem, right: GeometryItem): number {
  if (
    left.baseline && left.baseline.length >= 2
    && right.baseline && right.baseline.length >= 2
  ) {
    return symmetricPolylineDistance(left.baseline, right.baseline);
  }
  const leftCenter = centroid(left.boundary);
  const rightCenter = centroid(right.boundary);
  return Math.hypot(leftCenter.x - rightCenter.x, leftCenter.y - rightCenter.y);
}

export function matchGeometry(
  left: GeometryItem[],
  right: GeometryItem[],
  tolerancePx: number,
  iouThreshold: number,
): MatchResult {
  const candidates: Match[] = [];
  const topologyAdjacency: boolean[][] = left.map(() => right.map(() => false));

  left.forEach((leftItem, leftIndex) => {
    right.forEach((rightItem, rightIndex) => {
      const leftBox = box(leftItem.boundary);
      const rightBox = box(rightItem.boundary);
      const iou = boxIou(leftItem.boundary, rightItem.boundary);
      const distance = geometryDistance(leftItem, rightItem);
      const gap = boxGap(leftBox, rightBox);
      const overlap = axisOverlapRatio(leftBox, rightBox);
      const matches = (
        iou >= iouThreshold
        || distance <= tolerancePx
        || (gap <= tolerancePx && overlap >= 0.5)
      );
      // Split/merge topology needs stronger evidence than tolerant line
      // matching. Proximity alone makes adjacent, correctly segmented lines
      // look like splits and merges. A fragment or merged line should instead
      // substantially cover the smaller of the two candidate boxes.
      topologyAdjacency[leftIndex][rightIndex] = (
        smallerBoxOverlapRatio(leftBox, rightBox) >= 0.5
      );
      if (matches) {
        const distanceScore = Math.max(0, 1 - (distance / Math.max(1, tolerancePx * 2)));
        candidates.push({
          leftIndex,
          rightIndex,
          score: Math.max(iou, distanceScore),
          iou,
          distance,
        });
      }
    });
  });

  candidates.sort((a, b) => (
    b.score - a.score
    || b.iou - a.iou
    || a.distance - b.distance
    || a.leftIndex - b.leftIndex
    || a.rightIndex - b.rightIndex
  ));
  const usedLeft = new Set<number>();
  const usedRight = new Set<number>();
  const matches: Match[] = [];
  candidates.forEach((candidate) => {
    if (!usedLeft.has(candidate.leftIndex) && !usedRight.has(candidate.rightIndex)) {
      usedLeft.add(candidate.leftIndex);
      usedRight.add(candidate.rightIndex);
      matches.push(candidate);
    }
  });

  const split = topologyAdjacency.reduce(
    (count, row) => count + (row.filter(Boolean).length > 1 ? 1 : 0),
    0,
  );
  let merge = 0;
  right.forEach((_item, rightIndex) => {
    const overlapCount = topologyAdjacency.reduce(
      (count, row) => count + (row[rightIndex] ? 1 : 0),
      0,
    );
    if (overlapCount > 1) merge += 1;
  });

  return {
    matches,
    leftOnly: left.map((_item, index) => index).filter((index) => !usedLeft.has(index)),
    rightOnly: right.map((_item, index) => index).filter((index) => !usedRight.has(index)),
    split,
    merge,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null || precision + recall === 0) return null;
  return Number(((2 * precision * recall) / (precision + recall)).toFixed(6));
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(percentileValue * sorted.length) - 1;
  return sorted[Math.max(0, rank)];
}

function distribution(values: number[]) {
  return {
    count: values.length,
    totalMs: values.reduce((sum, value) => sum + value, 0),
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    minMs: values.length ? Math.min(...values) : null,
    maxMs: values.length ? Math.max(...values) : null,
  };
}

function axialDifference(left: number, right: number): number {
  // A text line is an undirected physical axis: reversing a baseline changes
  // its angle by 180 degrees without changing whether it is horizontal,
  // vertical, or slanted on the page.
  const normalized = (
    ((((left - right) + 90) % 180) + 180) % 180
  ) - 90;
  return Math.abs(normalized);
}

function orientationAgreement(
  left: GeometryItem[],
  right: GeometryItem[],
  matches: Match[],
  toleranceDegrees: number,
): { evaluated: number; correct: number; accuracy: number | null } {
  let evaluated = 0;
  let correct = 0;
  matches.forEach((match) => {
    const leftOrientation = left[match.leftIndex].orientationDegrees;
    const rightOrientation = right[match.rightIndex].orientationDegrees;
    if (leftOrientation === null || leftOrientation === undefined
      || rightOrientation === null || rightOrientation === undefined) {
      return;
    }
    evaluated += 1;
    if (axialDifference(leftOrientation, rightOrientation) <= toleranceDegrees) {
      correct += 1;
    }
  });
  return { evaluated, correct, accuracy: ratio(correct, evaluated) };
}

function readingOrderAgreement(
  left: GeometryItem[],
  right: GeometryItem[],
  matches: Match[],
): { evaluatedPairs: number; correctPairs: number; accuracy: number | null } {
  const ordered = matches.filter((match) => (
    left[match.leftIndex].readingOrder
    && right[match.rightIndex].readingOrder
  ));
  let evaluatedPairs = 0;
  let correctPairs = 0;
  for (let firstIndex = 0; firstIndex < ordered.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < ordered.length; secondIndex += 1) {
      const first = ordered[firstIndex];
      const second = ordered[secondIndex];
      const leftFirst = left[first.leftIndex].readingOrder!;
      const leftSecond = left[second.leftIndex].readingOrder!;
      const rightFirst = right[first.rightIndex].readingOrder!;
      const rightSecond = right[second.rightIndex].readingOrder!;
      if (
        leftFirst.scope !== leftSecond.scope
        || rightFirst.scope !== rightSecond.scope
        || (
          leftFirst.scope === 'region'
          && left[first.leftIndex].regionId !== left[second.leftIndex].regionId
        )
        || (
          rightFirst.scope === 'region'
          && right[first.rightIndex].regionId !== right[second.rightIndex].regionId
        )
        || leftFirst.index === leftSecond.index
        || rightFirst.index === rightSecond.index
      ) {
        continue;
      }
      evaluatedPairs += 1;
      if (
        Math.sign(leftFirst.index - leftSecond.index)
        === Math.sign(rightFirst.index - rightSecond.index)
      ) {
        correctPairs += 1;
      }
    }
  }
  return {
    evaluatedPairs,
    correctPairs,
    accuracy: ratio(correctPairs, evaluatedPairs),
  };
}

function rectangleUnionArea(items: GeometryItem[]): number {
  const boxes = items.map((item) => box(item.boundary)).filter((item) => boxArea(item) > 0);
  const xs = [...new Set(boxes.flatMap((item) => [item.minX, item.maxX]))].sort((a, b) => a - b);
  let area = 0;
  for (let index = 1; index < xs.length; index += 1) {
    const startX = xs[index - 1];
    const endX = xs[index];
    const active = boxes
      .filter((item) => item.minX < endX && item.maxX > startX)
      .map((item) => [item.minY, item.maxY] as const)
      .sort((a, b) => a[0] - b[0]);
    if (active.length === 0) continue;
    let coveredY = 0;
    let intervalStart = active[0][0];
    let intervalEnd = active[0][1];
    for (let intervalIndex = 1; intervalIndex < active.length; intervalIndex += 1) {
      const [nextStart, nextEnd] = active[intervalIndex];
      if (nextStart > intervalEnd) {
        coveredY += intervalEnd - intervalStart;
        intervalStart = nextStart;
        intervalEnd = nextEnd;
      } else {
        intervalEnd = Math.max(intervalEnd, nextEnd);
      }
    }
    coveredY += intervalEnd - intervalStart;
    area += (endX - startX) * coveredY;
  }
  return area;
}

function hasDerivedLineBoundaries(layout: NormalizedLayout): boolean {
  return (
    layout.warnings.some(
      (warning) => warning.code === DERIVED_LINE_BOUNDARY_WARNING,
    )
    || layout.lines.some(
      (line) => (
        line.provenance.attributes.boundarySource
        === DERIVED_LINE_BOUNDARY_SOURCE
      ),
    )
  );
}

function pageCoverage(
  left: NormalizedLayout,
  right: NormalizedLayout,
) {
  const leftAvailable = !hasDerivedLineBoundaries(left);
  const rightAvailable = !hasDerivedLineBoundaries(right);
  let reason: CoverageUnavailableReason | null = null;
  if (!leftAvailable && !rightAvailable) {
    reason = 'both_line_boundaries_derived_from_baselines';
  } else if (!leftAvailable) {
    reason = 'left_line_boundaries_derived_from_baselines';
  } else if (!rightAvailable) {
    reason = 'right_line_boundaries_derived_from_baselines';
  }
  if (reason !== null) {
    return {
      method: 'union-of-line-bounding-boxes' as const,
      available: false as const,
      leftAvailable,
      rightAvailable,
      leftFraction: null,
      rightFraction: null,
      signedDelta: null,
      absoluteDelta: null,
      reason,
    };
  }

  const imageArea = left.image.width * left.image.height;
  const leftFraction = ratio(rectangleUnionArea(left.lines), imageArea) ?? 0;
  const rightFraction = ratio(rectangleUnionArea(right.lines), imageArea) ?? 0;
  return {
    method: 'union-of-line-bounding-boxes' as const,
    available: true as const,
    leftAvailable: true,
    rightAvailable: true,
    leftFraction,
    rightFraction,
    signedDelta: Number((leftFraction - rightFraction).toFixed(6)),
    absoluteDelta: Number(Math.abs(leftFraction - rightFraction).toFixed(6)),
    reason: null,
  };
}

function targetLines(
  layout: Pick<NormalizedLayout, 'lines' | 'regions'> | LayoutAnnotation,
): Array<NormalizedLine | LayoutAnnotation['lines'][number]> {
  const regionClasses = new Map(layout.regions.map((region) => [region.id, region.class]));
  return layout.lines.filter((line) => (
    !NON_TARGET_CLASSES.has(line.class)
    && !(line.regionId && NON_TARGET_CLASSES.has(regionClasses.get(line.regionId) ?? ''))
  ));
}

function ordinaryRegions(
  layout: Pick<NormalizedLayout, 'regions'> | LayoutAnnotation,
): Array<NormalizedRegion | LayoutAnnotation['regions'][number]> {
  // Foreign-page exclusions have their own asymmetric scoring contract below.
  // All other canonical region classes remain in ordinary region scoring so
  // illustration, background, marginalia, header, and table classification
  // are not silently reduced to text-line accuracy.
  return layout.regions.filter((region) => region.class !== 'foreign_page');
}

function matchedClassSummary(
  left: Array<{ class: string }>,
  right: Array<{ class: string }>,
  matches: Match[],
) {
  const matched = matches.filter((match) => (
    left[match.leftIndex].class === right[match.rightIndex].class
  )).length;
  return {
    evaluated: matches.length,
    matched,
    mismatched: matches.length - matched,
    agreement: ratio(matched, matches.length),
  };
}

function foreignRegions(annotation: LayoutAnnotation): LayoutAnnotation['regions'] {
  return annotation.regions.filter((region) => region.class === 'foreign_page');
}

function foreignPageCounts(
  predicted: NormalizedLayout,
  annotation: LayoutAnnotation,
): {
  targetFalsePositives: number;
  correctlyClassified: number;
  falseExcludedTargetLines: number;
  correctlyClassifiedRegions: number;
  falseExcludedRegions: number;
  exclusionRegions: number;
} {
  const exclusions = foreignRegions(annotation);
  const predictedRegionClasses = new Map(
    predicted.regions.map((region) => [region.id, region.class]),
  );
  const overlapsExclusion = (boundary: Point[]) => {
    return exclusions.some((region) => (
      (rasterizedCandidateOverlapRatio(
        boundary,
        region.boundary,
        annotation.image.width,
        annotation.image.height,
      ) ?? 0) >= 0.5
    ));
  };
  let targetFalsePositives = 0;
  let correctlyClassified = 0;
  let falseExcludedTargetLines = 0;
  predicted.lines.forEach((line) => {
    const classifiedForeign = (
      line.class === 'foreign_page'
      || (
        line.regionId !== null
        && predictedRegionClasses.get(line.regionId) === 'foreign_page'
      )
    );
    const overlaps = overlapsExclusion(line.boundary);
    if (overlaps && classifiedForeign) {
      correctlyClassified += 1;
    } else if (overlaps) {
      targetFalsePositives += 1;
    } else if (classifiedForeign) {
      falseExcludedTargetLines += 1;
    }
  });
  const predictedForeignRegions = predicted.regions.filter(
    (region) => region.class === 'foreign_page',
  );
  const correctlyClassifiedRegions = predictedForeignRegions.filter(
    (region) => overlapsExclusion(region.boundary),
  ).length;
  return {
    targetFalsePositives,
    correctlyClassified,
    falseExcludedTargetLines,
    correctlyClassifiedRegions,
    falseExcludedRegions: predictedForeignRegions.length - correctlyClassifiedRegions,
    exclusionRegions: exclusions.length,
  };
}

function proxyPageMetrics(
  left: NormalizedLayout,
  right: NormalizedLayout,
  options: ScorecardOptions,
) {
  const effectiveTolerancePx = effectiveLineTolerancePx(
    options.lineTolerancePx,
    left.image.width,
    left.image.height,
  );
  const lineMatch = matchGeometry(
    left.lines,
    right.lines,
    effectiveTolerancePx,
    options.lineIouThreshold,
  );
  const regionMatch = matchGeometry(
    left.regions,
    right.regions,
    effectiveTolerancePx,
    options.lineIouThreshold,
  );
  const lineAgreement = ratio(
    2 * lineMatch.matches.length,
    left.lines.length + right.lines.length,
  );
  const regionAgreement = ratio(
    2 * regionMatch.matches.length,
    left.regions.length + right.regions.length,
  );
  const orientation = orientationAgreement(
    left.lines,
    right.lines,
    lineMatch.matches,
    options.orientationToleranceDegrees,
  );
  const order = readingOrderAgreement(left.lines, right.lines, lineMatch.matches);
  const lineClasses = matchedClassSummary(left.lines, right.lines, lineMatch.matches);
  const regionClasses = matchedClassSummary(
    left.regions,
    right.regions,
    regionMatch.matches,
  );
  const pageBoundary = pageBoundaryAgreement(left, right);
  return {
    effectiveLineTolerancePx: effectiveTolerancePx,
    lines: {
      left: left.lines.length,
      right: right.lines.length,
      matched: lineMatch.matches.length,
      leftOnly: lineMatch.leftOnly.length,
      rightOnly: lineMatch.rightOnly.length,
      splitCandidates: lineMatch.split,
      mergeCandidates: lineMatch.merge,
      agreementF1: lineAgreement,
      classAgreement: lineClasses.agreement,
    },
    regions: {
      left: left.regions.length,
      right: right.regions.length,
      matched: regionMatch.matches.length,
      leftOnly: regionMatch.leftOnly.length,
      rightOnly: regionMatch.rightOnly.length,
      agreementF1: regionAgreement,
      classEvaluated: regionClasses.evaluated,
      classMatches: regionClasses.matched,
      classMismatches: regionClasses.mismatched,
      classAgreement: regionClasses.agreement,
    },
    pageBoundary,
    coverage: pageCoverage(left, right),
    orientationAgreement: orientation,
    readingOrderAgreement: order,
  };
}

function runtimeSummary(run: LayoutRunManifest) {
  const durations = run.pages.map((page) => page.durationMs);
  const successfulDurations = run.pages
    .filter((page) => page.status === 'succeeded')
    .map((page) => page.durationMs);
  const failedDurations = run.pages
    .filter((page) => page.status === 'failed')
    .map((page) => page.durationMs);
  const rss = run.pages.flatMap((page) => page.peakRssBytes === null ? [] : [page.peakRssBytes]);
  const failures = new Map<string, number>();
  const resourceMethods = new Map<string, number>();
  const warnings = new Map<string, number>();
  const timingFields = [
    'preparationMs',
    'engineMs',
    'inputStageMs',
    'normalizationMs',
    'overlayMs',
    'totalMs',
    'engineUserCpuMs',
    'engineSystemCpuMs',
    'providerModelLoadMs',
    'providerInferenceMs',
  ] as const;
  run.pages.forEach((page) => {
    resourceMethods.set(
      page.resourceMeasurement.method,
      (resourceMethods.get(page.resourceMeasurement.method) ?? 0) + 1,
    );
    if (page.error) {
      const key = `${page.error.stage}:${page.error.code}`;
      failures.set(key, (failures.get(key) ?? 0) + 1);
    }
    page.warnings.forEach((warning) => {
      warnings.set(warning.code, (warnings.get(warning.code) ?? 0) + 1);
    });
  });
  const stageTimings = Object.fromEntries(timingFields.map((field) => {
    const values = run.pages.flatMap((page) => {
      const value = page.timings[field];
      return value == null ? [] : [value];
    });
    return [field, {
      count: values.length,
      totalMs: values.reduce((sum, value) => sum + value, 0),
      medianMs: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
    }];
  }));
  return {
    selected: run.summary.selected,
    succeeded: run.summary.succeeded,
    failed: run.summary.failed,
    failureRate: ratio(run.summary.failed, run.summary.selected),
    totalMs: run.summary.durationMs,
    pageDuration: {
      // Compatibility fields intentionally point at successful pages so fast
      // failures can never improve the displayed detector median.
      ...distribution(successfulDurations),
      attempted: distribution(durations),
      successful: distribution(successfulDurations),
      failed: distribution(failedDurations),
    },
    stageTimings,
    memory: {
      measuredPages: rss.length,
      peakRssBytes: rss.length ? Math.max(...rss) : null,
      methods: Object.fromEntries([...resourceMethods.entries()].sort()),
      caveat: 'RSS scope depends on resourceMeasurement.method; compare only like-for-like methods.',
    },
    failures: [...failures.entries()].map(([key, count]) => {
      const separator = key.indexOf(':');
      return {
        stage: key.slice(0, separator),
        code: key.slice(separator + 1),
        count,
      };
    }),
    warnings: Object.fromEntries([...warnings.entries()].sort()),
  };
}

async function runAccuracy(
  store: LayoutBenchmarkStore,
  run: LayoutRunManifest,
  cohortPages: CohortPageRecord[],
  annotations: Map<string, LayoutAnnotation | null>,
  options: ScorecardOptions,
  loadLayout: (runId: string, pageKey: string) => Promise<NormalizedLayout>,
) {
  const totals = {
    tp: 0,
    fp: 0,
    fn: 0,
    split: 0,
    merge: 0,
  };
  const regionTotals = {
    tp: 0,
    fp: 0,
    fn: 0,
    classEvaluated: 0,
    classMatches: 0,
    classMismatches: 0,
  };
  let availableGroundTruthPages = 0;
  let selectedAnnotatedPages = 0;
  let eligiblePages = 0;
  let incomparablePages = 0;
  let pageBoundaryEvaluated = 0;
  let pageBoundaryUnavailable = 0;
  let pageBoundaryIouTotal = 0;
  let orientationEvaluated = 0;
  let orientationCorrect = 0;
  let orderEvaluated = 0;
  let orderCorrect = 0;
  let foreignFalse = 0;
  let foreignClassified = 0;
  let foreignFalseExclusions = 0;
  let foreignClassifiedRegions = 0;
  let foreignFalseExcludedRegions = 0;
  let foreignExclusions = 0;
  const pages: unknown[] = [];
  const runPages = new Map(run.pages.map((page) => [page.pageKey, page]));

  for (const cohortPage of cohortPages) {
    const annotation = annotations.get(cohortPage.pageKey);
    if (!annotation || annotation.status !== 'complete') continue;
    availableGroundTruthPages += 1;
    const runPage = runPages.get(cohortPage.pageKey);
    if (!runPage) continue;
    selectedAnnotatedPages += 1;
    if (!runPage.prepared || runPage.status !== 'succeeded') {
      incomparablePages += 1;
      pages.push({
        pageKey: cohortPage.pageKey,
        eligible: false,
        reason: runPage.status === 'failed' ? 'run_failed' : 'prepared_input_unavailable',
      });
      continue;
    }
    if (
      runPage.prepared.width !== annotation.image.width
      || runPage.prepared.height !== annotation.image.height
    ) {
      incomparablePages += 1;
      pages.push({
        pageKey: cohortPage.pageKey,
        eligible: false,
        reason: 'ground_truth_coordinate_space_mismatch',
      });
      continue;
    }
    const annotationRasterMatches = annotation.image.rasterFingerprint
      ? preparedRastersMatch(
          {
            ...runPage.prepared,
            rasterFingerprint: await store.getPreparedRasterFingerprint(
              run.runId,
              cohortPage.pageKey,
            ),
          },
          annotation.image,
        )
      : runPage.prepared.sha256 === annotation.image.preparedSha256;
    if (!annotationRasterMatches) {
      incomparablePages += 1;
      pages.push({
        pageKey: cohortPage.pageKey,
        eligible: false,
        reason: 'ground_truth_coordinate_space_mismatch',
      });
      continue;
    }
    let layout: NormalizedLayout;
    try {
      layout = await loadLayout(run.runId, cohortPage.pageKey);
    } catch {
      incomparablePages += 1;
      pages.push({
        pageKey: cohortPage.pageKey,
        eligible: false,
        reason: 'normalized_layout_invalid_or_missing',
      });
      continue;
    }
    eligiblePages += 1;
    const truth = targetLines(annotation);
    const predicted = targetLines(layout);
    const truthRegions = ordinaryRegions(annotation);
    const predictedRegions = ordinaryRegions(layout);
    const effectiveTolerancePx = effectiveLineTolerancePx(
      options.lineTolerancePx,
      annotation.image.width,
      annotation.image.height,
    );
    const match = matchGeometry(
      truth,
      predicted,
      effectiveTolerancePx,
      options.lineIouThreshold,
    );
    const regionMatch = matchGeometry(
      truthRegions,
      predictedRegions,
      effectiveTolerancePx,
      options.lineIouThreshold,
    );
    const regionClasses = matchedClassSummary(
      truthRegions,
      predictedRegions,
      regionMatch.matches,
    );
    const boundary = pageBoundaryAccuracy(layout, annotation);
    const orientation = orientationAgreement(
      truth,
      predicted,
      match.matches,
      options.orientationToleranceDegrees,
    );
    const order = readingOrderAgreement(truth, predicted, match.matches);
    const foreign = foreignPageCounts(layout, annotation);
    const pageMetrics = {
      tp: match.matches.length,
      fp: match.rightOnly.length,
      fn: match.leftOnly.length,
      split: match.split,
      merge: match.merge,
    };
    const pageRegionMetrics = {
      tp: regionMatch.matches.length,
      fp: regionMatch.rightOnly.length,
      fn: regionMatch.leftOnly.length,
      classEvaluated: regionClasses.evaluated,
      classMatches: regionClasses.matched,
      classMismatches: regionClasses.mismatched,
    };
    Object.keys(totals).forEach((key) => {
      const metric = key as keyof typeof totals;
      totals[metric] += pageMetrics[metric];
    });
    Object.keys(regionTotals).forEach((key) => {
      const metric = key as keyof typeof regionTotals;
      regionTotals[metric] += pageRegionMetrics[metric];
    });
    if (boundary.available && boundary.iou !== null) {
      pageBoundaryEvaluated += 1;
      pageBoundaryIouTotal += boundary.iou;
    } else {
      pageBoundaryUnavailable += 1;
    }
    orientationEvaluated += orientation.evaluated;
    orientationCorrect += orientation.correct;
    orderEvaluated += order.evaluatedPairs;
    orderCorrect += order.correctPairs;
    foreignFalse += foreign.targetFalsePositives;
    foreignClassified += foreign.correctlyClassified;
    foreignFalseExclusions += foreign.falseExcludedTargetLines;
    foreignClassifiedRegions += foreign.correctlyClassifiedRegions;
    foreignFalseExcludedRegions += foreign.falseExcludedRegions;
    foreignExclusions += foreign.exclusionRegions;
    const linePrecision = ratio(pageMetrics.tp, pageMetrics.tp + pageMetrics.fp);
    const lineRecall = ratio(pageMetrics.tp, pageMetrics.tp + pageMetrics.fn);
    const regionPrecision = ratio(
      pageRegionMetrics.tp,
      pageRegionMetrics.tp + pageRegionMetrics.fp,
    );
    const regionRecall = ratio(
      pageRegionMetrics.tp,
      pageRegionMetrics.tp + pageRegionMetrics.fn,
    );
    pages.push({
      pageKey: cohortPage.pageKey,
      eligible: true,
      effectiveLineTolerancePx: effectiveTolerancePx,
      line: {
        ...pageMetrics,
        precision: linePrecision,
        recall: lineRecall,
        f1: f1(linePrecision, lineRecall),
      },
      region: {
        ...pageRegionMetrics,
        precision: regionPrecision,
        recall: regionRecall,
        f1: f1(regionPrecision, regionRecall),
        classAgreement: regionClasses.agreement,
      },
      pageBoundary: boundary,
      orientation,
      readingOrder: order,
      foreignPage: foreign,
    });
  }

  const linePrecision = ratio(totals.tp, totals.tp + totals.fp);
  const lineRecall = ratio(totals.tp, totals.tp + totals.fn);
  const regionPrecision = ratio(
    regionTotals.tp,
    regionTotals.tp + regionTotals.fp,
  );
  const regionRecall = ratio(
    regionTotals.tp,
    regionTotals.tp + regionTotals.fn,
  );
  return {
    availableGroundTruthPages,
    selectedAnnotatedPages,
    eligiblePages,
    incomparablePages,
    line: {
      ...totals,
      missed: totals.fn,
      spurious: totals.fp,
      precision: linePrecision,
      recall: lineRecall,
      f1: f1(linePrecision, lineRecall),
    },
    region: {
      ...regionTotals,
      precision: regionPrecision,
      recall: regionRecall,
      f1: f1(regionPrecision, regionRecall),
      classAgreement: ratio(
        regionTotals.classMatches,
        regionTotals.classEvaluated,
      ),
    },
    pageBoundary: {
      method: PAGE_BOUNDARY_METHOD,
      rasterLongEdgePx: PAGE_BOUNDARY_RASTER_LONG_EDGE_PX,
      evaluatedPages: pageBoundaryEvaluated,
      unavailablePages: pageBoundaryUnavailable,
      meanIoU: ratio(pageBoundaryIouTotal, pageBoundaryEvaluated),
    },
    orientation: {
      evaluated: orientationEvaluated,
      correct: orientationCorrect,
      accuracy: ratio(orientationCorrect, orientationEvaluated),
    },
    readingOrder: {
      evaluatedPairs: orderEvaluated,
      correctPairs: orderCorrect,
      accuracy: ratio(orderCorrect, orderEvaluated),
    },
    foreignPage: {
      exclusionRegions: foreignExclusions,
      targetFalsePositives: foreignFalse,
      correctlyClassifiedLines: foreignClassified,
      falseExcludedTargetLines: foreignFalseExclusions,
      correctlyClassifiedRegions: foreignClassifiedRegions,
      falseExcludedRegions: foreignFalseExcludedRegions,
    },
    pages,
  };
}

function emptyRepairTotals() {
  return {
    missedLinesAdded: 0,
    falseLinesRemoved: 0,
    splitLinesJoined: 0,
    mergedLinesSplit: 0,
    orientationCorrections: 0,
    readingOrderCorrections: 0,
    regionCorrections: 0,
    other: 0,
    total: 0,
  };
}

function summarizeDecisions(decisions: EvaluationDecision[]) {
  const reviewed = decisions.filter((decision) => decision.preference !== 'unreviewed');
  const preferences = { left: 0, right: 0, tie: 0, neither: 0 };
  const timingValues: number[] = [];
  const runWins = new Map<string, number>();
  const assessmentsByRun = new Map<string, {
    runId: string;
    pages: Set<string>;
    assessmentCount: number;
    flags: Record<string, number>;
    repairs: ReturnType<typeof emptyRepairTotals>;
  }>();
  let confidenceTotal = 0;
  let confidenceCount = 0;
  reviewed.forEach((decision) => {
    preferences[decision.preference as keyof typeof preferences] += 1;
    if (decision.preference === 'left') {
      runWins.set(decision.leftRunId, (runWins.get(decision.leftRunId) ?? 0) + 1);
    } else if (decision.preference === 'right') {
      runWins.set(decision.rightRunId, (runWins.get(decision.rightRunId) ?? 0) + 1);
    }
    ([
      { runId: decision.leftRunId, assessment: decision.assessments.left },
      { runId: decision.rightRunId, assessment: decision.assessments.right },
    ]).forEach(({ runId, assessment }) => {
      const entry = assessmentsByRun.get(runId) ?? {
        runId,
        pages: new Set<string>(),
        assessmentCount: 0,
        flags: Object.fromEntries(
          evaluationFlagSchema.options.map((flag) => [flag, 0]),
        ),
        repairs: emptyRepairTotals(),
      };
      entry.pages.add(decision.pageKey);
      entry.assessmentCount += 1;
      assessment.flags.forEach((flag) => {
        entry.flags[flag] += 1;
      });
      (Object.keys(entry.repairs) as Array<keyof typeof entry.repairs>).forEach((key) => {
        entry.repairs[key] += assessment.repairs[key];
      });
      assessmentsByRun.set(runId, entry);
    });
    if (decision.elapsedMs !== undefined) timingValues.push(decision.elapsedMs);
    if (decision.confidence !== undefined) {
      confidenceTotal += decision.confidence;
      confidenceCount += 1;
    }
  });
  return {
    decisionCount: reviewed.length,
    reviewedPages: new Set(reviewed.map((decision) => decision.pageKey)).size,
    preferences,
    runWins: Object.fromEntries([...runWins.entries()].sort()),
    byRun: [...assessmentsByRun.values()]
      .map((entry) => ({
        runId: entry.runId,
        assessedPages: entry.pages.size,
        assessmentCount: entry.assessmentCount,
        flags: entry.flags,
        repairs: entry.repairs,
      }))
      .sort((left, right) => left.runId.localeCompare(right.runId)),
    timing: {
      count: timingValues.length,
      totalMs: timingValues.reduce((sum, value) => sum + value, 0),
      medianMs: percentile(timingValues, 0.5),
      p95Ms: percentile(timingValues, 0.95),
    },
    confidence: {
      count: confidenceCount,
      mean: confidenceCount > 0
        ? Number((confidenceTotal / confidenceCount).toFixed(3))
        : null,
    },
  };
}

async function pageComparabilityReason(
  store: LayoutBenchmarkStore,
  leftRun: LayoutRunManifest,
  rightRun: LayoutRunManifest,
  pageKey: string,
): Promise<string | null> {
  if (
    leftRun.preprocessing.profileSha256
    !== rightRun.preprocessing.profileSha256
  ) {
    return 'preprocessing_profile_mismatch';
  }
  const leftPage = leftRun.pages.find((page) => page.pageKey === pageKey);
  const rightPage = rightRun.pages.find((page) => page.pageKey === pageKey);
  if (!leftPage || !rightPage) return 'not_selected_by_both_runs';
  if (leftPage.status !== 'succeeded' || rightPage.status !== 'succeeded') {
    return 'one_or_both_runs_failed';
  }
  if (!leftPage.prepared || !rightPage.prepared) {
    return 'prepared_input_unavailable';
  }
  const sameRaster = await store.preparedRunPagesMatch(
    leftRun.runId,
    rightRun.runId,
    pageKey,
  );
  if (
    leftPage.prepared.width !== rightPage.prepared.width
    || leftPage.prepared.height !== rightPage.prepared.height
    || !sameRaster
  ) {
    return 'prepared_raster_or_dimensions_mismatch';
  }
  return null;
}

async function humanSummary(
  store: LayoutBenchmarkStore,
  evaluation: LayoutEvaluation,
  selectedRuns: LayoutRunManifest[],
) {
  const selectedRunIds = selectedRuns.map((run) => run.runId);
  const selectedSet = new Set(selectedRunIds);
  const runsById = new Map(selectedRuns.map((run) => [run.runId, run]));
  const rank = new Map(selectedRunIds.map((runId, index) => [runId, index]));
  const excludedReasons: Record<string, number> = {};
  const selectedDecisions = evaluation.decisions.filter((decision) => (
    selectedSet.has(decision.leftRunId) && selectedSet.has(decision.rightRunId)
  ));
  const comparableDecisions: EvaluationDecision[] = [];
  for (const decision of selectedDecisions) {
    const leftRun = runsById.get(decision.leftRunId);
    const rightRun = runsById.get(decision.rightRunId);
    const reason = leftRun && rightRun
      ? await pageComparabilityReason(
          store,
          leftRun,
          rightRun,
          decision.pageKey,
        )
      : 'run_unavailable';
    if (reason === null) {
      comparableDecisions.push(decision);
    } else {
      excludedReasons[reason] = (excludedReasons[reason] ?? 0) + 1;
    }
  }
  const decisions = comparableDecisions
    .map((decision): EvaluationDecision => {
      const leftRank = rank.get(decision.leftRunId) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(decision.rightRunId) ?? Number.MAX_SAFE_INTEGER;
      if (
        leftRank < rightRank
        || (leftRank === rightRank && decision.leftRunId.localeCompare(decision.rightRunId) <= 0)
      ) {
        return decision;
      }
      return {
        ...decision,
        leftRunId: decision.rightRunId,
        rightRunId: decision.leftRunId,
        preference: decision.preference === 'left'
          ? 'right'
          : decision.preference === 'right'
            ? 'left'
            : decision.preference,
        assessments: {
          left: decision.assessments.right,
          right: decision.assessments.left,
        },
      };
    });
  const groups = new Map<string, EvaluationDecision[]>();
  decisions.forEach((decision) => {
    groups.set(
      decision.comparisonKey,
      [...(groups.get(decision.comparisonKey) ?? []), decision],
    );
  });
  return {
    ...summarizeDecisions(decisions),
    excludedDecisionCount: selectedDecisions.length - comparableDecisions.length,
    excludedReasons,
    byComparison: [...groups.entries()]
      .map(([comparisonKey, grouped]) => ({
        comparisonKey,
        leftRunId: grouped[0].leftRunId,
        rightRunId: grouped[0].rightRunId,
        ...summarizeDecisions(grouped),
      }))
      .sort((left, right) => left.comparisonKey.localeCompare(right.comparisonKey)),
  };
}

export async function buildScorecard(
  store: LayoutBenchmarkStore,
  runIds: string[],
  reviewerId: string,
  options: ScorecardOptions,
) {
  const [cohort, cohortPages, evaluation] = await Promise.all([
    store.loadCohort(),
    store.listCohortPages(),
    store.getEvaluation(reviewerId),
  ]);
  const runs = await Promise.all(runIds.map((runId) => store.getRun(runId)));
  const annotations = new Map<string, LayoutAnnotation | null>();
  await Promise.all(cohortPages.map(async (page) => {
    annotations.set(page.pageKey, await store.getAnnotation(page.pageKey));
  }));
  const layoutPromises = new Map<string, Promise<NormalizedLayout>>();
  const loadLayout = (runId: string, pageKey: string) => {
    const key = `${runId}:${pageKey}`;
    const existing = layoutPromises.get(key);
    if (existing) return existing;
    const promise = store.getNormalizedLayout(runId, pageKey);
    layoutPromises.set(key, promise);
    return promise;
  };

  const runScores = await Promise.all(runs.map(async (run) => ({
    runId: run.runId,
    engineId: run.engine.id,
    state: run.state,
    accuracy: await runAccuracy(
      store,
      run,
      cohortPages,
      annotations,
      options,
      loadLayout,
    ),
    runtime: runtimeSummary(run),
  })));

  const pairwise = [];
  for (let leftIndex = 0; leftIndex < runs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < runs.length; rightIndex += 1) {
      const leftRun = runs[leftIndex];
      const rightRun = runs[rightIndex];
      const leftPages = new Map(leftRun.pages.map((page) => [page.pageKey, page]));
      const rightPages = new Map(rightRun.pages.map((page) => [page.pageKey, page]));
      const pages = [];
      const aggregate = {
        comparablePages: 0,
        incomparablePages: 0,
        reasons: {} as Record<string, number>,
        lines: { left: 0, right: 0, matched: 0, leftOnly: 0, rightOnly: 0 },
        regions: {
          left: 0,
          right: 0,
          matched: 0,
          leftOnly: 0,
          rightOnly: 0,
          classEvaluated: 0,
          classMatches: 0,
          classMismatches: 0,
        },
        coverageAvailablePages: 0,
        coverageUnavailablePages: 0,
        coverageUnavailableReasons: {} as Partial<Record<
          CoverageUnavailableReason,
          number
        >>,
        coverageAbsoluteDeltaTotal: 0,
      };
      let pageBoundaryEvaluated = 0;
      let pageBoundaryUnavailable = 0;
      let pageBoundaryIouTotal = 0;

      for (const cohortPage of cohortPages) {
        const leftPage = leftPages.get(cohortPage.pageKey);
        const rightPage = rightPages.get(cohortPage.pageKey);
        const reason = await pageComparabilityReason(
          store,
          leftRun,
          rightRun,
          cohortPage.pageKey,
        );
        if (reason) {
          aggregate.incomparablePages += 1;
          aggregate.reasons[reason] = (aggregate.reasons[reason] ?? 0) + 1;
          pages.push({
            pageKey: cohortPage.pageKey,
            comparable: false,
            reason,
          });
          continue;
        }

        try {
          const [leftLayout, rightLayout] = await Promise.all([
            loadLayout(leftRun.runId, cohortPage.pageKey),
            loadLayout(rightRun.runId, cohortPage.pageKey),
          ]);
          const metrics = proxyPageMetrics(leftLayout, rightLayout, options);
          aggregate.comparablePages += 1;
          (Object.keys(aggregate.lines) as Array<keyof typeof aggregate.lines>).forEach((key) => {
            aggregate.lines[key] += metrics.lines[key];
          });
          (Object.keys(aggregate.regions) as Array<keyof typeof aggregate.regions>).forEach((key) => {
            aggregate.regions[key] += metrics.regions[key];
          });
          if (metrics.pageBoundary.available && metrics.pageBoundary.iou !== null) {
            pageBoundaryEvaluated += 1;
            pageBoundaryIouTotal += metrics.pageBoundary.iou;
          } else {
            pageBoundaryUnavailable += 1;
          }
          if (
            metrics.coverage.available
            && metrics.coverage.absoluteDelta !== null
          ) {
            aggregate.coverageAvailablePages += 1;
            aggregate.coverageAbsoluteDeltaTotal
              += metrics.coverage.absoluteDelta;
          } else {
            aggregate.coverageUnavailablePages += 1;
            const coverageReason = metrics.coverage.reason;
            if (coverageReason) {
              aggregate.coverageUnavailableReasons[coverageReason] = (
                aggregate.coverageUnavailableReasons[coverageReason] ?? 0
              ) + 1;
            }
          }
          pages.push({
            pageKey: cohortPage.pageKey,
            comparable: true,
            prepared: {
              sha256: leftPage!.prepared!.sha256,
              width: leftPage!.prepared!.width,
              height: leftPage!.prepared!.height,
              rasterFingerprint: await store.getPreparedRasterFingerprint(
                leftRun.runId,
                cohortPage.pageKey,
              ),
            },
            ...metrics,
          });
        } catch {
          const invalidReason = 'normalized_layout_invalid_or_missing';
          aggregate.incomparablePages += 1;
          aggregate.reasons[invalidReason] = (aggregate.reasons[invalidReason] ?? 0) + 1;
          pages.push({
            pageKey: cohortPage.pageKey,
            comparable: false,
            reason: invalidReason,
          });
        }
      }

      pairwise.push({
        leftRunId: leftRun.runId,
        rightRunId: rightRun.runId,
        metricKind: 'proxy_agreement_not_accuracy',
        pages,
        aggregate: {
          ...aggregate,
          lines: {
            ...aggregate.lines,
            agreementF1: ratio(
              2 * aggregate.lines.matched,
              aggregate.lines.left + aggregate.lines.right,
            ),
          },
          regions: {
            ...aggregate.regions,
            agreementF1: ratio(
              2 * aggregate.regions.matched,
              aggregate.regions.left + aggregate.regions.right,
            ),
            classAgreement: ratio(
              aggregate.regions.classMatches,
              aggregate.regions.classEvaluated,
            ),
          },
          pageBoundary: {
            method: PAGE_BOUNDARY_METHOD,
            rasterLongEdgePx: PAGE_BOUNDARY_RASTER_LONG_EDGE_PX,
            evaluatedPages: pageBoundaryEvaluated,
            unavailablePages: pageBoundaryUnavailable,
            meanIoU: ratio(pageBoundaryIouTotal, pageBoundaryEvaluated),
          },
          meanCoverageAbsoluteDelta: ratio(
            aggregate.coverageAbsoluteDeltaTotal,
            aggregate.coverageAvailablePages,
          ),
        },
      });
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    cohortId: cohort.cohortId,
    parameters: {
      ...options,
      toleranceNormalization: {
        method: 'prepared-image-long-edge',
        referenceLongEdgePx: TOLERANCE_REFERENCE_LONG_EDGE_PX,
        configuredToleranceMeaning: 'pixels at the reference long edge',
      },
      pageBoundaryRasterization: {
        method: PAGE_BOUNDARY_METHOD,
        referenceLongEdgePx: PAGE_BOUNDARY_RASTER_LONG_EDGE_PX,
        sampling: 'cell-center',
      },
    },
    metricDefinitions: {
      accuracy: 'Computed only against complete human ground truth in the exact prepared coordinate space.',
      pairwise: 'Cross-provider geometric agreement proxy; agreement does not imply correctness.',
      lineMatching: 'Greedy one-to-one matching using baseline distance, bounding-box IoU, and a per-page tolerance scaled from a 1600px prepared-image long edge.',
      regionMatching: 'Ordinary regions (all classes except foreign_page, which is scored separately) use the same one-to-one geometric matcher; class agreement is computed only across geometrically matched regions.',
      pageBoundary: 'Page-boundary IoU is approximated by deterministic cell-center rasterization at a 256px prepared-image long edge. PAGE_BOUNDARY_UNAVAILABLE frame fallbacks are null and excluded from means.',
      foreignPage: 'A detected line or foreign-page region overlaps an annotated exclusion when at least half of its polygon area lies inside the exclusion, approximated by deterministic candidate-local cell-center rasterization with a 256px long edge and 16px minimum short edge.',
      splitMerge: 'Candidate topology counts; each truth overlapping multiple predictions is a split and vice versa for merge.',
      coverage: 'Union area of provider-predicted line bounding boxes divided by prepared image area; a proxy, not ink coverage. Pages with baseline-derived display envelopes are unavailable and excluded because their synthetic corridor area is not comparable to provider polygons.',
      timing: 'Reviewer elapsed time is stored per comparison/page; engine duration is supplied by each run manifest.',
    },
    runs: runScores,
    pairwise,
    human: await humanSummary(store, evaluation, runs),
  };
}

import type {
  AlignmentPoint,
  RecognizedSegment,
} from './aligner.js';

export type StructuralSegment = Pick<
  RecognizedSegment,
  | 'id'
  | 'regionId'
  | 'orientationDegrees'
  | 'boundary'
  | 'baseline'
  | 'readingOrderIndex'
  | 'flowDirectionSign'
  | 'geometryEvidence'
>;

export type StructuralBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type OrientationFamily = 'horizontal' | 'vertical';

export type StructuralDecisionScope = 'row' | 'component';

export type StructuralDecisionReason =
  | 'missing-geometry'
  | 'region-mismatch'
  | 'orientation-mismatch'
  | 'flow-discontinuity'
  | 'human-gap-fill-boundary'
  | 'along-gap-too-large'
  | 'along-overlap-too-large'
  | 'collinear-fragments'
  | 'same-region-fragment-bridge'
  | 'insufficient-along-overlap'
  | 'component-flow-gap-too-large'
  | 'spatial-flow-neighbors';

export type StructuralDecisionMetrics = {
  orientationDeltaDegrees: number | null;
  alongGap: number | null;
  alongOverlap: number | null;
  alongOverlapRatio: number | null;
  flowGap: number | null;
  flowCenterDistance: number | null;
  flowOverlap: number | null;
  flowOverlapRatio: number | null;
  threshold: number | null;
};

export type StructuralDecision = {
  id: string;
  scope: StructuralDecisionScope;
  outcome: 'joined' | 'separated';
  leftId: string;
  rightId: string;
  reason: StructuralDecisionReason;
  metrics: StructuralDecisionMetrics;
};

export type PhysicalRow = {
  id: string;
  memberSegmentIds: string[];
  orientationDegrees: number;
  orientationFamily: OrientationFamily;
  bounds: StructuralBounds | null;
  sourceReadingOrderIndices: number[];
  sourceRegionIds: string[];
  formation: {
    reason: 'singleton-segment' | 'collinear-fragments';
    decisionIds: string[];
  };
};

export type SpatialFlowComponent = {
  id: string;
  rowIds: string[];
  memberSegmentIds: string[];
  orientationDegrees: number;
  orientationFamily: OrientationFamily;
  bounds: StructuralBounds | null;
  formation: {
    reason: 'single-row' | 'connected-spatial-flow';
    decisionIds: string[];
  };
};

export type StructuralNormalizationOptions = {
  imageWidth?: number;
  imageHeight?: number;
  orientationToleranceDegrees?: number;
  minimumRowFlowTolerance?: number;
  rowFlowThicknessRatio?: number;
  minimumFragmentGapTolerance?: number;
  fragmentGapThicknessRatio?: number;
  fragmentGapPageRatio?: number;
  maximumFragmentGapPageRatio?: number;
  maximumFragmentAlongOverlapRatio?: number;
  maximumSameRegionFragmentGapPageRatio?: number;
  maximumSameRegionFragmentGapWidthRatio?: number;
  minimumSameRegionFragmentFlowOverlapRatio?: number;
  maximumSameRegionFragmentFlowOffsetRatio?: number;
  maximumSameRegionFragmentReadingOrderDistance?: number;
  componentMinimumAlongOverlapRatio?: number;
  componentMinimumAlongOverlap?: number;
  componentMinimumFlowGapTolerance?: number;
  componentFlowGapThicknessRatio?: number;
  componentFlowGapPageRatio?: number;
  componentMaximumFlowGapPageRatio?: number;
};

export type StructuralNormalizationResult = {
  rows: PhysicalRow[];
  components: SpatialFlowComponent[];
  segmentToRowId: Record<string, string>;
  rowToComponentId: Record<string, string>;
  decisions: StructuralDecision[];
};

type ResolvedOptions = Required<StructuralNormalizationOptions>;

type Axis = {
  alongX: number;
  alongY: number;
  flowX: number;
  flowY: number;
};

type Projection = {
  alongStart: number;
  alongEnd: number;
  flowStart: number;
  flowEnd: number;
  flowAnchor: number;
};

type SegmentGeometry = {
  segment: StructuralSegment;
  points: AlignmentPoint[];
  orientationDegrees: number;
  orientationFamily: OrientationFamily;
  bounds: StructuralBounds | null;
};

type RowDraft = {
  memberIds: string[];
};

type RowGeometry = {
  row: PhysicalRow;
  points: AlignmentPoint[];
};

const DEFAULT_OPTIONS: ResolvedOptions = {
  imageWidth: 0,
  imageHeight: 0,
  orientationToleranceDegrees: 12,
  minimumRowFlowTolerance: 12,
  rowFlowThicknessRatio: 0.45,
  minimumFragmentGapTolerance: 24,
  fragmentGapThicknessRatio: 2.5,
  fragmentGapPageRatio: 0.025,
  maximumFragmentGapPageRatio: 0.06,
  maximumFragmentAlongOverlapRatio: 0.55,
  maximumSameRegionFragmentGapPageRatio: 0.11,
  maximumSameRegionFragmentGapWidthRatio: 0.55,
  minimumSameRegionFragmentFlowOverlapRatio: 0.4,
  maximumSameRegionFragmentFlowOffsetRatio: 0.7,
  maximumSameRegionFragmentReadingOrderDistance: 2,
  componentMinimumAlongOverlapRatio: 0.12,
  componentMinimumAlongOverlap: 20,
  componentMinimumFlowGapTolerance: 36,
  componentFlowGapThicknessRatio: 4,
  componentFlowGapPageRatio: 0.03,
  componentMaximumFlowGapPageRatio: 0.12,
};
const TINY_FRAGMENT_MAXIMUM_LARGER_WIDTH_RATIO = 0.08;
const TINY_FRAGMENT_MAXIMUM_PAGE_WIDTH_RATIO = 0.04;
const TINY_FRAGMENT_MAXIMUM_GAP_PAGE_RATIO = 0.03;
const TINY_FRAGMENT_MINIMUM_FLOW_OVERLAP_RATIO = 0.4;
const TINY_FRAGMENT_MAXIMUM_FLOW_OFFSET_RATIO = 0.85;
const TINY_FRAGMENT_MAXIMUM_READING_ORDER_DISTANCE = 4;

function roundMetric(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function finitePoints(
  points: AlignmentPoint[] | null | undefined,
): AlignmentPoint[] {
  return (points ?? []).filter(
    ({ x, y }) => Number.isFinite(x) && Number.isFinite(y),
  );
}

function segmentPoints(segment: StructuralSegment): AlignmentPoint[] {
  const boundary = finitePoints(segment.boundary);
  if (boundary.length > 0) return boundary;
  return finitePoints(segment.baseline);
}

function boundsForPoints(points: AlignmentPoint[]): StructuralBounds | null {
  if (points.length === 0) return null;
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function mergeBounds(
  bounds: Array<StructuralBounds | null>,
): StructuralBounds | null {
  const present = bounds.filter(
    (value): value is StructuralBounds => value !== null,
  );
  if (present.length === 0) return null;
  return {
    left: Math.min(...present.map(({ left }) => left)),
    top: Math.min(...present.map(({ top }) => top)),
    right: Math.max(...present.map(({ right }) => right)),
    bottom: Math.max(...present.map(({ bottom }) => bottom)),
  };
}

function canonicalOrientation(degrees: number): number {
  let result = degrees % 180;
  if (result < -90) result += 180;
  if (result >= 90) result -= 180;
  return result;
}

function orientationFromBaseline(
  baseline: AlignmentPoint[] | null | undefined,
): number | null {
  const points = finitePoints(baseline);
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  const deltaX = last.x - first.x;
  const deltaY = last.y - first.y;
  if (deltaX === 0 && deltaY === 0) return null;
  return canonicalOrientation(
    Math.atan2(deltaY, deltaX) * (180 / Math.PI),
  );
}

function orientationFromBounds(bounds: StructuralBounds | null): number {
  if (!bounds) return 0;
  return bounds.bottom - bounds.top > bounds.right - bounds.left ? -90 : 0;
}

function resolvedOrientation(segment: StructuralSegment): number {
  const baselineOrientation = orientationFromBaseline(segment.baseline);
  if (baselineOrientation !== null) return baselineOrientation;
  if (
    segment.orientationDegrees !== null
    && segment.orientationDegrees !== undefined
    && Number.isFinite(segment.orientationDegrees)
  ) {
    return canonicalOrientation(segment.orientationDegrees);
  }
  return orientationFromBounds(boundsForPoints(segmentPoints(segment)));
}

function meanOrientation(degrees: number[]): number {
  if (degrees.length === 0) return 0;
  const doubled = degrees.map((value) => value * 2 * (Math.PI / 180));
  const sine = doubled.reduce((sum, value) => sum + Math.sin(value), 0);
  const cosine = doubled.reduce((sum, value) => sum + Math.cos(value), 0);
  return canonicalOrientation(
    (Math.atan2(sine, cosine) / 2) * (180 / Math.PI),
  );
}

function orientationDistance(left: number, right: number): number {
  return Math.abs(canonicalOrientation(left - right));
}

function orientationFamily(
  orientationDegrees: number,
): OrientationFamily {
  return Math.abs(orientationDegrees) <= 45 ? 'horizontal' : 'vertical';
}

function axisForOrientation(orientationDegrees: number): Axis {
  const radians = orientationDegrees * (Math.PI / 180);
  const alongX = Math.cos(radians);
  const alongY = Math.sin(radians);
  return {
    alongX,
    alongY,
    flowX: -alongY,
    flowY: alongX,
  };
}

function projectPoint(point: AlignmentPoint, axis: Axis): {
  along: number;
  flow: number;
} {
  return {
    along: (point.x * axis.alongX) + (point.y * axis.alongY),
    flow: (point.x * axis.flowX) + (point.y * axis.flowY),
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function projectionForGeometry(
  points: AlignmentPoint[],
  baseline: AlignmentPoint[] | null | undefined,
  axis: Axis,
): Projection | null {
  if (points.length === 0) return null;
  const projected = points.map((point) => projectPoint(point, axis));
  const alongValues = projected.map(({ along }) => along);
  const flowValues = projected.map(({ flow }) => flow);
  const baselinePoints = finitePoints(baseline);
  const anchorValues = (
    baselinePoints.length > 0 ? baselinePoints : points
  ).map((point) => projectPoint(point, axis).flow);
  return {
    alongStart: Math.min(...alongValues),
    alongEnd: Math.max(...alongValues),
    flowStart: Math.min(...flowValues),
    flowEnd: Math.max(...flowValues),
    flowAnchor: mean(anchorValues),
  };
}

function intervalOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): number {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

function intervalGap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): number {
  return Math.max(0, Math.max(leftStart, rightStart) - Math.min(leftEnd, rightEnd));
}

function emptyMetrics(
  orientationDeltaDegrees: number | null = null,
): StructuralDecisionMetrics {
  return {
    orientationDeltaDegrees,
    alongGap: null,
    alongOverlap: null,
    alongOverlapRatio: null,
    flowGap: null,
    flowCenterDistance: null,
    flowOverlap: null,
    flowOverlapRatio: null,
    threshold: null,
  };
}

function resolvedOptions(
  options: StructuralNormalizationOptions,
): ResolvedOptions {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const nonNegativeKeys: Array<keyof ResolvedOptions> = [
    'imageWidth',
    'imageHeight',
    'orientationToleranceDegrees',
    'minimumRowFlowTolerance',
    'rowFlowThicknessRatio',
    'minimumFragmentGapTolerance',
    'fragmentGapThicknessRatio',
    'fragmentGapPageRatio',
    'maximumFragmentGapPageRatio',
    'maximumFragmentAlongOverlapRatio',
    'maximumSameRegionFragmentGapPageRatio',
    'maximumSameRegionFragmentGapWidthRatio',
    'minimumSameRegionFragmentFlowOverlapRatio',
    'maximumSameRegionFragmentFlowOffsetRatio',
    'maximumSameRegionFragmentReadingOrderDistance',
    'componentMinimumAlongOverlapRatio',
    'componentMinimumAlongOverlap',
    'componentMinimumFlowGapTolerance',
    'componentFlowGapThicknessRatio',
    'componentFlowGapPageRatio',
    'componentMaximumFlowGapPageRatio',
  ];
  nonNegativeKeys.forEach((key) => {
    if (!Number.isFinite(resolved[key]) || resolved[key] < 0) {
      throw new Error(`Structural normalization option ${key} must be non-negative`);
    }
  });
  if (!Number.isInteger(resolved.maximumSameRegionFragmentReadingOrderDistance)) {
    throw new Error(
      'Structural normalization option '
      + 'maximumSameRegionFragmentReadingOrderDistance must be an integer',
    );
  }
  return resolved;
}

function inferredPageBounds(
  geometries: SegmentGeometry[],
  options: ResolvedOptions,
): StructuralBounds {
  const observed = mergeBounds(geometries.map(({ bounds }) => bounds));
  return {
    left: 0,
    top: 0,
    right: options.imageWidth > 0
      ? options.imageWidth
      : Math.max(observed?.right ?? 0, 1),
    bottom: options.imageHeight > 0
      ? options.imageHeight
      : Math.max(observed?.bottom ?? 0, 1),
  };
}

function pageProjectionSpan(
  pageBounds: StructuralBounds,
  axis: Axis,
): { along: number; flow: number } {
  const corners = [
    { x: pageBounds.left, y: pageBounds.top },
    { x: pageBounds.right, y: pageBounds.top },
    { x: pageBounds.right, y: pageBounds.bottom },
    { x: pageBounds.left, y: pageBounds.bottom },
  ].map((point) => projectPoint(point, axis));
  return {
    along: Math.max(...corners.map(({ along }) => along))
      - Math.min(...corners.map(({ along }) => along)),
    flow: Math.max(...corners.map(({ flow }) => flow))
      - Math.min(...corners.map(({ flow }) => flow)),
  };
}

function rowPairDecision(
  left: SegmentGeometry,
  right: SegmentGeometry,
  pageBounds: StructuralBounds,
  options: ResolvedOptions,
): Omit<StructuralDecision, 'id'> {
  if (
    left.segment.geometryEvidence === 'human-gap-fill'
    || right.segment.geometryEvidence === 'human-gap-fill'
  ) {
    return {
      scope: 'row',
      outcome: 'separated',
      leftId: left.segment.id,
      rightId: right.segment.id,
      reason: 'human-gap-fill-boundary',
      metrics: emptyMetrics(),
    };
  }

  if (
    left.segment.regionId
    && right.segment.regionId
    && left.segment.regionId !== right.segment.regionId
  ) {
    return {
      scope: 'row',
      outcome: 'separated',
      leftId: left.segment.id,
      rightId: right.segment.id,
      reason: 'region-mismatch',
      metrics: emptyMetrics(),
    };
  }

  if (left.points.length === 0 || right.points.length === 0) {
    return {
      scope: 'row',
      outcome: 'separated',
      leftId: left.segment.id,
      rightId: right.segment.id,
      reason: 'missing-geometry',
      metrics: emptyMetrics(),
    };
  }

  const orientationDelta = orientationDistance(
    left.orientationDegrees,
    right.orientationDegrees,
  );
  if (orientationDelta > options.orientationToleranceDegrees) {
    return {
      scope: 'row',
      outcome: 'separated',
      leftId: left.segment.id,
      rightId: right.segment.id,
      reason: 'orientation-mismatch',
      metrics: {
        ...emptyMetrics(roundMetric(orientationDelta)),
        threshold: options.orientationToleranceDegrees,
      },
    };
  }

  const sharedOrientation = meanOrientation([
    left.orientationDegrees,
    right.orientationDegrees,
  ]);
  const axis = axisForOrientation(sharedOrientation);
  const leftProjection = projectionForGeometry(
    left.points,
    left.segment.baseline,
    axis,
  );
  const rightProjection = projectionForGeometry(
    right.points,
    right.segment.baseline,
    axis,
  );
  if (!leftProjection || !rightProjection) {
    return {
      scope: 'row',
      outcome: 'separated',
      leftId: left.segment.id,
      rightId: right.segment.id,
      reason: 'missing-geometry',
      metrics: emptyMetrics(roundMetric(orientationDelta)),
    };
  }

  const alongGap = intervalGap(
    leftProjection.alongStart,
    leftProjection.alongEnd,
    rightProjection.alongStart,
    rightProjection.alongEnd,
  );
  const alongOverlap = intervalOverlap(
    leftProjection.alongStart,
    leftProjection.alongEnd,
    rightProjection.alongStart,
    rightProjection.alongEnd,
  );
  const leftAlongSize = leftProjection.alongEnd - leftProjection.alongStart;
  const rightAlongSize = rightProjection.alongEnd - rightProjection.alongStart;
  const alongOverlapRatio = alongOverlap
    / Math.max(Math.min(leftAlongSize, rightAlongSize), 1);
  const flowGap = intervalGap(
    leftProjection.flowStart,
    leftProjection.flowEnd,
    rightProjection.flowStart,
    rightProjection.flowEnd,
  );
  const flowOverlap = intervalOverlap(
    leftProjection.flowStart,
    leftProjection.flowEnd,
    rightProjection.flowStart,
    rightProjection.flowEnd,
  );
  const leftFlowSize = leftProjection.flowEnd - leftProjection.flowStart;
  const rightFlowSize = rightProjection.flowEnd - rightProjection.flowStart;
  const flowOverlapRatio = flowOverlap
    / Math.max(Math.min(leftFlowSize, rightFlowSize), 1);
  const flowCenterDistance = Math.abs(
    leftProjection.flowAnchor - rightProjection.flowAnchor,
  );
  const flowThreshold = Math.max(
    options.minimumRowFlowTolerance,
    Math.min(leftFlowSize, rightFlowSize) * options.rowFlowThicknessRatio,
  );
  const metrics: StructuralDecisionMetrics = {
    orientationDeltaDegrees: roundMetric(orientationDelta),
    alongGap: roundMetric(alongGap),
    alongOverlap: roundMetric(alongOverlap),
    alongOverlapRatio: roundMetric(alongOverlapRatio),
    flowGap: roundMetric(flowGap),
    flowCenterDistance: roundMetric(flowCenterDistance),
    flowOverlap: roundMetric(flowOverlap),
    flowOverlapRatio: roundMetric(flowOverlapRatio),
    threshold: roundMetric(flowThreshold),
  };

  const pageSpan = pageProjectionSpan(pageBounds, axis).along;
  const rawGapLimit = Math.max(
    options.minimumFragmentGapTolerance,
    Math.max(leftFlowSize, rightFlowSize) * options.fragmentGapThicknessRatio,
    pageSpan * options.fragmentGapPageRatio,
  );
  const gapLimit = Math.min(
    rawGapLimit,
    Math.max(
      options.minimumFragmentGapTolerance,
      pageSpan * options.maximumFragmentGapPageRatio,
    ),
  );
  const leftReadingOrder = left.segment.readingOrderIndex;
  const rightReadingOrder = right.segment.readingOrderIndex;
  const hasNearbyReadingOrder = (
    typeof leftReadingOrder === 'number'
    && Number.isFinite(leftReadingOrder)
    && typeof rightReadingOrder === 'number'
    && Number.isFinite(rightReadingOrder)
    && Math.abs(leftReadingOrder - rightReadingOrder)
      <= options.maximumSameRegionFragmentReadingOrderDistance
  );
  const hasCompatibleFlowDirection = !(
    left.segment.flowDirectionSign
    && right.segment.flowDirectionSign
    && left.segment.flowDirectionSign !== right.segment.flowDirectionSign
  );
  const smallerAlongSize = Math.min(leftAlongSize, rightAlongSize);
  const sameRegionBridgeGapLimit = Math.min(
    pageSpan * options.maximumSameRegionFragmentGapPageRatio,
    smallerAlongSize * options.maximumSameRegionFragmentGapWidthRatio,
  );
  const sameRegionFragmentBridge = (
    Boolean(left.segment.regionId)
    && left.segment.regionId === right.segment.regionId
    && hasNearbyReadingOrder
    && hasCompatibleFlowDirection
    && alongGap > 0
    && alongGap <= sameRegionBridgeGapLimit
    && flowOverlapRatio
      >= options.minimumSameRegionFragmentFlowOverlapRatio
    && flowCenterDistance <= (
      Math.max(leftFlowSize, rightFlowSize)
      * options.maximumSameRegionFragmentFlowOffsetRatio
    )
  );
  // Kraken occasionally emits a single letter or numeral beside the rest of
  // its physical row several reading-order positions later. These fragments
  // are too small for the normal gap rule, and may even sit inside the main
  // row's horizontal span. Absorb only extremely narrow, visibly overlapping
  // fragments in the same explicit region. This repairs the three isolated
  // fragments on 007 page 5 without weakening cross-page or marginalia gates.
  const hasTinyFragmentReadingOrder = (
    typeof leftReadingOrder === 'number'
    && Number.isFinite(leftReadingOrder)
    && typeof rightReadingOrder === 'number'
    && Number.isFinite(rightReadingOrder)
    && Math.abs(leftReadingOrder - rightReadingOrder)
      <= TINY_FRAGMENT_MAXIMUM_READING_ORDER_DISTANCE
  );
  const largerAlongSize = Math.max(leftAlongSize, rightAlongSize);
  const sameRegionTinyRowFragment = (
    Boolean(left.segment.regionId)
    && left.segment.regionId === right.segment.regionId
    && hasTinyFragmentReadingOrder
    && hasCompatibleFlowDirection
    && smallerAlongSize
      <= largerAlongSize * TINY_FRAGMENT_MAXIMUM_LARGER_WIDTH_RATIO
    && smallerAlongSize
      <= pageSpan * TINY_FRAGMENT_MAXIMUM_PAGE_WIDTH_RATIO
    && alongGap > 0
    && alongGap <= pageSpan * TINY_FRAGMENT_MAXIMUM_GAP_PAGE_RATIO
    && flowOverlapRatio >= TINY_FRAGMENT_MINIMUM_FLOW_OVERLAP_RATIO
    && flowCenterDistance <= (
      Math.max(leftFlowSize, rightFlowSize)
      * TINY_FRAGMENT_MAXIMUM_FLOW_OFFSET_RATIO
    )
  );
  const requiresSameRegionBridge = (
    flowCenterDistance > flowThreshold
    || alongGap > gapLimit
    || alongOverlapRatio > options.maximumFragmentAlongOverlapRatio
  );

  if (
    flowCenterDistance > flowThreshold
    && !sameRegionFragmentBridge
    && !sameRegionTinyRowFragment
  ) {
    return {
      scope: 'row',
      outcome: 'separated',
      leftId: left.segment.id,
      rightId: right.segment.id,
      reason: 'flow-discontinuity',
      metrics,
    };
  }

  if (
    alongOverlapRatio > options.maximumFragmentAlongOverlapRatio
    && !sameRegionTinyRowFragment
  ) {
    return {
      scope: 'row',
      outcome: 'separated',
      leftId: left.segment.id,
      rightId: right.segment.id,
      reason: 'along-overlap-too-large',
      metrics: {
        ...metrics,
        threshold: options.maximumFragmentAlongOverlapRatio,
      },
    };
  }

  if (
    alongGap > gapLimit
    && !sameRegionFragmentBridge
    && !sameRegionTinyRowFragment
  ) {
    return {
      scope: 'row',
      outcome: 'separated',
      leftId: left.segment.id,
      rightId: right.segment.id,
      reason: 'along-gap-too-large',
      metrics: {
        ...metrics,
        threshold: roundMetric(gapLimit),
      },
    };
  }

  return {
    scope: 'row',
    outcome: 'joined',
    leftId: left.segment.id,
    rightId: right.segment.id,
    reason: requiresSameRegionBridge
      ? 'same-region-fragment-bridge'
      : 'collinear-fragments',
    metrics: {
      ...metrics,
      threshold: roundMetric(
        requiresSameRegionBridge ? sameRegionBridgeGapLimit : gapLimit,
      ),
    },
  };
}

function familyOrder(family: OrientationFamily): number {
  return family === 'horizontal' ? 0 : 1;
}

function compareSegmentGeometry(
  left: SegmentGeometry,
  right: SegmentGeometry,
): number {
  const familyDifference = familyOrder(left.orientationFamily)
    - familyOrder(right.orientationFamily);
  if (familyDifference !== 0) return familyDifference;
  const leftBounds = left.bounds;
  const rightBounds = right.bounds;
  if (!leftBounds && rightBounds) return 1;
  if (leftBounds && !rightBounds) return -1;
  if (leftBounds && rightBounds) {
    const primary = left.orientationFamily === 'horizontal'
      ? leftBounds.top - rightBounds.top
      : leftBounds.left - rightBounds.left;
    if (primary !== 0) return primary;
    const secondary = left.orientationFamily === 'horizontal'
      ? leftBounds.left - rightBounds.left
      : leftBounds.top - rightBounds.top;
    if (secondary !== 0) return secondary;
  }
  return left.segment.id.localeCompare(right.segment.id);
}

function decisionPairKey(leftId: string, rightId: string): string {
  return [leftId, rightId].sort((left, right) => left.localeCompare(right))
    .join('\u0000');
}

function rowProjection(
  geometry: SegmentGeometry,
  rowOrientation: number,
): Projection | null {
  return projectionForGeometry(
    geometry.points,
    geometry.segment.baseline,
    axisForOrientation(rowOrientation),
  );
}

function buildRows(
  geometries: SegmentGeometry[],
  rowDecisions: StructuralDecision[],
): {
  rows: PhysicalRow[];
  segmentToRowId: Record<string, string>;
} {
  const decisionByPair = new Map(
    rowDecisions.map((decision) => [
      decisionPairKey(decision.leftId, decision.rightId),
      decision,
    ]),
  );
  const decisionIdByPair = new Map(
    rowDecisions.map((decision) => [
      decisionPairKey(decision.leftId, decision.rightId),
      decision.id,
    ]),
  );
  const drafts: RowDraft[] = [];
  geometries.slice().sort(compareSegmentGeometry).forEach((geometry) => {
    const candidates = drafts.filter(({ memberIds }) => {
      const relationships = memberIds.map((memberId) => decisionByPair.get(
        decisionPairKey(memberId, geometry.segment.id),
      ));
      return relationships.some((decision) => decision?.outcome === 'joined')
        && relationships.every(
          (decision) => decision?.outcome === 'joined'
            || decision?.reason === 'along-gap-too-large',
        );
    });
    if (candidates.length === 0) {
      drafts.push({ memberIds: [geometry.segment.id] });
      return;
    }

    candidates.sort((left, right) => {
      const leftFirst = geometries.find(
        ({ segment }) => segment.id === left.memberIds[0],
      );
      const rightFirst = geometries.find(
        ({ segment }) => segment.id === right.memberIds[0],
      );
      if (!leftFirst || !rightFirst) return 0;
      const leftDistance = orientationDistance(
        leftFirst.orientationDegrees,
        geometry.orientationDegrees,
      );
      const rightDistance = orientationDistance(
        rightFirst.orientationDegrees,
        geometry.orientationDegrees,
      );
      return leftDistance - rightDistance
        || left.memberIds.join('\u0000').localeCompare(
          right.memberIds.join('\u0000'),
        );
    });
    const target = candidates[0];
    candidates.slice(1).forEach((candidate) => {
      const compatibleWithTarget = target.memberIds.every((leftId) => (
        candidate.memberIds.every((rightId) => {
          const decision = decisionByPair.get(decisionPairKey(
            leftId,
            rightId,
          ));
          return decision?.outcome === 'joined'
            || decision?.reason === 'along-gap-too-large';
        })
      ));
      if (!compatibleWithTarget) return;
      target.memberIds.push(...candidate.memberIds);
      const candidateIndex = drafts.indexOf(candidate);
      if (candidateIndex >= 0) drafts.splice(candidateIndex, 1);
    });
    target.memberIds.push(geometry.segment.id);
  });

  const geometryById = new Map(
    geometries.map((geometry) => [geometry.segment.id, geometry]),
  );
  const rowDrafts = drafts.map(({ memberIds }) => {
    const members = memberIds.map((id) => geometryById.get(id))
      .filter((value): value is SegmentGeometry => value !== undefined);
    const rowOrientation = meanOrientation(
      members.map(({ orientationDegrees }) => orientationDegrees),
    );
    const orderedMembers = members.slice().sort((left, right) => {
      const leftProjection = rowProjection(left, rowOrientation);
      const rightProjection = rowProjection(right, rowOrientation);
      if (leftProjection && rightProjection) {
        const alongDifference = leftProjection.alongStart
          - rightProjection.alongStart;
        if (alongDifference !== 0) return alongDifference;
      }
      const readingOrderDifference = (
        left.segment.readingOrderIndex ?? Number.MAX_SAFE_INTEGER
      ) - (
        right.segment.readingOrderIndex ?? Number.MAX_SAFE_INTEGER
      );
      return readingOrderDifference
        || left.segment.id.localeCompare(right.segment.id);
    });
    const orderedIds = orderedMembers.map(({ segment }) => segment.id);
    const decisionIds: string[] = [];
    for (let leftIndex = 0; leftIndex < orderedIds.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < orderedIds.length;
        rightIndex += 1
      ) {
        const decisionId = decisionIdByPair.get(decisionPairKey(
          orderedIds[leftIndex],
          orderedIds[rightIndex],
        ));
        if (decisionId) decisionIds.push(decisionId);
      }
    }
    return {
      memberSegmentIds: orderedIds,
      orientationDegrees: roundMetric(rowOrientation),
      orientationFamily: orientationFamily(rowOrientation),
      bounds: mergeBounds(orderedMembers.map(({ bounds }) => bounds)),
      sourceReadingOrderIndices: Array.from(new Set(
        orderedMembers
          .map(({ segment }) => segment.readingOrderIndex)
          .filter((value): value is number => value !== null && value !== undefined),
      )).sort((left, right) => left - right),
      sourceRegionIds: Array.from(new Set(
        orderedMembers
          .map(({ segment }) => segment.regionId)
          .filter((value): value is string => Boolean(value)),
      )).sort((left, right) => left.localeCompare(right)),
      formation: {
        reason: orderedIds.length === 1
          ? 'singleton-segment' as const
          : 'collinear-fragments' as const,
        decisionIds: decisionIds.sort((left, right) => left.localeCompare(right)),
      },
    };
  });

  rowDrafts.sort((left, right) => {
    const familyDifference = familyOrder(left.orientationFamily)
      - familyOrder(right.orientationFamily);
    if (familyDifference !== 0) return familyDifference;
    if (left.bounds && right.bounds) {
      const primary = left.orientationFamily === 'horizontal'
        ? left.bounds.top - right.bounds.top
        : left.bounds.left - right.bounds.left;
      if (primary !== 0) return primary;
      const secondary = left.orientationFamily === 'horizontal'
        ? left.bounds.left - right.bounds.left
        : left.bounds.top - right.bounds.top;
      if (secondary !== 0) return secondary;
    } else if (!left.bounds && right.bounds) {
      return 1;
    } else if (left.bounds && !right.bounds) {
      return -1;
    }
    return left.memberSegmentIds.join('\u0000').localeCompare(
      right.memberSegmentIds.join('\u0000'),
    );
  });

  const rows = rowDrafts.map((row, index) => ({
    id: `row-${String(index + 1).padStart(4, '0')}`,
    ...row,
  }));
  const segmentToRowId: Record<string, string> = {};
  rows.forEach((row) => {
    row.memberSegmentIds.forEach((segmentId) => {
      segmentToRowId[segmentId] = row.id;
    });
  });
  return { rows, segmentToRowId };
}

function componentPairDecision(
  left: RowGeometry,
  right: RowGeometry,
  pageBounds: StructuralBounds,
  options: ResolvedOptions,
): Omit<StructuralDecision, 'id'> {
  if (
    left.points.length === 0
    || right.points.length === 0
    || !left.row.bounds
    || !right.row.bounds
  ) {
    return {
      scope: 'component',
      outcome: 'separated',
      leftId: left.row.id,
      rightId: right.row.id,
      reason: 'missing-geometry',
      metrics: emptyMetrics(),
    };
  }

  const orientationDelta = orientationDistance(
    left.row.orientationDegrees,
    right.row.orientationDegrees,
  );
  if (orientationDelta > options.orientationToleranceDegrees) {
    return {
      scope: 'component',
      outcome: 'separated',
      leftId: left.row.id,
      rightId: right.row.id,
      reason: 'orientation-mismatch',
      metrics: {
        ...emptyMetrics(roundMetric(orientationDelta)),
        threshold: options.orientationToleranceDegrees,
      },
    };
  }

  const sharedOrientation = meanOrientation([
    left.row.orientationDegrees,
    right.row.orientationDegrees,
  ]);
  const axis = axisForOrientation(sharedOrientation);
  const leftProjection = projectionForGeometry(left.points, null, axis);
  const rightProjection = projectionForGeometry(right.points, null, axis);
  if (!leftProjection || !rightProjection) {
    return {
      scope: 'component',
      outcome: 'separated',
      leftId: left.row.id,
      rightId: right.row.id,
      reason: 'missing-geometry',
      metrics: emptyMetrics(roundMetric(orientationDelta)),
    };
  }

  const alongGap = intervalGap(
    leftProjection.alongStart,
    leftProjection.alongEnd,
    rightProjection.alongStart,
    rightProjection.alongEnd,
  );
  const alongOverlap = intervalOverlap(
    leftProjection.alongStart,
    leftProjection.alongEnd,
    rightProjection.alongStart,
    rightProjection.alongEnd,
  );
  const leftAlongSize = leftProjection.alongEnd - leftProjection.alongStart;
  const rightAlongSize = rightProjection.alongEnd - rightProjection.alongStart;
  const alongOverlapRatio = alongOverlap
    / Math.max(Math.min(leftAlongSize, rightAlongSize), 1);
  const flowGap = intervalGap(
    leftProjection.flowStart,
    leftProjection.flowEnd,
    rightProjection.flowStart,
    rightProjection.flowEnd,
  );
  const flowOverlap = intervalOverlap(
    leftProjection.flowStart,
    leftProjection.flowEnd,
    rightProjection.flowStart,
    rightProjection.flowEnd,
  );
  const leftFlowSize = leftProjection.flowEnd - leftProjection.flowStart;
  const rightFlowSize = rightProjection.flowEnd - rightProjection.flowStart;
  const flowOverlapRatio = flowOverlap
    / Math.max(Math.min(leftFlowSize, rightFlowSize), 1);
  const flowCenterDistance = Math.abs(
    leftProjection.flowAnchor - rightProjection.flowAnchor,
  );
  const metrics: StructuralDecisionMetrics = {
    orientationDeltaDegrees: roundMetric(orientationDelta),
    alongGap: roundMetric(alongGap),
    alongOverlap: roundMetric(alongOverlap),
    alongOverlapRatio: roundMetric(alongOverlapRatio),
    flowGap: roundMetric(flowGap),
    flowCenterDistance: roundMetric(flowCenterDistance),
    flowOverlap: roundMetric(flowOverlap),
    flowOverlapRatio: roundMetric(flowOverlapRatio),
    threshold: options.componentMinimumAlongOverlapRatio,
  };

  if (
    alongOverlap < options.componentMinimumAlongOverlap
    || alongOverlapRatio < options.componentMinimumAlongOverlapRatio
  ) {
    return {
      scope: 'component',
      outcome: 'separated',
      leftId: left.row.id,
      rightId: right.row.id,
      reason: 'insufficient-along-overlap',
      metrics,
    };
  }

  const pageFlowSpan = pageProjectionSpan(pageBounds, axis).flow;
  const rawFlowGapLimit = Math.max(
    options.componentMinimumFlowGapTolerance,
    Math.max(leftFlowSize, rightFlowSize)
      * options.componentFlowGapThicknessRatio,
    pageFlowSpan * options.componentFlowGapPageRatio,
  );
  const flowGapLimit = Math.min(
    rawFlowGapLimit,
    Math.max(
      options.componentMinimumFlowGapTolerance,
      pageFlowSpan * options.componentMaximumFlowGapPageRatio,
    ),
  );
  if (flowGap > flowGapLimit) {
    return {
      scope: 'component',
      outcome: 'separated',
      leftId: left.row.id,
      rightId: right.row.id,
      reason: 'component-flow-gap-too-large',
      metrics: {
        ...metrics,
        threshold: roundMetric(flowGapLimit),
      },
    };
  }

  return {
    scope: 'component',
    outcome: 'joined',
    leftId: left.row.id,
    rightId: right.row.id,
    reason: 'spatial-flow-neighbors',
    metrics: {
      ...metrics,
      threshold: roundMetric(flowGapLimit),
    },
  };
}

function connectedGroups(
  ids: string[],
  joinedPairs: Array<[string, string]>,
): string[][] {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    const current = parent.get(id);
    if (!current || current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const [first, second] = [leftRoot, rightRoot].sort(
      (a, b) => a.localeCompare(b),
    );
    parent.set(second, first);
  };
  joinedPairs.forEach(([left, right]) => union(left, right));

  const groups = new Map<string, string[]>();
  ids.forEach((id) => {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  });
  return Array.from(groups.values()).map(
    (group) => group.sort((left, right) => left.localeCompare(right)),
  );
}

function buildComponents(
  rows: PhysicalRow[],
  componentDecisions: StructuralDecision[],
): {
  components: SpatialFlowComponent[];
  rowToComponentId: Record<string, string>;
} {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const groups = connectedGroups(
    rows.map(({ id }) => id),
    componentDecisions
      .filter(({ outcome }) => outcome === 'joined')
      .map(({ leftId, rightId }) => [leftId, rightId]),
  );

  const drafts = groups.map((rowIds) => {
    const memberRows = rowIds.map((id) => rowById.get(id))
      .filter((value): value is PhysicalRow => value !== undefined);
    const orientation = meanOrientation(
      memberRows.map(({ orientationDegrees }) => orientationDegrees),
    );
    const sortedRows = memberRows.slice().sort((left, right) => {
      if (left.bounds && right.bounds) {
        const primary = orientationFamily(orientation) === 'horizontal'
          ? left.bounds.top - right.bounds.top
          : left.bounds.left - right.bounds.left;
        if (primary !== 0) return primary;
        const secondary = orientationFamily(orientation) === 'horizontal'
          ? left.bounds.left - right.bounds.left
          : left.bounds.top - right.bounds.top;
        if (secondary !== 0) return secondary;
      }
      return left.id.localeCompare(right.id);
    });
    const sortedRowIds = sortedRows.map(({ id }) => id);
    const rowIdSet = new Set(sortedRowIds);
    const decisionIds = componentDecisions
      .filter(
        (decision) => decision.outcome === 'joined'
          && rowIdSet.has(decision.leftId)
          && rowIdSet.has(decision.rightId),
      )
      .map(({ id }) => id)
      .sort((left, right) => left.localeCompare(right));
    const memberSegmentIds = sortedRows.flatMap(
      ({ memberSegmentIds: ids }) => ids,
    );
    return {
      rowIds: sortedRowIds,
      memberSegmentIds,
      orientationDegrees: roundMetric(orientation),
      orientationFamily: orientationFamily(orientation),
      bounds: mergeBounds(sortedRows.map(({ bounds }) => bounds)),
      formation: {
        reason: sortedRows.length === 1
          ? 'single-row' as const
          : 'connected-spatial-flow' as const,
        decisionIds,
      },
      minimumSegmentId: memberSegmentIds.slice().sort(
        (left, right) => left.localeCompare(right),
      )[0] ?? '',
    };
  });

  drafts.sort((left, right) => {
    const familyDifference = familyOrder(left.orientationFamily)
      - familyOrder(right.orientationFamily);
    if (familyDifference !== 0) return familyDifference;
    if (left.bounds && right.bounds) {
      const primary = left.orientationFamily === 'horizontal'
        ? left.bounds.top - right.bounds.top
        : left.bounds.left - right.bounds.left;
      if (primary !== 0) return primary;
      const secondary = left.orientationFamily === 'horizontal'
        ? left.bounds.left - right.bounds.left
        : left.bounds.top - right.bounds.top;
      if (secondary !== 0) return secondary;
    } else if (!left.bounds && right.bounds) {
      return 1;
    } else if (left.bounds && !right.bounds) {
      return -1;
    }
    return left.minimumSegmentId.localeCompare(right.minimumSegmentId);
  });

  const components = drafts.map(({ minimumSegmentId: _, ...draft }, index) => ({
    id: `component-${String(index + 1).padStart(4, '0')}`,
    ...draft,
  }));
  const rowToComponentId: Record<string, string> = {};
  components.forEach((component) => {
    component.rowIds.forEach((rowId) => {
      rowToComponentId[rowId] = component.id;
    });
  });
  return { components, rowToComponentId };
}

export function normalizeSegmentStructure(
  segments: readonly StructuralSegment[],
  options: StructuralNormalizationOptions = {},
): StructuralNormalizationResult {
  const resolved = resolvedOptions(options);
  const seenIds = new Set<string>();
  const geometries = segments.map((segment) => {
    if (seenIds.has(segment.id)) {
      throw new Error(`Duplicate structural segment id ${segment.id}`);
    }
    seenIds.add(segment.id);
    const points = segmentPoints(segment);
    const orientationDegrees = resolvedOrientation(segment);
    return {
      segment,
      points,
      orientationDegrees,
      orientationFamily: orientationFamily(orientationDegrees),
      bounds: boundsForPoints(points),
    };
  }).sort((left, right) => left.segment.id.localeCompare(right.segment.id));
  const pageBounds = inferredPageBounds(geometries, resolved);

  const rowDecisions: StructuralDecision[] = [];
  for (let leftIndex = 0; leftIndex < geometries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < geometries.length;
      rightIndex += 1
    ) {
      rowDecisions.push({
        id: `row-decision-${String(rowDecisions.length + 1).padStart(6, '0')}`,
        ...rowPairDecision(
          geometries[leftIndex],
          geometries[rightIndex],
          pageBounds,
          resolved,
        ),
      });
    }
  }

  const { rows, segmentToRowId } = buildRows(geometries, rowDecisions);
  const geometryById = new Map(
    geometries.map((geometry) => [geometry.segment.id, geometry]),
  );
  const rowGeometries: RowGeometry[] = rows.map((row) => ({
    row,
    points: row.memberSegmentIds.flatMap(
      (segmentId) => geometryById.get(segmentId)?.points ?? [],
    ),
  }));
  const componentDecisions: StructuralDecision[] = [];
  for (let leftIndex = 0; leftIndex < rowGeometries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < rowGeometries.length;
      rightIndex += 1
    ) {
      componentDecisions.push({
        id: `component-decision-${String(
          componentDecisions.length + 1,
        ).padStart(6, '0')}`,
        ...componentPairDecision(
          rowGeometries[leftIndex],
          rowGeometries[rightIndex],
          pageBounds,
          resolved,
        ),
      });
    }
  }
  const { components, rowToComponentId } = buildComponents(
    rows,
    componentDecisions,
  );

  const orderedSegmentToRowId: Record<string, string> = {};
  Array.from(Object.keys(segmentToRowId))
    .sort((left, right) => left.localeCompare(right))
    .forEach((segmentId) => {
      orderedSegmentToRowId[segmentId] = segmentToRowId[segmentId];
    });
  const orderedRowToComponentId: Record<string, string> = {};
  Array.from(Object.keys(rowToComponentId))
    .sort((left, right) => left.localeCompare(right))
    .forEach((rowId) => {
      orderedRowToComponentId[rowId] = rowToComponentId[rowId];
    });

  return {
    rows,
    components,
    segmentToRowId: orderedSegmentToRowId,
    rowToComponentId: orderedRowToComponentId,
    decisions: [...rowDecisions, ...componentDecisions],
  };
}

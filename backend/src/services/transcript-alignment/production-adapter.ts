import type { PageRecognitionRecord } from '../../schemas/page-recognition.js';
import {
  segmentRecognitionGeometryChecksum,
} from '../../schemas/page-recognition.js';
import {
  normalizeLineSegments,
} from '../../schemas/page-geometry.js';
import type { LineSegment } from '../../schemas/line-segment.js';
import type {
  AlignmentPoint,
  RecognizedSegment,
} from './aligner.js';
export {
  alignmentSegmentInputChecksum,
} from './alignment-input-identity.js';

export interface ProductionAlignmentSegments {
  recognizedSegments: RecognizedSegment[];
  excludedSegmentIds: string[];
  validRecognitionRecordCount: number;
  machineSegmentCount: number;
  machineSegmentsWithRecognitionCount: number;
  machineSegmentsWithUsableRecognitionCount: number;
}

function stableId(segment: LineSegment, index: number): string {
  return segment.id ?? `legacy:${index}:${segment.line}`;
}

function bboxBoundary(
  [xMin, yMin, xMax, yMax]: LineSegment['bbox'],
): AlignmentPoint[] {
  return [
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax },
  ];
}

function baselinePoints(
  baseline: LineSegment['baseline'],
): AlignmentPoint[] | null {
  return baseline?.map(([x, y]) => ({ x, y })) ?? null;
}

function baselineOrientationDegrees(
  baseline: LineSegment['baseline'],
): number | null {
  if (!baseline || baseline.length < 2) return null;
  const [startX, startY] = baseline[0];
  const [endX, endY] = baseline.at(-1)!;
  if (startX === endX && startY === endY) return null;
  return Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);
}

function providerOrientationDegrees(
  direction: LineSegment['providerTextDirection'],
): number | null {
  if (direction === 'vertical-lr' || direction === 'vertical-rl') {
    return 90;
  }
  if (direction === 'horizontal-lr' || direction === 'horizontal-rl') {
    return 0;
  }
  return null;
}

function humanGeometryOrigins(
  segments: readonly LineSegment[],
): Set<string> {
  const byId = new Map<string, LineSegment>();
  segments.forEach((segment, index) => {
    byId.set(stableId(segment, index), segment);
  });
  const result = new Set<string>();
  const visiting = new Set<string>();

  const isHumanOrigin = (id: string): boolean => {
    if (result.has(id)) return true;
    if (visiting.has(id)) return false;
    const segment = byId.get(id);
    if (!segment) return false;
    if (
      segment.geometryProvenance?.source === 'human-created'
      || segment.bboxSource?.startsWith('human-') === true
    ) {
      result.add(id);
      return true;
    }
    if (segment.geometryProvenance?.source !== 'human-adjusted') {
      return false;
    }
    visiting.add(id);
    const inherited = segment.geometryProvenance.parentSegmentIds.some(
      (parentId) => parentId !== id && isHumanOrigin(parentId),
    );
    visiting.delete(id);
    if (inherited) result.add(id);
    return inherited;
  };

  for (const id of byId.keys()) isHumanOrigin(id);
  return result;
}

export function adaptPageSegmentsForAlignment(input: {
  lineSegments: unknown;
  recognitionRecords: readonly PageRecognitionRecord[];
}): ProductionAlignmentSegments {
  const segments = normalizeLineSegments(input.lineSegments);
  const humanOrigins = humanGeometryOrigins(segments);
  const recognitionBySegmentId = new Map(
    input.recognitionRecords.map((record) => [record.segmentId, record]),
  );
  const recognizedSegments: RecognizedSegment[] = [];
  const excludedSegmentIds: string[] = [];
  let validRecognitionRecordCount = 0;
  let machineSegmentCount = 0;
  let machineSegmentsWithRecognitionCount = 0;
  let machineSegmentsWithUsableRecognitionCount = 0;

  segments.forEach((segment, index) => {
    const id = stableId(segment, index);
    if (segment.excluded === true || segment.segmentClass === 'ignore') {
      excludedSegmentIds.push(id);
      return;
    }

    const candidateRecord = recognitionBySegmentId.get(id);
    const recognition = candidateRecord
      && candidateRecord.segmentGeometryChecksumSha256
        === segmentRecognitionGeometryChecksum({ ...segment, id })
      ? candidateRecord
      : undefined;
    if (recognition) validRecognitionRecordCount += 1;

    const text = recognition?.text ?? '';
    const recognitionState = recognition?.state ?? 'not-attempted';
    const geometryEvidence = humanOrigins.has(id)
      ? 'human-gap-fill' as const
      : 'machine' as const;
    if (geometryEvidence === 'machine') {
      machineSegmentCount += 1;
      if (recognitionState !== 'not-attempted') {
        machineSegmentsWithRecognitionCount += 1;
      }
      if (
        recognitionState === 'recognized'
        && text.trim().length > 0
      ) {
        machineSegmentsWithUsableRecognitionCount += 1;
      }
    }
    const orientationDegrees = baselineOrientationDegrees(segment.baseline)
      ?? providerOrientationDegrees(segment.providerTextDirection);
    const isHuman = geometryEvidence === 'human-gap-fill';

    recognizedSegments.push({
      id,
      text,
      recognitionConfidence: recognition?.meanConfidence ?? null,
      recognitionState,
      geometryEvidence,
      regionId: segment.regionIds?.[0] ?? null,
      orientationDegrees,
      boundary: segment.boundary ?? bboxBoundary(segment.bbox),
      baseline: baselinePoints(segment.baseline),
      // Human geometry is append-only in the stored projection. Giving it a
      // provider ordinal would recreate the Dave-before-Yours bug, so spatial
      // preparation must place it.
      readingOrderIndex: isHuman
        ? null
        : segment.providerOrdinal ?? segment.line,
      flowDirectionSign: (
        segment.providerTextDirection === 'horizontal-rl'
        || segment.providerTextDirection === 'vertical-rl'
      ) ? -1 : 1,
      sourceSegmentIds: [id],
    });
  });

  return {
    recognizedSegments,
    excludedSegmentIds,
    validRecognitionRecordCount,
    machineSegmentCount,
    machineSegmentsWithRecognitionCount,
    machineSegmentsWithUsableRecognitionCount,
  };
}

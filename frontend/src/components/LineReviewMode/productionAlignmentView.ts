import type {
  ProductionAlignmentEvidence,
  ProductionAlignmentMappingStatus,
  ProductionAlignmentPage,
  ProductionAlignmentPageStatus,
} from '../../api/admin/productionTranscriptAlignment';
import type {
  LineSegment,
  LineSegmentWord,
} from '../../types/Letter';

export interface ProductionReviewLine {
  id: string;
  /** First segment is retained for compatibility with single-outline controls. */
  sourceSegmentId?: string;
  /** Exact stable segment membership returned by the backend aligner. */
  sourceSegmentIds: string[];
  /** Every outline remains separate so highlighting does not fill gaps between pieces. */
  segmentGeometries: LineSegment[];
  geometrySource: 'native' | 'unlocated';
  visualLineIndex: number;
  transcriptText: string;
  transcriptLineIndex: number;
  sourceLineNumber: number;
  bbox?: [number, number, number, number];
  baseline?: number[][];
  words?: LineSegmentWord[];
  boundary?: { x: number; y: number }[];
  geometryType?: LineSegment['geometryType'];
  providerTextDirection?: LineSegment['providerTextDirection'];
  regionIds?: string[];
  mappingStatus: ProductionAlignmentMappingStatus;
  mappingEvidence: ProductionAlignmentEvidence;
  pageStatus: ProductionAlignmentPageStatus;
  statusMessage: string | null;
}

function unionBbox(
  segments: readonly LineSegment[],
): [number, number, number, number] | undefined {
  if (segments.length === 0) return undefined;
  return [
    Math.min(...segments.map(({ bbox }) => bbox[0])),
    Math.min(...segments.map(({ bbox }) => bbox[1])),
    Math.max(...segments.map(({ bbox }) => bbox[2])),
    Math.max(...segments.map(({ bbox }) => bbox[3])),
  ];
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/**
 * Adapts the immutable backend alignment envelope to the existing review
 * renderer. Transcript order comes only from transcriptLineIndex; geometry
 * comes only from stable segment IDs.
 */
export function buildProductionReviewLines(
  page: ProductionAlignmentPage,
  currentTranscriptLines: readonly string[] = [],
): ProductionReviewLine[] {
  const segmentById = new Map<string, LineSegment>();
  for (const segment of page.geometry.lineSegments) {
    if (segment.id) segmentById.set(segment.id, segment);
  }

  const seenTranscriptIndices = new Set<number>();
  return [...page.mappings]
    .sort((left, right) => (
      left.transcriptLineIndex - right.transcriptLineIndex
      || left.sourceLineNumber - right.sourceLineNumber
      || left.id.localeCompare(right.id)
    ))
    .map((mapping, visualLineIndex) => {
      if (seenTranscriptIndices.has(mapping.transcriptLineIndex)) {
        throw new Error(
          `Transcript line ${mapping.transcriptLineIndex} was placed more than once`,
        );
      }
      seenTranscriptIndices.add(mapping.transcriptLineIndex);

      const segmentGeometries = mapping.segmentIds.map((segmentId) => {
        const segment = segmentById.get(segmentId);
        if (!segment) {
          throw new Error(
            `Transcript placement references missing segment ${segmentId}`,
          );
        }
        return segment;
      });
      const first = segmentGeometries[0];
      const words = segmentGeometries.flatMap((segment) => segment.words ?? []);
      const transcriptText = currentTranscriptLines[mapping.transcriptLineIndex]
        ?? mapping.transcriptText;

      return {
        id: mapping.id,
        ...(mapping.segmentIds[0]
          ? { sourceSegmentId: mapping.segmentIds[0] }
          : {}),
        sourceSegmentIds: [...mapping.segmentIds],
        segmentGeometries,
        geometrySource: segmentGeometries.length > 0
          ? 'native' as const
          : 'unlocated' as const,
        visualLineIndex,
        transcriptText,
        transcriptLineIndex: mapping.transcriptLineIndex,
        sourceLineNumber: mapping.sourceLineNumber,
        ...(unionBbox(segmentGeometries)
          ? { bbox: unionBbox(segmentGeometries)! }
          : {}),
        ...(segmentGeometries.length === 1 && first.baseline
          ? { baseline: first.baseline }
          : {}),
        ...(words.length > 0 ? { words } : {}),
        ...(segmentGeometries.length === 1 && first.boundary
          ? { boundary: first.boundary }
          : {}),
        ...(first?.geometryType
          ? { geometryType: first.geometryType }
          : {}),
        ...(first?.providerTextDirection
          ? { providerTextDirection: first.providerTextDirection }
          : {}),
        ...(uniqueStrings(segmentGeometries.flatMap(
          (segment) => segment.regionIds ?? [],
        )).length > 0
          ? {
              regionIds: uniqueStrings(segmentGeometries.flatMap(
                (segment) => segment.regionIds ?? [],
              )),
            }
          : {}),
        mappingStatus: mapping.status,
        mappingEvidence: mapping.evidence,
        pageStatus: page.status,
        statusMessage: page.statusMessage,
      };
    });
}

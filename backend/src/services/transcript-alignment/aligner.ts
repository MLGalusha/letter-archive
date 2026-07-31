import {
  applyBoundedLocalReorders,
  type BoundedLocalReorderDecision,
} from './bounded-local-reorder.js';
import { prepareAlignmentSegments } from './alignment-preparation.js';

export type TranscriptLine = {
  id: string;
  text: string;
};

export type AlignmentPoint = {
  x: number;
  y: number;
};

export type RecognizedSegment = {
  id: string;
  text: string;
  /**
   * Recognition is separate from geometry. A human may add a valid outline
   * before any recognizer has read its pixels.
   */
  recognitionState?: 'recognized' | 'attempted-empty' | 'not-attempted';
  /**
   * `human-gap-fill` means the geometry descends from a human-created outline.
   * Adapters must walk stored provenance lineage before assigning this value;
   * the latest `human-adjusted` source alone is not sufficient.
   */
  geometryEvidence?: 'machine' | 'human-gap-fill';
  recognitionConfidence?: number | null;
  regionId?: string | null;
  orientationDegrees?: number | null;
  boundary?: AlignmentPoint[] | null;
  baseline?: AlignmentPoint[] | null;
  readingOrderIndex?: number | null;
  flowDirectionSign?: 1 | -1 | null;
  /**
   * Physical-row preparation may combine multiple raw Kraken fragments
   * without losing their independently reviewable identities.
   */
  sourceSegmentIds?: string[];
  structuralRowId?: string | null;
  structuralComponentId?: string | null;
};

export type AlignmentOperationKind =
  | 'match'
  | 'split'
  | 'merge'
  | 'skip-segment'
  | 'unlocated-transcript';

export type AlignmentOperation = {
  kind: AlignmentOperationKind;
  transcriptIds: string[];
  segmentIds: string[];
  transcriptText: string;
  recognizedText: string;
  similarity: number;
  cost: number;
};

export type AlignmentAlternative = {
  segmentIds: string[];
  support: number;
};

export type TranscriptMapping = {
  transcriptId: string;
  segmentIds: string[];
  operation: Extract<AlignmentOperationKind, 'match' | 'split' | 'merge' | 'unlocated-transcript'>;
  evidence: 'content' | 'geometry-only';
  similarity: number;
  confidence: number;
  status: 'accepted' | 'ambiguous' | 'unlocated';
  alternatives: AlignmentAlternative[];
};

export type UnassignedSegmentReason =
  | 'secondary-flow'
  | 'transcript-mismatch'
  | 'non-transcribed-text'
  | 'alignment-uncertain'
  | 'deferred-orientation';

export type AlignmentResult = {
  totalCost: number;
  secondBestCost: number | null;
  pathMargin: number | null;
  operations: AlignmentOperation[];
  mappings: TranscriptMapping[];
  skippedSegmentIds: string[];
  deferredSegmentIds: string[];
  unassignedSegmentReasons: Array<{
    segmentId: string;
    reason: UnassignedSegmentReason;
  }>;
  exploredPathCount: number;
  localReorderDecisions: BoundedLocalReorderDecision[];
  pageAssessment: {
    status: 'alignable' | 'transcript-mismatch';
    transcriptLineCount: number;
    segmentCount: number;
    countRatio: number;
    strongestTextSimilarity: number;
    usableAnchorCount: number;
  };
};

export type AlignmentOptions = {
  maxGroupSize?: 2 | 3;
  topK?: number;
  autoAcceptThreshold?: number;
  minimumAcceptedSimilarity?: number;
  gapCosts?: {
    skippedSegmentOpen: number;
    skippedSegmentExtend: number;
    unlocatedTranscriptOpen: number;
    unlocatedTranscriptExtend: number;
  };
  splitMergePenalty?: number;
  pathCostTemperature?: number;
  unmatchedPairCost?: number;
  unmatchedPairMaximumSimilarity?: number;
};

type ResolvedAlignmentOptions = {
  maxGroupSize: 2 | 3;
  topK: number;
  autoAcceptThreshold: number;
  minimumAcceptedSimilarity: number;
  gapCosts: {
    skippedSegmentOpen: number;
    skippedSegmentExtend: number;
    unlocatedTranscriptOpen: number;
    unlocatedTranscriptExtend: number;
  };
  splitMergePenalty: number;
  pathCostTemperature: number;
  unmatchedPairCost: number;
  unmatchedPairMaximumSimilarity: number;
};

type PathState =
  | 'match'
  | 'unmatched-pair'
  | 'skip-segment'
  | 'unlocated-transcript';

type Path = {
  cost: number;
  operations: AlignmentOperation[];
  signature: string;
};

type Cell = Record<PathState, Path[]>;

const DEFAULT_OPTIONS: ResolvedAlignmentOptions = {
  maxGroupSize: 2,
  topK: 5,
  autoAcceptThreshold: 0.9,
  minimumAcceptedSimilarity: 0.72,
  splitMergePenalty: 0.12,
  pathCostTemperature: 0.25,
  unmatchedPairCost: 0.7,
  unmatchedPairMaximumSimilarity: 0.3,
  gapCosts: {
    skippedSegmentOpen: 0.68,
    skippedSegmentExtend: 0.32,
    unlocatedTranscriptOpen: 0.72,
    unlocatedTranscriptExtend: 0.46,
  },
};

const EDITORIAL_MARKER = /\[(?:illegible|unclear|unreadable|blank|missing)(?:[^\]]*)\]/giu;
const EDITORIAL_MARKER_PRESENT = /\[(?:illegible|unclear|unreadable|blank|missing)(?:[^\]]*)\]/iu;
const COMBINING_MARK = /\p{M}/gu;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;
const MAIN_FLOW_ORIENTATION_TOLERANCE_DEGREES = 25;
const MINIMUM_DOMINANT_ORIENTATION_SHARE = 0.6;
const MINIMUM_ADJACENT_TRANSPOSITION_GAIN = 0.08;
const ADJACENT_TRANSPOSITION_PENALTY = 0.08;
const TRANSCRIPT_MISMATCH_MINIMUM_SEQUENCE_SIZE = 4;
// Abstain only on a severe page-level mismatch. Historical handwriting OCR
// can legitimately produce several extra or missing rows even when the
// transcript is correct (007 page 5 is 17 transcript lines vs 27 rows).
const TRANSCRIPT_MISMATCH_MAXIMUM_COUNT_RATIO = 0.55;
const TRANSCRIPT_MISMATCH_USABLE_ANCHOR_SIMILARITY = 0.5;
const TRANSCRIPT_MISMATCH_MAXIMUM_USABLE_ANCHORS = 1;
const SEQUENCE_ANCHOR_MINIMUM_SIMILARITY = 0.42;
const SEQUENCE_ANCHOR_MINIMUM_MARGIN = 0.05;
const GEOMETRY_BODY_MINIMUM_PREFIX_SIZE = 2;
const GEOMETRY_BODY_MAXIMUM_PREFIX_SHARE = 0.4;
const GEOMETRY_BODY_MINIMUM_WIDTH_RATIO = 1.4;
const GEOMETRY_BODY_MINIMUM_CONFIDENCE_CONTRAST = 0.12;
const GEOMETRY_BODY_MINIMUM_MONOTONIC_SHARE = 0.8;
const SHORT_WORD_PREFIX_SIMILARITY = 0.46;
const MISSING_ROW_MINIMUM_GAP_RATIO = 2.4;
const MISSING_ROW_MAXIMUM_CONTENT_SCORE_DELTA = 0.08;
const MISSING_ROW_MINIMUM_DIRECT_SUPPORT = 0.35;
const MISSING_ROW_MAXIMUM_ORIENTATION_SPREAD_DEGREES = 10;
const MISSING_ROW_EXPECTED_GAP_BONUS = 0.05;
const MISSING_ROW_TRANSCRIPT_MERGE_PENALTY = 0.6;
const MERGE_MEMBER_MAXIMUM_UNSUPPORTED_SIMILARITY = 0.15;
const MERGE_MEMBER_MINIMUM_EVIDENCE_GAIN = 0.03;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function normalizeAlignmentText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARK, '')
    .replace(EDITORIAL_MARKER, ' ')
    .toLocaleLowerCase('en')
    .replaceAll('ſ', 's')
    .replaceAll('’', "'")
    .replaceAll('‘', "'")
    .replaceAll('“', '"')
    .replaceAll('”', '"')
    .replace(NON_ALPHANUMERIC, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function isStandaloneEditorialMarker(value: string): boolean {
  return (
    EDITORIAL_MARKER_PRESENT.test(value)
    && normalizeAlignmentText(value).length === 0
  );
}

function isBlankHumanGapFill(segment: RecognizedSegment): boolean {
  return segment.geometryEvidence === 'human-gap-fill'
    && segment.recognitionState !== 'recognized'
    && normalizeAlignmentText(segment.text).length === 0;
}

export function levenshteinDistance(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  if (leftPoints.length === 0) return rightPoints.length;
  if (rightPoints.length === 0) return leftPoints.length;

  let previous = Array.from(
    { length: rightPoints.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= leftPoints.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= rightPoints.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]
        + (leftPoints[leftIndex - 1] === rightPoints[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution,
      );
    }
    previous = current;
  }
  return previous[rightPoints.length];
}

function tokenDice(left: string, right: string): number {
  const leftTokens = left.length > 0 ? left.split(' ') : [];
  const rightTokens = right.length > 0 ? right.split(' ') : [];
  if (leftTokens.length === 0 && rightTokens.length === 0) return 1;
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const remaining = new Map<string, number>();
  rightTokens.forEach((token) => {
    remaining.set(token, (remaining.get(token) ?? 0) + 1);
  });
  let intersection = 0;
  leftTokens.forEach((token) => {
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      intersection += 1;
      remaining.set(token, count - 1);
    }
  });
  return (2 * intersection) / (leftTokens.length + rightTokens.length);
}

export function alignmentTextSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeAlignmentText(left);
  const normalizedRight = normalizeAlignmentText(right);
  // Two empty strings contain no evidence that a transcript line belongs to a
  // detected image line. Treating editorial markers such as "[illegible]" as
  // an exact match would create a false anchor and shift the surrounding text.
  if (normalizedLeft.length === 0 && normalizedRight.length === 0) return 0;
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) return 0;

  const maximumLength = Math.max(
    Array.from(normalizedLeft).length,
    Array.from(normalizedRight).length,
  );
  const characterSimilarity = 1 - (
    levenshteinDistance(normalizedLeft, normalizedRight) / maximumLength
  );
  const lengthSimilarity = Math.min(normalizedLeft.length, normalizedRight.length)
    / Math.max(normalizedLeft.length, normalizedRight.length);
  const baseSimilarity = clamp(
    (0.72 * characterSimilarity)
    + (0.18 * tokenDice(normalizedLeft, normalizedRight))
    + (0.1 * lengthSimilarity),
  );
  const [shorter, longer] = normalizedLeft.length <= normalizedRight.length
    ? [normalizedLeft, normalizedRight]
    : [normalizedRight, normalizedLeft];
  const shortWordPrefixEvidence = (
    /^\p{L}{1,2}$/u.test(shorter)
    && /^\p{L}{5,}$/u.test(longer)
    && longer.startsWith(shorter)
  )
    ? SHORT_WORD_PREFIX_SIMILARITY
    : 0;
  return Math.max(baseSimilarity, shortWordPrefixEvidence);
}

function assessPageCorrespondence(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
): AlignmentResult['pageAssessment'] {
  const transcriptLineCount = transcriptLines.filter(({ text }) => (
    !isStandaloneEditorialMarker(text)
  )).length;
  const segmentCount = segments.length;
  const countRatio = transcriptLineCount === 0 || segmentCount === 0
    ? 0
    : Math.min(transcriptLineCount, segmentCount)
      / Math.max(transcriptLineCount, segmentCount);
  const pairSimilarities = transcriptLines.flatMap((transcriptLine) => (
    isStandaloneEditorialMarker(transcriptLine.text)
      ? []
      : segments.map((segment) => (
        alignmentTextSimilarity(transcriptLine.text, segment.text)
      ))
  ));
  const strongestTextSimilarity = pairSimilarities.length === 0
    ? 0
    : Math.max(...pairSimilarities);
  const usableAnchorCount = transcriptLines.filter((transcriptLine) => (
    !isStandaloneEditorialMarker(transcriptLine.text)
    && segments.some((segment) => (
      alignmentTextSimilarity(transcriptLine.text, segment.text)
        >= TRANSCRIPT_MISMATCH_USABLE_ANCHOR_SIMILARITY
    ))
  )).length;
  const hasEnoughEvidenceToAssess = (
    transcriptLineCount >= TRANSCRIPT_MISMATCH_MINIMUM_SEQUENCE_SIZE
    && segmentCount >= TRANSCRIPT_MISMATCH_MINIMUM_SEQUENCE_SIZE
  );
  const status = (
    hasEnoughEvidenceToAssess
    && countRatio < TRANSCRIPT_MISMATCH_MAXIMUM_COUNT_RATIO
    && usableAnchorCount <= TRANSCRIPT_MISMATCH_MAXIMUM_USABLE_ANCHORS
  )
    ? 'transcript-mismatch'
    : 'alignable';
  return {
    status,
    transcriptLineCount,
    segmentCount,
    countRatio,
    strongestTextSimilarity,
    usableAnchorCount,
  };
}

function stableLeadingSegmentOffset(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
): number {
  if (transcriptLines.length < 2 || segments.length <= transcriptLines.length) {
    return 0;
  }
  if (segments.some((segment) => projectedSegmentExtent(segment) === null)) {
    return 0;
  }
  const similarities = transcriptLines.map((transcriptLine) => (
    segments.map((segment) => (
      alignmentTextSimilarity(transcriptLine.text, segment.text)
    ))
  ));
  const anchors: Array<{
    transcriptIndex: number;
    segmentIndex: number;
    similarity: number;
  }> = [];
  similarities.forEach((row, transcriptIndex) => {
    const ranked = row.map((similarity, segmentIndex) => ({
      similarity,
      segmentIndex,
    })).sort((left, right) => right.similarity - left.similarity);
    const best = ranked[0];
    if (
      !best
      || best.similarity < SEQUENCE_ANCHOR_MINIMUM_SIMILARITY
      || best.similarity - (ranked[1]?.similarity ?? 0)
        < SEQUENCE_ANCHOR_MINIMUM_MARGIN
    ) {
      return;
    }
    const bestTranscriptForSegment = similarities
      .map((candidate, candidateTranscriptIndex) => ({
        transcriptIndex: candidateTranscriptIndex,
        similarity: candidate[best.segmentIndex],
      }))
      .sort((left, right) => right.similarity - left.similarity)[0];
    if (bestTranscriptForSegment?.transcriptIndex !== transcriptIndex) return;
    anchors.push({
      transcriptIndex,
      segmentIndex: best.segmentIndex,
      similarity: best.similarity,
    });
  });
  const byOffset = new Map<number, typeof anchors>();
  if (anchors.some((anchor) => (
    anchor.segmentIndex === anchor.transcriptIndex
  ))) {
    return 0;
  }
  anchors.forEach((anchor) => {
    const offset = anchor.segmentIndex - anchor.transcriptIndex;
    if (offset <= 0) return;
    byOffset.set(offset, [...(byOffset.get(offset) ?? []), anchor]);
  });
  const candidate = [...byOffset.entries()]
    .filter(([, values]) => values.length >= 2)
    .filter(([offset]) => (
      Math.min(transcriptLines.length, segments.length - offset)
        / Math.max(transcriptLines.length, segments.length - offset)
        >= 0.75
    ))
    .sort((left, right) => {
      const leftScore = left[1].reduce(
        (sum, anchor) => sum + anchor.similarity,
        0,
      );
      const rightScore = right[1].reduce(
        (sum, anchor) => sum + anchor.similarity,
        0,
      );
      return right[1].length - left[1].length
        || rightScore - leftScore
        || left[0] - right[0];
    })[0];
  return candidate?.[0] ?? 0;
}

function boundedReorderLeadingSegmentOffset(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
): number {
  const offset = segments.length - transcriptLines.length;
  if (offset <= 0 || transcriptLines.length < 2) return 0;
  if (segments.some((segment) => projectedSegmentExtent(segment) === null)) {
    return 0;
  }
  const leadingSegments = segments.slice(0, offset);
  const leadingContainsTranscriptAnchor = leadingSegments.some((segment) => (
    transcriptLines.some((transcriptLine) => (
      alignmentTextSimilarity(transcriptLine.text, segment.text)
        >= SEQUENCE_ANCHOR_MINIMUM_SIMILARITY
    ))
  ));
  if (leadingContainsTranscriptAnchor) return 0;

  const suffix = segments.slice(offset);
  const reordered = applyBoundedLocalReorders(
    transcriptLines,
    suffix,
    {
      movableSide: 'transcript',
      similarity: alignmentTextSimilarity,
    },
  );
  if (reordered.decisions.length === 0) return 0;
  const alignedAnchorCount = reordered.transcriptLines.filter(
    (transcriptLine, index) => (
      alignmentTextSimilarity(
        transcriptLine.text,
        reordered.segments[index].text,
      ) >= TRANSCRIPT_MISMATCH_USABLE_ANCHOR_SIMILARITY
    ),
  ).length;
  return alignedAnchorCount >= 2 ? offset : 0;
}

function transcriptMismatchResult(
  transcriptLines: TranscriptLine[],
  originalSegments: RecognizedSegment[],
  deferredSegments: RecognizedSegment[],
  assessment: AlignmentResult['pageAssessment'],
): AlignmentResult {
  const deferredIds = new Set(deferredSegments.map(({ id }) => id));
  const transcriptOperations = transcriptLines.map<AlignmentOperation>(
    (transcriptLine) => ({
      kind: 'unlocated-transcript',
      transcriptIds: [transcriptLine.id],
      segmentIds: [],
      transcriptText: transcriptLine.text,
      recognizedText: '',
      similarity: 0,
      cost: 0,
    }),
  );
  const segmentOperations = originalSegments.map<AlignmentOperation>(
    (segment) => ({
      kind: 'skip-segment',
      transcriptIds: [],
      segmentIds: [segment.id],
      transcriptText: '',
      recognizedText: segment.text,
      similarity: 0,
      cost: 0,
    }),
  );
  return {
    totalCost: 0,
    secondBestCost: null,
    pathMargin: null,
    operations: [...transcriptOperations, ...segmentOperations],
    mappings: transcriptLines.map((transcriptLine) => ({
      transcriptId: transcriptLine.id,
      segmentIds: [],
      operation: 'unlocated-transcript',
      evidence: 'content',
      similarity: 0,
      confidence: 0,
      status: 'unlocated',
      alternatives: [{ segmentIds: [], support: 1 }],
    })),
    skippedSegmentIds: originalSegments.map(({ id }) => id),
    deferredSegmentIds: deferredSegments.map(({ id }) => id),
    unassignedSegmentReasons: originalSegments.map(({ id }) => ({
      segmentId: id,
      reason: deferredIds.has(id)
        ? 'deferred-orientation' as const
        : 'transcript-mismatch' as const,
    })),
    exploredPathCount: 1,
    localReorderDecisions: [],
    pageAssessment: assessment,
  };
}

function makeCell(): Cell {
  return {
    match: [],
    'unmatched-pair': [],
    'skip-segment': [],
    'unlocated-transcript': [],
  };
}

function operationSignature(operation: AlignmentOperation): string {
  return [
    operation.kind,
    operation.transcriptIds.join(','),
    operation.segmentIds.join(','),
  ].join(':');
}

function appendOperation(
  path: Path,
  operation: AlignmentOperation,
  additionalCost = operation.cost,
): Path {
  const signature = `${path.signature}|${operationSignature(operation)}`;
  return {
    cost: path.cost + additionalCost,
    operations: [...path.operations, operation],
    signature,
  };
}

function appendOperations(
  path: Path,
  operations: AlignmentOperation[],
): Path {
  return operations.reduce(
    (current, operation) => appendOperation(current, operation),
    path,
  );
}

function keepBest(paths: Path[], topK: number): Path[] {
  const bySignature = new Map<string, Path>();
  paths.forEach((path) => {
    const existing = bySignature.get(path.signature);
    if (!existing || path.cost < existing.cost) {
      bySignature.set(path.signature, path);
    }
  });
  return [...bySignature.values()]
    .sort((left, right) => (
      left.cost - right.cost || left.signature.localeCompare(right.signature)
    ))
    .slice(0, topK);
}

function groupText(values: Array<{ text: string }>): string {
  return values.map(({ text }) => text).join(' ');
}

function operationSegmentIds(
  segments: RecognizedSegment[],
): string[] {
  return Array.from(new Set(segments.flatMap((segment) => (
    segment.sourceSegmentIds && segment.sourceSegmentIds.length > 0
      ? segment.sourceSegmentIds
      : [segment.id]
  ))));
}

function averageRecognitionConfidence(
  segments: RecognizedSegment[],
): number | null {
  const values = segments
    .map(({ recognitionConfidence }) => recognitionConfidence)
    .filter((value): value is number => (
      typeof value === 'number' && Number.isFinite(value)
    ))
    .map((value) => clamp(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function projectedSegmentExtent(
  segment: RecognizedSegment,
): {
  alongStart: number;
  alongEnd: number;
  flowStart: number;
  flowEnd: number;
} | null {
  const points = segment.boundary && segment.boundary.length > 0
    ? segment.boundary
    : segment.baseline;
  if (!points || points.length === 0) return null;
  const orientation = (
    typeof segment.orientationDegrees === 'number'
    && Number.isFinite(segment.orientationDegrees)
  )
    ? segment.orientationDegrees
    : 0;
  const radians = orientation * (Math.PI / 180);
  const alongX = Math.cos(radians);
  const alongY = Math.sin(radians);
  const flowX = -alongY;
  const flowY = alongX;
  const along = points.map(({ x, y }) => (alongX * x) + (alongY * y));
  const flow = points.map(({ x, y }) => (flowX * x) + (flowY * y));
  return {
    alongStart: Math.min(...along),
    alongEnd: Math.max(...along),
    flowStart: Math.min(...flow),
    flowEnd: Math.max(...flow),
  };
}

/**
 * A low-quality handwriting recognizer may provide no textual anchors even
 * when the page geometry is highly regular. In that narrow case, identify a
 * short leading block of document furniture (letterhead, stamps, or printed
 * form labels) only when the remaining rows form a broad, monotonic body and
 * there is a strong local visual change from the proposed prefix to the body.
 *
 * The body boundary is deliberately independent of the raw row surplus:
 * Kraken can split handwritten rows, so `segments - transcript` is not a safe
 * estimate of the number of stationery rows. Any plausible transcript match
 * in the proposed prefix vetoes that candidate so omitted or reordered
 * handwriting is never discarded merely because it is narrow.
 */
function geometryBackedLeadingBodyOffset(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
  assessment: AlignmentResult['pageAssessment'],
): number {
  if (
    transcriptLines.length < 2
    || segments.length <= transcriptLines.length
    || assessment.usableAnchorCount > 1
  ) {
    return 0;
  }

  const extents = segments.map(projectedSegmentExtent);
  if (extents.some((extent) => extent === null)) return 0;
  const projected = extents as Array<NonNullable<
    ReturnType<typeof projectedSegmentExtent>
  >>;
  const widths = (values: typeof projected) => values.map((extent) => (
    Math.max(1, extent.alongEnd - extent.alongStart)
  ));
  const flowCenters = (values: typeof projected) => values.map((extent) => (
    (extent.flowStart + extent.flowEnd) / 2
  ));
  const confidenceValues = (values: RecognizedSegment[]) => values.flatMap(
    ({ recognitionConfidence }) => (
      typeof recognitionConfidence === 'number'
      && Number.isFinite(recognitionConfidence)
        ? [clamp(recognitionConfidence)]
        : []
    ),
  );
  const maximumOffset = Math.min(
    Math.floor(segments.length * GEOMETRY_BODY_MAXIMUM_PREFIX_SHARE),
    segments.length - 2,
  );
  const candidates: Array<{ offset: number; score: number }> = [];

  for (
    let offset = GEOMETRY_BODY_MINIMUM_PREFIX_SIZE;
    offset <= maximumOffset;
    offset += 1
  ) {
    const prefix = segments.slice(0, offset);
    const body = segments.slice(offset);
    const bodyCountRatio = Math.min(body.length, transcriptLines.length)
      / Math.max(body.length, transcriptLines.length);
    if (bodyCountRatio < 0.75) continue;

    // A prefix row that plausibly occurs anywhere in the transcript is not
    // proven document furniture. This intentionally ignores ordering because
    // an LLM can move, omit, or rewrap a line.
    const prefixContainsTranscriptEvidence = prefix.some((segment) => (
      transcriptLines.some((transcriptLine) => (
        alignmentTextSimilarity(transcriptLine.text, segment.text)
          >= SEQUENCE_ANCHOR_MINIMUM_SIMILARITY
      ))
    ));
    if (prefixContainsTranscriptEvidence) continue;

    const prefixExtents = projected.slice(0, offset);
    const bodyExtents = projected.slice(offset);
    const prefixWidths = widths(prefixExtents);
    const bodyWidths = widths(bodyExtents);
    const prefixMedianWidth = median(prefixWidths);
    const bodyMedianWidth = median(bodyWidths);
    if (
      prefixMedianWidth === null
      || bodyMedianWidth === null
      || bodyMedianWidth
        < prefixMedianWidth * GEOMETRY_BODY_MINIMUM_WIDTH_RATIO
    ) {
      continue;
    }
    const broadBodyShare = bodyWidths.filter(
      (width) => width >= bodyMedianWidth * 0.55,
    ).length / Math.max(bodyWidths.length, 1);
    const broadBodyCount = bodyWidths.filter(
      (width) => width >= bodyMedianWidth * 0.55,
    ).length;
    if (
      broadBodyShare < 0.65
      || broadBodyCount !== transcriptLines.length
      || bodyWidths.slice(0, 2).some(
        (width) => width < bodyMedianWidth * 0.55,
      )
    ) {
      continue;
    }

    const prefixConfidences = confidenceValues(prefix);
    const bodyConfidences = confidenceValues(body);
    if (
      prefixConfidences.length / prefix.length < 0.8
      || bodyConfidences.length / body.length < 0.8
    ) {
      continue;
    }
    const prefixMedianConfidence = median(prefixConfidences);
    const bodyMedianConfidence = median(bodyConfidences);
    if (
      prefixMedianConfidence === null
      || bodyMedianConfidence === null
      || prefixMedianConfidence - bodyMedianConfidence
        < GEOMETRY_BODY_MINIMUM_CONFIDENCE_CONTRAST
    ) {
      continue;
    }

    const prefixCenters = flowCenters(prefixExtents);
    const bodyCenters = flowCenters(bodyExtents);
    const bodyGaps = bodyCenters.slice(1).map(
      (center, index) => center - bodyCenters[index],
    );
    const positiveBodyGaps = bodyGaps.filter((gap) => gap > 0);
    if (
      positiveBodyGaps.length / Math.max(bodyGaps.length, 1)
        < GEOMETRY_BODY_MINIMUM_MONOTONIC_SHARE
    ) {
      continue;
    }
    const medianBodyGap = median(positiveBodyGaps);
    const bodyStart = bodyCenters[0];
    const prefixEnd = Math.max(...prefixCenters);
    const previousWidth = prefixWidths[prefixWidths.length - 1];
    const localWidthRatio = bodyWidths[0] / Math.max(previousWidth, 1);
    const localStartOffset = Math.abs(
      bodyExtents[0].alongStart
      - prefixExtents[prefixExtents.length - 1].alongStart,
    );
    if (
      medianBodyGap === null
      || bodyStart <= prefixEnd
      || bodyStart - prefixEnd < medianBodyGap * 0.7
      || localWidthRatio < 1.6
      // A narrow salutation usually shares the body's left margin. Even with
      // poor OCR it remains handwriting evidence, not document furniture.
      || localStartOffset < bodyMedianWidth * 0.18
    ) {
      continue;
    }

    candidates.push({
      offset,
      score: (
        localWidthRatio
        + (bodyMedianWidth / Math.max(prefixMedianWidth, 1))
        + ((prefixMedianConfidence - bodyMedianConfidence) * 4)
        + bodyCountRatio
      ),
    });
  }

  return candidates.sort((left, right) => (
    right.score - left.score || left.offset - right.offset
  ))[0]?.offset ?? 0;
}

/**
 * If exactly one transcript row lacks geometry, a conspicuously large gap
 * between otherwise regular image rows can locate that omission. Content is
 * still required: the geometry-proposed omission must be competitive with the
 * best one-to-one textual placement, and the omitted transcript line cannot
 * itself have anchor-strength evidence elsewhere.
 */
function geometryBackedMissingTranscriptIndex(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
): number | null {
  if (
    transcriptLines.length - segments.length !== 1
    || segments.length < 5
  ) {
    return null;
  }
  const orientations = segments.map(({ orientationDegrees }) => (
    typeof orientationDegrees === 'number'
    && Number.isFinite(orientationDegrees)
      ? orientationDegrees
      : 0
  ));
  const sharedOrientation = median(orientations);
  if (
    sharedOrientation === null
    || orientations.some((orientation) => (
      Math.abs(orientation - sharedOrientation)
        > MISSING_ROW_MAXIMUM_ORIENTATION_SPREAD_DEGREES
    ))
  ) {
    return null;
  }
  // Compare every row in one coordinate frame. Per-row projection axes can
  // manufacture a large gap from small orientation differences.
  const radians = sharedOrientation * (Math.PI / 180);
  const flowX = -Math.sin(radians);
  const flowY = Math.cos(radians);
  const centers = segments.map((segment) => {
    const points = segment.boundary && segment.boundary.length > 0
      ? segment.boundary
      : segment.baseline;
    if (!points || points.length === 0) return null;
    const projected = points.map(({ x, y }) => (flowX * x) + (flowY * y));
    return (Math.min(...projected) + Math.max(...projected)) / 2;
  });
  if (centers.some((center) => center === null)) return null;
  const comparableCenters = centers as number[];
  const gaps = comparableCenters.slice(1).map(
    (center, index) => center - comparableCenters[index],
  );
  if (gaps.some((gap) => gap <= 0)) return null;
  const rankedGaps = gaps
    .map((gap, index) => ({ gap, index }))
    .sort((left, right) => right.gap - left.gap);
  const largest = rankedGaps[0];
  if (!largest) return null;
  const ordinaryGap = median(rankedGaps.slice(1).map(({ gap }) => gap));
  if (
    ordinaryGap === null
    || largest.gap < ordinaryGap * MISSING_ROW_MINIMUM_GAP_RATIO
  ) {
    return null;
  }
  const missingIndex = largest.index + 1;
  if (missingIndex <= 0 || missingIndex >= transcriptLines.length - 1) {
    return null;
  }

  const candidateScores = transcriptLines.map((_, skippedIndex) => {
    const kept = transcriptLines.filter((__, index) => index !== skippedIndex);
    const similarities = kept.map((line, index) => (
      alignmentTextSimilarity(line.text, segments[index].text)
    ));
    return {
      skippedIndex,
      similarities,
      score: similarities.reduce((sum, similarity) => sum + similarity, 0),
    };
  });
  const proposed = candidateScores[missingIndex];
  const best = candidateScores
    .slice()
    .sort((left, right) => right.score - left.score)[0];
  if (
    !proposed
    || !best
    || best.score - proposed.score
      > MISSING_ROW_MAXIMUM_CONTENT_SCORE_DELTA
    || proposed.similarities.filter(
      (similarity) => similarity >= MISSING_ROW_MINIMUM_DIRECT_SUPPORT,
    ).length < 2
    || Math.max(...segments.map((segment) => (
      alignmentTextSimilarity(
        transcriptLines[missingIndex].text,
        segment.text,
      )
    ))) >= SEQUENCE_ANCHOR_MINIMUM_SIMILARITY
  ) {
    return null;
  }

  return missingIndex;
}

/**
 * Once Kraken fragments have been reconstructed into physical rows, a
 * one-to-many transition should mean either a genuinely fragmented row or a
 * compact interlinear correction. A tall marginal glyph must not be swept
 * into the neighboring body line merely because doing so is cheaper.
 */
function canMatchSegmentGroup(
  segments: RecognizedSegment[],
): boolean {
  if (segments.length <= 1) return true;
  if (segments.length > 2) return false;
  const [left, right] = segments;
  if (
    left.regionId
    && right.regionId
    && left.regionId !== right.regionId
  ) {
    return false;
  }
  const leftExtent = projectedSegmentExtent(left);
  const rightExtent = projectedSegmentExtent(right);
  if (!leftExtent || !rightExtent) {
    // Geometry-free callers retain the original text-only behavior.
    return true;
  }
  const leftAlong = Math.max(
    1,
    leftExtent.alongEnd - leftExtent.alongStart,
  );
  const rightAlong = Math.max(
    1,
    rightExtent.alongEnd - rightExtent.alongStart,
  );
  const leftFlow = Math.max(1, leftExtent.flowEnd - leftExtent.flowStart);
  const rightFlow = Math.max(1, rightExtent.flowEnd - rightExtent.flowStart);
  const smallerAlong = Math.min(leftAlong, rightAlong);
  const largerAlong = Math.max(leftAlong, rightAlong);
  const alongRatio = smallerAlong / largerAlong;
  const smallerExtent = leftAlong <= rightAlong ? leftExtent : rightExtent;
  const smallerFlow = leftAlong <= rightAlong ? leftFlow : rightFlow;
  const alongOverlap = Math.max(
    0,
    Math.min(leftExtent.alongEnd, rightExtent.alongEnd)
      - Math.max(leftExtent.alongStart, rightExtent.alongStart),
  );
  const flowCenterDistance = Math.abs(
    ((leftExtent.flowStart + leftExtent.flowEnd) / 2)
      - ((rightExtent.flowStart + rightExtent.flowEnd) / 2),
  );
  const flowOverlap = Math.max(
    0,
    Math.min(leftExtent.flowEnd, rightExtent.flowEnd)
      - Math.max(leftExtent.flowStart, rightExtent.flowStart),
  );
  const compactHorizontalFragment = (
    alongRatio >= 0.08
    && alongRatio <= 0.55
    && smallerAlong / smallerFlow >= 1.6
    && alongOverlap / Math.max(smallerAlong, 1) >= 0.35
    && flowOverlap > 0
    && flowCenterDistance <= Math.max(24, 1.5 * Math.max(leftFlow, rightFlow))
  );
  const comparableRowWidths = alongRatio > 0.55;
  // Referencing the smaller extent keeps this calculation explicit and makes
  // accidental NaN geometry fail closed through the finite comparisons above.
  return Number.isFinite(smallerExtent.alongStart)
    && (
      compactHorizontalFragment
      || (
        comparableRowWidths
        && (
          !segments.every(({ structuralRowId }) => Boolean(structuralRowId))
          || segments.some(({ text }) => normalizeAlignmentText(text).length <= 2)
        )
      )
  );
}

/**
 * A single detected row may legitimately contain multiple transcript lines
 * when the transcript wraps more finely than Kraken. It must not, however,
 * absorb a missing transcript line merely because opening an unlocated gap is
 * expensive. A member with essentially no independent OCR support must make
 * the combined transcript a meaningfully better explanation of the detected
 * text. This keeps noisy but visible wrapped text together while preventing a
 * missing line from being swallowed by the row before or after it.
 */
function isUnsupportedTranscriptMerge(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
): boolean {
  if (transcriptLines.length <= 1 || segments.length !== 1) return false;
  const recognizedText = groupText(segments);
  const individualSimilarities = transcriptLines.map(({ text }) => (
    alignmentTextSimilarity(text, recognizedText)
  ));
  const strongest = Math.max(...individualSimilarities);
  const weakest = Math.min(...individualSimilarities);
  const combined = alignmentTextSimilarity(
    groupText(transcriptLines),
    recognizedText,
  );
  const unsupportedMember = (
    weakest <= MERGE_MEMBER_MAXIMUM_UNSUPPORTED_SIMILARITY
    && combined - strongest < MERGE_MEMBER_MINIMUM_EVIDENCE_GAIN
  );
  return unsupportedMember;
}

function matchCost(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
  splitMergePenalty: number,
): AlignmentOperation {
  const transcriptText = groupText(transcriptLines);
  const recognizedText = groupText(segments);
  const similarity = alignmentTextSimilarity(transcriptText, recognizedText);
  const recognitionConfidence = averageRecognitionConfidence(segments);
  const recognitionAdjustment = recognitionConfidence === null
    ? 0
    : 0.08 * (0.5 - recognitionConfidence);
  const extraUnits = Math.max(transcriptLines.length, segments.length) - 1;
  const groupingPenalty = extraUnits * (
    splitMergePenalty + (0.45 * (1 - similarity))
  );
  const cost = Math.max(
    0,
    (1 - similarity) + recognitionAdjustment + groupingPenalty,
  );
  const kind = transcriptLines.length > 1
    ? 'merge'
    : operationSegmentIds(segments).length > 1
      ? 'split'
      : 'match';
  return {
    kind,
    transcriptIds: transcriptLines.map(({ id }) => id),
    segmentIds: operationSegmentIds(segments),
    transcriptText,
    recognizedText,
    similarity,
    cost,
  };
}

function allPaths(cell: Cell): Path[] {
  return [
    ...cell.match,
    ...cell['unmatched-pair'],
    ...cell['skip-segment'],
    ...cell['unlocated-transcript'],
  ];
}

function hasStrongSurroundingAnchors(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
  transcriptIndex: number,
  segmentIndex: number,
  minimumSimilarity: number,
): boolean {
  const previousTranscript = transcriptLines[transcriptIndex - 2];
  const previousSegment = segments[segmentIndex - 2];
  const nextTranscript = transcriptLines[transcriptIndex];
  const nextSegment = segments[segmentIndex];
  if (
    !previousTranscript
    || !previousSegment
    || !nextTranscript
    || !nextSegment
  ) {
    return false;
  }
  return (
    alignmentTextSimilarity(previousTranscript.text, previousSegment.text)
      >= minimumSimilarity
    && alignmentTextSimilarity(nextTranscript.text, nextSegment.text)
      >= minimumSimilarity
  );
}

function orientationAxis(degrees: number): number {
  return ((degrees % 180) + 180) % 180;
}

function orientationDistance(left: number, right: number): number {
  const difference = Math.abs(
    orientationAxis(left) - orientationAxis(right),
  );
  return Math.min(difference, 180 - difference);
}

function partitionByDominantOrientation(
  segments: RecognizedSegment[],
): {
  mainFlow: RecognizedSegment[];
  deferred: RecognizedSegment[];
  dominantOrientation: number | null;
  dominantFlowDirectionSign: 1 | -1;
} {
  const explicitOrientations = segments.flatMap((segment) => (
    typeof segment.orientationDegrees === 'number'
      && Number.isFinite(segment.orientationDegrees)
      ? [{ segment, orientation: segment.orientationDegrees }]
      : []
  ));
  if (explicitOrientations.length < 2) {
    return {
      mainFlow: segments,
      deferred: [],
      dominantOrientation: explicitOrientations[0]?.orientation ?? null,
      dominantFlowDirectionSign: dominantDirectionSign(segments),
    };
  }

  const candidates = explicitOrientations
    .map(({ orientation }) => ({
      orientation,
      memberCount: explicitOrientations.filter((candidate) => (
        orientationDistance(orientation, candidate.orientation)
          <= MAIN_FLOW_ORIENTATION_TOLERANCE_DEGREES
      )).length,
    }))
    .sort((left, right) => (
      right.memberCount - left.memberCount
      || orientationDistance(left.orientation, 0)
        - orientationDistance(right.orientation, 0)
    ));
  const dominant = candidates[0];
  if (
    !dominant
    || dominant.memberCount < 2
    || dominant.memberCount / explicitOrientations.length
      < MINIMUM_DOMINANT_ORIENTATION_SHARE
  ) {
    return {
      mainFlow: segments,
      deferred: [],
      dominantOrientation: null,
      dominantFlowDirectionSign: dominantDirectionSign(segments),
    };
  }

  const mainFlow = segments.filter((segment) => (
    typeof segment.orientationDegrees !== 'number'
    || !Number.isFinite(segment.orientationDegrees)
    || orientationDistance(
      segment.orientationDegrees,
      dominant.orientation,
    ) <= MAIN_FLOW_ORIENTATION_TOLERANCE_DEGREES
  ));
  const mainIds = new Set(mainFlow.map(({ id }) => id));
  return {
    mainFlow,
    deferred: segments.filter(({ id }) => !mainIds.has(id)),
    dominantOrientation: dominant.orientation,
    dominantFlowDirectionSign: dominantDirectionSign(mainFlow),
  };
}

function dominantDirectionSign(
  segments: RecognizedSegment[],
): 1 | -1 {
  const signs = segments.flatMap(({ flowDirectionSign }) => (
    flowDirectionSign === 1 || flowDirectionSign === -1
      ? [flowDirectionSign]
      : []
  ));
  if (signs.length === 0) return 1;
  const balance = signs.reduce<number>((sum, sign) => sum + sign, 0);
  return balance < 0 ? -1 : 1;
}

function orderByExplicitReadingOrder(
  segments: RecognizedSegment[],
): RecognizedSegment[] {
  const indexes = segments.map(({ readingOrderIndex }) => readingOrderIndex);
  if (
    indexes.some((index) => typeof index !== 'number' || !Number.isFinite(index))
    || new Set(indexes).size !== indexes.length
  ) {
    return segments;
  }
  return [...segments].sort((left, right) => (
    (left.readingOrderIndex as number) - (right.readingOrderIndex as number)
  ));
}

function flowExtent(
  segment: RecognizedSegment,
  dominantOrientation: number | null,
  flowDirectionSign: 1 | -1,
): {
  center: number;
  size: number;
} | null {
  const points = segment.boundary && segment.boundary.length > 0
    ? segment.boundary
    : segment.baseline;
  if (!points || points.length === 0) return null;
  const orientationRadians = (
    (dominantOrientation ?? 0) * Math.PI
  ) / 180;
  const normalX = -Math.sin(orientationRadians);
  const normalY = Math.cos(orientationRadians);
  const coordinates = points
    .map(({ x, y }) => (
      flowDirectionSign * ((normalX * x) + (normalY * y))
    ))
    .filter((value) => Number.isFinite(value));
  if (coordinates.length === 0) return null;
  const minimum = Math.min(...coordinates);
  const maximum = Math.max(...coordinates);
  return {
    center: (minimum + maximum) / 2,
    size: Math.max(1, maximum - minimum),
  };
}

function hasClearFlowInversion(
  first: RecognizedSegment,
  second: RecognizedSegment,
  dominantOrientation: number | null,
  flowDirectionSign: 1 | -1,
): boolean {
  if (
    first.regionId
    && second.regionId
    && first.regionId !== second.regionId
  ) {
    return false;
  }
  const firstExtent = flowExtent(
    first,
    dominantOrientation,
    flowDirectionSign,
  );
  const secondExtent = flowExtent(
    second,
    dominantOrientation,
    flowDirectionSign,
  );
  if (!firstExtent || !secondExtent) return false;
  const minimumSeparation = Math.max(
    12,
    0.35 * Math.min(firstExtent.size, secondExtent.size),
  );
  return firstExtent.center - secondExtent.center >= minimumSeparation;
}

function transposedMatchOperations(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
  transcriptIndex: number,
  segmentIndex: number,
  splitMergePenalty: number,
  dominantOrientation: number | null,
  flowDirectionSign: 1 | -1,
): AlignmentOperation[] | null {
  if (transcriptIndex < 2 || segmentIndex < 2) return null;
  const firstTranscript = transcriptLines[transcriptIndex - 2];
  const secondTranscript = transcriptLines[transcriptIndex - 1];
  if (
    isStandaloneEditorialMarker(firstTranscript.text)
    || isStandaloneEditorialMarker(secondTranscript.text)
  ) return null;
  const firstSegment = segments[segmentIndex - 2];
  const secondSegment = segments[segmentIndex - 1];
  if (
    !hasClearFlowInversion(
      firstSegment,
      secondSegment,
      dominantOrientation,
      flowDirectionSign,
    )
  ) return null;

  const directFirst = matchCost(
    [firstTranscript],
    [firstSegment],
    splitMergePenalty,
  );
  const directSecond = matchCost(
    [secondTranscript],
    [secondSegment],
    splitMergePenalty,
  );
  const transposedFirst = matchCost(
    [firstTranscript],
    [secondSegment],
    splitMergePenalty,
  );
  const transposedSecond = matchCost(
    [secondTranscript],
    [firstSegment],
    splitMergePenalty,
  );
  const directCost = directFirst.cost + directSecond.cost;
  const transposedCost = (
    transposedFirst.cost
    + transposedSecond.cost
    + ADJACENT_TRANSPOSITION_PENALTY
  );
  if (
    directCost - transposedCost < MINIMUM_ADJACENT_TRANSPOSITION_GAIN
    || transposedFirst.similarity <= directFirst.similarity
    || transposedSecond.similarity <= directSecond.similarity
  ) {
    return null;
  }
  return [
    {
      ...transposedFirst,
      cost: transposedFirst.cost + ADJACENT_TRANSPOSITION_PENALTY,
    },
    transposedSecond,
  ];
}

function createMatrix(transcriptCount: number, segmentCount: number): Cell[][] {
  return Array.from(
    { length: transcriptCount + 1 },
    () => Array.from({ length: segmentCount + 1 }, makeCell),
  );
}

function mappingSignature(segmentIds: string[]): string {
  return segmentIds.length === 0 ? '__unlocated__' : segmentIds.join(',');
}

function mappingsByTranscript(path: Path): Map<string, {
  segmentIds: string[];
  operation: TranscriptMapping['operation'];
  similarity: number;
}> {
  const result = new Map<string, {
    segmentIds: string[];
    operation: TranscriptMapping['operation'];
    similarity: number;
  }>();
  path.operations.forEach((operation) => {
    if (operation.kind === 'skip-segment') return;
    operation.transcriptIds.forEach((transcriptId) => {
      result.set(transcriptId, {
        segmentIds: operation.segmentIds,
        operation: operation.kind as TranscriptMapping['operation'],
        similarity: operation.similarity,
      });
    });
  });
  return result;
}

function buildMappings(
  transcriptLines: TranscriptLine[],
  bestPath: Path,
  candidatePaths: Path[],
  options: ResolvedAlignmentOptions,
  segmentsWithoutUsableContentIds: ReadonlySet<string>,
): TranscriptMapping[] {
  const bestMappings = mappingsByTranscript(bestPath);
  const pathMappings = candidatePaths.map((path) => ({
    mapping: mappingsByTranscript(path),
    weight: Math.exp(
      -(path.cost - bestPath.cost) / options.pathCostTemperature,
    ),
  }));
  const totalPathWeight = pathMappings.reduce(
    (sum, candidate) => sum + candidate.weight,
    0,
  );
  const secondBestCost = candidatePaths[1]?.cost;
  const comparableTranscriptCount = transcriptLines.filter(({ text }) => (
    !isStandaloneEditorialMarker(text)
  )).length;
  const margin = secondBestCost === undefined
    ? 1
    : clamp(
      (secondBestCost - bestPath.cost)
        / Math.max(1, comparableTranscriptCount),
    );

  return transcriptLines.map(({ id, text }) => {
    const best = bestMappings.get(id) ?? {
      segmentIds: [],
      operation: 'unlocated-transcript' as const,
      similarity: 0,
    };
    const alternativesBySignature = new Map<string, {
      segmentIds: string[];
      weight: number;
    }>();
    pathMappings.forEach(({ mapping, weight }) => {
      const candidate = mapping.get(id);
      const segmentIds = candidate?.segmentIds ?? [];
      const signature = mappingSignature(segmentIds);
      const existing = alternativesBySignature.get(signature);
      alternativesBySignature.set(signature, {
        segmentIds,
        weight: (existing?.weight ?? 0) + weight,
      });
    });
    const alternatives = [...alternativesBySignature.values()]
      .map(({ segmentIds, weight }) => ({
        segmentIds,
        support: totalPathWeight === 0 ? 0 : weight / totalPathWeight,
      }))
      .sort((left, right) => (
        right.support - left.support
        || mappingSignature(left.segmentIds).localeCompare(
          mappingSignature(right.segmentIds),
        )
      ));
    const selectedSupport = alternatives.find(({ segmentIds }) => (
      mappingSignature(segmentIds) === mappingSignature(best.segmentIds)
    ))?.support ?? 0;
    const evidence = (
      best.segmentIds.length > 0
      && best.segmentIds.every((segmentId) => (
        segmentsWithoutUsableContentIds.has(segmentId)
      ))
    )
      ? 'geometry-only' as const
      : 'content' as const;
    const confidence = isStandaloneEditorialMarker(text)
      ? 0
      : evidence === 'geometry-only'
        ? clamp(0.5 * selectedSupport)
      : clamp(
        (0.58 * best.similarity)
        + (0.32 * selectedSupport)
        + (0.1 * margin),
      );
    const status = best.segmentIds.length === 0
      ? 'unlocated'
      : evidence === 'geometry-only'
        ? 'ambiguous'
      : confidence >= options.autoAcceptThreshold
        && best.similarity >= options.minimumAcceptedSimilarity
        ? 'accepted'
        : 'ambiguous';
    return {
      transcriptId: id,
      segmentIds: best.segmentIds,
      operation: best.operation,
      evidence,
      similarity: best.similarity,
      confidence,
      status,
      alternatives: alternatives.slice(0, 3),
    };
  });
}

export function alignTranscriptToRecognizedSegments(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
  suppliedOptions: AlignmentOptions = {},
): AlignmentResult {
  const originalTranscriptLines = transcriptLines;
  const originalSegments = segments;
  const options: ResolvedAlignmentOptions = {
    ...DEFAULT_OPTIONS,
    ...suppliedOptions,
    gapCosts: {
      ...DEFAULT_OPTIONS.gapCosts,
      ...suppliedOptions.gapCosts,
    },
  };
  if (
    !Number.isFinite(options.pathCostTemperature)
    || options.pathCostTemperature <= 0
  ) {
    throw new Error('pathCostTemperature must be a positive finite number');
  }
  if (
    !Number.isFinite(options.unmatchedPairCost)
    || options.unmatchedPairCost <= 0
  ) {
    throw new Error('unmatchedPairCost must be a positive finite number');
  }
  if (
    !Number.isFinite(options.unmatchedPairMaximumSimilarity)
    || options.unmatchedPairMaximumSimilarity < 0
    || options.unmatchedPairMaximumSimilarity > 1
  ) {
    throw new Error(
      'unmatchedPairMaximumSimilarity must be a finite number from 0 to 1',
    );
  }
  const flowPartition = partitionByDominantOrientation(segments);
  const deferredSegments = flowPartition.deferred;
  const preparation = prepareAlignmentSegments({
    transcriptLines,
    segments: flowPartition.mainFlow,
    options: {
      textSimilarity: alignmentTextSimilarity,
    },
  });
  let secondarySegments = preparation.secondaryRawSegments;
  const originalFlowIndex = new Map(
    flowPartition.mainFlow.map(({ id }, index) => [id, index]),
  );
  const explicitPreparedRegions = new Set(
    preparation.primaryRows.flatMap(({ sourceRegionIds }) => sourceRegionIds),
  );
  const preparedRows = explicitPreparedRegions.size > 1
    ? preparation.primaryRows.slice().sort((left, right) => {
      const leftIndex = Math.min(...left.sourceSegmentIds.map(
        (id) => originalFlowIndex.get(id) ?? Number.MAX_SAFE_INTEGER,
      ));
      const rightIndex = Math.min(...right.sourceSegmentIds.map(
        (id) => originalFlowIndex.get(id) ?? Number.MAX_SAFE_INTEGER,
      ));
      return leftIndex - rightIndex;
    })
    : preparation.primaryRows;
  const preparationCollapsedDistinctLines = (
    transcriptLines.length > 0
    && flowPartition.mainFlow.length >= transcriptLines.length * 0.8
    && preparedRows.length < transcriptLines.length * 0.75
  );
  if (preparationCollapsedDistinctLines) {
    // Conflicting orientation metadata can make otherwise separate lines look
    // collinear (notably in legacy rotated fixtures). Preserve the provider
    // sequence rather than destructively flattening evidence.
    segments = orderByExplicitReadingOrder(flowPartition.mainFlow);
    secondarySegments = [];
  } else {
    segments = preparedRows;
  }
  let pageAssessment = assessPageCorrespondence(
    transcriptLines,
    segments,
  );
  const stableLeadingOffset = stableLeadingSegmentOffset(
    transcriptLines,
    segments,
  );
  const boundedReorderLeadingOffset = boundedReorderLeadingSegmentOffset(
    transcriptLines,
    segments,
  );
  const geometryBodyOffset = geometryBackedLeadingBodyOffset(
    transcriptLines,
    segments,
    pageAssessment,
  );
  if (
    pageAssessment.status === 'transcript-mismatch'
    && geometryBodyOffset === 0
  ) {
    return transcriptMismatchResult(
      transcriptLines,
      originalSegments,
      deferredSegments,
      pageAssessment,
    );
  }
  const leadingSelection = stableLeadingOffset > 0
    ? { offset: stableLeadingOffset, source: 'content-anchor' as const }
    : boundedReorderLeadingOffset > 0
      ? {
        offset: boundedReorderLeadingOffset,
        source: 'bounded-reorder' as const,
      }
      : geometryBodyOffset > 0
        ? { offset: geometryBodyOffset, source: 'geometry' as const }
        : { offset: 0, source: null };
  const leadingSegmentOffset = leadingSelection.offset;
  const geometryBodySelectionApplied = leadingSelection.source === 'geometry';
  const leadingPreparedSegments = segments.slice(0, leadingSegmentOffset);
  const leadingRawIds = new Set(
    operationSegmentIds(leadingPreparedSegments),
  );
  const anchorExcludedSegments = originalSegments.filter(
    ({ id }) => leadingRawIds.has(id),
  );
  if (leadingSegmentOffset > 0) {
    segments = segments.slice(leadingSegmentOffset);
    pageAssessment = assessPageCorrespondence(transcriptLines, segments);
  }
  const segmentReorder = applyBoundedLocalReorders(
    transcriptLines,
    segments,
    {
      movableSide: 'segments',
      similarity: alignmentTextSimilarity,
    },
  );
  const transcriptReorder = applyBoundedLocalReorders(
    segmentReorder.transcriptLines,
    segmentReorder.segments,
    {
      movableSide: 'transcript',
      similarity: alignmentTextSimilarity,
    },
  );
  transcriptLines = transcriptReorder.transcriptLines;
  segments = transcriptReorder.segments;
  const localReorderDecisions = [
    ...segmentReorder.decisions,
    ...transcriptReorder.decisions,
  ];
  const geometryMissingTranscriptIndex = geometryBackedMissingTranscriptIndex(
    transcriptLines,
    segments,
  );
  const sequenceCoverageMode = (
    geometryBodySelectionApplied
    || (
      pageAssessment.countRatio >= 0.75
      && (
        pageAssessment.usableAnchorCount >= 2
        || (
          pageAssessment.usableAnchorCount >= 1
          && preparation.selection.selectedScore.strongMatchCount >= 2
        )
      )
      && segments.every((segment) => (
        projectedSegmentExtent(segment) !== null
      ))
    )
  );
  const structuralComponentIds = new Set(
    segments.map(({ structuralComponentId }) => structuralComponentId),
  );
  const preserveInteriorGeometry = (
    sequenceCoverageMode
    && pageAssessment.countRatio === 1
    && structuralComponentIds.size === 1
    && !structuralComponentIds.has(null)
    && !structuralComponentIds.has(undefined)
  );
  const gapCosts = sequenceCoverageMode
    ? {
      skippedSegmentOpen: Math.max(
        options.gapCosts.skippedSegmentOpen,
        1.08,
      ),
      skippedSegmentExtend: Math.max(
        options.gapCosts.skippedSegmentExtend,
        1.04,
      ),
      unlocatedTranscriptOpen: Math.max(
        options.gapCosts.unlocatedTranscriptOpen,
        1.08,
      ),
      unlocatedTranscriptExtend: Math.max(
        options.gapCosts.unlocatedTranscriptExtend,
        1.04,
      ),
    }
    : options.gapCosts;

  const matrix = createMatrix(transcriptLines.length, segments.length);
  matrix[0][0].match = [{
    cost: 0,
    operations: [],
    signature: 'start',
  }];

  for (let transcriptIndex = 0; transcriptIndex <= transcriptLines.length; transcriptIndex += 1) {
    for (let segmentIndex = 0; segmentIndex <= segments.length; segmentIndex += 1) {
      if (transcriptIndex === 0 && segmentIndex === 0) continue;
      const cell = matrix[transcriptIndex][segmentIndex];

      if (
        transcriptIndex > 0
        && isStandaloneEditorialMarker(
          transcriptLines[transcriptIndex - 1].text,
        )
      ) {
        const transcriptLine = transcriptLines[transcriptIndex - 1];
        const operation: AlignmentOperation = {
          kind: 'unlocated-transcript',
          transcriptIds: [transcriptLine.id],
          segmentIds: [],
          transcriptText: transcriptLine.text,
          recognizedText: '',
          similarity: 0,
          cost: 0,
        };
        const previous = matrix[transcriptIndex - 1][segmentIndex];
        (Object.keys(previous) as PathState[]).forEach((state) => {
          cell[state] = keepBest(
            previous[state].map((path) => (
              appendOperation(path, operation, 0)
            )),
            options.topK,
          );
        });
        continue;
      }

      const matchCandidates: Path[] = [];
      let oneToOneOperation: AlignmentOperation | null = null;
      for (
        let transcriptGroupSize = 1;
        transcriptGroupSize <= options.maxGroupSize;
        transcriptGroupSize += 1
      ) {
        for (
          let segmentGroupSize = 1;
          segmentGroupSize <= options.maxGroupSize;
          segmentGroupSize += 1
        ) {
          if (
            transcriptGroupSize > 1
            && segmentGroupSize > 1
          ) continue;
          if (
            sequenceCoverageMode
            && transcriptGroupSize > 1
            && segments.length >= transcriptLines.length
          ) continue;
          if (
            transcriptIndex < transcriptGroupSize
            || segmentIndex < segmentGroupSize
          ) continue;
          const transcriptGroup = transcriptLines.slice(
            transcriptIndex - transcriptGroupSize,
            transcriptIndex,
          );
          if (
            transcriptGroup.some(({ text }) => (
              isStandaloneEditorialMarker(text)
            ))
          ) continue;
          const segmentGroup = segments.slice(
            segmentIndex - segmentGroupSize,
            segmentIndex,
          );
          // A blank human outline is independent geometry evidence, not a
          // recognized fragment. It may fill exactly one transcript gap by
          // position, but it must never be absorbed into a split or merge
          // with neighboring recognized text.
          if (
            segmentGroup.some(isBlankHumanGapFill)
            && (transcriptGroupSize !== 1 || segmentGroupSize !== 1)
          ) continue;
          if (!canMatchSegmentGroup(segmentGroup)) continue;
          if (isUnsupportedTranscriptMerge(
            transcriptGroup,
            segmentGroup,
          )) continue;
          const previous = matrix[
            transcriptIndex - transcriptGroupSize
          ][
            segmentIndex - segmentGroupSize
          ];
          const operation = matchCost(
            transcriptGroup,
            segmentGroup,
            options.splitMergePenalty + (
              geometryMissingTranscriptIndex !== null
              && transcriptGroupSize > 1
                ? (
                  geometryMissingTranscriptIndex
                    >= transcriptIndex - transcriptGroupSize
                  && geometryMissingTranscriptIndex < transcriptIndex
                    ? MISSING_ROW_TRANSCRIPT_MERGE_PENALTY
                    : MISSING_ROW_TRANSCRIPT_MERGE_PENALTY / 2
                )
                : 0
            ),
          );
          if (transcriptGroupSize === 1 && segmentGroupSize === 1) {
            oneToOneOperation = operation;
          }
          allPaths(previous).forEach((path) => {
            matchCandidates.push(appendOperation(path, operation));
          });
        }
      }
      const transposedOperations = transposedMatchOperations(
        transcriptLines,
        segments,
        transcriptIndex,
        segmentIndex,
        options.splitMergePenalty,
        flowPartition.dominantOrientation,
        flowPartition.dominantFlowDirectionSign,
      );
      if (transposedOperations) {
        const previous = matrix[transcriptIndex - 2][segmentIndex - 2];
        allPaths(previous).forEach((path) => {
          matchCandidates.push(appendOperations(path, transposedOperations));
        });
      }
      const unmatchedPairCandidates: Path[] = [];
      if (transcriptIndex > 0 && segmentIndex > 0) {
        const transcriptLine = transcriptLines[transcriptIndex - 1];
        const segment = segments[segmentIndex - 1];
        const pairSimilarity = oneToOneOperation?.similarity
          ?? alignmentTextSimilarity(transcriptLine.text, segment.text);
        if (
          !preserveInteriorGeometry
          &&
          pairSimilarity <= options.unmatchedPairMaximumSimilarity
          && hasStrongSurroundingAnchors(
            transcriptLines,
            segments,
            transcriptIndex,
            segmentIndex,
            options.minimumAcceptedSimilarity,
          )
        ) {
          const previous = matrix[transcriptIndex - 1][segmentIndex - 1];
          const combinedGapOpenCost = (
            gapCosts.skippedSegmentOpen
            + gapCosts.unlocatedTranscriptOpen
          );
          const skippedShare = options.unmatchedPairCost * (
            combinedGapOpenCost > 0
              ? gapCosts.skippedSegmentOpen / combinedGapOpenCost
              : 0.5
          );
          const unlocatedShare = options.unmatchedPairCost - skippedShare;
          const unlocatedOperation: AlignmentOperation = {
            kind: 'unlocated-transcript',
            transcriptIds: [transcriptLine.id],
            segmentIds: [],
            transcriptText: transcriptLine.text,
            recognizedText: '',
            similarity: 0,
            cost: unlocatedShare,
          };
          const skippedOperation: AlignmentOperation = {
            kind: 'skip-segment',
            transcriptIds: [],
            segmentIds: operationSegmentIds([segment]),
            transcriptText: '',
            recognizedText: segment.text,
            similarity: 0,
            cost: skippedShare,
          };
          // This is an atomic substitution by "no link", not two opposing gap
          // runs. It is allowed only between strong one-to-one anchors and
          // enters its own state. Sourcing exclusively from the match state
          // prevents consecutive substitutions from erasing a noisy suffix.
          previous.match.forEach((path) => {
            unmatchedPairCandidates.push(appendOperations(path, [
              unlocatedOperation,
              skippedOperation,
            ]));
          });
        }
      }
      cell.match = keepBest(matchCandidates, options.topK);
      cell['unmatched-pair'] = keepBest(
        unmatchedPairCandidates,
        options.topK,
      );

      if (segmentIndex > 0) {
        const segment = segments[segmentIndex - 1];
        const ordinaryOperation: AlignmentOperation = {
          kind: 'skip-segment',
          transcriptIds: [],
          segmentIds: operationSegmentIds([segment]),
          transcriptText: '',
          recognizedText: segment.text,
          similarity: 0,
          cost: options.gapCosts.skippedSegmentOpen,
        };
        const previous = matrix[transcriptIndex][segmentIndex - 1];
        // A detected-only gap may open from a content match or extend itself,
        // but it cannot switch directly from a transcript-only gap. Allowing
        // gap-to-gap transitions lets the aligner cheaply abandon both
        // remaining sequences instead of comparing their noisy text.
        const candidates = [
          ...previous.match,
          ...previous['skip-segment'],
        ].map((path) => {
          const isExtension = previous['skip-segment'].includes(path);
          const cost = isExtension
            ? gapCosts.skippedSegmentExtend
            : gapCosts.skippedSegmentOpen;
          return appendOperation(
            path,
            { ...ordinaryOperation, cost },
            cost,
          );
        });
        cell['skip-segment'] = keepBest(candidates, options.topK);
      }

      if (transcriptIndex > 0) {
        const transcriptLine = transcriptLines[transcriptIndex - 1];
        const operation: AlignmentOperation = {
          kind: 'unlocated-transcript',
          transcriptIds: [transcriptLine.id],
          segmentIds: [],
          transcriptText: transcriptLine.text,
          recognizedText: '',
          similarity: 0,
          cost: options.gapCosts.unlocatedTranscriptOpen,
        };
        const previous = matrix[transcriptIndex - 1][segmentIndex];
        const candidates = [
          ...previous.match,
          ...previous['unlocated-transcript'],
        ].map((path) => {
          const isExtension = previous['unlocated-transcript'].includes(path);
          const ordinaryCost = isExtension
            ? gapCosts.unlocatedTranscriptExtend
            : gapCosts.unlocatedTranscriptOpen;
          const cost = Math.max(
            0,
            ordinaryCost - (
              transcriptIndex - 1 === geometryMissingTranscriptIndex
                ? MISSING_ROW_EXPECTED_GAP_BONUS
                : 0
            ),
          );
          return appendOperation(path, { ...operation, cost }, cost);
        });
        cell['unlocated-transcript'] = keepBest(candidates, options.topK);
      }
    }
  }

  const completed = keepBest(
    allPaths(matrix[transcriptLines.length][segments.length]),
    options.topK,
  );
  const bestPath = completed[0] ?? {
    cost: 0,
    operations: [],
    signature: 'empty',
  };
  const secondBestCost = completed[1]?.cost ?? null;
  const pathMargin = secondBestCost === null
    ? null
    : secondBestCost - bestPath.cost;
  const coreMappings = buildMappings(
    originalTranscriptLines,
    bestPath,
    completed,
    options,
    new Set(
      originalSegments
        .filter((segment) => (
          segment.text.trim().length === 0
          || segment.recognitionState === 'attempted-empty'
          || segment.recognitionState === 'not-attempted'
        ))
        .map(({ id }) => id),
    ),
  );
  const deferredIds = new Set(deferredSegments.map(({ id }) => id));
  const secondaryIds = new Set(secondarySegments.map(({ id }) => id));
  const nonTranscribedIds = geometryBodySelectionApplied
    ? leadingRawIds
    : new Set<string>();
  const uncertainIds = new Set(
    [
      ...anchorExcludedSegments
        .filter(({ id }) => !nonTranscribedIds.has(id))
        .map(({ id }) => id),
      ...bestPath.operations
        .filter(({ kind }) => kind === 'skip-segment')
        .flatMap(({ segmentIds }) => segmentIds),
    ],
  );
  const skippedIds = new Set([
    ...deferredIds,
    ...secondaryIds,
    ...nonTranscribedIds,
    ...uncertainIds,
  ]);
  return {
    totalCost: bestPath.cost,
    secondBestCost,
    pathMargin,
    operations: bestPath.operations,
    mappings: coreMappings,
    skippedSegmentIds: originalSegments
      .filter(({ id }) => skippedIds.has(id))
      .map(({ id }) => id),
    deferredSegmentIds: originalSegments
      .filter(({ id }) => deferredIds.has(id))
      .map(({ id }) => id),
    unassignedSegmentReasons: originalSegments
      .filter(({ id }) => skippedIds.has(id))
      .map(({ id }) => ({
        segmentId: id,
        reason: deferredIds.has(id)
          ? 'deferred-orientation' as const
          : secondaryIds.has(id)
            ? 'secondary-flow' as const
            : nonTranscribedIds.has(id)
              ? 'non-transcribed-text' as const
              : 'alignment-uncertain' as const,
      })),
    exploredPathCount: completed.length,
    localReorderDecisions,
    pageAssessment,
  };
}

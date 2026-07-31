import type {
  RecognizedSegment,
  TranscriptLine,
} from './aligner.js';

export type BoundedLocalReorderSide = 'segments' | 'transcript';

export type AlignmentTextSimilarity = (
  transcriptText: string,
  recognizedText: string,
) => number;

export type BoundedLocalReorderOptions = {
  movableSide: BoundedLocalReorderSide;
  similarity: AlignmentTextSimilarity;
  minimumAverageSimilarityGain?: number;
  minimumPairSimilarity?: number;
  maximumPairRegression?: number;
  minimumGeometryGain?: number;
  minimumFlowSeparation?: number;
  orientationToleranceDegrees?: number;
};

export type BoundedLocalReorderDecision = {
  movableSide: BoundedLocalReorderSide;
  windowStart: number;
  windowSize: 2 | 3;
  beforeIds: string[];
  afterIds: string[];
  permutation: number[];
  baselineSimilarity: number;
  reorderedSimilarity: number;
  similarityGain: number;
  minimumReorderedPairSimilarity: number;
  geometryScoreBefore: number;
  geometryScoreAfter: number;
};

export type BoundedLocalReorderResult = {
  transcriptLines: TranscriptLine[];
  segments: RecognizedSegment[];
  decisions: BoundedLocalReorderDecision[];
};

type ResolvedOptions = Required<Omit<
  BoundedLocalReorderOptions,
  'movableSide' | 'similarity'
>> & Pick<BoundedLocalReorderOptions, 'movableSide' | 'similarity'>;

type FlowGeometry = {
  center: number;
  thickness: number;
};

type WindowCandidate = BoundedLocalReorderDecision & {
  score: number;
};

const DEFAULTS = {
  minimumAverageSimilarityGain: 0.18,
  minimumPairSimilarity: 0.5,
  maximumPairRegression: 0.03,
  minimumGeometryGain: 0.34,
  minimumFlowSeparation: 8,
  orientationToleranceDegrees: 25,
} as const;

const PERMUTATIONS: Record<2 | 3, number[][]> = {
  2: [[1, 0]],
  3: [
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ],
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function finitePoints(
  points: RecognizedSegment['boundary'] | RecognizedSegment['baseline'],
): Array<{ x: number; y: number }> {
  return (points ?? []).filter(
    ({ x, y }) => Number.isFinite(x) && Number.isFinite(y),
  );
}

function canonicalOrientation(degrees: number): number {
  let result = degrees % 180;
  if (result < -90) result += 180;
  if (result >= 90) result -= 180;
  return result;
}

function orientationDistance(left: number, right: number): number {
  const difference = Math.abs(
    canonicalOrientation(left) - canonicalOrientation(right),
  );
  return Math.min(difference, 180 - difference);
}

function inferredOrientation(segment: RecognizedSegment): number | null {
  if (
    typeof segment.orientationDegrees === 'number'
    && Number.isFinite(segment.orientationDegrees)
  ) {
    return canonicalOrientation(segment.orientationDegrees);
  }
  const baseline = finitePoints(segment.baseline);
  const first = baseline[0];
  const last = baseline.at(-1);
  if (!first || !last) return null;
  const deltaX = last.x - first.x;
  const deltaY = last.y - first.y;
  if (deltaX === 0 && deltaY === 0) return null;
  return canonicalOrientation(
    Math.atan2(deltaY, deltaX) * (180 / Math.PI),
  );
}

function meanOrientation(orientations: number[]): number | null {
  if (orientations.length === 0) return null;
  const doubled = orientations.map((degrees) => degrees * 2 * (Math.PI / 180));
  const x = doubled.reduce((sum, radians) => sum + Math.cos(radians), 0);
  const y = doubled.reduce((sum, radians) => sum + Math.sin(radians), 0);
  if (x === 0 && y === 0) return null;
  return canonicalOrientation(
    (Math.atan2(y, x) / 2) * (180 / Math.PI),
  );
}

function dominantFlowDirectionSign(segments: RecognizedSegment[]): 1 | -1 {
  const signs = segments.flatMap(({ flowDirectionSign }) => (
    flowDirectionSign === 1 || flowDirectionSign === -1
      ? [flowDirectionSign]
      : []
  ));
  if (signs.length === 0) return 1;
  return signs.reduce<number>((sum, sign) => sum + sign, 0) < 0 ? -1 : 1;
}

function flowGeometries(
  segments: RecognizedSegment[],
  orientationToleranceDegrees: number,
): FlowGeometry[] | null {
  const knownRegions = new Set(
    segments
      .map(({ regionId }) => regionId)
      .filter((value): value is string => Boolean(value)),
  );
  if (knownRegions.size > 1) return null;

  const orientations = segments.map(inferredOrientation);
  if (orientations.some((value) => value === null)) return null;
  const mean = meanOrientation(orientations as number[]);
  if (mean === null) return null;
  if (orientations.some((value) => (
    orientationDistance(value as number, mean)
      > orientationToleranceDegrees
  ))) {
    return null;
  }

  const radians = mean * (Math.PI / 180);
  const flowDirectionSign = dominantFlowDirectionSign(segments);
  const flowX = flowDirectionSign * -Math.sin(radians);
  const flowY = flowDirectionSign * Math.cos(radians);

  return segments.map((segment) => {
    const boundary = finitePoints(segment.boundary);
    const baseline = finitePoints(segment.baseline);
    const extentPoints = boundary.length > 0 ? boundary : baseline;
    if (extentPoints.length === 0) return null;
    const extentCoordinates = extentPoints.map(
      ({ x, y }) => (flowX * x) + (flowY * y),
    );
    const anchorPoints = baseline.length > 0 ? baseline : extentPoints;
    const anchorCoordinates = anchorPoints.map(
      ({ x, y }) => (flowX * x) + (flowY * y),
    );
    return {
      center: anchorCoordinates.reduce((sum, value) => sum + value, 0)
        / anchorCoordinates.length,
      thickness: Math.max(
        1,
        Math.max(...extentCoordinates) - Math.min(...extentCoordinates),
      ),
    };
  }).filter((value): value is FlowGeometry => value !== null);
}

function geometryOrderScore(
  geometries: FlowGeometry[],
  minimumFlowSeparation: number,
): number {
  if (geometries.length < 2) return 1;
  let forward = 0;
  for (let index = 1; index < geometries.length; index += 1) {
    const previous = geometries[index - 1];
    const current = geometries[index];
    const requiredSeparation = Math.max(
      minimumFlowSeparation,
      0.1 * Math.min(previous.thickness, current.thickness),
    );
    if (current.center - previous.center >= requiredSeparation) {
      forward += 1;
    }
  }
  return forward / (geometries.length - 1);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pairSimilarities(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
  similarity: AlignmentTextSimilarity,
): number[] {
  return transcriptLines.map((line, index) => (
    clamp(similarity(line.text, segments[index].text))
  ));
}

function permute<T>(values: T[], permutation: number[]): T[] {
  return permutation.map((index) => values[index]);
}

function candidateForWindow(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
  windowStart: number,
  windowSize: 2 | 3,
  permutation: number[],
  options: ResolvedOptions,
): WindowCandidate | null {
  const transcriptWindow = transcriptLines.slice(
    windowStart,
    windowStart + windowSize,
  );
  const segmentWindow = segments.slice(
    windowStart,
    windowStart + windowSize,
  );
  const geometries = flowGeometries(
    segmentWindow,
    options.orientationToleranceDegrees,
  );
  if (!geometries || geometries.length !== windowSize) return null;

  const reorderedTranscript = options.movableSide === 'transcript'
    ? permute(transcriptWindow, permutation)
    : transcriptWindow;
  const reorderedSegments = options.movableSide === 'segments'
    ? permute(segmentWindow, permutation)
    : segmentWindow;
  const reorderedGeometries = options.movableSide === 'segments'
    ? permute(geometries, permutation)
    : geometries;
  const geometryScoreBefore = geometryOrderScore(
    geometries,
    options.minimumFlowSeparation,
  );
  const geometryScoreAfter = geometryOrderScore(
    reorderedGeometries,
    options.minimumFlowSeparation,
  );
  if (geometryScoreAfter < 1) return null;
  if (
    options.movableSide === 'segments'
    && geometryScoreAfter - geometryScoreBefore < options.minimumGeometryGain
  ) {
    return null;
  }

  const baselinePairs = pairSimilarities(
    transcriptWindow,
    segmentWindow,
    options.similarity,
  );
  const reorderedPairs = pairSimilarities(
    reorderedTranscript,
    reorderedSegments,
    options.similarity,
  );
  const baselineSimilarity = average(baselinePairs);
  const reorderedSimilarity = average(reorderedPairs);
  const similarityGain = reorderedSimilarity - baselineSimilarity;
  if (similarityGain < options.minimumAverageSimilarityGain) return null;
  const minimumReorderedPairSimilarity = Math.min(...reorderedPairs);
  if (minimumReorderedPairSimilarity < options.minimumPairSimilarity) {
    return null;
  }
  if (reorderedPairs.some((value, index) => (
    value + options.maximumPairRegression < baselinePairs[index]
  ))) {
    return null;
  }

  const before = options.movableSide === 'segments'
    ? segmentWindow
    : transcriptWindow;
  const after = options.movableSide === 'segments'
    ? reorderedSegments
    : reorderedTranscript;
  return {
    movableSide: options.movableSide,
    windowStart,
    windowSize,
    beforeIds: before.map(({ id }) => id),
    afterIds: after.map(({ id }) => id),
    permutation: [...permutation],
    baselineSimilarity: round(baselineSimilarity),
    reorderedSimilarity: round(reorderedSimilarity),
    similarityGain: round(similarityGain),
    minimumReorderedPairSimilarity: round(minimumReorderedPairSimilarity),
    geometryScoreBefore: round(geometryScoreBefore),
    geometryScoreAfter: round(geometryScoreAfter),
    score: similarityGain + (
      0.1 * (geometryScoreAfter - geometryScoreBefore)
    ),
  };
}

function assertUniqueIds(
  label: string,
  values: Array<{ id: string }>,
): void {
  const ids = values.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} ids must be unique`);
  }
}

function resolveOptions(
  suppliedOptions: BoundedLocalReorderOptions,
): ResolvedOptions {
  const options: ResolvedOptions = {
    ...DEFAULTS,
    ...suppliedOptions,
  };
  const unitIntervalOptions = [
    'minimumAverageSimilarityGain',
    'minimumPairSimilarity',
    'maximumPairRegression',
    'minimumGeometryGain',
  ] as const;
  unitIntervalOptions.forEach((key) => {
    const value = options[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${key} must be a finite number from 0 to 1`);
    }
  });
  if (
    !Number.isFinite(options.minimumFlowSeparation)
    || options.minimumFlowSeparation < 0
  ) {
    throw new Error(
      'minimumFlowSeparation must be a non-negative finite number',
    );
  }
  if (
    !Number.isFinite(options.orientationToleranceDegrees)
    || options.orientationToleranceDegrees < 0
    || options.orientationToleranceDegrees > 90
  ) {
    throw new Error(
      'orientationToleranceDegrees must be a finite number from 0 to 90',
    );
  }
  return options;
}

/**
 * Applies evidence-backed permutations to disjoint 2-3 item windows.
 *
 * The inputs are an already paired, equal-length sequence. Unequal inputs are
 * intentionally returned unchanged so gap handling remains the aligner's job.
 * Objects and ids are preserved; only the caller-selected side may move.
 */
export function applyBoundedLocalReorders(
  transcriptLines: TranscriptLine[],
  segments: RecognizedSegment[],
  suppliedOptions: BoundedLocalReorderOptions,
): BoundedLocalReorderResult {
  assertUniqueIds('Transcript line', transcriptLines);
  assertUniqueIds('Segment', segments);
  const result: BoundedLocalReorderResult = {
    transcriptLines: [...transcriptLines],
    segments: [...segments],
    decisions: [],
  };
  if (
    transcriptLines.length !== segments.length
    || transcriptLines.length < 2
  ) {
    return result;
  }

  const options = resolveOptions(suppliedOptions);
  const candidates: WindowCandidate[] = [];
  for (let windowStart = 0; windowStart < transcriptLines.length; windowStart += 1) {
    for (const windowSize of [3, 2] as const) {
      if (windowStart + windowSize > transcriptLines.length) continue;
      PERMUTATIONS[windowSize].forEach((permutation) => {
        const candidate = candidateForWindow(
          transcriptLines,
          segments,
          windowStart,
          windowSize,
          permutation,
          options,
        );
        if (candidate) candidates.push(candidate);
      });
    }
  }

  const occupied = new Set<number>();
  const accepted = candidates
    .sort((left, right) => (
      right.score - left.score
      || left.windowStart - right.windowStart
      || right.windowSize - left.windowSize
      || left.afterIds.join('\u0000').localeCompare(
        right.afterIds.join('\u0000'),
      )
    ))
    .filter((candidate) => {
      const indices = Array.from(
        { length: candidate.windowSize },
        (_, offset) => candidate.windowStart + offset,
      );
      if (indices.some((index) => occupied.has(index))) return false;
      indices.forEach((index) => occupied.add(index));
      return true;
    })
    .sort((left, right) => left.windowStart - right.windowStart);

  accepted.forEach((decision) => {
    const target = decision.movableSide === 'segments'
      ? result.segments
      : result.transcriptLines;
    const window = target.slice(
      decision.windowStart,
      decision.windowStart + decision.windowSize,
    );
    target.splice(
      decision.windowStart,
      decision.windowSize,
      ...permute(window, decision.permutation),
    );
    const { score: _score, ...publicDecision } = decision;
    result.decisions.push(publicDecision);
  });

  return result;
}

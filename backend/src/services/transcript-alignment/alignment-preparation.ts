import type {
  RecognizedSegment,
  TranscriptLine,
} from './aligner.js';
import {
  normalizeSegmentStructure,
  type PhysicalRow,
  type SpatialFlowComponent,
  type StructuralNormalizationOptions,
  type StructuralNormalizationResult,
} from './structural-normalization.js';

export type PreparedAlignmentSegment = RecognizedSegment & {
  sourceSegmentIds: string[];
  sourceRegionIds: string[];
  structuralRowId: string;
  structuralComponentId: string | null;
};

export type ComponentSubsetScore = {
  componentIds: string[];
  rowCount: number;
  countFit: number;
  contentCoverage: number;
  strongestSimilarity: number;
  strongMatchCount: number;
  score: number;
};

export type AlignmentPreparationSelection = {
  mode: 'geometry-bypass' | 'all-components' | 'component-subset';
  primaryComponentIds: string[];
  secondaryComponentIds: string[];
  allComponentsScore: ComponentSubsetScore;
  selectedScore: ComponentSubsetScore;
  scoreImprovement: number;
};

export type AlignmentPreparationResult = {
  primaryRows: PreparedAlignmentSegment[];
  secondaryRows: PreparedAlignmentSegment[];
  secondaryRawSegments: RecognizedSegment[];
  rawSegmentIdsByPreparedId: Record<string, string[]>;
  structural: StructuralNormalizationResult;
  selection: AlignmentPreparationSelection;
};

export type AlignmentPreparationOptions = {
  structural?: StructuralNormalizationOptions;
  structure?: StructuralNormalizationResult;
  textSimilarity?: (left: string, right: string) => number;
  minimumSubsetScoreImprovement?: number;
  minimumContentEvidenceSimilarity?: number;
  strongContentSimilarity?: number;
  maximumExhaustiveComponentCount?: number;
};

type ResolvedPreparationOptions = {
  structural: StructuralNormalizationOptions;
  textSimilarity: (left: string, right: string) => number;
  minimumSubsetScoreImprovement: number;
  minimumContentEvidenceSimilarity: number;
  strongContentSimilarity: number;
  maximumExhaustiveComponentCount: number;
};

type ComponentRows = {
  component: SpatialFlowComponent;
  rows: PreparedAlignmentSegment[];
};

const COMBINING_MARK = /\p{M}/gu;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;
const EDITORIAL_MARKER = /\[(?:illegible|unclear|unreadable|blank|missing)(?:[^\]]*)\]/giu;

const DEFAULT_OPTIONS: ResolvedPreparationOptions = {
  structural: {
    // In the benchmark's prepared-pixel space, 155 px reconnects the widest
    // confirmed same-row gaps (151 px on 007 page 1 and 138 px on 009 page
    // 9), while staying below the 162 px gutter on 007 page 2.
    minimumFragmentGapTolerance: 155,
    maximumFragmentGapPageRatio: 0.05,
  },
  textSimilarity: defaultTextSimilarity,
  minimumSubsetScoreImprovement: 0.04,
  minimumContentEvidenceSimilarity: 0.3,
  strongContentSimilarity: 0.42,
  maximumExhaustiveComponentCount: 12,
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundMetric(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeText(value: string): string {
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

function levenshteinDistance(left: string, right: string): number {
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
    for (
      let rightIndex = 1;
      rightIndex <= rightPoints.length;
      rightIndex += 1
    ) {
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

function defaultTextSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) return 0;
  const maximumLength = Math.max(
    Array.from(normalizedLeft).length,
    Array.from(normalizedRight).length,
  );
  const characterSimilarity = 1 - (
    levenshteinDistance(normalizedLeft, normalizedRight) / maximumLength
  );
  const lengthSimilarity = Math.min(
    normalizedLeft.length,
    normalizedRight.length,
  ) / Math.max(normalizedLeft.length, normalizedRight.length);
  return clamp(
    (0.72 * characterSimilarity)
    + (0.18 * tokenDice(normalizedLeft, normalizedRight))
    + (0.1 * lengthSimilarity),
  );
}

function resolveOptions(
  options: AlignmentPreparationOptions,
): ResolvedPreparationOptions {
  const resolved = {
    ...DEFAULT_OPTIONS,
    ...options,
    structural: {
      ...DEFAULT_OPTIONS.structural,
      ...options.structural,
    },
  };
  [
    'minimumSubsetScoreImprovement',
    'minimumContentEvidenceSimilarity',
    'strongContentSimilarity',
  ].forEach((key) => {
    const value = resolved[key as keyof ResolvedPreparationOptions];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`Alignment preparation option ${key} must be non-negative`);
    }
  });
  if (
    !Number.isInteger(resolved.maximumExhaustiveComponentCount)
    || resolved.maximumExhaustiveComponentCount < 1
    || resolved.maximumExhaustiveComponentCount > 20
  ) {
    throw new Error(
      'Alignment preparation option maximumExhaustiveComponentCount '
      + 'must be an integer from 1 through 20',
    );
  }
  return resolved;
}

function finitePoints(
  points: RecognizedSegment['boundary'] | RecognizedSegment['baseline'],
): Array<{ x: number; y: number }> {
  return (points ?? []).filter(
    ({ x, y }) => Number.isFinite(x) && Number.isFinite(y),
  );
}

function hasGeometry(segment: RecognizedSegment): boolean {
  return finitePoints(segment.boundary).length > 0
    || finitePoints(segment.baseline).length > 0;
}

function boundaryForRow(row: PhysicalRow): RecognizedSegment['boundary'] {
  if (!row.bounds) return null;
  const {
    left,
    top,
    right,
    bottom,
  } = row.bounds;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function weightedConfidence(segments: RecognizedSegment[]): number | null {
  const values = segments.flatMap((segment) => (
    typeof segment.recognitionConfidence === 'number'
      && Number.isFinite(segment.recognitionConfidence)
      ? [{
          confidence: segment.recognitionConfidence,
          weight: Math.max(Array.from(normalizeText(segment.text)).length, 1),
        }]
      : []
  ));
  if (values.length === 0) return null;
  const weight = values.reduce((sum, value) => sum + value.weight, 0);
  return values.reduce(
    (sum, value) => sum + (value.confidence * value.weight),
    0,
  ) / weight;
}

function dominantFlowDirection(
  segments: RecognizedSegment[],
): 1 | -1 | null {
  const signs = segments.flatMap(({ flowDirectionSign }) => (
    flowDirectionSign === 1 || flowDirectionSign === -1
      ? [flowDirectionSign]
      : []
  ));
  if (signs.length === 0) return null;
  return signs.reduce<number>((sum, sign) => sum + sign, 0) < 0 ? -1 : 1;
}

function rowSegment(
  row: PhysicalRow,
  componentId: string | null,
  rawById: Map<string, RecognizedSegment>,
): PreparedAlignmentSegment {
  const members = row.memberSegmentIds.map((segmentId) => {
    const segment = rawById.get(segmentId);
    if (!segment) {
      throw new Error(
        `Structural row ${row.id} references unknown segment ${segmentId}`,
      );
    }
    return segment;
  });
  const text = members.map(({ text: value }) => value.trim())
    .filter(Boolean)
    .join(' ');
  const readingOrderIndices = members.flatMap(({ readingOrderIndex }) => (
    typeof readingOrderIndex === 'number' && Number.isFinite(readingOrderIndex)
      ? [readingOrderIndex]
      : []
  ));
  const baseline = members.flatMap((member) => finitePoints(member.baseline));
  const recognitionState = members.some(
    ({ recognitionState: state }) => state === 'recognized',
  )
    ? 'recognized' as const
    : members.some(
      ({ recognitionState: state }) => state === 'attempted-empty',
    )
      ? 'attempted-empty' as const
      : members.every(
        ({ recognitionState: state }) => state === 'not-attempted',
      )
        ? 'not-attempted' as const
        : undefined;
  const geometryEvidence = members.every(
    ({ geometryEvidence: evidence }) => evidence === 'human-gap-fill',
  )
    ? 'human-gap-fill' as const
    : members.some(
      ({ geometryEvidence: evidence }) => evidence === 'machine',
    )
      ? 'machine' as const
      : undefined;
  return {
    id: row.id,
    text,
    recognitionState,
    geometryEvidence,
    recognitionConfidence: weightedConfidence(members),
    regionId: row.sourceRegionIds.length === 1
      ? row.sourceRegionIds[0]
      : null,
    orientationDegrees: row.orientationDegrees,
    boundary: boundaryForRow(row),
    baseline: baseline.length > 0 ? baseline : null,
    readingOrderIndex: readingOrderIndices.length > 0
      ? Math.min(...readingOrderIndices)
      : null,
    flowDirectionSign: dominantFlowDirection(members),
    sourceSegmentIds: [...row.memberSegmentIds],
    sourceRegionIds: [...row.sourceRegionIds],
    structuralRowId: row.id,
    structuralComponentId: componentId,
  };
}

function rawById(
  segments: readonly RecognizedSegment[],
): Map<string, RecognizedSegment> {
  const result = new Map<string, RecognizedSegment>();
  segments.forEach((segment) => {
    if (result.has(segment.id)) {
      throw new Error(`Duplicate recognized segment id ${segment.id}`);
    }
    result.set(segment.id, segment);
  });
  return result;
}

function componentRows(
  structure: StructuralNormalizationResult,
  preparedByRowId: Map<string, PreparedAlignmentSegment>,
): ComponentRows[] {
  return structure.components.map((component) => ({
    component,
    rows: component.rowIds.map((rowId) => {
      const row = preparedByRowId.get(rowId);
      if (!row) {
        throw new Error(
          `Structural component ${component.id} references unknown row ${rowId}`,
        );
      }
      return row;
    }),
  }));
}

function subsetScore(
  componentIds: readonly string[],
  components: ComponentRows[],
  transcriptLines: readonly TranscriptLine[],
  options: ResolvedPreparationOptions,
): ComponentSubsetScore {
  const selectedIds = new Set(componentIds);
  const rows = components
    .filter(({ component }) => selectedIds.has(component.id))
    .flatMap(({ rows: values }) => values);
  const similarities = transcriptLines.map(({ text }) => (
    rows.reduce(
      (best, row) => Math.max(
        best,
        options.textSimilarity(text, row.text),
      ),
      0,
    )
  ));
  const contentCoverage = similarities.length > 0
    ? similarities.reduce((sum, value) => sum + value, 0)
      / similarities.length
    : 0;
  const countFit = transcriptLines.length === 0 && rows.length === 0
    ? 1
    : Math.min(transcriptLines.length, rows.length)
      / Math.max(transcriptLines.length, rows.length, 1);
  return {
    componentIds: [...componentIds].sort((left, right) => (
      left.localeCompare(right)
    )),
    rowCount: rows.length,
    countFit: roundMetric(countFit),
    contentCoverage: roundMetric(contentCoverage),
    strongestSimilarity: roundMetric(Math.max(0, ...similarities)),
    strongMatchCount: similarities.filter(
      (value) => value >= options.strongContentSimilarity,
    ).length,
    score: roundMetric(
      (0.72 * contentCoverage)
      + (0.28 * countFit),
    ),
  };
}

function compareSubsetScores(
  left: ComponentSubsetScore,
  right: ComponentSubsetScore,
): number {
  const scoreDifference = left.score - right.score;
  if (Math.abs(scoreDifference) > 0.000001) return scoreDifference;
  const coverageDifference = left.contentCoverage - right.contentCoverage;
  if (Math.abs(coverageDifference) > 0.000001) return coverageDifference;
  const strongDifference = left.strongMatchCount - right.strongMatchCount;
  if (strongDifference !== 0) return strongDifference;
  // When the evidence is tied, preserve more components. Exclusion requires
  // positive evidence; it is never the tie-breaker.
  const componentDifference = left.componentIds.length
    - right.componentIds.length;
  if (componentDifference !== 0) return componentDifference;
  return right.componentIds.join('\u0000').localeCompare(
    left.componentIds.join('\u0000'),
  );
}

function exhaustiveSubsets(
  componentIds: string[],
  mandatoryIds: Set<string>,
): string[][] {
  const result: string[][] = [];
  const subsetCount = 2 ** componentIds.length;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    const ids = componentIds.filter((_, index) => (
      (mask & (2 ** index)) !== 0
    ));
    if ([...mandatoryIds].every((id) => ids.includes(id))) {
      result.push(ids);
    }
  }
  return result;
}

function greedySubsets(
  componentIds: string[],
  mandatoryIds: Set<string>,
): string[][] {
  const subsets = [componentIds];
  componentIds.forEach((componentId) => {
    if (mandatoryIds.has(componentId)) return;
    subsets.push(componentIds.filter((id) => id !== componentId));
  });
  return subsets;
}

function chooseComponents(
  structure: StructuralNormalizationResult,
  components: ComponentRows[],
  transcriptLines: readonly TranscriptLine[],
  options: ResolvedPreparationOptions,
): AlignmentPreparationSelection {
  const allIds = structure.components.map(({ id }) => id);
  const allComponentsScore = subsetScore(
    allIds,
    components,
    transcriptLines,
    options,
  );
  if (allIds.length <= 1 || transcriptLines.length === 0) {
    return {
      mode: 'all-components',
      primaryComponentIds: allIds,
      secondaryComponentIds: [],
      allComponentsScore,
      selectedScore: allComponentsScore,
      scoreImprovement: 0,
    };
  }

  const mandatoryIds = new Set(
    structure.components
      .filter((component) => component.rowIds.some((rowId) => (
        structure.rows.find(({ id }) => id === rowId)?.bounds === null
      )))
      .map(({ id }) => id),
  );
  const subsets = allIds.length <= options.maximumExhaustiveComponentCount
    ? exhaustiveSubsets(allIds, mandatoryIds)
    : greedySubsets(allIds, mandatoryIds);
  const best = subsets
    .map((ids) => subsetScore(ids, components, transcriptLines, options))
    .sort((left, right) => compareSubsetScores(right, left))[0]
    ?? allComponentsScore;
  const scoreImprovement = roundMetric(best.score - allComponentsScore.score);
  const hasContentEvidence = best.strongestSimilarity
    >= options.minimumContentEvidenceSimilarity;
  const coveragePreserved = best.contentCoverage
    >= allComponentsScore.contentCoverage - 0.02;
  const useSubset = best.componentIds.length < allIds.length
    && scoreImprovement >= options.minimumSubsetScoreImprovement
    && hasContentEvidence
    && coveragePreserved;
  const primaryComponentIds = useSubset ? best.componentIds : allIds;
  const primarySet = new Set(primaryComponentIds);
  return {
    mode: useSubset ? 'component-subset' : 'all-components',
    primaryComponentIds,
    secondaryComponentIds: allIds.filter((id) => !primarySet.has(id)),
    allComponentsScore,
    selectedScore: useSubset ? best : allComponentsScore,
    scoreImprovement: useSubset ? scoreImprovement : 0,
  };
}

function bypassPreparation(
  transcriptLines: readonly TranscriptLine[],
  segments: readonly RecognizedSegment[],
  structure: StructuralNormalizationResult,
  options: ResolvedPreparationOptions,
): AlignmentPreparationResult {
  const originalIndexById = new Map(
    segments.map((segment, index) => [segment.id, index]),
  );
  const primaryRows = segments.map((segment) => {
    const structuralRowId = structure.segmentToRowId[segment.id];
    return {
      ...segment,
      sourceSegmentIds: [segment.id],
      sourceRegionIds: segment.regionId ? [segment.regionId] : [],
      structuralRowId: structuralRowId ?? segment.id,
      structuralComponentId: structuralRowId
        ? structure.rowToComponentId[structuralRowId] ?? null
        : null,
    };
  }).sort((left, right) => {
    const leftReadingOrder = left.readingOrderIndex;
    const rightReadingOrder = right.readingOrderIndex;
    if (
      typeof leftReadingOrder === 'number'
      && Number.isFinite(leftReadingOrder)
      && typeof rightReadingOrder === 'number'
      && Number.isFinite(rightReadingOrder)
      && leftReadingOrder !== rightReadingOrder
    ) {
      return leftReadingOrder - rightReadingOrder;
    }
    return (originalIndexById.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (originalIndexById.get(right.id) ?? Number.MAX_SAFE_INTEGER);
  });
  const componentIds = structure.components.map(({ id }) => id);
  const preparedByComponent = componentRows(
    structure,
    new Map(structure.rows.map((row) => [
      row.id,
      rowSegment(
        row,
        structure.rowToComponentId[row.id] ?? null,
        rawById(segments),
      ),
    ])),
  );
  const score = subsetScore(
    componentIds,
    preparedByComponent,
    transcriptLines,
    options,
  );
  return {
    primaryRows,
    secondaryRows: [],
    secondaryRawSegments: [],
    rawSegmentIdsByPreparedId: Object.fromEntries(
      primaryRows.map(({ id, sourceSegmentIds }) => [
        id,
        [...sourceSegmentIds],
      ]),
    ),
    structural: structure,
    selection: {
      mode: 'geometry-bypass',
      primaryComponentIds: componentIds,
      secondaryComponentIds: [],
      allComponentsScore: score,
      selectedScore: score,
      scoreImprovement: 0,
    },
  };
}

export function prepareAlignmentSegments({
  transcriptLines,
  segments,
  options = {},
}: {
  transcriptLines: readonly TranscriptLine[];
  segments: readonly RecognizedSegment[];
  options?: AlignmentPreparationOptions;
}): AlignmentPreparationResult {
  const resolved = resolveOptions(options);
  const segmentMap = rawById(segments);
  const structure = options.structure ?? normalizeSegmentStructure(
    segments,
    resolved.structural,
  );
  const structuralIds = Object.keys(structure.segmentToRowId);
  if (
    structuralIds.length !== segments.length
    || segments.some(({ id }) => !structure.segmentToRowId[id])
  ) {
    throw new Error(
      'Structural normalization must cover every recognized segment exactly',
    );
  }
  if (segments.length > 0 && segments.every((segment) => !hasGeometry(segment))) {
    return bypassPreparation(
      transcriptLines,
      segments,
      structure,
      resolved,
    );
  }

  const preparedByRowId = new Map(
    structure.rows.map((row) => [
      row.id,
      rowSegment(
        row,
        structure.rowToComponentId[row.id] ?? null,
        segmentMap,
      ),
    ]),
  );
  const preparedComponents = componentRows(structure, preparedByRowId);
  const selection = chooseComponents(
    structure,
    preparedComponents,
    transcriptLines,
    resolved,
  );
  const primaryIds = new Set(selection.primaryComponentIds);
  const primaryRows = structure.rows.flatMap((row) => {
    const componentId = structure.rowToComponentId[row.id];
    const prepared = preparedByRowId.get(row.id);
    return prepared && componentId && primaryIds.has(componentId)
      ? [prepared]
      : [];
  });
  const secondaryRows = structure.rows.flatMap((row) => {
    const componentId = structure.rowToComponentId[row.id];
    const prepared = preparedByRowId.get(row.id);
    return prepared && componentId && !primaryIds.has(componentId)
      ? [prepared]
      : [];
  });
  const secondaryRawIds = new Set(
    secondaryRows.flatMap(({ sourceSegmentIds }) => sourceSegmentIds),
  );
  const allPreparedRows = [...primaryRows, ...secondaryRows];
  return {
    primaryRows,
    secondaryRows,
    secondaryRawSegments: segments.filter(({ id }) => secondaryRawIds.has(id)),
    rawSegmentIdsByPreparedId: Object.fromEntries(
      allPreparedRows.map(({ id, sourceSegmentIds }) => [
        id,
        [...sourceSegmentIds],
      ]),
    ),
    structural: structure,
    selection,
  };
}

export function expandPreparedSegmentIds(
  preparedSegmentIds: readonly string[],
  rawSegmentIdsByPreparedId: Readonly<Record<string, readonly string[]>>,
): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();
  preparedSegmentIds.forEach((preparedId) => {
    const rawIds = rawSegmentIdsByPreparedId[preparedId];
    if (!rawIds) {
      throw new Error(`Unknown prepared segment id ${preparedId}`);
    }
    rawIds.forEach((rawId) => {
      if (seen.has(rawId)) return;
      seen.add(rawId);
      expanded.push(rawId);
    });
  });
  return expanded;
}

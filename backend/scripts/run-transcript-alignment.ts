import { createHash } from 'node:crypto';
import {
  access,
  link,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';
import { runManifestSchema } from '../src/benchmarks/layout/schemas.js';
import {
  alignTranscriptToRecognizedSegments,
  type AlignmentOptions,
  type RecognizedSegment,
} from '../src/services/transcript-alignment/aligner.js';
import {
  parseAlignmentLayout,
} from '../src/benchmarks/transcript-alignment/layout-input.js';
import {
  transcriptAlignmentArtifactSchema,
  transcriptAlignmentSnapshotSchema,
  transcriptRecognitionArtifactSchema,
  transcriptRecognitionRunSchema,
} from '../src/benchmarks/transcript-alignment/schemas.js';

const ALIGNMENT_OPTIONS = {
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
} satisfies AlignmentOptions;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function valuesAfter(flag: string): string[] {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag) {
      const value = process.argv[index + 1];
      if (!value) throw new Error(`${flag} requires a value`);
      values.push(resolve(value));
    }
  }
  return values;
}

function requiredValue(flag: string): string {
  const values = valuesAfter(flag);
  if (values.length !== 1) {
    throw new Error(`${flag} must be supplied exactly once`);
  }
  return values[0];
}

function singleProvenanceValue(
  label: string,
  values: Array<string | null | undefined>,
): string {
  if (values.some((value) => !value)) {
    throw new Error(`Every recognition artifact must declare ${label}`);
  }
  const unique = [...new Set(values as string[])];
  if (unique.length !== 1) {
    throw new Error(
      `Recognition artifacts disagree on ${label}: ${unique.join(', ')}`,
    );
  }
  return unique[0];
}

function relativePathInside(
  root: string,
  path: string,
  label: string,
): string {
  const candidate = relative(root, path);
  if (
    candidate.length === 0
    || isAbsolute(candidate)
    || candidate === '..'
    || candidate.startsWith('../')
  ) {
    throw new Error(`${label} is outside its declared run root`);
  }
  return candidate.split('\\').join('/');
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    // Linking a fully written file into place is atomic and refuses to replace
    // an existing artifact. Every experiment must use a fresh output path so
    // its source data and any hash-bound human reviews remain reproducible.
    try {
      await link(temporaryPath, path);
    } catch (error) {
      if (
        error instanceof Error
        && 'code' in error
        && error.code === 'EEXIST'
      ) {
        throw new Error(
          `Refusing to overwrite existing alignment artifact: ${path}`,
        );
      }
      throw error;
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const startedAtMonotonic = process.hrtime.bigint();
  const snapshotPath = requiredValue('--snapshot');
  const letterKey = process.argv[process.argv.indexOf('--letter') + 1];
  if (!letterKey || letterKey.startsWith('--')) {
    throw new Error('--letter requires a letter key');
  }
  const recognitionPaths = valuesAfter('--recognition');
  if (recognitionPaths.length === 0) {
    throw new Error('At least one --recognition artifact is required');
  }
  const outputPath = requiredValue('--output');
  try {
    await access(outputPath);
    throw new Error(
      `Refusing to overwrite existing alignment artifact: ${outputPath}`,
    );
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      // The output is new as required. atomicWriteJson repeats this guarantee
      // at publication time to close the race between checking and writing.
    } else {
      throw error;
    }
  }

  const snapshotBytes = await readFile(snapshotPath);
  const snapshot = transcriptAlignmentSnapshotSchema.parse(
    JSON.parse(snapshotBytes.toString('utf8')),
  );
  const letter = snapshot.letters.find(
    (candidate) => candidate.letterKey === letterKey,
  );
  if (!letter) throw new Error(`Letter ${letterKey} is not in the snapshot`);

  const recognizerRunId = singleProvenanceValue(
    'recognizer run ID',
    recognitionPaths.map((path) => (
      path.match(/\/recognition-runs\/([^/]+)\/pages\//u)?.[1] ?? null
    )),
  );
  const recognitionRunRoot = singleProvenanceValue(
    'recognizer run root',
    recognitionPaths.map((path) => (
      path.match(/^(.*\/recognition-runs\/[^/]+)\/pages\//u)?.[1] ?? null
    )),
  );
  const recognitionManifestPath = resolve(
    recognitionRunRoot,
    'run.v1.json',
  );
  const recognitionManifest = transcriptRecognitionRunSchema.parse(
    JSON.parse((await readFile(recognitionManifestPath)).toString('utf8')),
  );
  if (recognitionManifest.runId !== recognizerRunId) {
    throw new Error(
      `Recognition manifest run ID ${recognitionManifest.runId} does not `
      + `match path run ID ${recognizerRunId}`,
    );
  }
  const layoutManifestPath = resolve(
    recognitionManifest.source.layoutRunManifest,
  );
  const layoutManifestBytes = await readFile(layoutManifestPath);
  const actualLayoutManifestSha256 = sha256(layoutManifestBytes);
  if (
    actualLayoutManifestSha256
      !== recognitionManifest.source.layoutRunManifestSha256
  ) {
    throw new Error(
      `Layout manifest checksum mismatch: expected `
      + `${recognitionManifest.source.layoutRunManifestSha256}, received `
      + actualLayoutManifestSha256,
    );
  }
  const layoutManifest = runManifestSchema.parse(
    JSON.parse(layoutManifestBytes.toString('utf8')),
  );
  if (layoutManifest.runId !== recognitionManifest.source.layoutRunId) {
    throw new Error(
      `Layout manifest run ID ${layoutManifest.runId} does not match `
      + `recognition source ${recognitionManifest.source.layoutRunId}`,
    );
  }
  const layoutRunRoot = dirname(layoutManifestPath);
  const layoutManifestPages = new Map(
    layoutManifest.pages.map((page) => [page.pageKey, page]),
  );

  const recognitionInputs = await Promise.all(
    recognitionPaths.map(async (path) => {
      const bytes = await readFile(path);
      const value = transcriptRecognitionArtifactSchema.parse(
        JSON.parse(bytes.toString('utf8')),
      );
      const layoutPath = resolve(value.source.layoutPath);
      const layoutBytes = await readFile(layoutPath);
      const layoutSha256 = sha256(layoutBytes);
      if (layoutSha256 !== value.source.layoutSha256) {
        throw new Error(
          `Recognition layout checksum mismatch for ${value.pageKey}: `
          + `expected ${value.source.layoutSha256}, received ${layoutSha256}`,
        );
      }
      const layoutRelativePath = relativePathInside(
        layoutRunRoot,
        layoutPath,
        `Layout for ${value.pageKey}`,
      );
      const layoutManifestPage = layoutManifestPages.get(value.pageKey);
      if (
        !layoutManifestPage
        || layoutManifestPage.status !== 'succeeded'
        || !layoutManifestPage.prepared
      ) {
        throw new Error(
          `Layout manifest has no successful page ${value.pageKey}`,
        );
      }
      const expectedLayoutPaths = [
        layoutManifestPage.artifacts.raw,
        layoutManifestPage.artifacts.normalized,
      ].filter((path): path is string => path !== undefined);
      if (!expectedLayoutPaths.includes(layoutRelativePath)) {
        throw new Error(
          `Layout ${layoutRelativePath} is not the raw or normalized `
          + `artifact declared for page ${value.pageKey}`,
        );
      }
      if (
        layoutManifest.integrity.artifacts[layoutRelativePath]?.sha256
          !== layoutSha256
      ) {
        throw new Error(
          `Layout ${layoutRelativePath} is not hash-bound by run `
          + layoutManifest.runId,
        );
      }
      const layout = parseAlignmentLayout(
        JSON.parse(layoutBytes.toString('utf8')),
        value.pageKey,
      );
      if (layout.preparedImageSha256 !== value.source.imageSha256) {
        throw new Error(
          `Recognition image checksum does not match layout for ${value.pageKey}`,
        );
      }
      if (layoutManifestPage.prepared.sha256 !== value.source.imageSha256) {
        throw new Error(
          `Recognition image checksum does not match the prepared artifact `
          + `declared for ${value.pageKey}`,
        );
      }
      const layoutLineIds = new Set(layout.lines.map(({ id }) => id));
      const recognitionIds = new Set(
        value.records.map(({ segmentId }) => segmentId),
      );
      if (
        layoutLineIds.size !== recognitionIds.size
        || [...layoutLineIds].some((id) => !recognitionIds.has(id))
      ) {
        throw new Error(
          `Recognition records do not exactly cover layout lines for `
          + value.pageKey,
        );
      }
      return {
        path,
        sha256: sha256(bytes),
        value,
        layoutPath,
        layoutSha256,
        layout,
      };
    }),
  );
  const expectedPageKeys = letter.pages
    .map(({ pageKey }) => pageKey)
    .sort();
  const actualPageKeys = recognitionInputs
    .map(({ value }) => value.pageKey)
    .sort();
  if (JSON.stringify(expectedPageKeys) !== JSON.stringify(actualPageKeys)) {
    throw new Error(
      `Recognition pages ${actualPageKeys.join(', ')} do not exactly match `
      + `snapshot pages ${expectedPageKeys.join(', ')}`,
    );
  }
  const recognitionManifestPages = new Map(
    recognitionManifest.pages.map((page) => [page.pageKey, page]),
  );
  recognitionInputs.forEach((input) => {
    const manifestPage = recognitionManifestPages.get(input.value.pageKey);
    if (!manifestPage || manifestPage.status === 'failed') {
      throw new Error(
        `Recognition manifest has no successful page `
        + input.value.pageKey,
      );
    }
    const artifactRelativePath = relativePathInside(
      recognitionRunRoot,
      input.path,
      `Recognition for ${input.value.pageKey}`,
    );
    if (artifactRelativePath !== manifestPage.output) {
      throw new Error(
        `Recognition path ${artifactRelativePath} does not match manifest `
        + manifestPage.output,
      );
    }
    if (
      input.value.model.sha256 !== recognitionManifest.model.sha256
      || input.value.model.segmentationType
        !== recognitionManifest.model.segmentationType
    ) {
      throw new Error(
        `Recognition model provenance does not match its run manifest for `
        + input.value.pageKey,
      );
    }
  });
  const modelSha256 = singleProvenanceValue(
    'model SHA-256',
    recognitionInputs.map(({ value }) => value.model?.sha256),
  );
  const segmentationType = singleProvenanceValue(
    'model segmentation type',
    recognitionInputs.map(({ value }) => value.model?.segmentationType),
  );
  const krakenVersion = singleProvenanceValue(
    'Kraken version',
    recognitionInputs.map(({ value }) => value.model?.krakenVersion),
  );
  const layoutRunId = recognitionManifest.source.layoutRunId;
  const inferenceConfiguration = singleProvenanceValue(
    'inference configuration',
    recognitionInputs.map(({ value }) => (
      value.inference === undefined ? null : JSON.stringify(value.inference)
    )),
  );

  const byPageKey = new Map(
    recognitionInputs.map((input) => [input.value.pageKey, input]),
  );
  const pageResults = letter.pages
    .toSorted((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => {
      const pageStartedAt = process.hrtime.bigint();
      const recognition = byPageKey.get(page.pageKey);
      if (!recognition) {
        throw new Error(`Missing recognition for ${page.pageKey}`);
      }
      const recordsBySegmentId = new Map(
        recognition.value.records.map((record) => [
          record.segmentId,
          record,
        ]),
      );
      const segments: RecognizedSegment[] = recognition.layout.lines.map(
        (line) => {
          const record = recordsBySegmentId.get(line.id);
          if (!record) {
            throw new Error(
              `Layout line ${line.id} has no recognition record`,
            );
          }
          return {
            id: line.id,
            text: record.text,
            recognitionState: record.text.trim().length > 0
              ? 'recognized'
              : 'attempted-empty',
            geometryEvidence: 'machine',
            recognitionConfidence: record.meanConfidence,
            regionId: line.regionId,
            orientationDegrees: line.orientationDegrees,
            boundary: line.boundary,
            baseline: line.baseline,
            readingOrderIndex: line.readingOrderIndex,
            flowDirectionSign: line.flowDirectionSign,
          };
        },
      );
      const transcriptLines = page.transcript.lines.filter(
        ({ alignable }) => alignable,
      );
      const result = alignTranscriptToRecognizedSegments(
        transcriptLines,
        segments,
        ALIGNMENT_OPTIONS,
      );
      const transcriptById = new Map(
        transcriptLines.map((line) => [line.id, line]),
      );
      return {
        page,
        recognition,
        segments,
        transcriptLines,
        result,
        mappings: result.mappings.map((mapping) => ({
          ...mapping,
          pageKey: page.pageKey,
          transcriptText: transcriptById.get(mapping.transcriptId)?.text ?? '',
          sourceLineNumber:
            transcriptById.get(mapping.transcriptId)?.sourceLineNumber ?? null,
        })),
        operations: result.operations.map((operation) => ({
          ...operation,
          pageKey: page.pageKey,
        })),
        elapsedMilliseconds: Number(
          process.hrtime.bigint() - pageStartedAt,
        ) / 1_000_000,
      };
    });
  const mappings = pageResults.flatMap((page) => page.mappings);
  const operations = pageResults.flatMap((page) => page.operations);
  const skippedSegmentIds = pageResults.flatMap(
    ({ result }) => result.skippedSegmentIds,
  );
  const deferredSegmentIds = pageResults.flatMap(
    ({ result }) => result.deferredSegmentIds,
  );
  const unassignedSegmentReasons = pageResults.flatMap(
    ({ result }) => result.unassignedSegmentReasons,
  );
  const statusCounts = Object.fromEntries(
    ['accepted', 'ambiguous', 'unlocated'].map((status) => [
      status,
      mappings.filter((mapping) => mapping.status === status).length,
    ]),
  );
  const operationCounts = Object.fromEntries(
    ['match', 'split', 'merge', 'skip-segment', 'unlocated-transcript']
      .map((kind) => [
        kind,
        operations.filter((operation) => operation.kind === kind).length,
      ]),
  );
  const averageSimilarity = mappings.length === 0
    ? 0
    : mappings.reduce(
      (sum, mapping) => sum + mapping.similarity,
      0,
    ) / mappings.length;
  const totalCost = pageResults.reduce(
    (sum, page) => sum + page.result.totalCost,
    0,
  );
  const pathMargin = pageResults.reduce<number | null>(
    (minimum, page) => {
      const margin = page.result.pathMargin;
      if (margin === null) return minimum;
      return minimum === null ? margin : Math.min(minimum, margin);
    },
    null,
  );
  // For independent page alignments, the global runner-up changes only the
  // least-certain page while all other pages stay on their best path.
  const secondBestCost = pathMargin === null
    ? null
    : totalCost + pathMargin;

  const output = transcriptAlignmentArtifactSchema.parse({
    schemaVersion: 1,
    kind: 'transcript-to-kraken-segment-alignment',
    createdAt: new Date().toISOString(),
    letterKey,
    source: {
      snapshotPath,
      snapshotSha256: sha256(snapshotBytes),
      transcriptSha256: letter.transcript.sha256,
      recognitions: recognitionInputs.map((input) => ({
        pageKey: input.value.pageKey,
        path: input.path,
        sha256: input.sha256,
      })),
    },
    configuration: {
      algorithm: 'k-best-physical-row-anchor-fill-dp-v4',
      pageScope: 'exact-transcript-page-marker',
      parameters: ALIGNMENT_OPTIONS,
      transitions: [
        'geometry-safe-physical-row-reconstruction',
        'spatial-flow-component-isolation',
        'stable-anchor-prefix-exclusion',
        'geometry-backed-non-transcribed-prefix-isolation',
        'geometry-backed-anchor-and-fill',
        'one-to-one',
        'one-to-two',
        'two-to-one',
        'geometry-gated-adjacent-transposition',
        'bounded-local-segment-reorder',
        'bounded-local-transcript-reorder',
        'isolated-unmatched-pair-between-strong-anchors',
        'page-transcript-mismatch-abstention',
        'skip-detected-segment',
        'unlocated-transcript-line',
        'standalone-editorial-marker-to-unlocated',
        'standalone-pagination-marker-exclusion',
        'minority-orientation-to-deferred-segment',
      ],
      confidencePolicy: 'abstain-below-threshold',
    },
    summary: {
      transcriptLineCount: pageResults.reduce(
        (sum, page) => sum + page.transcriptLines.length,
        0,
      ),
      recognizedSegmentCount: pageResults.reduce(
        (sum, page) => sum + page.segments.length,
        0,
      ),
      skippedSegmentCount: skippedSegmentIds.length,
      deferredSegmentCount: deferredSegmentIds.length,
      averageSimilarity,
      totalCost,
      secondBestCost,
      pathMargin,
      exploredPathCount: pageResults.reduce(
        (sum, page) => sum + page.result.exploredPathCount,
        0,
      ),
      statusCounts,
      operationCounts,
      transcriptMismatchPageCount: pageResults.filter(
        ({ result }) => result.pageAssessment.status === 'transcript-mismatch',
      ).length,
      localReorderCount: pageResults.reduce(
        (sum, { result }) => sum + result.localReorderDecisions.length,
        0,
      ),
    },
    pages: pageResults.map((page) => ({
      pageKey: page.page.pageKey,
      pageNumber: page.page.pageNumber,
      transcriptSha256: page.page.transcript.sha256,
      transcriptLineCount: page.transcriptLines.length,
      recognizedSegmentCount: page.segments.length,
      mappingCount: page.mappings.length,
      skippedSegmentCount: page.result.skippedSegmentIds.length,
      deferredSegmentCount: page.result.deferredSegmentIds.length,
      pageAssessment: page.result.pageAssessment,
      localReorderDecisions: page.result.localReorderDecisions,
      unassignedReasonCounts: Object.fromEntries(
        [
          'secondary-flow',
          'transcript-mismatch',
          'non-transcribed-text',
          'alignment-uncertain',
          'deferred-orientation',
        ].map((reason) => [
          reason,
          page.result.unassignedSegmentReasons
            .filter((entry) => entry.reason === reason).length,
        ]),
      ),
      totalCost: page.result.totalCost,
      secondBestCost: page.result.secondBestCost,
      pathMargin: page.result.pathMargin,
      elapsedMilliseconds: page.elapsedMilliseconds,
      statusCounts: Object.fromEntries(
        ['accepted', 'ambiguous', 'unlocated'].map((status) => [
          status,
          page.mappings.filter((mapping) => mapping.status === status).length,
        ]),
      ),
    })),
    recognizer: {
      runId: recognizerRunId,
      modelSha256,
      segmentationType,
      krakenVersion,
      inference: JSON.parse(inferenceConfiguration) as unknown,
    },
    layoutRunId,
    runtime: {
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      elapsedMilliseconds: Number(
        process.hrtime.bigint() - startedAtMonotonic,
      ) / 1_000_000,
      maximumResidentSetBytes: process.resourceUsage().maxRSS * 1024,
      platform: `${process.platform}-${process.arch}`,
      nodeVersion: process.version,
    },
    mappings,
    operations,
    skippedSegmentIds,
    deferredSegmentIds,
    unassignedSegmentReasons,
  });
  await atomicWriteJson(outputPath, output);
  console.log(JSON.stringify({
    outputPath,
    outputSha256: sha256(await readFile(outputPath)),
    summary: output.summary,
  }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

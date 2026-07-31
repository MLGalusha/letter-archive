import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import type {
  output as ZodOutput,
  ZodTypeAny,
} from 'zod';
import { ZodError } from 'zod';
import { AppError, NotFoundError } from '../../utils/response-helpers.js';
import {
  krakenNativePageLayoutV2Schema,
} from '../../services/kraken-page-layout-adapter.js';
import {
  BenchmarkValidationError,
  DEFAULT_BACKEND_ROOT,
  defaultLayoutBenchmarkStore,
  LayoutBenchmarkStore,
} from '../layout/store.js';
import {
  parseAlignmentLayout,
  type AlignmentLayout,
} from './layout-input.js';
import {
  buildTranscriptAlignmentScorecard,
  type TranscriptAlignmentScorecard,
} from './scorecard.js';
import {
  transcriptAlignmentArtifactSchema,
  transcriptAlignmentLetterKeySchema,
  transcriptAlignmentListResponseSchema,
  transcriptAlignmentPageKeySchema,
  transcriptAlignmentPageResponseSchema,
  transcriptAlignmentReviewDocumentSchema,
  transcriptAlignmentReviewInputSchema,
  transcriptAlignmentRunIdSchema,
  transcriptAlignmentSnapshotSchema,
  transcriptRecognitionArtifactSchema,
  transcriptRecognitionRunSchema,
  type TranscriptAlignmentArtifact,
  type TranscriptAlignmentListResponse,
  type TranscriptAlignmentPageResponse,
  type TranscriptAlignmentReviewDocument,
  type TranscriptAlignmentReviewInput,
  type TranscriptAlignmentSavedReview,
  type TranscriptAlignmentSnapshot,
  type TranscriptRecognitionArtifact,
  type TranscriptRecognitionRun,
} from './schemas.js';

const ALIGNMENT_FILENAME = 'alignment.v1.json';
const RECOGNITION_RUN_FILENAME = 'run.v1.json';
const IMAGE_ROOT = '/images/layout-benchmark';
const SEGMENT_PAGE_PATTERN = /^(\d{3}-[\dX]{8}-[A-Z]\d{2}-\d{2})-line-/;

export interface TranscriptAlignmentPaths {
  backendRoot: string;
  resultsRoot: string;
  alignmentsRoot: string;
  recognitionRunsRoot: string;
  snapshotsRoot: string;
  reviewsRoot: string;
}

export interface TranscriptAlignmentStoreOptions
  extends Partial<TranscriptAlignmentPaths> {
  layoutStore?: LayoutBenchmarkStore;
}

type ParsedFile<T> = {
  value: T;
  sha256: string;
};

type AlignmentBundle = {
  artifact: TranscriptAlignmentArtifact;
  artifactSha256: string;
  snapshot: TranscriptAlignmentSnapshot;
  snapshotLetter: TranscriptAlignmentSnapshot['letters'][number];
};

type RecognitionBundle = {
  manifest: TranscriptRecognitionRun;
  artifact: TranscriptRecognitionArtifact;
};

export class TranscriptAlignmentArtifactChangedError extends AppError {
  constructor(
    expectedArtifactSha256: string,
    currentArtifactSha256: string,
  ) {
    super(
      409,
      'Transcript-alignment artifact changed; reload before saving review',
      {
        expectedArtifactSha256,
        currentArtifactSha256,
      },
      'ALIGNMENT_ARTIFACT_CHANGED',
    );
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

function publicArtifactError(error: unknown): string {
  if (
    error instanceof BenchmarkValidationError
    || error instanceof NotFoundError
  ) {
    return error.message;
  }
  return 'Unable to inspect transcript-alignment artifact';
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function pathIsInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === ''
    || (
      !pathFromRoot.startsWith('..')
      && !isAbsolute(pathFromRoot)
    )
  );
}

function resolveLexicallyInside(root: string, ...segments: string[]): string {
  const candidate = resolve(root, ...segments);
  if (!pathIsInside(root, candidate)) {
    throw new BenchmarkValidationError('Benchmark artifact path escapes its root');
  }
  return candidate;
}

async function resolveRegularFileInside(
  root: string,
  ...segments: string[]
): Promise<string> {
  const lexicalCandidate = resolveLexicallyInside(root, ...segments);
  let rootRealPath: string;
  let candidateStat;
  try {
    [rootRealPath, candidateStat] = await Promise.all([
      realpath(root),
      lstat(lexicalCandidate),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('Transcript-alignment artifact not found');
    }
    throw error;
  }
  if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) {
    throw new BenchmarkValidationError(
      'Transcript-alignment artifacts must be regular files',
    );
  }
  const candidateRealPath = await realpath(lexicalCandidate);
  if (!pathIsInside(rootRealPath, candidateRealPath)) {
    throw new BenchmarkValidationError('Benchmark artifact resolves outside its root');
  }
  return candidateRealPath;
}

async function readValidatedJson<TSchema extends ZodTypeAny>(
  filePath: string,
  schema: TSchema,
  label: string,
): Promise<ParsedFile<ZodOutput<TSchema>>> {
  const bytes = await readFile(filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new BenchmarkValidationError(`${label} is not valid JSON`, {
      cause: errorMessage(error),
    });
  }
  try {
    return {
      value: schema.parse(parsed),
      sha256: sha256(bytes),
    };
  } catch (error) {
    throw new BenchmarkValidationError(`${label} failed validation`, {
      cause: errorMessage(error),
    });
  }
}

async function directoryNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function regularJsonFilenames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => (
        entry.isFile()
        && !entry.name.startsWith('.')
        && entry.name.endsWith('.json')
      ))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function pageKeyForSegment(segmentId: string): string | null {
  return SEGMENT_PAGE_PATTERN.exec(segmentId)?.[1] ?? null;
}

function statusCounts(
  mappings: TranscriptAlignmentArtifact['mappings'],
): TranscriptAlignmentListResponse['runs'][number]['statusCounts'] {
  return {
    accepted: mappings.filter(({ status }) => status === 'accepted').length,
    ambiguous: mappings.filter(({ status }) => status === 'ambiguous').length,
    unlocated: mappings.filter(({ status }) => status === 'unlocated').length,
  };
}

function addStatusCounts(
  left: TranscriptAlignmentListResponse['runs'][number]['statusCounts'],
  right: TranscriptAlignmentListResponse['runs'][number]['statusCounts'],
): TranscriptAlignmentListResponse['runs'][number]['statusCounts'] {
  return {
    accepted: left.accepted + right.accepted,
    ambiguous: left.ambiguous + right.ambiguous,
    unlocated: left.unlocated + right.unlocated,
  };
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sameSegmentIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = sortedUnique(left);
  const rightSorted = sortedUnique(right);
  return leftSorted.every(
    (segmentId, index) => segmentId === rightSorted[index],
  );
}

function assertSinglePageSegmentGroup(
  segmentIds: string[],
  knownPageKeys: Set<string>,
  label: string,
  declaredPageKey: string | null = null,
): void {
  if (new Set(segmentIds).size !== segmentIds.length) {
    throw new BenchmarkValidationError(`${label} contains duplicate segment IDs`);
  }
  const pageKeys = sortedUnique(segmentIds.flatMap((segmentId) => {
    const pageKey = pageKeyForSegment(segmentId);
    if (!pageKey) {
      if (!declaredPageKey) {
        throw new BenchmarkValidationError(
          `${label} contains a segment ID without a declared page identity`,
        );
      }
      return [];
    }
    if (!knownPageKeys.has(pageKey)) {
      throw new BenchmarkValidationError(
        `${label} references a page outside the frozen letter`,
      );
    }
    return [pageKey];
  }));
  if (pageKeys.length > 1) {
    throw new BenchmarkValidationError(
      `${label} crosses a physical page boundary`,
    );
  }
  if (
    declaredPageKey
    && pageKeys.some((pageKey) => pageKey !== declaredPageKey)
  ) {
    throw new BenchmarkValidationError(
      `${label} page identity conflicts with its segments`,
    );
  }
}

function transcriptSourceLabel(
  tier: TranscriptAlignmentSnapshot['letters'][number]['transcript']['sourceStatus']['tier'],
): string {
  switch (tier) {
    case 'modern-confirmed':
      return 'Confirmed transcript';
    case 'legacy-confirmed':
      return 'Legacy-confirmed transcript';
    case 'human-edited':
      return 'Human-edited transcript';
    case 'ai-draft':
      return 'Unconfirmed AI draft';
  }
}

export class TranscriptAlignmentStore {
  readonly paths: TranscriptAlignmentPaths;
  readonly layoutStore: LayoutBenchmarkStore;
  private readonly alignmentCache = new Map<string, Promise<AlignmentBundle>>();
  private readonly snapshotCache = new Map<
    string,
    Promise<TranscriptAlignmentSnapshot>
  >();
  private readonly recognitionCache = new Map<
    string,
    Promise<RecognitionBundle>
  >();
  private readonly reviewWriteLocks = new Map<string, Promise<void>>();

  constructor(options: TranscriptAlignmentStoreOptions = {}) {
    const backendRoot = resolve(options.backendRoot ?? DEFAULT_BACKEND_ROOT);
    const resultsRoot = resolve(
      options.resultsRoot
        ?? join(backendRoot, 'test-results/transcript-alignment'),
    );
    this.paths = {
      backendRoot,
      resultsRoot,
      alignmentsRoot: resolve(
        options.alignmentsRoot ?? join(resultsRoot, 'alignments'),
      ),
      recognitionRunsRoot: resolve(
        options.recognitionRunsRoot ?? join(resultsRoot, 'recognition-runs'),
      ),
      snapshotsRoot: resolve(
        options.snapshotsRoot ?? join(resultsRoot, 'cohorts'),
      ),
      reviewsRoot: resolve(
        options.reviewsRoot ?? join(resultsRoot, 'reviews'),
      ),
    };
    this.layoutStore = options.layoutStore ?? defaultLayoutBenchmarkStore;
  }

  async listAlignmentRuns(): Promise<TranscriptAlignmentListResponse> {
    const runs: TranscriptAlignmentListResponse['runs'] = [];
    const invalidRuns: TranscriptAlignmentListResponse['invalidRuns'] = [];

    for (const unvalidatedRunId of await directoryNames(this.paths.alignmentsRoot)) {
      const parsedRunId = transcriptAlignmentRunIdSchema.safeParse(unvalidatedRunId);
      if (!parsedRunId.success) {
        invalidRuns.push({
          runId: unvalidatedRunId,
          letterKey: null,
          error: 'Directory name is not a safe alignment run ID',
        });
        continue;
      }
      const runId = parsedRunId.data;
      const runRoot = resolveLexicallyInside(this.paths.alignmentsRoot, runId);
      const letters: TranscriptAlignmentListResponse['runs'][number]['letters'] = [];
      let createdAt = '';

      for (const unvalidatedLetterKey of await directoryNames(runRoot)) {
        const parsedLetterKey = transcriptAlignmentLetterKeySchema.safeParse(
          unvalidatedLetterKey,
        );
        if (!parsedLetterKey.success) {
          invalidRuns.push({
            runId,
            letterKey: unvalidatedLetterKey,
            error: 'Directory name is not a valid letter key',
          });
          continue;
        }
        const letterKey = parsedLetterKey.data;
        try {
          const bundle = await this.loadAlignmentBundle(runId, letterKey);
          const counts = statusCounts(bundle.artifact.mappings);
          const pageKeys = bundle.snapshotLetter.pages
            .map(({ pageKey }) => pageKey)
            .sort();
          letters.push({
            letterKey,
            pageKeys,
            mappingCount: bundle.artifact.mappings.length,
            statusCounts: counts,
            unassignedMappingCount: bundle.artifact.mappings.filter(
              ({ segmentIds, pageKey }) => (
                segmentIds.length === 0 && !pageKey
              ),
            ).length,
          });
          if (bundle.artifact.createdAt > createdAt) {
            createdAt = bundle.artifact.createdAt;
          }
        } catch (error) {
          invalidRuns.push({
            runId,
            letterKey,
            error: publicArtifactError(error),
          });
        }
      }

      if (letters.length > 0) {
        const counts = letters.reduce(
          (total, letter) => addStatusCounts(total, letter.statusCounts),
          { accepted: 0, ambiguous: 0, unlocated: 0 },
        );
        runs.push({
          runId,
          createdAt,
          letterCount: letters.length,
          pageCount: letters.reduce(
            (total, letter) => total + letter.pageKeys.length,
            0,
          ),
          mappingCount: letters.reduce(
            (total, letter) => total + letter.mappingCount,
            0,
          ),
          statusCounts: counts,
          letters: letters.sort(
            (left, right) => left.letterKey.localeCompare(right.letterKey),
          ),
        });
      }
    }

    return transcriptAlignmentListResponseSchema.parse({
      schemaVersion: 1,
      runs: runs.sort((left, right) => (
        right.createdAt.localeCompare(left.createdAt)
        || left.runId.localeCompare(right.runId)
      )),
      invalidRuns,
    });
  }

  async getAlignmentPage(
    runIdValue: string,
    pageKeyValue: string,
    reviewerId?: string,
  ): Promise<TranscriptAlignmentPageResponse> {
    const runId = transcriptAlignmentRunIdSchema.parse(runIdValue);
    const pageKey = transcriptAlignmentPageKeySchema.parse(pageKeyValue);
    const letterKey = pageKey.replace(/-\d{2}$/, '');
    const bundle = await this.loadAlignmentBundle(runId, letterKey);
    const snapshotPage = bundle.snapshotLetter.pages.find(
      (candidate) => candidate.pageKey === pageKey,
    );
    if (!snapshotPage) {
      throw new NotFoundError('Page is not part of this transcript-alignment run');
    }
    const recognitionReference = bundle.artifact.source.recognitions.find(
      (candidate) => candidate.pageKey === pageKey,
    );
    if (!recognitionReference) {
      throw new NotFoundError('Recognition is not available for this page');
    }
    const recognition = await this.findRecognition(
      recognitionReference.pageKey,
      recognitionReference.sha256,
    );
    const layoutRunId = recognition.manifest.source.layoutRunId;
    const [{ run: layoutRun, page: layoutRunPage }, cohortPage] = await Promise.all([
      this.layoutStore.getRunPage(layoutRunId, pageKey),
      this.layoutStore.getCohortPage(pageKey),
    ]);
    if (
      layoutRunPage.status !== 'succeeded'
      || !layoutRunPage.prepared
    ) {
      throw new BenchmarkValidationError(
        'Recognition references a layout page without complete prepared geometry',
      );
    }
    if (
      recognition.artifact.model.sha256 !== recognition.manifest.model.sha256
      || recognition.artifact.model.segmentationType
        !== recognition.manifest.model.segmentationType
    ) {
      throw new BenchmarkValidationError(
        'Recognition artifact model does not match its run manifest',
      );
    }
    if (
      snapshotPage.originalFilename !== cohortPage.originalFilename
      || snapshotPage.pageNumber !== cohortPage.pageNumber
      || snapshotPage.sourceSha256 !== cohortPage.checksumSha256
    ) {
      throw new BenchmarkValidationError(
        'Transcript snapshot page does not match the frozen layout cohort',
      );
    }

    const layoutSha256 = recognition.artifact.source.layoutSha256;
    const normalizedPath = layoutRunPage.artifacts.normalized;
    const rawPath = layoutRunPage.artifacts.raw;
    const normalizedIntegrity = normalizedPath
      ? layoutRun.integrity.artifacts[normalizedPath]
      : undefined;
    const rawIntegrity = rawPath
      ? layoutRun.integrity.artifacts[rawPath]
      : undefined;
    let layout: AlignmentLayout;
    if (normalizedIntegrity?.sha256 === layoutSha256) {
      const normalized = await this.layoutStore.getNormalizedLayout(
        layoutRunId,
        pageKey,
      );
      if (
        normalized.pageKey !== pageKey
        || normalized.image.sourceSha256 !== cohortPage.checksumSha256
        || normalized.image.width !== layoutRunPage.prepared.width
        || normalized.image.height !== layoutRunPage.prepared.height
      ) {
        throw new BenchmarkValidationError(
          'Normalized layout identity does not match the expected page',
        );
      }
      layout = parseAlignmentLayout(normalized, pageKey);
    } else if (rawIntegrity?.sha256 === layoutSha256) {
      const rawArtifact = await this.layoutStore.resolveRunArtifact(
        layoutRunId,
        pageKey,
        'raw',
      );
      const native = await readValidatedJson(
        rawArtifact.absolutePath,
        krakenNativePageLayoutV2Schema,
        'Kraken native PageLayout',
      );
      if (
        native.sha256 !== layoutSha256
        || native.sha256 !== rawIntegrity.sha256
        || native.value.source.original.sha256 !== cohortPage.checksumSha256
        || native.value.source.original.sha256 !== snapshotPage.sourceSha256
        || native.value.source.original.width !== snapshotPage.width
        || native.value.source.original.height !== snapshotPage.height
        || native.value.source.normalized.sha256
          !== layoutRunPage.prepared.sha256
        || native.value.source.normalized.width
          !== layoutRunPage.prepared.width
        || native.value.source.normalized.height
          !== layoutRunPage.prepared.height
      ) {
        throw new BenchmarkValidationError(
          'Kraken native layout identity does not match the expected page',
        );
      }
      layout = parseAlignmentLayout(native.value, pageKey);
    } else {
      throw new BenchmarkValidationError(
        'Recognition layout checksum does not match this page layout artifact',
      );
    }
    if (
      recognition.artifact.source.imageSha256
        !== layoutRunPage.prepared.sha256
      || layout.preparedImageSha256 !== layoutRunPage.prepared.sha256
    ) {
      throw new BenchmarkValidationError(
        'Recognition image checksum does not match the prepared layout image',
      );
    }

    const recognitionBySegmentId = new Map(
      recognition.artifact.records.map((record) => [record.segmentId, record]),
    );
    const unassignedReasonBySegmentId = new Map(
      bundle.artifact.unassignedSegmentReasons.map(({ segmentId, reason }) => [
        segmentId,
        reason,
      ]),
    );
    const layoutIds = new Set(layout.lines.map(({ id }) => id));
    if (
      recognition.artifact.summary.inputLineCount !== layout.lines.length
      || recognition.artifact.records.length !== layout.lines.length
      || recognitionBySegmentId.size !== layoutIds.size
      || [...recognitionBySegmentId.keys()].some((id) => !layoutIds.has(id))
    ) {
      throw new BenchmarkValidationError(
        'Recognition records do not exactly cover the referenced layout lines',
      );
    }

    const segments = layout.lines.map((line) => {
      const record = recognitionBySegmentId.get(line.id);
      if (!record) {
        throw new BenchmarkValidationError(
          'Referenced layout line is missing its recognition record',
        );
      }
      if (!line.boundary) {
        throw new BenchmarkValidationError(
          'Recognition layout line is missing reviewable boundary geometry',
        );
      }
      return {
        id: line.id,
        boundary: line.boundary,
        baseline: line.baseline,
        orientationDegrees: line.orientationDegrees,
        readingOrderIndex: line.readingOrderIndex,
        recognizedText: record.text,
        recognitionConfidence: record.meanConfidence,
        unassignedReason: unassignedReasonBySegmentId.get(line.id),
      };
    });
    const pageMapping = (mapping: TranscriptAlignmentArtifact['mappings'][number]) => (
      mapping.pageKey
        ?? (mapping.segmentIds.length > 0
        ? pageKeyForSegment(mapping.segmentIds[0])
        : bundle.snapshotLetter.pages.length === 1
          ? pageKey
          : null)
    );
    const pageMappings = bundle.artifact.mappings.filter(
      (mapping) => pageMapping(mapping) === pageKey,
    );
    const reviewDocument = reviewerId
      ? await this.loadReviewDocument(
        runId,
        pageKey,
        bundle.artifactSha256,
        reviewerId,
      )
      : null;
    const reviewByTranscriptId = new Map(
      reviewDocument?.reviews.map((review) => [
        review.transcriptId,
        review.review,
      ]) ?? [],
    );
    const pageItems = pageMappings.map((mapping) => {
      mapping.segmentIds.forEach((segmentId) => {
        if (!recognitionBySegmentId.has(segmentId)) {
          throw new BenchmarkValidationError(
            'Alignment mapping references a segment absent from page recognition',
          );
        }
      });
      return {
        id: mapping.transcriptId,
        sourceLineNumber: mapping.sourceLineNumber!,
        transcriptText: mapping.transcriptText,
        mapping: {
          status: mapping.status,
          operation: mapping.operation,
          segmentIds: mapping.segmentIds,
          similarity: mapping.similarity,
          confidence: mapping.confidence,
          alternatives: mapping.alternatives.filter(({ segmentIds }) => (
            segmentIds.length === 0
            || segmentIds.every((segmentId) => (
              recognitionBySegmentId.has(segmentId)
            ))
          )),
        },
        review: reviewByTranscriptId.get(mapping.transcriptId) ?? null,
      };
    });
    pageItems.forEach((item) => {
      item.mapping.alternatives.forEach(({ segmentIds }) => {
        segmentIds.forEach((segmentId) => {
          if (!recognitionBySegmentId.has(segmentId)) {
            throw new BenchmarkValidationError(
              'Alignment alternative references a segment absent from page recognition',
            );
          }
        });
      });
    });
    const pageSkippedSegmentIds = bundle.artifact.skippedSegmentIds.filter(
      (segmentId) => (
        pageKeyForSegment(segmentId) === pageKey
        || (
          pageKeyForSegment(segmentId) === null
          && recognitionBySegmentId.has(segmentId)
        )
      ),
    );
    const pageDeferredSegmentIds = bundle.artifact.deferredSegmentIds.filter(
      (segmentId) => (
        pageKeyForSegment(segmentId) === pageKey
        || (
          pageKeyForSegment(segmentId) === null
          && recognitionBySegmentId.has(segmentId)
        )
      ),
    );
    pageSkippedSegmentIds.forEach((segmentId) => {
      if (!recognitionBySegmentId.has(segmentId)) {
        throw new BenchmarkValidationError(
          'Skipped alignment segment is absent from page recognition',
        );
      }
    });
    bundle.artifact.unassignedSegmentReasons
      .filter(({ segmentId }) => pageSkippedSegmentIds.includes(segmentId))
      .forEach(({ segmentId }) => {
        if (!recognitionBySegmentId.has(segmentId)) {
          throw new BenchmarkValidationError(
            'Reasoned unassigned segment is absent from page recognition',
          );
        }
      });
    this.validateReviewsAgainstPage(
      reviewDocument,
      pageItems.map(({ id }) => id),
      [...recognitionBySegmentId.keys()],
    );
    const reviewedCount = pageItems.filter(({ review }) => review !== null).length;

    return transcriptAlignmentPageResponseSchema.parse({
      schemaVersion: 1,
      artifactSha256: bundle.artifactSha256,
      run: {
        runId,
        createdAt: bundle.artifact.createdAt,
        algorithm: bundle.artifact.configuration.algorithm,
        layoutRunId,
        recognizer: {
          runId: recognition.manifest.runId,
          modelSha256: recognition.manifest.model.sha256,
          segmentationType: recognition.manifest.model.segmentationType,
        },
      },
      page: {
        pageKey,
        letterKey,
        pageNumber: snapshotPage.pageNumber,
        originalFilename: snapshotPage.originalFilename,
        challengeTags: snapshotPage.challengeTags,
        image: {
          url: `${IMAGE_ROOT}/runs/${encodeURIComponent(layoutRunId)}/pages/${encodeURIComponent(pageKey)}/prepared`,
          width: layoutRunPage.prepared.width,
          height: layoutRunPage.prepared.height,
          sha256: layoutRunPage.prepared.sha256,
        },
      },
      transcriptSource: {
        sha256: bundle.artifact.source.transcriptSha256,
        tier: bundle.snapshotLetter.transcript.sourceStatus.tier,
        label: transcriptSourceLabel(
          bundle.snapshotLetter.transcript.sourceStatus.tier,
        ),
      },
      summary: {
        mappingCount: pageItems.length,
        statusCounts: statusCounts(pageMappings),
        skippedSegmentCount: pageSkippedSegmentIds.length,
        unassignedMappingCount: bundle.artifact.mappings.filter(
          ({ segmentIds, pageKey: mappingPageKey }) => (
            segmentIds.length === 0 && !mappingPageKey
          ),
        ).length,
        reviewProgress: {
          reviewedCount,
          totalCount: pageItems.length,
          percent: pageItems.length === 0
            ? 0
            : (reviewedCount / pageItems.length) * 100,
        },
      },
      segments,
      items: pageItems,
      skippedSegmentIds: pageSkippedSegmentIds,
      deferredSegmentIds: pageDeferredSegmentIds,
    });
  }

  async getAlignmentScorecard(
    runIdValue: string,
    reviewerId: string,
  ): Promise<TranscriptAlignmentScorecard> {
    const runId = transcriptAlignmentRunIdSchema.parse(runIdValue);
    if (!reviewerId || reviewerId.length > 512) {
      throw new BenchmarkValidationError('Invalid alignment reviewer identity');
    }
    const listing = await this.listAlignmentRuns();
    const run = listing.runs.find((candidate) => candidate.runId === runId);
    if (!run) {
      throw new NotFoundError('Transcript-alignment run not found');
    }
    const pages = await Promise.all(run.letters.flatMap((letter) => (
      letter.pageKeys.map((pageKey) => (
        this.getAlignmentPage(runId, pageKey, reviewerId)
      ))
    )));
    return buildTranscriptAlignmentScorecard(
      runId,
      pages.map((page) => ({
        pageKey: page.page.pageKey,
        items: page.items,
      })),
    );
  }

  async saveAlignmentReview(
    runIdValue: string,
    pageKeyValue: string,
    transcriptId: string,
    reviewerId: string,
    inputValue: TranscriptAlignmentReviewInput,
  ): Promise<{
    review: TranscriptAlignmentSavedReview;
    progress: TranscriptAlignmentPageResponse['summary']['reviewProgress'];
  }> {
    if (!reviewerId || reviewerId.length > 512) {
      throw new BenchmarkValidationError('Invalid alignment reviewer identity');
    }
    const input = transcriptAlignmentReviewInputSchema.parse(inputValue);
    const page = await this.getAlignmentPage(runIdValue, pageKeyValue);
    const diskArtifactSha256 = await this.readCurrentAlignmentArtifactSha256(
      page.run.runId,
      page.page.pageKey,
    );
    if (page.artifactSha256 !== diskArtifactSha256) {
      this.alignmentCache.delete(
        `${page.run.runId}:${page.page.letterKey}`,
      );
      throw new TranscriptAlignmentArtifactChangedError(
        input.expectedArtifactSha256,
        diskArtifactSha256,
      );
    }
    if (input.expectedArtifactSha256 !== page.artifactSha256) {
      throw new TranscriptAlignmentArtifactChangedError(
        input.expectedArtifactSha256,
        page.artifactSha256,
      );
    }
    const pageItem = page.items.find(({ id }) => id === transcriptId);
    if (!pageItem) {
      throw new NotFoundError(
        'Transcript line is not part of this alignment page',
      );
    }
    const pageSegmentIds = new Set(page.segments.map(({ id }) => id));
    if (
      input.verdict === 'correct'
      && input.correctSegmentIds
      && !sameSegmentIds(
        input.correctSegmentIds,
        pageItem.mapping.segmentIds,
      )
    ) {
      throw new BenchmarkValidationError(
        'A correct verdict must retain the proposed segment assignment',
      );
    }
    if (
      input.verdict === 'unsure'
      && input.correctSegmentIds !== undefined
    ) {
      throw new BenchmarkValidationError(
        'An unsure verdict cannot declare a corrected segment assignment',
      );
    }
    const correctSegmentIds = input.correctSegmentIds
      ?? (input.verdict === 'correct' ? pageItem.mapping.segmentIds : []);
    if (
      input.verdict === 'incorrect'
      && sameSegmentIds(correctSegmentIds, pageItem.mapping.segmentIds)
      && !(
        correctSegmentIds.length === 0
        && pageItem.mapping.segmentIds.length === 0
        && input.failureModes.includes('missed-line')
      )
    ) {
      throw new BenchmarkValidationError(
        'An incorrect verdict must change the proposed segment assignment; '
        + 'an empty missed line must be explicitly marked missed-line',
      );
    }
    if (correctSegmentIds.some((segmentId) => !pageSegmentIds.has(segmentId))) {
      throw new BenchmarkValidationError(
        'Corrected segment assignment references a segment outside this page',
      );
    }

    const reviewDocumentKey = this.reviewPathSegments(
      page.run.runId,
      page.page.pageKey,
      page.artifactSha256,
      reviewerId,
    ).join('/');
    return this.withReviewDocumentLock(reviewDocumentKey, async () => {
      const currentDocument = await this.loadReviewDocument(
        page.run.runId,
        page.page.pageKey,
        page.artifactSha256,
        reviewerId,
      );
      this.validateReviewsAgainstPage(
        currentDocument,
        page.items.map(({ id }) => id),
        page.segments.map(({ id }) => id),
      );
      const now = new Date().toISOString();
      const review: TranscriptAlignmentSavedReview = {
        verdict: input.verdict,
        correctSegmentIds,
        failureModes: input.failureModes,
        activeSeconds: input.activeSeconds ?? 0,
        repairActions: input.repairActions ?? 0,
        updatedAt: now,
      };
      const reviews = [
        ...(currentDocument?.reviews ?? []).filter(
          (candidate) => candidate.transcriptId !== transcriptId,
        ),
        { transcriptId, review },
      ].sort((left, right) => (
        left.transcriptId.localeCompare(right.transcriptId)
      ));
      const document = transcriptAlignmentReviewDocumentSchema.parse({
        schemaVersion: 1,
        kind: 'transcript-alignment-human-review',
        runId: page.run.runId,
        pageKey: page.page.pageKey,
        artifactSha256: page.artifactSha256,
        reviewerId,
        createdAt: currentDocument?.createdAt ?? now,
        updatedAt: now,
        reviews,
      });
      const immediatelyCurrentArtifactSha256
        = await this.readCurrentAlignmentArtifactSha256(
          page.run.runId,
          page.page.pageKey,
        );
      if (
        input.expectedArtifactSha256 !== immediatelyCurrentArtifactSha256
        || page.artifactSha256 !== immediatelyCurrentArtifactSha256
      ) {
        this.alignmentCache.delete(
          `${page.run.runId}:${page.page.letterKey}`,
        );
        throw new TranscriptAlignmentArtifactChangedError(
          input.expectedArtifactSha256,
          immediatelyCurrentArtifactSha256,
        );
      }
      await this.writeReviewDocument(document);
      const reviewedCount = reviews.length;
      return {
        review,
        progress: {
          reviewedCount,
          totalCount: page.items.length,
          percent: page.items.length === 0
            ? 0
            : (reviewedCount / page.items.length) * 100,
        },
      };
    });
  }

  private async loadAlignmentBundle(
    runId: string,
    letterKey: string,
  ): Promise<AlignmentBundle> {
    const validatedRunId = transcriptAlignmentRunIdSchema.parse(runId);
    const validatedLetterKey = transcriptAlignmentLetterKeySchema.parse(letterKey);
    const cacheKey = `${validatedRunId}:${validatedLetterKey}`;
    const cached = this.alignmentCache.get(cacheKey);
    if (cached) return cached;
    const loading = (async () => {
      const artifactPath = await resolveRegularFileInside(
        this.paths.alignmentsRoot,
        validatedRunId,
        validatedLetterKey,
        ALIGNMENT_FILENAME,
      );
      const parsedArtifact = await readValidatedJson(
        artifactPath,
        transcriptAlignmentArtifactSchema,
        'Transcript-alignment artifact',
      );
      if (parsedArtifact.value.letterKey !== validatedLetterKey) {
        throw new BenchmarkValidationError(
          'Alignment artifact letter key does not match its directory',
        );
      }
      const snapshot = await this.findSnapshot(
        parsedArtifact.value.source.snapshotSha256,
      );
      const snapshotLetter = snapshot.letters.find(
        (candidate) => candidate.letterKey === validatedLetterKey,
      );
      if (!snapshotLetter) {
        throw new BenchmarkValidationError(
          'Alignment letter is absent from the frozen transcript snapshot',
        );
      }
      this.validateAlignmentAgainstSnapshot(
        parsedArtifact.value,
        snapshotLetter,
      );
      return {
        artifact: parsedArtifact.value,
        artifactSha256: parsedArtifact.sha256,
        snapshot,
        snapshotLetter,
      };
    })().catch((error) => {
      this.alignmentCache.delete(cacheKey);
      throw error;
    });
    this.alignmentCache.set(cacheKey, loading);
    return loading;
  }

  private async findSnapshot(
    expectedSha256: string,
  ): Promise<TranscriptAlignmentSnapshot> {
    const cached = this.snapshotCache.get(expectedSha256);
    if (cached) return cached;
    const loading = (async () => {
      for (const filename of await regularJsonFilenames(this.paths.snapshotsRoot)) {
        const filePath = await resolveRegularFileInside(
          this.paths.snapshotsRoot,
          filename,
        );
        const bytes = await readFile(filePath);
        if (sha256(bytes) !== expectedSha256) continue;
        return readValidatedJson(
          filePath,
          transcriptAlignmentSnapshotSchema,
          'Transcript-alignment snapshot',
        ).then(({ value }) => value);
      }
      throw new BenchmarkValidationError(
        'Frozen transcript snapshot matching the declared checksum was not found',
      );
    })().catch((error) => {
      this.snapshotCache.delete(expectedSha256);
      throw error;
    });
    this.snapshotCache.set(expectedSha256, loading);
    return loading;
  }

  private async findRecognition(
    pageKey: string,
    expectedSha256: string,
  ): Promise<RecognitionBundle> {
    const cacheKey = `${pageKey}:${expectedSha256}`;
    const cached = this.recognitionCache.get(cacheKey);
    if (cached) return cached;
    const loading = (async () => {
      for (
        const unvalidatedRunId
        of await directoryNames(this.paths.recognitionRunsRoot)
      ) {
        const parsedRunId = transcriptAlignmentRunIdSchema.safeParse(
          unvalidatedRunId,
        );
        if (!parsedRunId.success) continue;
        const runId = parsedRunId.data;
        let manifest: TranscriptRecognitionRun;
        try {
          const manifestPath = await resolveRegularFileInside(
            this.paths.recognitionRunsRoot,
            runId,
            RECOGNITION_RUN_FILENAME,
          );
          ({ value: manifest } = await readValidatedJson(
            manifestPath,
            transcriptRecognitionRunSchema,
            'Recognition run manifest',
          ));
        } catch {
          // A malformed or incomplete unrelated run must not hide a valid
          // checksum-addressed recognition artifact in another run.
          continue;
        }
        if (manifest.runId !== runId) {
          continue;
        }
        const page = manifest.pages.find((candidate) => (
          candidate.pageKey === pageKey && candidate.status !== 'failed'
        ));
        if (!page || page.status === 'failed') continue;
        const artifactPath = await resolveRegularFileInside(
          this.paths.recognitionRunsRoot,
          runId,
          page.output,
        );
        const bytes = await readFile(artifactPath);
        if (sha256(bytes) !== expectedSha256) continue;
        const { value: artifact } = await readValidatedJson(
          artifactPath,
          transcriptRecognitionArtifactSchema,
          'Recognition artifact',
        );
        if (artifact.pageKey !== pageKey) {
          throw new BenchmarkValidationError(
            'Recognition artifact page key does not match its manifest',
          );
        }
        return { manifest, artifact };
      }
      throw new BenchmarkValidationError(
        'Recognition artifact matching the declared page and checksum was not found',
      );
    })().catch((error) => {
      this.recognitionCache.delete(cacheKey);
      throw error;
    });
    this.recognitionCache.set(cacheKey, loading);
    return loading;
  }

  private reviewPathSegments(
    runId: string,
    pageKey: string,
    artifactSha256: string,
    reviewerId: string,
  ): [string, string, string, string] {
    const reviewerKey = createHash('sha256')
      .update(reviewerId, 'utf8')
      .digest('hex');
    return [
      runId,
      pageKey,
      artifactSha256,
      `${reviewerKey}.v1.json`,
    ];
  }

  private async readCurrentAlignmentArtifactSha256(
    runId: string,
    pageKey: string,
  ): Promise<string> {
    const letterKey = pageKey.replace(/-\d{2}$/, '');
    const artifactPath = await resolveRegularFileInside(
      this.paths.alignmentsRoot,
      runId,
      letterKey,
      ALIGNMENT_FILENAME,
    );
    return sha256(await readFile(artifactPath));
  }

  private async withReviewDocumentLock<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.reviewWriteLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const queueEntry = previous
      .catch(() => undefined)
      .then(() => gate);
    this.reviewWriteLocks.set(key, queueEntry);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.reviewWriteLocks.get(key) === queueEntry) {
        this.reviewWriteLocks.delete(key);
      }
    }
  }

  private async loadReviewDocument(
    runId: string,
    pageKey: string,
    artifactSha256: string,
    reviewerId: string,
  ): Promise<TranscriptAlignmentReviewDocument | null> {
    let path: string;
    try {
      path = await resolveRegularFileInside(
        this.paths.reviewsRoot,
        ...this.reviewPathSegments(
          runId,
          pageKey,
          artifactSha256,
          reviewerId,
        ),
      );
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
    const { value: parsedValue } = await readValidatedJson(
      path,
      transcriptAlignmentReviewDocumentSchema,
      'Transcript-alignment review',
    );
    // Re-parse to retain the schema's output type after applying defaults for
    // review documents written before failure-mode capture.
    const value = transcriptAlignmentReviewDocumentSchema.parse(parsedValue);
    if (
      value.runId !== runId
      || value.pageKey !== pageKey
      || value.artifactSha256 !== artifactSha256
      || value.reviewerId !== reviewerId
    ) {
      throw new BenchmarkValidationError(
        'Transcript-alignment review identity does not match its artifact path',
      );
    }
    return value;
  }

  private validateReviewsAgainstPage(
    document: TranscriptAlignmentReviewDocument | null,
    transcriptIds: string[],
    segmentIds: string[],
  ): void {
    if (!document) return;
    const knownTranscriptIds = new Set(transcriptIds);
    const knownSegmentIds = new Set(segmentIds);
    document.reviews.forEach(({ transcriptId, review }) => {
      if (!knownTranscriptIds.has(transcriptId)) {
        throw new BenchmarkValidationError(
          'Transcript-alignment review references an unknown transcript line',
        );
      }
      if (
        review.correctSegmentIds.some(
          (segmentId) => !knownSegmentIds.has(segmentId),
        )
      ) {
        throw new BenchmarkValidationError(
          'Transcript-alignment review references an unknown page segment',
        );
      }
    });
  }

  private async writeReviewDocument(
    document: TranscriptAlignmentReviewDocument,
  ): Promise<void> {
    const pathSegments = this.reviewPathSegments(
      document.runId,
      document.pageKey,
      document.artifactSha256,
      document.reviewerId,
    );
    const directory = resolveLexicallyInside(
      this.paths.reviewsRoot,
      ...pathSegments.slice(0, -1),
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const [rootRealPath, directoryRealPath] = await Promise.all([
      realpath(this.paths.reviewsRoot),
      realpath(directory),
    ]);
    if (!pathIsInside(rootRealPath, directoryRealPath)) {
      throw new BenchmarkValidationError(
        'Transcript-alignment review directory resolves outside its root',
      );
    }
    const destination = resolveLexicallyInside(
      directory,
      pathSegments[pathSegments.length - 1],
    );
    const temporaryPath = resolveLexicallyInside(
      directory,
      `.${pathSegments[pathSegments.length - 1]}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(document, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      await rename(temporaryPath, destination);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private validateAlignmentAgainstSnapshot(
    artifact: TranscriptAlignmentArtifact,
    snapshotLetter: TranscriptAlignmentSnapshot['letters'][number],
  ): void {
    if (artifact.source.transcriptSha256 !== snapshotLetter.transcript.sha256) {
      throw new BenchmarkValidationError(
        'Alignment transcript checksum does not match the frozen snapshot',
      );
    }
    const expectedPageKeys = snapshotLetter.pages
      .map(({ pageKey }) => pageKey)
      .sort();
    const recognitionPageKeys = artifact.source.recognitions
      .map(({ pageKey }) => pageKey)
      .sort();
    if (
      JSON.stringify(expectedPageKeys)
      !== JSON.stringify(recognitionPageKeys)
    ) {
      throw new BenchmarkValidationError(
        'Alignment recognition pages do not exactly match the frozen letter pages',
      );
    }
    const knownPageKeys = new Set(expectedPageKeys);
    const alignableLines = snapshotLetter.transcript.lines.filter(
      ({ alignable }) => alignable,
    );
    const transcriptById = new Map(
      alignableLines.map((line) => [line.id, line]),
    );
    if (
      artifact.summary.transcriptLineCount !== alignableLines.length
      || artifact.mappings.length !== alignableLines.length
    ) {
      throw new BenchmarkValidationError(
        'Alignment mappings do not cover every alignable transcript line exactly once',
      );
    }
    artifact.mappings.forEach((mapping, mappingIndex) => {
      const transcriptLine = transcriptById.get(mapping.transcriptId);
      if (
        !transcriptLine
        || mapping.transcriptText !== transcriptLine.text
        || mapping.sourceLineNumber !== transcriptLine.sourceLineNumber
      ) {
        throw new BenchmarkValidationError(
          'Alignment mapping does not match its frozen transcript line',
        );
      }
      assertSinglePageSegmentGroup(
        mapping.segmentIds,
        knownPageKeys,
        `Mapping ${mappingIndex}`,
        mapping.pageKey ?? null,
      );
      if (mapping.pageKey && !knownPageKeys.has(mapping.pageKey)) {
        throw new BenchmarkValidationError(
          `Mapping ${mappingIndex} declares a page outside the frozen letter`,
        );
      }
      const detectedPageKey = mapping.segmentIds.length > 0
        ? pageKeyForSegment(mapping.segmentIds[0])
        : null;
      if (
        mapping.pageKey
        && detectedPageKey
        && mapping.pageKey !== detectedPageKey
      ) {
        throw new BenchmarkValidationError(
          `Mapping ${mappingIndex} page identity conflicts with its segments`,
        );
      }
      mapping.alternatives.forEach(({ segmentIds }, alternativeIndex) => {
        assertSinglePageSegmentGroup(
          segmentIds,
          knownPageKeys,
          `Mapping ${mappingIndex} alternative ${alternativeIndex}`,
          mapping.pageKey ?? null,
        );
      });
      if (
        (mapping.segmentIds.length === 0)
        !== (mapping.operation === 'unlocated-transcript')
        || (
          mapping.operation === 'unlocated-transcript'
          && mapping.status !== 'unlocated'
        )
      ) {
        throw new BenchmarkValidationError(
          'Unlocated mapping state is inconsistent with its segment assignment',
        );
      }
    });
    artifact.skippedSegmentIds.forEach((segmentId, index) => {
      const segmentPageKey = pageKeyForSegment(segmentId);
      if (segmentPageKey && !knownPageKeys.has(segmentPageKey)) {
        throw new BenchmarkValidationError(
          `Skipped segment ${index} references a page outside the frozen letter`,
        );
      }
    });
    artifact.deferredSegmentIds.forEach((segmentId, index) => {
      const segmentPageKey = pageKeyForSegment(segmentId);
      if (segmentPageKey && !knownPageKeys.has(segmentPageKey)) {
        throw new BenchmarkValidationError(
          `Deferred segment ${index} references a page outside the frozen letter`,
        );
      }
      if (!artifact.skippedSegmentIds.includes(segmentId)) {
        throw new BenchmarkValidationError(
          'Deferred segments must remain present in the skipped segment set',
        );
      }
    });
    if (
      new Set(artifact.skippedSegmentIds).size
        !== artifact.skippedSegmentIds.length
      || artifact.summary.skippedSegmentCount
        !== artifact.skippedSegmentIds.length
    ) {
      throw new BenchmarkValidationError(
        'Skipped segment summary is inconsistent',
      );
    }
    if (
      new Set(artifact.deferredSegmentIds).size
        !== artifact.deferredSegmentIds.length
      || (
        artifact.summary.deferredSegmentCount !== undefined
        && artifact.summary.deferredSegmentCount
          !== artifact.deferredSegmentIds.length
      )
    ) {
      throw new BenchmarkValidationError(
        'Deferred segment summary is inconsistent',
      );
    }
    const actualStatusCounts = statusCounts(artifact.mappings);
    if (
      JSON.stringify(actualStatusCounts)
      !== JSON.stringify(artifact.summary.statusCounts)
    ) {
      throw new BenchmarkValidationError(
        'Alignment status summary is inconsistent',
      );
    }
  }
}

export const defaultTranscriptAlignmentStore = new TranscriptAlignmentStore();

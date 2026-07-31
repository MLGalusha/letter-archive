import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  lstat,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodType } from 'zod';
import { ZodError } from 'zod';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../utils/response-helpers.js';
import {
  annotationDocumentSchema,
  buildLetterKey,
  buildPageKey,
  cohortSchema,
  evaluationDocumentSchema,
  type AnnotationUpdate,
  type CohortPage,
  type EvaluationDecision,
  type EvaluationDecisionInput,
  type LayoutAnnotation,
  type LayoutCohort,
  type LayoutEvaluation,
  type LayoutRunManifest,
  type NormalizedLayout,
  normalizedLayoutSchema,
  pageMaskInputStageSchema,
  RUN_MANIFEST_FILENAME,
  runManifestPhysicalFiles,
  runManifestSchema,
  SAFE_ID_PATTERN,
  sourceSnapshotBundleSha256,
} from './schemas.js';
import {
  computePreparedRasterFingerprint,
  type PreparedRasterFingerprint,
  preparedRastersMatch,
} from './raster-fingerprint.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BACKEND_ROOT = resolve(MODULE_DIR, '../../..');

export interface LayoutBenchmarkPaths {
  backendRoot: string;
  cohortPath: string;
  resultsRoot: string;
  runsRoot: string;
  evaluationsRoot: string;
  sourceRoot: string;
}

export interface CohortPageRecord extends CohortPage {
  pageKey: string;
  letterKey: string;
  collectionCode: string;
  dateRaw: string;
  type: 'L';
  typeSequence: number;
}

export interface InvalidRun {
  directory: string;
  error: string;
}

export interface RunListing {
  runs: LayoutRunManifest[];
  invalidRuns: InvalidRun[];
}

export type RunArtifactKind =
  | 'prepared'
  | 'overlay'
  | 'raw'
  | 'error'
  | 'pageMask'
  | 'engineInput'
  | 'inputStage';

export interface ResolvedArtifact {
  absolutePath: string;
  contentType: string;
  sizeBytes: number;
  filename: string;
}

export interface SourceArtifact extends ResolvedArtifact {
  checksumSha256: string;
}

export interface EvaluationProgress {
  totalPages: number;
  reviewedPages: number;
  decisionCount: number;
  excludedDecisionCount: number;
  percent: number;
  comparisons: Array<{
    comparisonKey: string;
    leftRunId: string;
    rightRunId: string;
    reviewedPages: number;
    totalPages: number;
    eligiblePages: number;
    incomparablePages: number;
    attemptedPages: number;
    leftSelectedPages: number;
    rightSelectedPages: number;
    sharedSelectedPages: number;
    sharedSucceededPages: number;
    failedPages: number;
    preprocessingProfileMismatchPages: number;
    preparedMismatchPages: number;
    percent: number;
  }>;
}

export class BenchmarkValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, message, details, 'invalid_benchmark_artifact');
  }
}

export class BenchmarkConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, message, details, 'benchmark_conflict');
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

function safeId(value: string, label: string): string {
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new BenchmarkValidationError(`Invalid ${label}`);
  }
  return value;
}

function isDiagnosticOnlyRun(run: LayoutRunManifest): boolean {
  const diagnostic = run.engine.configuration.values.diagnostic;
  return Boolean(
    diagnostic
    && typeof diagnostic === 'object'
    && !Array.isArray(diagnostic)
    && diagnostic.equivalentToDefaultProfile === false
  );
}

function pathIsInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === '' || (
    !relativePath.startsWith('..')
    && !relativePath.startsWith('/')
  );
}

function resolveLexicallyInside(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, ...segments);
  if (!pathIsInside(resolvedRoot, candidate)) {
    throw new BenchmarkValidationError('Path traversal rejected');
  }
  return candidate;
}

async function resolveExistingFileInside(root: string, ...segments: string[]): Promise<string> {
  const lexicalRoot = resolve(root);
  const candidate = resolveLexicallyInside(lexicalRoot, ...segments);
  let canonicalRoot: string;
  let canonicalCandidate: string;
  try {
    [canonicalRoot, canonicalCandidate] = await Promise.all([
      realpath(root),
      realpath(candidate),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('Benchmark artifact not found');
    }
    throw error;
  }
  if (!pathIsInside(canonicalRoot, canonicalCandidate)) {
    throw new BenchmarkValidationError('Symlink traversal rejected');
  }
  const expectedCanonicalPath = resolve(
    canonicalRoot,
    relative(lexicalRoot, candidate),
  );
  if (canonicalCandidate !== expectedCanonicalPath) {
    throw new BenchmarkValidationError('Symlink artifact rejected');
  }
  const lexicalStat = await lstat(candidate);
  if (lexicalStat.isSymbolicLink()) {
    throw new BenchmarkValidationError('Symlink artifact rejected');
  }
  const fileStat = await stat(canonicalCandidate);
  if (!fileStat.isFile()) {
    throw new NotFoundError('Benchmark artifact is not a regular file');
  }
  return canonicalCandidate;
}

async function listRegularFilesWithoutSymlinks(
  root: string,
  relativeDirectory = '',
): Promise<string[]> {
  const absoluteDirectory = resolveLexicallyInside(root, relativeDirectory || '.');
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isSymbolicLink()) {
      throw new BenchmarkValidationError(`Symlink entry rejected: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listRegularFilesWithoutSymlinks(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new BenchmarkValidationError(`Non-regular run entry rejected: ${relativePath}`);
    }
  }
  return files;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', resolveHash);
  });
  return hash.digest('hex');
}

async function verifyIntegrityEntry(
  runRoot: string,
  artifact: string,
  expected: { sha256: string; sizeBytes: number },
): Promise<{ absolutePath: string; sha256: string; sizeBytes: number }> {
  let absolutePath: string;
  try {
    absolutePath = await resolveExistingFileInside(runRoot, artifact);
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new BenchmarkValidationError(`Integrity artifact is missing: ${artifact}`);
    }
    throw error;
  }
  const [fileStat, actualSha256] = await Promise.all([
    stat(absolutePath),
    sha256File(absolutePath),
  ]);
  if (fileStat.size !== expected.sizeBytes) {
    throw new BenchmarkValidationError(
      `Integrity size mismatch for ${artifact}: expected ${expected.sizeBytes}, received ${fileStat.size}`,
    );
  }
  if (actualSha256 !== expected.sha256) {
    throw new BenchmarkValidationError(`Integrity checksum mismatch for ${artifact}`);
  }
  return {
    absolutePath,
    sha256: actualSha256,
    sizeBytes: fileStat.size,
  };
}

async function readValidatedJson<T>(
  filePath: string,
  schema: ZodType<T>,
  label: string,
): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError(`${label} not found`);
    }
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new BenchmarkValidationError(`${label} is not valid JSON`);
  }

  try {
    return schema.parse(value);
  } catch (error) {
    throw new BenchmarkValidationError(`${label} failed schema validation`, {
      issues: error instanceof ZodError ? error.issues : undefined,
    });
  }
}

async function readAndValidateNormalizedLayout(
  run: LayoutRunManifest,
  page: LayoutRunManifest['pages'][number],
  layoutPath: string,
): Promise<NormalizedLayout> {
  if (!page.prepared) {
    throw new BenchmarkValidationError(
      'Normalized layout requires a prepared input',
    );
  }
  const layout = await readValidatedJson(
    layoutPath,
    normalizedLayoutSchema,
    'Normalized layout',
  );
  if (
    layout.runId !== run.runId
    || layout.pageKey !== page.pageKey
    || layout.engineId !== run.engine.id
  ) {
    throw new BenchmarkValidationError(
      'Normalized layout identity does not match its run/page',
    );
  }
  if (
    layout.image.width !== page.prepared.width
    || layout.image.height !== page.prepared.height
    || layout.image.preparedSha256 !== page.prepared.sha256
    || layout.image.sourceSha256 !== page.source.sha256
    || (
      layout.image.rasterFingerprint !== undefined
      && (
        page.prepared.rasterFingerprint === undefined
        || layout.image.rasterFingerprint.algorithm
          !== page.prepared.rasterFingerprint.algorithm
        || layout.image.rasterFingerprint.sha256
          !== page.prepared.rasterFingerprint.sha256
      )
    )
  ) {
    throw new BenchmarkValidationError(
      'Normalized layout coordinate space does not match its prepared input',
    );
  }
  if (
    layout.regions.length !== page.counts.regions
    || layout.lines.length !== page.counts.lines
  ) {
    throw new BenchmarkValidationError(
      'Normalized layout counts do not match the run manifest',
    );
  }
  return layout;
}

async function readAndValidatePageMaskInputStage(
  page: LayoutRunManifest['pages'][number],
  verifiedArtifacts: ReadonlyMap<
    string,
    { absolutePath: string; sha256: string; sizeBytes: number }
  >,
): Promise<void> {
  const inputStageReference = page.artifacts.inputStage;
  const pageMaskReference = page.artifacts.pageMask;
  const engineInputReference = page.artifacts.engineInput;
  if (!inputStageReference || !pageMaskReference || !engineInputReference) {
    return;
  }
  if (!page.prepared) {
    throw new BenchmarkValidationError(
      'Page-mask input-stage evidence requires a prepared input',
    );
  }
  const inputStageArtifact = verifiedArtifacts.get(inputStageReference);
  const pageMaskArtifact = verifiedArtifacts.get(pageMaskReference);
  const engineInputArtifact = verifiedArtifacts.get(engineInputReference);
  if (!inputStageArtifact || !pageMaskArtifact || !engineInputArtifact) {
    throw new BenchmarkValidationError(
      'Page-mask input-stage integrity entries are incomplete',
    );
  }
  const inputStage = await readValidatedJson(
    inputStageArtifact.absolutePath,
    pageMaskInputStageSchema,
    'Page-mask input-stage provenance',
  );
  if (
    inputStage.coordinateTransform.width !== page.prepared.width
    || inputStage.coordinateTransform.height !== page.prepared.height
  ) {
    throw new BenchmarkValidationError(
      'Page-mask input-stage coordinate space does not match its prepared input',
    );
  }
  for (const [label, declared, verified] of [
    ['page-mask', inputStage.includeMask.artifact, pageMaskArtifact],
    ['engine-input', inputStage.engineInput.artifact, engineInputArtifact],
  ] as const) {
    if (
      declared.sha256 !== verified.sha256
      || declared.sizeBytes !== verified.sizeBytes
      || declared.width !== page.prepared.width
      || declared.height !== page.prepared.height
    ) {
      throw new BenchmarkValidationError(
        `${label} provenance does not match the verified run artifact`,
      );
    }
  }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${filePath.split('/').pop()}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, 'wx', 0o600);
  let renamed = false;
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, filePath);
    renamed = true;

    // Persist the directory entry where the platform supports directory fsync.
    try {
      const directoryHandle = await open(directory, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EPERM') {
        throw error;
      }
    }
  } finally {
    await handle.close().catch(() => undefined);
    if (!renamed) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

function mimeForFilename(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.xml':
      return 'application/xml; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

async function detectImageMime(filePath: string, fallbackFilename: string): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const bytes = Buffer.alloc(16);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const header = bytes.subarray(0, bytesRead);
    if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      header.length >= 8
      && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return 'image/png';
    }
    if (
      header.length >= 12
      && header.subarray(0, 4).toString('ascii') === 'RIFF'
      && header.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }
    if (
      header.length >= 4
      && (
        header.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00]))
        || header.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
      )
    ) {
      return 'image/tiff';
    }
    if (
      header.length >= 6
      && ['GIF87a', 'GIF89a'].includes(header.subarray(0, 6).toString('ascii'))
    ) {
      return 'image/gif';
    }
    return mimeForFilename(fallbackFilename);
  } finally {
    await handle.close();
  }
}

async function readPngDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const handle = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (
      bytesRead < 24
      || !header.subarray(0, 8).equals(signature)
      || header.subarray(12, 16).toString('ascii') !== 'IHDR'
    ) {
      throw new BenchmarkValidationError('Prepared/overlay artifact is not a valid PNG');
    }
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    if (width <= 0 || height <= 0) {
      throw new BenchmarkValidationError('PNG declares invalid dimensions');
    }
    return { width, height };
  } finally {
    await handle.close();
  }
}

async function forEachWithConcurrency<T>(
  values: T[],
  concurrency: number,
  action: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        await action(values[index]);
      }
    },
  );
  await Promise.all(workers);
}

function comparisonKey(leftRunId: string, rightRunId: string): string {
  return [leftRunId, rightRunId].sort().join('__');
}

export class LayoutBenchmarkStore {
  readonly paths: LayoutBenchmarkPaths;
  private readonly writeLocks = new Map<string, Promise<void>>();
  private readonly runCache = new Map<string, Promise<LayoutRunManifest>>();
  private readonly layoutCache = new Map<string, Promise<NormalizedLayout>>();
  private readonly rasterFingerprintCache = new Map<
    string,
    Promise<PreparedRasterFingerprint>
  >();
  private cohortCache: Promise<LayoutCohort> | null = null;
  private cohortShaCache: Promise<string> | null = null;
  private cohortPagesCache: Promise<CohortPageRecord[]> | null = null;

  constructor(overrides: Partial<LayoutBenchmarkPaths> = {}) {
    const backendRoot = resolve(overrides.backendRoot ?? DEFAULT_BACKEND_ROOT);
    const resultsRoot = resolve(
      overrides.resultsRoot ?? join(backendRoot, 'test-results/layout-benchmark'),
    );
    this.paths = {
      backendRoot,
      cohortPath: resolve(
        overrides.cohortPath ?? join(backendRoot, 'benchmarks/layout/cohort.v1.json'),
      ),
      resultsRoot,
      runsRoot: resolve(overrides.runsRoot ?? join(resultsRoot, 'runs')),
      evaluationsRoot: resolve(
        overrides.evaluationsRoot ?? join(resultsRoot, 'evaluations'),
      ),
      sourceRoot: resolve(
        overrides.sourceRoot ?? (
          env.STORAGE_DIR.startsWith('/')
            ? env.STORAGE_DIR
            : join(backendRoot, env.STORAGE_DIR)
        ),
      ),
    };
  }

  async loadCohort(): Promise<LayoutCohort> {
    if (!this.cohortCache) {
      this.cohortCache = readValidatedJson(
        this.paths.cohortPath,
        cohortSchema,
        'Layout cohort',
      ).catch((error) => {
        this.cohortCache = null;
        throw error;
      });
    }
    return this.cohortCache;
  }

  async cohortSha256(): Promise<string> {
    if (!this.cohortShaCache) {
      this.cohortShaCache = sha256File(this.paths.cohortPath).catch((error) => {
        this.cohortShaCache = null;
        throw error;
      });
    }
    return this.cohortShaCache;
  }

  async listCohortPages(): Promise<CohortPageRecord[]> {
    if (!this.cohortPagesCache) {
      this.cohortPagesCache = this.loadCohort().then((cohort) => (
        cohort.letters.flatMap((letter) => {
          const letterKey = buildLetterKey(letter.identity);
          return letter.pages.map((page) => ({
            ...page,
            pageKey: buildPageKey(letter.identity, page.pageNumber),
            letterKey,
            ...letter.identity,
          }));
        })
      )).catch((error) => {
        this.cohortPagesCache = null;
        throw error;
      });
    }
    return this.cohortPagesCache;
  }

  async getCohortPage(pageKey: string): Promise<CohortPageRecord> {
    if (!/^\d{3}-[\dX]{8}-[A-Z]\d{2}-\d{2}$/.test(pageKey)) {
      throw new BenchmarkValidationError('Invalid page key');
    }
    const page = (await this.listCohortPages()).find((candidate) => candidate.pageKey === pageKey);
    if (!page) {
      throw new NotFoundError('Benchmark page not found');
    }
    return page;
  }

  async listRuns(): Promise<RunListing> {
    let entries;
    try {
      entries = await readdir(this.paths.runsRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { runs: [], invalidRuns: [] };
      }
      throw error;
    }

    const candidates = entries
      .filter((entry) => (
        (entry.isDirectory() || entry.isSymbolicLink())
        && !entry.name.startsWith('.')
      ))
      .sort((left, right) => left.name.localeCompare(right.name));
    const results = await Promise.all(candidates.map(async (entry) => {
      if (!SAFE_ID_PATTERN.test(entry.name)) {
        return {
          invalid: {
            directory: entry.name,
            error: 'Directory name is not a safe run ID',
          },
        };
      }
      try {
        return { run: await this.getRun(entry.name) };
      } catch (error) {
        return {
          invalid: {
            directory: entry.name,
            error: errorMessage(error),
          },
        };
      }
    }));

    const runs = results
      .flatMap((result) => result.run ? [result.run] : [])
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const invalidRuns = results.flatMap((result) => result.invalid ? [result.invalid] : []);
    return { runs, invalidRuns };
  }

  async getRun(runIdValue: string): Promise<LayoutRunManifest> {
    const runId = safeId(runIdValue, 'run id');
    const cached = this.runCache.get(runId);
    if (cached) return cached;
    const loading = this.loadAndValidateRun(runId).catch((error) => {
      this.runCache.delete(runId);
      throw error;
    });
    this.runCache.set(runId, loading);
    return loading;
  }

  private async loadAndValidateRun(runId: string): Promise<LayoutRunManifest> {
    const runRoot = resolveLexicallyInside(this.paths.runsRoot, runId);
    let runRootStat;
    try {
      runRootStat = await lstat(runRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError('Benchmark run not found');
      }
      throw error;
    }
    if (runRootStat.isSymbolicLink()) {
      throw new BenchmarkValidationError('Symlink run directory rejected');
    }
    if (!runRootStat.isDirectory()) {
      throw new NotFoundError('Benchmark run is not a directory');
    }
    const manifestPath = await resolveExistingFileInside(
      runRoot,
      RUN_MANIFEST_FILENAME,
    );
    const [run, cohort, cohortSha256] = await Promise.all([
      readValidatedJson(manifestPath, runManifestSchema, 'Run manifest'),
      this.loadCohort(),
      this.cohortSha256(),
    ]);
    if (run.runId !== runId) {
      throw new BenchmarkValidationError('Run ID does not match its directory');
    }
    if (run.cohort.id !== cohort.cohortId || run.cohort.sha256 !== cohortSha256) {
      throw new BenchmarkValidationError(
        'Run was not produced from the current cohort manifest',
      );
    }

    const cohortPages = new Map(
      (await this.listCohortPages()).map((page) => [page.pageKey, page]),
    );
    if (run.cohort.selection.scope === 'full') {
      const selectedKeys = [...run.cohort.selection.pageKeys].sort();
      const allKeys = [...cohortPages.keys()].sort();
      if (JSON.stringify(selectedKeys) !== JSON.stringify(allKeys)) {
        throw new BenchmarkValidationError(
          'A full run must select every page in the current cohort',
        );
      }
    }
    run.pages.forEach((runPage) => {
      const sourcePage = cohortPages.get(runPage.pageKey);
      if (!sourcePage) {
        throw new BenchmarkValidationError(
          `Run contains a page outside the cohort: ${runPage.pageKey}`,
        );
      }
      if (
        runPage.source.filename !== sourcePage.originalFilename
        || runPage.source.sha256 !== sourcePage.checksumSha256
        || runPage.source.width !== sourcePage.width
        || runPage.source.height !== sourcePage.height
      ) {
        throw new BenchmarkValidationError(
          `Run source identity does not match cohort page ${runPage.pageKey}`,
        );
      }
    });

    const expectedFiles = runManifestPhysicalFiles(run);
    const actualFiles = await listRegularFilesWithoutSymlinks(runRoot);
    const expected = new Set(expectedFiles);
    const actual = new Set(actualFiles);
    const missing = expectedFiles.filter((path) => !actual.has(path));
    const extra = actualFiles.filter((path) => !expected.has(path));
    if (missing.length > 0 || extra.length > 0) {
      throw new BenchmarkValidationError(
        'Run directory files do not exactly match manifest integrity coverage',
        {
          missing,
          extra,
        },
      );
    }

    const verifiedArtifacts = new Map<
      string,
      { absolutePath: string; sha256: string; sizeBytes: number }
    >();
    await forEachWithConcurrency(
      Object.entries(run.integrity.artifacts),
      8,
      async ([artifact, integrity]) => {
        verifiedArtifacts.set(
          artifact,
          await verifyIntegrityEntry(runRoot, artifact, integrity),
        );
      },
    );
    const actualSourceFiles = Object.fromEntries(
      Object.entries(run.sourceSnapshot.files).map(([originalPath, snapshot]) => {
        const verified = verifiedArtifacts.get(snapshot.snapshotPath)!;
        return [originalPath, { sha256: verified.sha256 }];
      }),
    );
    if (
      sourceSnapshotBundleSha256(actualSourceFiles)
      !== run.sourceSnapshot.bundleSha256
    ) {
      throw new BenchmarkValidationError(
        'Source snapshot bundle checksum does not match snapshotted files',
      );
    }

    await forEachWithConcurrency(run.pages, 4, async (runPage) => {
      if (runPage.prepared) {
        const preparedPath = verifiedArtifacts.get(
          runPage.prepared.artifact,
        )!.absolutePath;
        const dimensions = await readPngDimensions(preparedPath);
        if (
          dimensions.width !== runPage.prepared.width
          || dimensions.height !== runPage.prepared.height
        ) {
          throw new BenchmarkValidationError(
            `Prepared artifact dimensions do not match manifest for ${runPage.pageKey}`,
          );
        }
        if (runPage.artifacts.overlay) {
          const overlayDimensions = await readPngDimensions(
            verifiedArtifacts.get(runPage.artifacts.overlay)!.absolutePath,
          );
          if (
            overlayDimensions.width !== runPage.prepared.width
            || overlayDimensions.height !== runPage.prepared.height
          ) {
            throw new BenchmarkValidationError(
              `Overlay dimensions do not match prepared input for ${runPage.pageKey}`,
            );
          }
        }
        for (const kind of ['pageMask', 'engineInput'] as const) {
          const artifact = runPage.artifacts[kind];
          if (!artifact) continue;
          const artifactDimensions = await readPngDimensions(
            verifiedArtifacts.get(artifact)!.absolutePath,
          );
          if (
            artifactDimensions.width !== runPage.prepared.width
            || artifactDimensions.height !== runPage.prepared.height
          ) {
            throw new BenchmarkValidationError(
              `${kind} dimensions do not match prepared input for ${runPage.pageKey}`,
            );
          }
        }
      }
      await readAndValidatePageMaskInputStage(runPage, verifiedArtifacts);
      if (runPage.artifacts.normalized) {
        await readAndValidateNormalizedLayout(
          run,
          runPage,
          verifiedArtifacts.get(runPage.artifacts.normalized)!.absolutePath,
        );
      }
    });
    return run;
  }

  async getRunPage(runId: string, pageKey: string): Promise<{
    run: LayoutRunManifest;
    page: LayoutRunManifest['pages'][number];
  }> {
    const run = await this.getRun(runId);
    const page = run.pages.find((candidate) => candidate.pageKey === pageKey);
    if (!page) {
      throw new NotFoundError('Page was not selected for this run');
    }
    return { run, page };
  }

  async getPreparedRasterFingerprint(
    runId: string,
    pageKey: string,
  ): Promise<PreparedRasterFingerprint> {
    const { run, page } = await this.getRunPage(runId, pageKey);
    if (!page.prepared) {
      throw new NotFoundError('Prepared input is not available for this page');
    }
    const integrity = run.integrity.artifacts[page.prepared.artifact];
    if (!integrity) {
      throw new BenchmarkValidationError(
        'Prepared artifact is missing integrity metadata',
      );
    }
    const cacheKey = [
      integrity.sha256,
      integrity.sizeBytes,
      `${page.prepared.width}x${page.prepared.height}`,
    ].join(':');
    const cached = this.rasterFingerprintCache.get(cacheKey);
    if (cached) {
      const fingerprint = await cached;
      this.assertDeclaredRasterFingerprint(run, page, fingerprint);
      return fingerprint;
    }

    const loading = (async () => {
      const verified = await verifyIntegrityEntry(
        resolveLexicallyInside(this.paths.runsRoot, run.runId),
        page.prepared!.artifact,
        integrity,
      );
      try {
        return await computePreparedRasterFingerprint(
          verified.absolutePath,
          page.prepared!,
        );
      } catch (error) {
        throw new BenchmarkValidationError(
          `Prepared raster fingerprint could not be derived for ${page.pageKey}`,
          { cause: errorMessage(error) },
        );
      }
    })().catch((error) => {
      this.rasterFingerprintCache.delete(cacheKey);
      throw error;
    });
    this.rasterFingerprintCache.set(cacheKey, loading);
    const fingerprint = await loading;
    this.assertDeclaredRasterFingerprint(run, page, fingerprint);
    return fingerprint;
  }

  async preparedRunPagesMatch(
    leftRunId: string,
    rightRunId: string,
    pageKey: string,
  ): Promise<boolean> {
    const [left, right] = await Promise.all([
      this.getRunPage(leftRunId, pageKey),
      this.getRunPage(rightRunId, pageKey),
    ]);
    if (!left.page.prepared || !right.page.prepared) return false;
    const [leftFingerprint, rightFingerprint] = await Promise.all([
      this.getPreparedRasterFingerprint(leftRunId, pageKey),
      this.getPreparedRasterFingerprint(rightRunId, pageKey),
    ]);
    return preparedRastersMatch(
      { ...left.page.prepared, rasterFingerprint: leftFingerprint },
      { ...right.page.prepared, rasterFingerprint: rightFingerprint },
    );
  }

  private assertDeclaredRasterFingerprint(
    run: LayoutRunManifest,
    page: LayoutRunManifest['pages'][number],
    actual: PreparedRasterFingerprint,
  ): void {
    const declared = page.prepared?.rasterFingerprint;
    if (
      declared
      && (
        declared.algorithm !== actual.algorithm
        || declared.sha256 !== actual.sha256
      )
    ) {
      throw new BenchmarkValidationError(
        `Prepared raster fingerprint does not match decoded pixels for ${page.pageKey}`,
        {
          runId: run.runId,
          declared,
          actual,
        },
      );
    }
  }

  async getNormalizedLayout(runId: string, pageKey: string): Promise<NormalizedLayout> {
    const validatedRunId = safeId(runId, 'run id');
    if (!/^\d{3}-[\dX]{8}-[A-Z]\d{2}-\d{2}$/.test(pageKey)) {
      throw new BenchmarkValidationError('Invalid page key');
    }
    const { run, page } = await this.getRunPage(validatedRunId, pageKey);
    if (!page.artifacts.normalized || !page.prepared) {
      throw new NotFoundError('Normalized layout is not available for this page');
    }
    const integrity = run.integrity.artifacts[page.artifacts.normalized];
    if (!integrity) {
      throw new BenchmarkValidationError(
        'Normalized layout is missing integrity metadata',
      );
    }
    await verifyIntegrityEntry(
      resolveLexicallyInside(this.paths.runsRoot, validatedRunId),
      page.artifacts.normalized,
      integrity,
    );
    const cacheKey = `${validatedRunId}:${pageKey}`;
    const cached = this.layoutCache.get(cacheKey);
    if (cached) return cached;
    const loading = this.loadAndValidateNormalizedLayout(
      validatedRunId,
      pageKey,
    ).catch((error) => {
      this.layoutCache.delete(cacheKey);
      throw error;
    });
    this.layoutCache.set(cacheKey, loading);
    return loading;
  }

  private async loadAndValidateNormalizedLayout(
    runId: string,
    pageKey: string,
  ): Promise<NormalizedLayout> {
    const { run, page } = await this.getRunPage(runId, pageKey);
    if (!page.artifacts.normalized || !page.prepared) {
      throw new NotFoundError('Normalized layout is not available for this page');
    }
    const layoutPath = await resolveExistingFileInside(
      this.paths.runsRoot,
      run.runId,
      page.artifacts.normalized,
    );
    return readAndValidateNormalizedLayout(
      run,
      page,
      layoutPath,
    );
  }

  async resolveRunArtifact(
    runId: string,
    pageKey: string,
    kind: RunArtifactKind,
  ): Promise<ResolvedArtifact> {
    const { run, page } = await this.getRunPage(runId, pageKey);
    const artifact = kind === 'prepared'
      ? page.prepared?.artifact
      : page.artifacts[kind];
    if (!artifact) {
      throw new NotFoundError(`${kind} artifact is not available for this page`);
    }
    const integrity = run.integrity.artifacts[artifact];
    if (!integrity) {
      throw new BenchmarkValidationError(`${kind} artifact is missing integrity metadata`);
    }
    const verified = await verifyIntegrityEntry(
      resolveLexicallyInside(this.paths.runsRoot, run.runId),
      artifact,
      integrity,
    );
    return {
      absolutePath: verified.absolutePath,
      contentType: mimeForFilename(verified.absolutePath),
      sizeBytes: verified.sizeBytes,
      filename: verified.absolutePath.split('/').pop() ?? kind,
    };
  }

  async resolveSource(pageKey: string): Promise<SourceArtifact> {
    const page = await this.getCohortPage(pageKey);
    const typeDirectory = `${page.type}${String(page.typeSequence).padStart(2, '0')}`;
    const absolutePath = await resolveExistingFileInside(
      this.paths.sourceRoot,
      'collections',
      page.collectionCode,
      page.dateRaw,
      typeDirectory,
      page.originalFilename,
    );
    const checksumSha256 = await sha256File(absolutePath);
    if (checksumSha256 !== page.checksumSha256) {
      throw new BenchmarkConflictError(
        'Stored source checksum no longer matches the frozen cohort',
        { pageKey },
      );
    }
    const fileStat = await stat(absolutePath);
    return {
      absolutePath,
      contentType: await detectImageMime(absolutePath, page.originalFilename),
      sizeBytes: fileStat.size,
      filename: page.originalFilename,
      checksumSha256,
    };
  }

  async getAnnotation(pageKey: string): Promise<LayoutAnnotation | null> {
    const cohort = await this.loadCohort();
    const cohortPage = await this.getCohortPage(pageKey);
    const groundTruthRoot = resolveLexicallyInside(
      dirname(this.paths.cohortPath),
      cohort.groundTruth.artifactDirectory,
    );
    try {
      const safeAnnotationPath = await resolveExistingFileInside(
        groundTruthRoot,
        `${pageKey}.layout.v1.json`,
      );
      const annotation = await readValidatedJson(
        safeAnnotationPath,
        annotationDocumentSchema,
        'Ground-truth annotation',
      );
      if (
        annotation.cohortId !== cohort.cohortId
        || annotation.pageKey !== pageKey
        || annotation.image.sourceSha256 !== cohortPage.checksumSha256
      ) {
        throw new BenchmarkValidationError(
          'Ground-truth annotation identity does not match the current cohort page',
        );
      }
      if (annotation.image.rasterFingerprint) {
        return annotation;
      }
      // Legacy annotations recorded only the encoded PNG checksum. Resolve the
      // immutable run they were anchored to and enrich the in-memory value
      // without rewriting the historical annotation artifact.
      const { runs } = await this.listRuns();
      const anchor = runs.flatMap((run) => {
        const runPage = run.pages.find((candidate) => (
          candidate.pageKey === pageKey
          && candidate.prepared?.sha256 === annotation.image.preparedSha256
          && candidate.prepared.width === annotation.image.width
          && candidate.prepared.height === annotation.image.height
        ));
        return runPage?.prepared ? [{ run, runPage }] : [];
      })[0];
      if (!anchor) {
        return annotation;
      }
      return annotationDocumentSchema.parse({
        ...annotation,
        image: {
          ...annotation.image,
          rasterFingerprint: await this.getPreparedRasterFingerprint(
            anchor.run.runId,
            pageKey,
          ),
        },
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async saveAnnotation(
    pageKey: string,
    reviewerIdValue: string,
    update: AnnotationUpdate,
  ): Promise<LayoutAnnotation> {
    const reviewerId = safeId(reviewerIdValue, 'reviewer id');
    const cohort = await this.loadCohort();
    const page = await this.getCohortPage(pageKey);
    if (update.image.sourceSha256 !== page.checksumSha256) {
      throw new BenchmarkConflictError(
        'Annotation source checksum does not match the cohort page',
      );
    }
    const { runs } = await this.listRuns();
    const matchingPreparedRun = runs.flatMap((run) => {
      const runPage = run.pages.find((candidate) => candidate.pageKey === pageKey);
      return (
        runPage?.status === 'succeeded'
        && runPage.prepared?.sha256 === update.image.preparedSha256
        && runPage.prepared.width === update.image.width
        && runPage.prepared.height === update.image.height
      ) ? [{ run, runPage }] : [];
    })[0];
    if (!matchingPreparedRun) {
      throw new BenchmarkConflictError(
        'Annotation prepared coordinate space does not match a successful immutable run artifact',
        {
          pageKey,
          preparedSha256: update.image.preparedSha256,
          width: update.image.width,
          height: update.image.height,
        },
      );
    }
    const groundTruthRoot = resolveLexicallyInside(
      dirname(this.paths.cohortPath),
      cohort.groundTruth.artifactDirectory,
    );
    const annotationPath = resolveLexicallyInside(
      groundTruthRoot,
      `${pageKey}.layout.v1.json`,
    );

    return this.withWriteLock(annotationPath, async () => {
      const existing = await this.getAnnotation(pageKey);
      const now = new Date().toISOString();
      const annotation = annotationDocumentSchema.parse({
        schemaVersion: 1,
        cohortId: cohort.cohortId,
        pageKey,
        ...update,
        image: {
          ...update.image,
          rasterFingerprint: await this.getPreparedRasterFingerprint(
            matchingPreparedRun.run.runId,
            pageKey,
          ),
        },
        audit: {
          createdAt: existing?.audit.createdAt ?? now,
          createdBy: existing?.audit.createdBy ?? reviewerId,
          updatedAt: now,
          updatedBy: reviewerId,
        },
      });
      await atomicWriteJson(annotationPath, annotation);
      return annotation;
    });
  }

  async getEvaluation(reviewerIdValue: string): Promise<LayoutEvaluation> {
    const reviewerId = safeId(reviewerIdValue, 'reviewer id');
    const cohort = await this.loadCohort();
    try {
      const safeEvaluationPath = await resolveExistingFileInside(
        this.paths.evaluationsRoot,
        `${reviewerId}.evaluation.v1.json`,
      );
      const evaluation = await readValidatedJson(
        safeEvaluationPath,
        evaluationDocumentSchema,
        'Reviewer evaluation',
      );
      if (evaluation.reviewerId !== reviewerId || evaluation.cohortId !== cohort.cohortId) {
        throw new BenchmarkValidationError(
          'Evaluation identity does not match reviewer/current cohort',
        );
      }
      const cohortPageKeys = new Set(
        (await this.listCohortPages()).map((page) => page.pageKey),
      );
      if (evaluation.decisions.some((decision) => !cohortPageKeys.has(decision.pageKey))) {
        throw new BenchmarkValidationError(
          'Evaluation contains a decision outside the current cohort',
        );
      }
      return evaluation;
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        throw error;
      }
      const now = new Date().toISOString();
      return {
        schemaVersion: 1,
        cohortId: cohort.cohortId,
        reviewerId,
        createdAt: now,
        updatedAt: now,
        decisions: [],
      };
    }
  }

  async createEvaluationDecision(
    reviewerIdValue: string,
    pageKey: string,
    input: EvaluationDecisionInput,
  ): Promise<{ evaluation: LayoutEvaluation; decision: EvaluationDecision }> {
    const reviewerId = safeId(reviewerIdValue, 'reviewer id');
    await this.getCohortPage(pageKey);
    const [left, right] = await Promise.all([
      this.getRunPage(input.leftRunId, pageKey),
      this.getRunPage(input.rightRunId, pageKey),
    ]);
    if (isDiagnosticOnlyRun(left.run) || isDiagnosticOnlyRun(right.run)) {
      throw new BenchmarkConflictError(
        'Diagnostic engine profiles are inspectable but excluded from human quality ranking',
      );
    }
    if (
      left.run.preprocessing.profileSha256
      !== right.run.preprocessing.profileSha256
    ) {
      throw new BenchmarkConflictError(
        'Runs use different preprocessing profiles and are not comparable',
      );
    }
    if (
      left.page.status !== 'succeeded'
      || right.page.status !== 'succeeded'
      || !left.page.prepared
      || !right.page.prepared
    ) {
      throw new BenchmarkConflictError(
        'Both runs must have successful prepared results for this page',
      );
    }
    if (
      left.page.prepared.width !== right.page.prepared.width
      || left.page.prepared.height !== right.page.prepared.height
      || !(await this.preparedRunPagesMatch(
        left.run.runId,
        right.run.runId,
        pageKey,
      ))
    ) {
      throw new BenchmarkConflictError(
        'Runs have different decoded prepared rasters or dimensions and are not comparable',
      );
    }
    if (input.elapsedMs === undefined || input.elapsedMs <= 0) {
      throw new BenchmarkValidationError(
        'A positive timed review duration is required',
      );
    }

    const evaluationPath = resolveLexicallyInside(
      this.paths.evaluationsRoot,
      `${reviewerId}.evaluation.v1.json`,
    );
    return this.withWriteLock(evaluationPath, async () => {
      const evaluation = await this.getEvaluation(reviewerId);
      const key = comparisonKey(input.leftRunId, input.rightRunId);
      const existingIndex = evaluation.decisions.findIndex(
        (candidate) => candidate.pageKey === pageKey && candidate.comparisonKey === key,
      );
      if (existingIndex >= 0) {
        throw new BenchmarkConflictError(
          'A verdict already exists for this page and run pair and is immutable',
        );
      }
      const now = new Date().toISOString();
      const decision: EvaluationDecision = {
        pageKey,
        comparisonKey: key,
        ...input,
        reviewedAt: now,
        updatedAt: now,
      };
      const decisions = [...evaluation.decisions];
      decisions.push(decision);
      decisions.sort((a, b) => (
        a.pageKey.localeCompare(b.pageKey)
        || a.comparisonKey.localeCompare(b.comparisonKey)
      ));
      const updated = evaluationDocumentSchema.parse({
        ...evaluation,
        updatedAt: now,
        decisions,
      });
      await atomicWriteJson(evaluationPath, updated);
      return { evaluation: updated, decision };
    });
  }

  async evaluationProgress(evaluation: LayoutEvaluation): Promise<EvaluationProgress> {
    const cohort = await this.loadCohort();
    const cohortPages = await this.listCohortPages();
    const reviewed = evaluation.decisions.filter(
      (decision) => decision.preference !== 'unreviewed',
    );
    const reviewedEligiblePageKeys = new Set<string>();
    let reviewedEligibleDecisions = 0;
    const comparisons = new Map<string, {
      comparisonKey: string;
      leftRunId: string;
      rightRunId: string;
      pages: Set<string>;
    }>();
    reviewed.forEach((decision) => {
      const entry = comparisons.get(decision.comparisonKey) ?? {
        comparisonKey: decision.comparisonKey,
        leftRunId: decision.leftRunId,
        rightRunId: decision.rightRunId,
        pages: new Set<string>(),
      };
      entry.pages.add(decision.pageKey);
      comparisons.set(decision.comparisonKey, entry);
    });

    const percent = (count: number) => (
      cohort.coverage.pageCount === 0
        ? 0
        : Number(((count / cohort.coverage.pageCount) * 100).toFixed(1))
    );
    const comparisonProgress = await Promise.all(
      [...comparisons.values()].map(async (entry) => {
        let eligiblePageKeys = new Set<string>();
        let attemptedPages = 0;
        let leftSelectedPages = 0;
        let rightSelectedPages = 0;
        let sharedSelectedPages = 0;
        let sharedSucceededPages = 0;
        let failedPages = 0;
        let preprocessingProfileMismatchPages = 0;
        let preparedMismatchPages = 0;
        try {
          const [leftRun, rightRun] = await Promise.all([
            this.getRun(entry.leftRunId),
            this.getRun(entry.rightRunId),
          ]);
          const leftPages = new Map(leftRun.pages.map((page) => [page.pageKey, page]));
          const rightPages = new Map(rightRun.pages.map((page) => [page.pageKey, page]));
          leftSelectedPages = leftPages.size;
          rightSelectedPages = rightPages.size;
          attemptedPages = new Set([...leftPages.keys(), ...rightPages.keys()]).size;
          const preprocessingProfilesMatch = (
            leftRun.preprocessing.profileSha256
            === rightRun.preprocessing.profileSha256
          );
          const qualityRankable = (
            !isDiagnosticOnlyRun(leftRun)
            && !isDiagnosticOnlyRun(rightRun)
          );
          for (const cohortPage of cohortPages) {
            const left = leftPages.get(cohortPage.pageKey);
            const right = rightPages.get(cohortPage.pageKey);
            if (!left || !right) {
              continue;
            }
            sharedSelectedPages += 1;
            if (left.status !== 'succeeded' || right.status !== 'succeeded') {
              failedPages += 1;
              continue;
            }
            sharedSucceededPages += 1;
            if (!qualityRankable) {
              continue;
            }
            if (!preprocessingProfilesMatch) {
              preprocessingProfileMismatchPages += 1;
              continue;
            }
            if (
              !left.prepared
              || !right.prepared
              || left.prepared.width !== right.prepared.width
              || left.prepared.height !== right.prepared.height
              || !(await this.preparedRunPagesMatch(
                leftRun.runId,
                rightRun.runId,
                cohortPage.pageKey,
              ))
            ) {
              preparedMismatchPages += 1;
              continue;
            }
            eligiblePageKeys.add(cohortPage.pageKey);
          }
        } catch {
          // A manually removed or invalid immutable run leaves the historical
          // decision visible but contributes no currently eligible pages.
        }
        const reviewedEligiblePages = [...entry.pages].filter(
          (pageKey) => eligiblePageKeys.has(pageKey),
        );
        reviewedEligiblePages.forEach((pageKey) => {
          reviewedEligiblePageKeys.add(pageKey);
        });
        reviewedEligibleDecisions += reviewedEligiblePages.length;
        const eligiblePages = eligiblePageKeys.size;
        return {
          comparisonKey: entry.comparisonKey,
          leftRunId: entry.leftRunId,
          rightRunId: entry.rightRunId,
          reviewedPages: reviewedEligiblePages.length,
          totalPages: eligiblePages,
          eligiblePages,
          incomparablePages: cohort.coverage.pageCount - eligiblePages,
          attemptedPages,
          leftSelectedPages,
          rightSelectedPages,
          sharedSelectedPages,
          sharedSucceededPages,
          failedPages,
          preprocessingProfileMismatchPages,
          preparedMismatchPages,
          percent: eligiblePages === 0
            ? 0
            : Number(((reviewedEligiblePages.length / eligiblePages) * 100).toFixed(1)),
        };
      }),
    );
    return {
      totalPages: cohort.coverage.pageCount,
      reviewedPages: reviewedEligiblePageKeys.size,
      decisionCount: reviewedEligibleDecisions,
      excludedDecisionCount: reviewed.length - reviewedEligibleDecisions,
      percent: percent(reviewedEligiblePageKeys.size),
      comparisons: comparisonProgress
        .sort((a, b) => a.comparisonKey.localeCompare(b.comparisonKey)),
    };
  }

  private async withWriteLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
    const previous = this.writeLocks.get(filePath) ?? Promise.resolve();
    let release!: () => void;
    const currentLock = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const chain = previous.then(() => currentLock);
    this.writeLocks.set(filePath, chain);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.writeLocks.get(filePath) === chain) {
        this.writeLocks.delete(filePath);
      }
    }
  }
}

/** Shared process-local reader/cache for immutable benchmark runs. */
export const defaultLayoutBenchmarkStore = new LayoutBenchmarkStore();

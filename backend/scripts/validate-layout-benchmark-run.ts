#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  open,
  lstat,
  readdir,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import {
  buildPageKey,
  cohortSchema,
  normalizedLayoutSchema,
  pageMaskInputStageSchema,
  RUN_MANIFEST_FILENAME,
  runManifestPhysicalFiles,
  runManifestSchema,
  SAFE_ID_PATTERN,
  type LayoutCohort,
  type LayoutRunManifest,
  sourceSnapshotBundleSha256,
} from '../src/benchmarks/layout/schemas.js';
import { computePreparedRasterFingerprint } from '../src/benchmarks/layout/raster-fingerprint.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDirectory, '..');
const cohortPath = join(backendRoot, 'benchmarks/layout/cohort.v1.json');

interface Arguments {
  directory: string;
  runId: string;
}

function parseArguments(values: string[]): Arguments {
  let directory: string | undefined;
  let runId: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === '--directory') {
      directory = values[index + 1];
      index += 1;
    } else if (values[index] === '--run-id') {
      runId = values[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${values[index]}`);
    }
  }
  if (!directory || !isAbsolute(directory)) {
    throw new Error('--directory must be an absolute path');
  }
  if (!runId || !SAFE_ID_PATTERN.test(runId)) {
    throw new Error('--run-id must be a safe benchmark run ID');
  }
  return { directory: resolve(directory), runId };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function sha256File(path: string): Promise<string> {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function readPngDimensions(path: string): Promise<{
  width: number;
  height: number;
}> {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (
      bytesRead !== header.length
      || !header.subarray(0, 8).equals(signature)
      || header.subarray(12, 16).toString('ascii') !== 'IHDR'
    ) {
      throw new Error(`Artifact is not a valid PNG: ${path}`);
    }
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    if (width <= 0 || height <= 0) {
      throw new Error(`PNG declares invalid dimensions: ${path}`);
    }
    return { width, height };
  } finally {
    await handle.close();
  }
}

async function resolveArtifact(runDirectory: string, artifact: string): Promise<string> {
  const root = await realpath(runDirectory);
  const lexicalCandidate = join(root, artifact);
  const candidate = await realpath(lexicalCandidate);
  const relativePath = relative(root, candidate);
  if (
    relativePath === ''
    || relativePath.startsWith('..')
    || isAbsolute(relativePath)
  ) {
    throw new Error(`Artifact escapes the staged run directory: ${artifact}`);
  }
  if (candidate !== lexicalCandidate || (await lstat(lexicalCandidate)).isSymbolicLink()) {
    throw new Error(`Artifact cannot be a symlink: ${artifact}`);
  }
  const details = await stat(candidate);
  if (!details.isFile()) {
    throw new Error(`Artifact is not a regular file: ${artifact}`);
  }
  return candidate;
}

async function listRegularFilesWithoutSymlinks(
  runDirectory: string,
  relativeDirectory = '',
): Promise<string[]> {
  const absoluteDirectory = relativeDirectory
    ? join(runDirectory, relativeDirectory)
    : runDirectory;
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(`Run directory cannot contain symlinks: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listRegularFilesWithoutSymlinks(runDirectory, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Run directory contains a non-regular entry: ${relativePath}`);
    }
  }
  return files;
}

async function verifyIntegrity(
  runDirectory: string,
  run: LayoutRunManifest,
): Promise<Map<string, string>> {
  const expectedFiles = runManifestPhysicalFiles(run);
  const actualFiles = await listRegularFilesWithoutSymlinks(runDirectory);
  const expected = new Set(expectedFiles);
  const actual = new Set(actualFiles);
  const missing = expectedFiles.filter((path) => !actual.has(path));
  const extra = actualFiles.filter((path) => !expected.has(path));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Run files do not exactly match integrity coverage; missing=${missing.join(',') || '<none>'}; extra=${extra.join(',') || '<none>'}`,
    );
  }

  const resolvedArtifacts = new Map<string, string>();
  await forEachWithConcurrency(
    Object.entries(run.integrity.artifacts),
    8,
    async ([artifact, expectedIntegrity]) => {
      const absolutePath = await resolveArtifact(runDirectory, artifact);
      const [actualIntegrity, fileStat] = await Promise.all([
        sha256File(absolutePath),
        stat(absolutePath),
      ]);
      if (actualIntegrity !== expectedIntegrity.sha256) {
        throw new Error(`Integrity checksum mismatch for ${artifact}`);
      }
      if (fileStat.size !== expectedIntegrity.sizeBytes) {
        throw new Error(
          `Integrity size mismatch for ${artifact}: expected ${expectedIntegrity.sizeBytes}, received ${fileStat.size}`,
        );
      }
      resolvedArtifacts.set(artifact, absolutePath);
    },
  );
  const actualSourceFiles = Object.fromEntries(
    Object.entries(run.sourceSnapshot.files).map(([originalPath, snapshot]) => {
      const integrity = run.integrity.artifacts[snapshot.snapshotPath];
      return [originalPath, { sha256: integrity.sha256 }];
    }),
  );
  if (
    sourceSnapshotBundleSha256(actualSourceFiles)
    !== run.sourceSnapshot.bundleSha256
  ) {
    throw new Error('Source snapshot bundle checksum does not match snapshotted files');
  }
  return resolvedArtifacts;
}

function cohortPages(cohort: LayoutCohort): Map<string, LayoutCohort['letters'][number]['pages'][number]> {
  return new Map(cohort.letters.flatMap((letter) => (
    letter.pages.map((page) => [buildPageKey(letter.identity, page.pageNumber), page] as const)
  )));
}

async function validatePage(
  run: LayoutRunManifest,
  cohort: LayoutCohort,
  page: LayoutRunManifest['pages'][number],
  resolvedArtifacts: Map<string, string>,
): Promise<void> {
  const sourcePage = cohortPages(cohort).get(page.pageKey);
  if (
    !sourcePage
    || page.source.filename !== sourcePage.originalFilename
    || page.source.sha256 !== sourcePage.checksumSha256
    || page.source.width !== sourcePage.width
    || page.source.height !== sourcePage.height
  ) {
    throw new Error(`Run source identity does not match cohort page ${page.pageKey}`);
  }

  if (page.prepared) {
    const preparedPath = resolvedArtifacts.get(page.prepared.artifact)!;
    const dimensions = await readPngDimensions(preparedPath);
    if (
      dimensions.width !== page.prepared.width
      || dimensions.height !== page.prepared.height
    ) {
      throw new Error(`Prepared PNG dimensions mismatch for ${page.pageKey}`);
    }
    if (page.prepared.rasterFingerprint) {
      const actualFingerprint = await computePreparedRasterFingerprint(
        preparedPath,
        page.prepared,
      );
      if (
        actualFingerprint.algorithm !== page.prepared.rasterFingerprint.algorithm
        || actualFingerprint.sha256 !== page.prepared.rasterFingerprint.sha256
      ) {
        throw new Error(
          `Prepared raster fingerprint mismatch for ${page.pageKey}`,
        );
      }
    }
    if (page.artifacts.overlay) {
      const overlay = await readPngDimensions(
        resolvedArtifacts.get(page.artifacts.overlay)!,
      );
      if (
        overlay.width !== page.prepared.width
        || overlay.height !== page.prepared.height
      ) {
        throw new Error(`Overlay dimensions mismatch for ${page.pageKey}`);
      }
    }
    for (const kind of ['pageMask', 'engineInput'] as const) {
      const reference = page.artifacts[kind];
      if (!reference) continue;
      const artifact = await readPngDimensions(
        resolvedArtifacts.get(reference)!,
      );
      if (
        artifact.width !== page.prepared.width
        || artifact.height !== page.prepared.height
      ) {
        throw new Error(`${kind} dimensions mismatch for ${page.pageKey}`);
      }
    }
    if (
      page.artifacts.pageMask
      && page.artifacts.engineInput
      && page.artifacts.inputStage
    ) {
      const inputStage = pageMaskInputStageSchema.parse(
        await readJson(resolvedArtifacts.get(page.artifacts.inputStage)!),
      );
      if (
        inputStage.coordinateTransform.width !== page.prepared.width
        || inputStage.coordinateTransform.height !== page.prepared.height
      ) {
        throw new Error(
          `Page-mask coordinate space mismatch for ${page.pageKey}`,
        );
      }
      for (const [label, declared, reference] of [
        [
          'pageMask',
          inputStage.includeMask.artifact,
          page.artifacts.pageMask,
        ],
        [
          'engineInput',
          inputStage.engineInput.artifact,
          page.artifacts.engineInput,
        ],
      ] as const) {
        const integrity = run.integrity.artifacts[reference];
        if (
          declared.sha256 !== integrity.sha256
          || declared.sizeBytes !== integrity.sizeBytes
          || declared.width !== page.prepared.width
          || declared.height !== page.prepared.height
        ) {
          throw new Error(
            `${label} provenance mismatch for ${page.pageKey}`,
          );
        }
      }
    }
  }

  if (page.artifacts.normalized) {
    const layout = normalizedLayoutSchema.parse(
      await readJson(resolvedArtifacts.get(page.artifacts.normalized)!),
    );
    if (
      layout.runId !== run.runId
      || layout.pageKey !== page.pageKey
      || layout.engineId !== run.engine.id
    ) {
      throw new Error(`Normalized layout identity mismatch for ${page.pageKey}`);
    }
    if (
      !page.prepared
      || layout.image.width !== page.prepared.width
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
      throw new Error(`Normalized coordinate space mismatch for ${page.pageKey}`);
    }
    if (
      layout.regions.length !== page.counts.regions
      || layout.lines.length !== page.counts.lines
    ) {
      throw new Error(`Normalized count mismatch for ${page.pageKey}`);
    }
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

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if ((await lstat(args.directory)).isSymbolicLink()) {
    throw new Error('Staged run directory cannot be a symlink');
  }
  const manifestPath = await resolveArtifact(
    args.directory,
    RUN_MANIFEST_FILENAME,
  );
  const [runValue, cohortValue, currentCohortSha256] = await Promise.all([
    readJson(manifestPath),
    readJson(cohortPath),
    sha256File(cohortPath),
  ]);
  const run = runManifestSchema.parse(runValue);
  const cohort = cohortSchema.parse(cohortValue);
  if (run.runId !== args.runId) {
    throw new Error('Run ID does not match the requested publication ID');
  }
  if (
    run.cohort.id !== cohort.cohortId
    || run.cohort.sha256 !== currentCohortSha256
  ) {
    throw new Error('Run was not produced from the current cohort manifest');
  }
  if (run.cohort.selection.scope === 'full') {
    const expected = [...cohortPages(cohort).keys()].sort();
    const actual = [...run.cohort.selection.pageKeys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('Full run selection does not contain the entire cohort');
    }
  }
  const resolvedArtifacts = await verifyIntegrity(args.directory, run);
  await forEachWithConcurrency(
    run.pages,
    4,
    async (page) => validatePage(run, cohort, page, resolvedArtifacts),
  );
  process.stdout.write(`${JSON.stringify({
    ok: true,
    runId: run.runId,
    pages: run.pages.length,
    succeeded: run.summary.succeeded,
    failed: run.summary.failed,
  })}\n`);
}

main().catch((error: unknown) => {
  if (error instanceof ZodError) {
    const issues = error.issues
      .slice(0, 12)
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`);
    process.stderr.write(`Staged run schema validation failed: ${issues.join('; ')}\n`);
  } else {
    process.stderr.write(
      `Staged run validation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  process.exitCode = 2;
});

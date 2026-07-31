/**
 * Local, revision-bound line recognition for the production transcript overlay.
 *
 * Exports exact current geometry, normalizes source orientation, runs Kraken 7
 * once for the selected letter, validates every output, and only then appends
 * the artifacts to the local database.
 *
 * Usage:
 *   npm run recognize-lines-local -- --letter-id <UUID>
 *   npm run recognize-lines-local -- --letter-id <UUID> --page-id <UUID>
 */

import 'dotenv/config';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  closeDatabase,
  db,
  letters,
} from '../src/db/index.js';
import {
  pageRecognitionArtifactSchema,
  type PageRecognitionArtifact,
} from '../src/schemas/page-recognition.js';
import {
  insertPageRecognitionArtifactBatch,
} from '../src/services/page-recognition-artifacts.js';
import { getAbsoluteStoragePath } from '../src/services/storage.js';
import { pageGeometryEnvelopeFromRow } from '../src/services/line-segments.js';
import {
  buildCurrentRecognitionBatchManifest,
  type CurrentRecognitionManifestPageInput,
} from '../src/services/transcript-alignment/current-recognition-batch.js';

const execFileAsync = promisify(execFile);
const uuidSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const normalizationResultSchema = z.object({
  operation: z.string(),
  applied: z.boolean(),
  originalExifOrientation: z.number().int().min(1).max(8).nullable(),
  exifReadError: z.boolean(),
  original: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mode: z.string(),
  }),
  normalized: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mode: z.literal('RGB'),
  }),
  sourceChecksumSha256: sha256Schema,
  rasterEncodedChecksumSha256: sha256Schema,
  rasterChecksumAlgorithm: z.literal('sha256-rgb8-v1'),
  rasterChecksumSha256: sha256Schema,
}).strict();

const recognitionRunSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('current-page-recognition-run'),
  state: z.enum(['completed', 'completed-with-failures']),
  pages: z.array(z.object({
    pageId: z.string().uuid(),
    status: z.literal('succeeded'),
    output: z.string().min(1),
  }).passthrough()),
  failures: z.array(z.object({
    pageId: z.string().uuid(),
    message: z.string(),
  }).passthrough()),
}).passthrough();

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`Missing required ${name}`);
  return value;
}

function runIdentifier(): string {
  const timestamp = new Date().toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `current-${timestamp}-${randomUUID()}`;
}

async function normalizeSource(input: {
  python: string;
  helper: string;
  sourcePath: string;
  rasterPath: string;
}) {
  const { stdout, stderr } = await execFileAsync(
    input.python,
    [
      input.helper,
      '--input',
      input.sourcePath,
      '--output',
      input.rasterPath,
    ],
    {
      cwd: resolve('.'),
      env: {
        ...process.env,
        PYTHONPATH: resolve('python'),
      },
      maxBuffer: 1024 * 1024,
      timeout: 2 * 60 * 1000,
    },
  );
  if (stderr.trim()) process.stderr.write(stderr);
  return normalizationResultSchema.parse(JSON.parse(stdout));
}

async function loadArtifacts(
  runRoot: string,
  pages: Array<{ pageId: string; output: string }>,
): Promise<PageRecognitionArtifact[]> {
  return Promise.all(pages.map(async ({ pageId, output }) => {
    const outputPath = resolve(runRoot, output);
    const artifact = pageRecognitionArtifactSchema.parse(JSON.parse(
      await readFile(outputPath, 'utf8'),
    ));
    if (artifact.pageId !== pageId) {
      throw new Error(
        `Recognition output page mismatch: ${artifact.pageId} != ${pageId}`,
      );
    }
    return artifact;
  }));
}

async function main() {
  const letterId = uuidSchema.parse(requiredArgument('--letter-id'));
  const requestedPageId = argument('--page-id');
  if (requestedPageId) uuidSchema.parse(requestedPageId);

  const projectRoot = resolve('.');
  const python = resolve(projectRoot, 'python/venv/bin/python');
  const normalizationHelper = resolve(
    projectRoot,
    'python/transcript_alignment/normalize_source.py',
  );
  const recognitionWorker = resolve(
    projectRoot,
    'python/transcript_alignment/recognize_current_geometry.py',
  );
  const model = resolve(
    argument('--model')
      ?? 'test-results/transcript-alignment/models/McCATMuS_nfd_nofix_V1.mlmodel',
  );
  const runId = runIdentifier();
  const runRoot = resolve(
    argument('--run-root')
      ?? join('test-results/current-recognition', runId),
  );
  await mkdir(resolve(runRoot, '..'), { recursive: true });
  await mkdir(runRoot);
  await mkdir(join(runRoot, 'rasters'));

  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    columns: {
      id: true,
      dateRaw: true,
      primarySourceRevision: true,
    },
    with: {
      pages: {
        orderBy: (pages, { asc }) => [asc(pages.pageNumber)],
        columns: {
          id: true,
          pageNumber: true,
          originalFilename: true,
          storagePath: true,
          checksumSha256: true,
          lineSegments: true,
          geometryRevision: true,
          geometryChecksumSha256: true,
          segmentTrustState: true,
          approvedGeometryRevision: true,
          approvedGeometryChecksumSha256: true,
          geometryApprovedBy: true,
          geometryApprovedAt: true,
        },
      },
    },
  });
  if (!letter) throw new Error('Letter not found');

  const selectedPages = requestedPageId
    ? letter.pages.filter(({ id }) => id === requestedPageId)
    : letter.pages;
  if (selectedPages.length === 0) {
    throw new Error('The requested page does not belong to this letter');
  }

  console.log(
    `Preparing ${selectedPages.length} page${selectedPages.length === 1 ? '' : 's'} for local recognition…`,
  );
  const manifestPages: CurrentRecognitionManifestPageInput[] = [];
  for (const page of selectedPages) {
    if (!page.checksumSha256) {
      throw new Error(
        `Page ${page.pageNumber} has no immutable source checksum`,
      );
    }
    const sourcePath = getAbsoluteStoragePath(page.storagePath);
    const rasterPath = resolve(runRoot, 'rasters', `${page.id}.png`);
    const normalized = await normalizeSource({
      python,
      helper: normalizationHelper,
      sourcePath,
      rasterPath,
    });
    if (normalized.sourceChecksumSha256 !== page.checksumSha256) {
      throw new Error(
        `Page ${page.pageNumber} source bytes no longer match the database`,
      );
    }
    const geometry = pageGeometryEnvelopeFromRow(page);
    if (
      geometry.lineSegments.every(
        (segment) => segment.excluded || segment.segmentClass === 'ignore',
      )
    ) {
      throw new Error(
        `Page ${page.pageNumber} has no active line geometry to recognize`,
      );
    }
    manifestPages.push({
      pageId: page.id,
      pageKey: basename(page.originalFilename).replace(/\.[^.]+$/, ''),
      primarySourceRevision: letter.primarySourceRevision,
      geometry,
      raster: {
        sourcePath,
        sourceChecksumSha256: normalized.sourceChecksumSha256,
        rasterPath,
        rasterEncodedChecksumSha256:
          normalized.rasterEncodedChecksumSha256,
        rasterChecksumSha256: normalized.rasterChecksumSha256,
        width: normalized.normalized.width,
        height: normalized.normalized.height,
        normalization: {
          operation: normalized.operation,
          applied: normalized.applied,
          originalExifOrientation: normalized.originalExifOrientation,
          exifReadError: normalized.exifReadError,
          original: normalized.original,
          normalized: normalized.normalized,
        },
      },
    });
    console.log(
      `  Page ${page.pageNumber}: ${geometry.lineSegments.length} current outlines, ${normalized.operation}`,
    );
  }

  const manifest = buildCurrentRecognitionBatchManifest({
    runId,
    pages: manifestPages,
  });
  const manifestPath = resolve(runRoot, 'input.v1.json');
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );

  console.log('Running Kraken 7 locally…');
  const { stdout, stderr } = await execFileAsync(
    python,
    [
      recognitionWorker,
      '--manifest',
      manifestPath,
      '--model',
      model,
      '--output-root',
      runRoot,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PYTHONPATH: resolve(projectRoot, 'python'),
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30 * 60 * 1000,
    },
  );
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);

  const run = recognitionRunSchema.parse(JSON.parse(
    await readFile(resolve(runRoot, 'run.v1.json'), 'utf8'),
  ));
  if (run.state !== 'completed' || run.failures.length > 0) {
    throw new Error(
      `Recognition failed for ${run.failures.length} page(s); nothing was imported`,
    );
  }
  if (run.pages.length !== selectedPages.length) {
    throw new Error(
      'Recognition output did not cover every selected page; nothing was imported',
    );
  }

  // Parse every page first. No database write begins until the complete run
  // has passed the shared TypeScript artifact schema.
  const artifacts = await loadArtifacts(runRoot, run.pages);
  const imported = await insertPageRecognitionArtifactBatch(artifacts);

  console.log(
    `Ready: ${imported.length} page artifact${imported.length === 1 ? '' : 's'} imported for the production overlay.`,
  );
  console.log(`Retained run evidence: ${runRoot}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closeDatabase();
}

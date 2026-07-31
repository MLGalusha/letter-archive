import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sourceSnapshotBundleSha256 } from '../schemas.js';
import {
  BenchmarkConflictError,
  BenchmarkValidationError,
  LayoutBenchmarkStore,
} from '../store.js';
import {
  makeAnnotationUpdate,
  makeCohort,
  makeLayout,
  makeRun,
  PAGE_KEY,
} from './test-fixtures.js';

function checksum(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

const zeroRepairs = {
  missedLinesAdded: 0,
  falseLinesRemoved: 0,
  splitLinesJoined: 0,
  mergedLinesSplit: 0,
  orientationCorrections: 0,
  readingOrderCorrections: 0,
  regionCorrections: 0,
  other: 0,
  total: 0,
};
const zeroAssessments = {
  left: { flags: [], repairs: zeroRepairs },
  right: { flags: [], repairs: zeroRepairs },
};

describe('LayoutBenchmarkStore', () => {
  let root: string;
  let store: LayoutBenchmarkStore;
  let sourceSha: string;
  let cohortSha: string;
  let sourceBytes: Buffer;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'layout-benchmark-store-'));
    // Several real set-014 files have WebP payloads behind legacy .jpg names.
    sourceBytes = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([16, 0, 0, 0]),
      Buffer.from('WEBP'),
      Buffer.from('frozen source image bytes'),
    ]);
    sourceSha = checksum(sourceBytes);
    const cohort = makeCohort();
    cohort.letters[0].pages[0].checksumSha256 = sourceSha;
    const cohortRaw = `${JSON.stringify(cohort, null, 2)}\n`;
    cohortSha = checksum(cohortRaw);

    await mkdir(join(root, 'benchmarks/layout'), { recursive: true });
    await writeFile(join(root, 'benchmarks/layout/cohort.v1.json'), cohortRaw);
    await mkdir(join(root, 'storage/collections/001/18881103/L01'), { recursive: true });
    await writeFile(
      join(root, 'storage/collections/001/18881103/L01/001-18881103-L01-01.jpg'),
      sourceBytes,
    );
    store = new LayoutBenchmarkStore({
      backendRoot: root,
      sourceRoot: join(root, 'storage'),
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeRun(
    runId: string,
    preparedVariant = 'default',
    preprocessingProfileSha256 = 'f'.repeat(64),
    status: 'succeeded' | 'failed' = 'succeeded',
    equivalentToDefaultProfile?: boolean,
    pngCompressionLevel = 6,
  ) {
    const color = preparedVariant === 'default'
      ? { r: 255, g: 255, b: 255 }
      : preparedVariant === 'dark'
        ? { r: 20, g: 20, b: 20 }
        : { r: 120, g: 80, b: 40 };
    const prepared = await sharp({
      create: {
        width: 100,
        height: 200,
        channels: 3,
        background: color,
      },
    }).png({ compressionLevel: pngCompressionLevel }).toBuffer();
    const engineId = `engine-${runId}`;
    const preparedSha256 = checksum(prepared);
    const preparedPixels = await sharp(prepared).raw().toBuffer();
    const rasterSha256 = createHash('sha256')
      .update('rgb8:100x200\n', 'ascii')
      .update(preparedPixels)
      .digest('hex');
    const run = makeRun(runId, engineId, {
      cohortSha,
      sourceSha,
      preparedSha: preparedSha256,
      rasterSha: rasterSha256,
      status,
    });
    if (equivalentToDefaultProfile !== undefined) {
      run.engine.configuration.values.diagnostic = {
        equivalentToDefaultProfile,
        comparisonProfile: 'default',
        purpose: 'bounded diagnostic smoke run',
        capReachedIsQualityFailure: true,
      };
    }
    run.preprocessing.profileSha256 = preprocessingProfileSha256;
    const runRoot = join(root, 'test-results/layout-benchmark/runs', runId);
    const cohortSnapshotBytes = await readFile(
      join(root, run.cohort.manifestPath),
    );
    const engineConfigurationBytes = Buffer.from(
      `${JSON.stringify({ profileId: 'default', engineId }, null, 2)}\n`,
    );
    const preprocessingBytes = Buffer.from(
      `${JSON.stringify({ profile: preprocessingProfileSha256 }, null, 2)}\n`,
    );
    const artifactBytes: Record<string, Buffer> = {};
    for (const [originalPath, snapshot] of Object.entries(
      run.sourceSnapshot.files,
    )) {
      const source = originalPath === run.cohort.manifestPath
        ? cohortSnapshotBytes
        : originalPath === run.engine.configuration.path
          ? engineConfigurationBytes
          : originalPath === run.preprocessing.path
            ? preprocessingBytes
            : Buffer.from(`# frozen benchmark source: ${originalPath}\n`);
      snapshot.sha256 = checksum(source);
      snapshot.sizeBytes = source.length;
      artifactBytes[snapshot.snapshotPath] = source;
    }
    run.cohort.sha256 = checksum(cohortSnapshotBytes);
    run.engine.configuration.sha256 = checksum(engineConfigurationBytes);
    run.preprocessing.profileSha256 = checksum(preprocessingBytes);
    run.sourceSnapshot.bundleSha256 = sourceSnapshotBundleSha256(
      run.sourceSnapshot.files,
    );

    if (status === 'succeeded') {
      const page = run.pages[0];
      const layout = makeLayout(runId, engineId, preparedSha256);
      layout.image.sourceSha256 = sourceSha;
      artifactBytes[page.prepared!.artifact] = prepared;
      artifactBytes[page.artifacts.raw!] = Buffer.from('{"provider":"test"}\n');
      artifactBytes[page.artifacts.normalized!] = Buffer.from(
        `${JSON.stringify(layout, null, 2)}\n`,
      );
      artifactBytes[page.artifacts.overlay!] = prepared;
    } else {
      artifactBytes[run.pages[0].artifacts.error!] = Buffer.from(
        '{"stage":"engine","code":"test_failure","message":"Detector failed."}\n',
      );
    }

    run.integrity.artifacts = Object.fromEntries(
      Object.entries(artifactBytes).map(([artifact, bytes]) => [
        artifact,
        { sha256: checksum(bytes), sizeBytes: bytes.length },
      ]),
    );

    await Promise.all(Object.entries(artifactBytes).map(async ([artifact, bytes]) => {
      const absolutePath = join(runRoot, artifact);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, bytes);
    }));
    await writeFile(
      join(runRoot, 'run.v2.json'),
      `${JSON.stringify(run, null, 2)}\n`,
    );
    return run;
  }

  async function addPageMaskArtifacts(
    run: Awaited<ReturnType<typeof writeRun>>,
    corruptBinding = false,
  ) {
    const page = run.pages[0];
    const runRoot = join(
      root,
      'test-results/layout-benchmark/runs',
      run.runId,
    );
    const prefix = `pages/${page.pageKey}`;
    const references = {
      pageMask: `${prefix}/page-mask.png`,
      engineInput: `${prefix}/engine-input.png`,
      inputStage: `${prefix}/input-stage.v1.json`,
    };
    const pageMask = await sharp(
      Buffer.alloc(100 * 200, 255),
      { raw: { width: 100, height: 200, channels: 1 } },
    ).png().toBuffer();
    const engineInput = await readFile(
      join(runRoot, page.prepared!.artifact),
    );
    const provenance = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      stage: 'source-bound-page-mask-to-kraken-input',
      coordinateTransform: {
        name: 'identity',
        coordinateSpace: 'prepared-pixels-top-left',
        width: 100,
        height: 200,
      },
      includeMask: {
        artifact: {
          format: 'PNG',
          mode: 'L',
          width: 100,
          height: 200,
          sha256: corruptBinding ? '0'.repeat(64) : checksum(pageMask),
          sizeBytes: pageMask.length,
          rasterFingerprint: {
            algorithm: 'sha256-l8-v1',
            sha256: '1'.repeat(64),
          },
        },
      },
      engineInput: {
        artifact: {
          format: 'PNG',
          mode: 'RGB',
          width: 100,
          height: 200,
          sha256: checksum(engineInput),
          sizeBytes: engineInput.length,
          rasterFingerprint: {
            algorithm: 'sha256-rgb8-v1',
            sha256: page.prepared!.rasterFingerprint!.sha256,
          },
        },
      },
    }, null, 2)}\n`);
    const bytes = {
      [references.pageMask]: pageMask,
      [references.engineInput]: engineInput,
      [references.inputStage]: provenance,
    };
    page.artifacts.pageMask = references.pageMask;
    page.artifacts.engineInput = references.engineInput;
    page.artifacts.inputStage = references.inputStage;
    page.timings.inputStageMs = 5;
    for (const [artifact, value] of Object.entries(bytes)) {
      run.integrity.artifacts[artifact] = {
        sha256: checksum(value),
        sizeBytes: value.length,
      };
      const absolutePath = join(runRoot, artifact);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, value);
    }
    await writeFile(
      join(runRoot, 'run.v2.json'),
      `${JSON.stringify(run, null, 2)}\n`,
    );
  }

  it('loads and verifies the cohort-backed source without consulting mutable DB state', async () => {
    const source = await store.resolveSource(PAGE_KEY);

    expect(source.checksumSha256).toBe(sourceSha);
    expect(source.contentType).toBe('image/webp');
    expect((await readFile(source.absolutePath)).subarray(8, 12).toString()).toBe('WEBP');
  });

  it('cross-checks page-mask provenance against verified PNG artifacts', async () => {
    const valid = await writeRun('mask-binding-valid');
    await addPageMaskArtifacts(valid);
    await expect(store.getRun(valid.runId)).resolves.toMatchObject({
      runId: valid.runId,
    });

    const invalid = await writeRun('mask-binding-invalid');
    await addPageMaskArtifacts(invalid, true);
    await expect(store.getRun(invalid.runId)).rejects.toThrow(
      'page-mask provenance does not match the verified run artifact',
    );
  });

  it('fails closed when frozen source bytes drift', async () => {
    await writeFile(
      join(root, 'storage/collections/001/18881103/L01/001-18881103-L01-01.jpg'),
      'changed',
    );

    await expect(store.resolveSource(PAGE_KEY)).rejects.toBeInstanceOf(
      BenchmarkConflictError,
    );
  });

  it('reports malformed completed run directories without hiding valid runs', async () => {
    await writeRun('valid-run');
    const invalidRoot = join(root, 'test-results/layout-benchmark/runs/invalid-run');
    const legacyRoot = join(root, 'test-results/layout-benchmark/runs/legacy-run');
    await mkdir(invalidRoot, { recursive: true });
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(join(invalidRoot, 'run.v2.json'), '{"schemaVersion":2}\n');
    await writeFile(join(legacyRoot, 'run.v1.json'), '{"schemaVersion":1}\n');

    const listing = await store.listRuns();

    expect(listing.runs.map((run) => run.runId)).toEqual(['valid-run']);
    expect(listing.invalidRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ directory: 'invalid-run' }),
      expect.objectContaining({ directory: 'legacy-run' }),
    ]));
  });

  it('validates actual prepared PNG checksum and dimensions before caching a run', async () => {
    await writeRun('tampered-checksum');
    const checksumPath = join(
      root,
      'test-results/layout-benchmark/runs/tampered-checksum/pages',
      PAGE_KEY,
      'prepared.png',
    );
    const differentPng = await sharp({
      create: {
        width: 100,
        height: 200,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    }).png().toBuffer();
    await writeFile(checksumPath, differentPng);
    await expect(store.getRun('tampered-checksum')).rejects.toThrow(
      /Integrity (?:checksum|size) mismatch/,
    );

    await writeRun('tampered-dimensions');
    const manifestPath = join(
      root,
      'test-results/layout-benchmark/runs/tampered-dimensions/run.v2.json',
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.pages[0].prepared.width = 99;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(store.getRun('tampered-dimensions')).rejects.toThrow(
      'Prepared artifact dimensions do not match manifest',
    );
  });

  it.each([
    ['raw', 'succeeded'],
    ['normalized', 'succeeded'],
    ['overlay', 'succeeded'],
    ['error', 'failed'],
    ['snapshot', 'succeeded'],
  ] as const)('rejects a tampered %s artifact on initial load', async (kind, status) => {
    const runId = `tampered-${kind}`;
    const run = await writeRun(
      runId,
      'default',
      'f'.repeat(64),
      status,
    );
    const page = run.pages[0];
    const artifact = kind === 'snapshot'
      ? Object.values(run.sourceSnapshot.files)[0].snapshotPath
      : page.artifacts[kind]!;
    await writeFile(
      join(root, 'test-results/layout-benchmark/runs', runId, artifact),
      `tampered ${kind}\n`,
    );

    await expect(store.getRun(runId)).rejects.toThrow(
      /Integrity (?:checksum|size) mismatch/,
    );
  });

  it('rehashes a requested artifact even after the run has been cached', async () => {
    const run = await writeRun('cached-artifact');
    await store.resolveRunArtifact('cached-artifact', PAGE_KEY, 'overlay');
    await writeFile(
      join(
        root,
        'test-results/layout-benchmark/runs/cached-artifact',
        run.pages[0].artifacts.overlay!,
      ),
      'tampered overlay\n',
    );

    await expect(
      store.resolveRunArtifact('cached-artifact', PAGE_KEY, 'overlay'),
    ).rejects.toThrow(/Integrity (?:checksum|size) mismatch/);
  });

  it('rehashes normalized layout bytes before returning a cached parse', async () => {
    const run = await writeRun('cached-layout');
    await expect(
      store.getNormalizedLayout('cached-layout', PAGE_KEY),
    ).resolves.toMatchObject({ runId: 'cached-layout', pageKey: PAGE_KEY });
    await writeFile(
      join(
        root,
        'test-results/layout-benchmark/runs/cached-layout',
        run.pages[0].artifacts.normalized!,
      ),
      '{}\n',
    );

    await expect(
      store.getNormalizedLayout('cached-layout', PAGE_KEY),
    ).rejects.toThrow(/Integrity (?:checksum|size) mismatch/);
  });

  it('deep-validates normalized layouts during initial run loading', async () => {
    const run = await writeRun('invalid-normalized-layout');
    const runRoot = join(
      root,
      'test-results/layout-benchmark/runs/invalid-normalized-layout',
    );
    const normalizedPath = run.pages[0].artifacts.normalized!;
    const invalidBytes = Buffer.from('{}\n');
    await writeFile(join(runRoot, normalizedPath), invalidBytes);

    const manifestPath = join(runRoot, 'run.v2.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.integrity.artifacts[normalizedPath] = {
      sha256: checksum(invalidBytes),
      sizeBytes: invalidBytes.length,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(store.getRun('invalid-normalized-layout')).rejects.toThrow(
      'Normalized layout failed schema validation',
    );
  });

  it('rejects missing, unlisted, and uncovered physical files', async () => {
    const missing = await writeRun('missing-file');
    await rm(join(
      root,
      'test-results/layout-benchmark/runs/missing-file',
      missing.pages[0].artifacts.raw!,
    ));
    await expect(store.getRun('missing-file')).rejects.toThrow(
      'files do not exactly match',
    );

    await writeRun('extra-file');
    await writeFile(
      join(root, 'test-results/layout-benchmark/runs/extra-file/unlisted.json'),
      '{}\n',
    );
    await expect(store.getRun('extra-file')).rejects.toThrow(
      'files do not exactly match',
    );

    const uncovered = await writeRun('uncovered-file');
    const manifestPath = join(
      root,
      'test-results/layout-benchmark/runs/uncovered-file/run.v2.json',
    );
    delete uncovered.integrity.artifacts[uncovered.pages[0].artifacts.raw!];
    await writeFile(manifestPath, `${JSON.stringify(uncovered, null, 2)}\n`);
    await expect(store.getRun('uncovered-file')).rejects.toThrow(
      'Run manifest failed schema validation',
    );
  });

  it('rejects artifact symlinks that escape the immutable run root', async () => {
    await writeRun('unsafe-run');
    const outside = join(root, 'secret.png');
    await writeFile(outside, 'secret');
    const overlay = join(
      root,
      'test-results/layout-benchmark/runs/unsafe-run/pages',
      PAGE_KEY,
      'overlay.png',
    );
    await rm(overlay);
    await symlink(outside, overlay);

    await expect(
      store.resolveRunArtifact('unsafe-run', PAGE_KEY, 'overlay'),
    ).rejects.toBeInstanceOf(BenchmarkValidationError);
  });

  it('rejects artifact symlinks even when their target stays inside the run root', async () => {
    const run = await writeRun('internal-symlink');
    const runRoot = join(
      root,
      'test-results/layout-benchmark/runs/internal-symlink',
    );
    const raw = join(runRoot, run.pages[0].artifacts.raw!);
    await rm(raw);
    await symlink('overlay.png', raw);

    await expect(store.getRun('internal-symlink')).rejects.toThrow(
      'Symlink entry rejected',
    );
  });

  it('quarantines a run directory that is itself a symlink', async () => {
    await writeRun('real-run');
    const runsRoot = join(root, 'test-results/layout-benchmark/runs');
    await symlink(join(runsRoot, 'real-run'), join(runsRoot, 'linked-run'), 'dir');

    await expect(store.getRun('linked-run')).rejects.toThrow(
      'Symlink run directory rejected',
    );
    const listing = await store.listRuns();
    expect(listing.invalidRuns).toContainEqual(expect.objectContaining({
      directory: 'linked-run',
      error: 'Symlink run directory rejected',
    }));
  });

  it('atomically preserves concurrent decisions for different comparisons', async () => {
    await Promise.all([
      writeRun('run-a'),
      writeRun('run-b'),
      writeRun('run-c'),
    ]);

    await Promise.all([
      store.createEvaluationDecision('reviewer-1', PAGE_KEY, {
        leftRunId: 'run-a',
        rightRunId: 'run-b',
        preference: 'left',
        assessments: zeroAssessments,
        elapsedMs: 1_000,
      }),
      store.createEvaluationDecision('reviewer-1', PAGE_KEY, {
        leftRunId: 'run-a',
        rightRunId: 'run-c',
        preference: 'right',
        assessments: {
          left: { flags: [], repairs: zeroRepairs },
          right: { flags: ['false_line'], repairs: zeroRepairs },
        },
        elapsedMs: 2_000,
      }),
    ]);

    const evaluation = await store.getEvaluation('reviewer-1');
    const files = await readdir(join(root, 'test-results/layout-benchmark/evaluations'));
    expect(evaluation.decisions).toHaveLength(2);
    expect(files).toEqual(['reviewer-1.evaluation.v1.json']);
    expect(files.some((file) => file.endsWith('.tmp'))).toBe(false);
  });

  it('measures comparison progress against the comparable run intersection', async () => {
    await Promise.all([writeRun('run-a'), writeRun('run-b')]);
    const { evaluation } = await store.createEvaluationDecision(
      'reviewer-1',
      PAGE_KEY,
      {
        leftRunId: 'run-a',
        rightRunId: 'run-b',
        preference: 'left',
        assessments: zeroAssessments,
        elapsedMs: 1_000,
      },
    );

    const progress = await store.evaluationProgress(evaluation);

    expect(progress.comparisons[0]).toMatchObject({
      reviewedPages: 1,
      totalPages: 1,
      eligiblePages: 1,
      attemptedPages: 1,
      leftSelectedPages: 1,
      rightSelectedPages: 1,
      sharedSelectedPages: 1,
      sharedSucceededPages: 1,
      failedPages: 0,
      preparedMismatchPages: 0,
      percent: 100,
    });
  });

  it('requires positive review timing before persisting a verdict', async () => {
    await Promise.all([writeRun('run-a'), writeRun('run-b')]);

    await expect(store.createEvaluationDecision('reviewer-1', PAGE_KEY, {
      leftRunId: 'run-a',
      rightRunId: 'run-b',
      preference: 'left',
      assessments: zeroAssessments,
    })).rejects.toThrow('A positive timed review duration is required');
  });

  it('rejects human comparison writes across unequal prepared coordinate spaces', async () => {
    await Promise.all([
      writeRun('run-a'),
      writeRun('run-b', 'dark'),
    ]);

    await expect(store.createEvaluationDecision('reviewer-1', PAGE_KEY, {
      leftRunId: 'run-a',
      rightRunId: 'run-b',
      preference: 'neither',
      assessments: zeroAssessments,
    })).rejects.toBeInstanceOf(BenchmarkConflictError);
  });

  it('compares decoded RGB pixels when PNG encodings differ', async () => {
    const [left, right] = await Promise.all([
      writeRun('run-a', 'default', 'f'.repeat(64), 'succeeded', undefined, 0),
      writeRun('run-b', 'default', 'f'.repeat(64), 'succeeded', undefined, 9),
    ]);

    expect(left.pages[0].prepared!.sha256).not.toBe(
      right.pages[0].prepared!.sha256,
    );
    await expect(
      store.preparedRunPagesMatch('run-a', 'run-b', PAGE_KEY),
    ).resolves.toBe(true);
    await expect(store.createEvaluationDecision('reviewer-1', PAGE_KEY, {
      leftRunId: 'run-a',
      rightRunId: 'run-b',
      preference: 'tie',
      assessments: zeroAssessments,
      elapsedMs: 1_000,
    })).resolves.toMatchObject({
      decision: { preference: 'tie' },
    });
  });

  it('rejects human comparison writes across unequal preprocessing profiles', async () => {
    await Promise.all([
      writeRun('run-a'),
      writeRun('run-b', 'default', '0'.repeat(64)),
    ]);

    await expect(store.createEvaluationDecision('reviewer-1', PAGE_KEY, {
      leftRunId: 'run-a',
      rightRunId: 'run-b',
      preference: 'neither',
      assessments: zeroAssessments,
    })).rejects.toThrow('preprocessing profiles');
  });

  it('rejects human quality decisions for diagnostic-only run profiles', async () => {
    await Promise.all([
      writeRun('run-a'),
      writeRun('diagnostic-run', 'default', 'f'.repeat(64), 'succeeded', false),
    ]);

    await expect(store.createEvaluationDecision('reviewer-1', PAGE_KEY, {
      leftRunId: 'run-a',
      rightRunId: 'diagnostic-run',
      preference: 'left',
      assessments: zeroAssessments,
      elapsedMs: 1_000,
    })).rejects.toThrow(
      'Diagnostic engine profiles are inspectable but excluded from human quality ranking',
    );
  });

  it('excludes historical diagnostic-profile decisions from quality progress', async () => {
    await Promise.all([
      writeRun('run-a'),
      writeRun('diagnostic-run', 'default', 'f'.repeat(64), 'succeeded', false),
    ]);
    const now = '2026-07-28T12:00:00.000Z';
    const progress = await store.evaluationProgress({
      schemaVersion: 1,
      cohortId: 'test-cohort',
      reviewerId: 'reviewer-1',
      createdAt: now,
      updatedAt: now,
      decisions: [{
        pageKey: PAGE_KEY,
        comparisonKey: 'diagnostic-run__run-a',
        leftRunId: 'run-a',
        rightRunId: 'diagnostic-run',
        preference: 'left',
        assessments: zeroAssessments,
        elapsedMs: 1_000,
        reviewedAt: now,
        updatedAt: now,
      }],
    });

    expect(progress).toMatchObject({
      reviewedPages: 0,
      decisionCount: 0,
      excludedDecisionCount: 1,
      comparisons: [{
        eligiblePages: 0,
        reviewedPages: 0,
      }],
    });
  });

  it('keeps the first blind verdict immutable for each page and unordered run pair', async () => {
    await Promise.all([writeRun('run-a'), writeRun('run-b')]);
    const first = await store.createEvaluationDecision('reviewer-1', PAGE_KEY, {
      leftRunId: 'run-a',
      rightRunId: 'run-b',
      preference: 'left',
      assessments: zeroAssessments,
      elapsedMs: 1_000,
    });

    await expect(store.createEvaluationDecision('reviewer-1', PAGE_KEY, {
      leftRunId: 'run-b',
      rightRunId: 'run-a',
      preference: 'left',
      assessments: zeroAssessments,
      elapsedMs: 5_000,
    })).rejects.toThrow(
      'A verdict already exists for this page and run pair and is immutable',
    );

    const evaluation = await store.getEvaluation('reviewer-1');
    expect(evaluation.decisions).toEqual([first.decision]);
    expect(evaluation.decisions[0]).toMatchObject({
      leftRunId: 'run-a',
      rightRunId: 'run-b',
      preference: 'left',
      elapsedMs: 1_000,
    });
  });

  it('quarantines historical decisions when preprocessing profiles no longer match', async () => {
    await Promise.all([
      writeRun('run-a'),
      writeRun('run-b', 'default', '0'.repeat(64)),
    ]);
    const now = '2026-07-28T12:00:00.000Z';
    const evaluation = {
      schemaVersion: 1 as const,
      cohortId: 'test-cohort',
      reviewerId: 'reviewer-1',
      createdAt: now,
      updatedAt: now,
      decisions: [{
        pageKey: PAGE_KEY,
        comparisonKey: 'run-a__run-b',
        leftRunId: 'run-a',
        rightRunId: 'run-b',
        preference: 'left' as const,
        assessments: zeroAssessments,
        reviewedAt: now,
        updatedAt: now,
      }],
    };

    const progress = await store.evaluationProgress(evaluation);

    expect(progress).toMatchObject({
      reviewedPages: 0,
      decisionCount: 0,
      excludedDecisionCount: 1,
      comparisons: [{
        eligiblePages: 0,
        preprocessingProfileMismatchPages: 1,
        reviewedPages: 0,
      }],
    });
  });

  it('atomically stamps reviewer provenance on provider-neutral ground truth', async () => {
    const run = await writeRun('annotation-anchor');
    const update = makeAnnotationUpdate();
    update.image.sourceSha256 = sourceSha;
    update.image.preparedSha256 = run.pages[0].prepared!.sha256;

    const saved = await store.saveAnnotation(PAGE_KEY, 'reviewer-1', update);
    const loaded = await store.getAnnotation(PAGE_KEY);

    expect(saved.audit).toMatchObject({
      createdBy: 'reviewer-1',
      updatedBy: 'reviewer-1',
    });
    expect(loaded).toEqual(saved);
  });

  it('rejects ground truth that is not anchored to an immutable prepared artifact', async () => {
    await writeRun('annotation-anchor');
    const update = makeAnnotationUpdate();
    update.image.sourceSha256 = sourceSha;

    await expect(
      store.saveAnnotation(PAGE_KEY, 'reviewer-1', update),
    ).rejects.toThrow(
      'Annotation prepared coordinate space does not match a successful immutable run artifact',
    );
  });

  it('rejects annotations tied to a different source checksum', async () => {
    const update = makeAnnotationUpdate();

    await expect(
      store.saveAnnotation(PAGE_KEY, 'reviewer-1', update),
    ).rejects.toBeInstanceOf(BenchmarkConflictError);
  });
});

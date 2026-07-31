import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  annotationUpdateSchema,
  canonicalSourceSnapshotBundleBytes,
  cohortSchema,
  evaluationDecisionInputSchema,
  normalizedLayoutSchema,
  pageMaskInputStageSchema,
  runManifestSchema,
  safeRelativePathSchema,
  scorecardQuerySchema,
  sourceSnapshotBundleSha256,
} from '../schemas.js';
import {
  makeAnnotationUpdate,
  makeCohort,
  makeLayout,
  makeRun,
} from './test-fixtures.js';

describe('layout benchmark schemas', () => {
  it('validates the checked-in 66-page cohort and every filename identity', async () => {
    const raw = await readFile(
      new URL('../../../../benchmarks/layout/cohort.v1.json', import.meta.url),
      'utf8',
    );
    const cohort = cohortSchema.parse(JSON.parse(raw));

    expect(cohort.coverage).toMatchObject({
      letterCount: 14,
      pageCount: 66,
    });
    expect(cohort.coverage.collectionCodesAtSelection).toHaveLength(14);
  });

  it('rejects a filename whose page identity disagrees with its envelope', () => {
    const cohort = makeCohort();
    cohort.letters[0].pages[0].originalFilename = '001-18881103-L01-02.jpg';

    const result = cohortSchema.safeParse(cohort);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => (
      issue.message.includes('does not match its enclosing')
    ))).toBe(true);
  });

  it('rejects stale declared counts and unknown fields', () => {
    const wrongCount = {
      ...makeCohort(),
      coverage: { ...makeCohort().coverage, pageCount: 2 },
    };
    expect(cohortSchema.safeParse(wrongCount).success).toBe(false);
    expect(cohortSchema.safeParse({ ...makeCohort(), surprise: true }).success).toBe(false);
  });

  it.each([
    '../secret.json',
    'pages/../../secret.json',
    '/tmp/secret.json',
    'pages\\secret.json',
    'pages//secret.json',
  ])('rejects unsafe relative artifact path %s', (candidate) => {
    expect(safeRelativePathSchema.safeParse(candidate).success).toBe(false);
  });

  it('accepts a fully measured strict run and rejects divergent totals', () => {
    expect(runManifestSchema.parse(makeRun()).summary.succeeded).toBe(1);
    const invalid = makeRun();
    invalid.pages[0].timings.totalMs = 999;

    const result = runManifestSchema.safeParse(invalid);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => (
      issue.path.join('.') === 'pages.0.timings.totalMs'
    ))).toBe(true);
  });

  it('accepts nullable unattempted stages for failures while retaining a measured total', () => {
    const run = makeRun('failed-run', 'engine-a', { status: 'failed' });
    run.pages[0].timings.preparationMs = null;
    run.pages[0].timings.engineMs = null;
    run.pages[0].timings.normalizationMs = null;
    run.pages[0].timings.overlayMs = null;

    expect(runManifestSchema.parse(run).pages[0].timings).toMatchObject({
      preparationMs: null,
      engineMs: null,
      normalizationMs: null,
      overlayMs: null,
      totalMs: 1_000,
    });
  });

  it('requires every wall-clock stage timing for a succeeded page', () => {
    const run = makeRun();
    run.pages[0].timings.overlayMs = null;

    const result = runManifestSchema.safeParse(run);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(expect.objectContaining({
      path: ['pages', 0, 'timings', 'overlayMs'],
    }));
  });

  it('requires raw evidence on success and an error artifact on failure', () => {
    const succeededWithoutRaw = makeRun();
    const rawPath = succeededWithoutRaw.pages[0].artifacts.raw!;
    delete succeededWithoutRaw.pages[0].artifacts.raw;
    delete succeededWithoutRaw.integrity.artifacts[rawPath];

    const failedWithoutErrorArtifact = makeRun(
      'failed-without-error-artifact',
      'engine-a',
      { status: 'failed' },
    );
    const errorPath = failedWithoutErrorArtifact.pages[0].artifacts.error!;
    delete failedWithoutErrorArtifact.pages[0].artifacts.error;
    delete failedWithoutErrorArtifact.integrity.artifacts[errorPath];

    expect(runManifestSchema.safeParse(succeededWithoutRaw).success).toBe(false);
    expect(runManifestSchema.safeParse(failedWithoutErrorArtifact).success).toBe(false);
  });

  it('binds page-mask input artifacts as an exact triplet with measured timing', () => {
    const run = makeRun();
    const prefix = `pages/${run.pages[0].pageKey}`;
    run.pages[0].artifacts.pageMask = `${prefix}/page-mask.png`;
    run.pages[0].artifacts.engineInput = `${prefix}/engine-input.png`;
    run.pages[0].artifacts.inputStage = `${prefix}/input-stage.v1.json`;
    run.pages[0].timings.inputStageMs = 42;
    for (const artifact of [
      run.pages[0].artifacts.pageMask,
      run.pages[0].artifacts.engineInput,
      run.pages[0].artifacts.inputStage,
    ]) {
      run.integrity.artifacts[artifact] = {
        sha256: '8'.repeat(64),
        sizeBytes: 42,
      };
    }

    expect(runManifestSchema.parse(run).pages[0].timings.inputStageMs).toBe(42);

    delete run.integrity.artifacts[run.pages[0].artifacts.engineInput];
    delete run.pages[0].artifacts.engineInput;
    expect(runManifestSchema.safeParse(run).success).toBe(false);
  });

  it('validates the page-mask provenance fields that bind both PNG artifacts', () => {
    const artifact = {
      format: 'PNG',
      mode: 'L',
      width: 100,
      height: 200,
      sha256: '8'.repeat(64),
      sizeBytes: 42,
      rasterFingerprint: {
        algorithm: 'sha256-l8-v1',
        sha256: '7'.repeat(64),
      },
    };
    const provenance = {
      schemaVersion: 1,
      stage: 'source-bound-page-mask-to-kraken-input',
      coordinateTransform: {
        name: 'identity',
        coordinateSpace: 'prepared-pixels-top-left',
        width: 100,
        height: 200,
      },
      includeMask: { artifact },
      engineInput: {
        artifact: {
          ...artifact,
          mode: 'RGB',
          rasterFingerprint: {
            algorithm: 'sha256-rgb8-v1',
            sha256: '6'.repeat(64),
          },
        },
      },
    };

    expect(pageMaskInputStageSchema.safeParse(provenance).success).toBe(true);
    expect(pageMaskInputStageSchema.safeParse({
      ...provenance,
      engineInput: {
        artifact: {
          ...provenance.engineInput.artifact,
          sha256: 'not-a-checksum',
        },
      },
    }).success).toBe(false);
  });

  it('requires the source snapshot to contain the declared run inputs', () => {
    expect(runManifestSchema.safeParse(makeRun()).success).toBe(true);

    const missingRunner = makeRun();
    const runnerPath = 'python/layout_benchmark/runner.py';
    const runnerSnapshot = missingRunner.sourceSnapshot.files[runnerPath];
    delete missingRunner.sourceSnapshot.files[runnerPath];
    delete missingRunner.integrity.artifacts[runnerSnapshot.snapshotPath];
    missingRunner.sourceSnapshot.bundleSha256 = sourceSnapshotBundleSha256(
      missingRunner.sourceSnapshot.files,
    );

    const unboundCohort = makeRun();
    unboundCohort.cohort.sha256 = '9'.repeat(64);

    const unsnapshottedEngineConfig = makeRun();
    unsnapshottedEngineConfig.engine.configuration.path = (
      'benchmarks/layout/config/undeclared.json'
    );

    const unsnapshottedPreprocessing = makeRun();
    unsnapshottedPreprocessing.preprocessing.path = (
      'benchmarks/layout/engine-configs/undeclared-preprocessing.json'
    );

    expect(runManifestSchema.safeParse(missingRunner).success).toBe(false);
    expect(runManifestSchema.safeParse(unboundCohort).success).toBe(false);
    expect(runManifestSchema.safeParse(unsnapshottedEngineConfig).success).toBe(false);
    expect(runManifestSchema.safeParse(unsnapshottedPreprocessing).success).toBe(false);
  });

  it('hashes canonical source bundles with sorted keys and one trailing newline', () => {
    const files = {
      'python/z.py': { sha256: 'b'.repeat(64) },
      'python/a.py': { sha256: 'a'.repeat(64) },
    };
    const canonical = canonicalSourceSnapshotBundleBytes(files);
    const withoutNewline = canonical.subarray(0, canonical.length - 1);

    expect(canonical.toString('utf8')).toBe(
      `{"python/a.py":"${'a'.repeat(64)}","python/z.py":"${'b'.repeat(64)}"}\n`,
    );
    expect(sourceSnapshotBundleSha256(files)).toBe(
      createHash('sha256').update(canonical).digest('hex'),
    );
    expect(sourceSnapshotBundleSha256(files)).not.toBe(
      createHash('sha256').update(withoutNewline).digest('hex'),
    );
  });

  it('sorts canonical source keys by Unicode code point like Python', () => {
    const files = {
      'python/😀.py': { sha256: 'b'.repeat(64) },
      'python/\uE000.py': { sha256: 'a'.repeat(64) },
    };

    expect(canonicalSourceSnapshotBundleBytes(files).toString('utf8')).toBe(
      `{"python/\uE000.py":"${'a'.repeat(64)}","python/😀.py":"${'b'.repeat(64)}"}\n`,
    );
  });

  it('requires exact integrity coverage and source snapshot path identity', () => {
    const missingCoverage = makeRun();
    delete missingCoverage.integrity.artifacts[
      missingCoverage.pages[0].artifacts.raw!
    ];
    expect(runManifestSchema.safeParse(missingCoverage).success).toBe(false);

    const extraCoverage = makeRun();
    extraCoverage.integrity.artifacts['pages/unreferenced.json'] = {
      sha256: '9'.repeat(64),
      sizeBytes: 1,
    };
    expect(runManifestSchema.safeParse(extraCoverage).success).toBe(false);

    const wrongSnapshotPath = makeRun();
    const [originalPath, snapshot] = Object.entries(
      wrongSnapshotPath.sourceSnapshot.files,
    )[0];
    snapshot.snapshotPath = `source-snapshot/not-${originalPath}`;
    expect(runManifestSchema.safeParse(wrongSnapshotPath).success).toBe(false);
  });

  it('treats source snapshots as benchmark code/config, independent of page images', () => {
    const run = makeRun();

    expect(run.sourceSnapshot.files['python/layout_benchmark/runner.py']).toBeDefined();
    expect(run.sourceSnapshot.files[run.pages[0].source.relativePath]).toBeUndefined();
    expect(runManifestSchema.safeParse(run).success).toBe(true);
  });

  it('conditionally freezes raster evaluator code without invalidating legacy v2 runs', () => {
    const rasterSourcePath = 'src/benchmarks/layout/raster-fingerprint.ts';
    const removeRasterSource = (run: ReturnType<typeof makeRun>) => {
      const snapshot = run.sourceSnapshot.files[rasterSourcePath];
      delete run.sourceSnapshot.files[rasterSourcePath];
      delete run.integrity.artifacts[snapshot.snapshotPath];
      run.sourceSnapshot.bundleSha256 = sourceSnapshotBundleSha256(
        run.sourceSnapshot.files,
      );
    };

    const modern = makeRun();
    removeRasterSource(modern);
    expect(runManifestSchema.safeParse(modern).success).toBe(false);

    const legacy = makeRun();
    delete legacy.pages[0].prepared!.rasterFingerprint;
    removeRasterSource(legacy);
    expect(runManifestSchema.safeParse(legacy).success).toBe(true);
  });

  it('rejects cross-references and points outside the prepared image', () => {
    const badReference = makeLayout();
    badReference.regions[0].lineIds = ['missing'];
    expect(normalizedLayoutSchema.safeParse(badReference).success).toBe(false);

    const outside = makeLayout();
    outside.lines[0].boundary[0].x = 101;
    expect(normalizedLayoutSchema.safeParse(outside).success).toBe(false);
  });

  it('validates provider-neutral annotations against the same geometry invariants', () => {
    expect(annotationUpdateSchema.safeParse(makeAnnotationUpdate()).success).toBe(true);
    const invalid = makeAnnotationUpdate();
    invalid.lines[0].regionId = 'missing';
    expect(annotationUpdateSchema.safeParse(invalid).success).toBe(false);
  });

  it('requires measurable repair totals and distinct run IDs', () => {
    const base = {
      leftRunId: 'run-a',
      rightRunId: 'run-b',
      preference: 'left' as const,
      assessments: {
        left: {
          flags: [],
          repairs: {
            missedLinesAdded: 0,
            falseLinesRemoved: 0,
            splitLinesJoined: 0,
            mergedLinesSplit: 0,
            orientationCorrections: 0,
            readingOrderCorrections: 0,
            regionCorrections: 0,
            other: 0,
            total: 0,
          },
        },
        right: {
          flags: ['missed_line'],
          repairs: {
            missedLinesAdded: 1,
            falseLinesRemoved: 0,
            splitLinesJoined: 0,
            mergedLinesSplit: 0,
            orientationCorrections: 0,
            readingOrderCorrections: 0,
            regionCorrections: 0,
            other: 0,
            total: 1,
          },
        },
      },
      elapsedMs: 5_000,
    };
    expect(evaluationDecisionInputSchema.safeParse(base).success).toBe(true);
    expect(evaluationDecisionInputSchema.safeParse({
      ...base,
      rightRunId: 'run-a',
    }).success).toBe(false);
    expect(evaluationDecisionInputSchema.safeParse({
      ...base,
      assessments: {
        ...base.assessments,
        right: {
          ...base.assessments.right,
          repairs: { ...base.assessments.right.repairs, total: 0 },
        },
      },
    }).success).toBe(false);
    expect(evaluationDecisionInputSchema.safeParse({
      ...base,
      elapsedMs: undefined,
    }).success).toBe(false);
  });

  it('caps scorecard requests at four runs to bound pairwise work', () => {
    expect(scorecardQuerySchema.parse({
      runIds: 'run-a,run-b,run-c,run-d',
    }).runIds).toEqual(['run-a', 'run-b', 'run-c', 'run-d']);
    expect(scorecardQuerySchema.safeParse({
      runIds: 'run-a,run-b,run-c,run-d,run-e',
    }).success).toBe(false);
  });
});

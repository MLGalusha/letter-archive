import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const pipelineDefinitions = new Set([
  'pipeline/metadataV2.ts',
  'pipeline/processor.ts',
  'pipeline/transcription.ts',
  'services/letter/extra-content.ts',
  'services/letter/regeneration.ts',
]);

const allowedExecutionOwners = new Set([
  'routes/admin/letters/content.ts',
  'services/worker-processing-cycle.ts',
]);

const allowedDirectRunningWriters = new Set([
  'routes/admin/letters/content.ts',
  'services/letter/entity-extraction-job.ts',
  'services/letter/extra-content-job.ts',
  'services/letter/metadata-job.ts',
  'services/letter/transcription-job.ts',
  'services/letters.ts',
]);

const allowedRecoveryCallers = new Set([
  'index.ts',
  'worker.ts',
]);

const allowedExpiredTranscriptionRecoveryCallers = new Set([
  'services/processing-queue.ts',
]);

const allowedExpiredExtraContentRecoveryCallers = new Set([
  'services/processing-queue.ts',
]);

const allowedExpiredMetadataRecoveryCallers = new Set([
  'services/processing-queue.ts',
]);

const allowedExpiredEntityExtractionRecoveryCallers = new Set([
  'services/processing-queue.ts',
]);

const allowedTranscribeImageCallers = new Set([
  'ai/openai/transcription.ts',
  'pipeline/transcription.ts',
]);

const allowedTranscribeExtraContentCallers = new Set([
  'ai/openai/transcription.ts',
  'pipeline/transcription.ts',
  'services/letter/extra-content.ts',
]);

const canonicalTranscriptionClaimOwner = 'services/letter/transcription-job.ts';
const canonicalExtraContentClaimOwner = 'services/letter/extra-content-job.ts';
const canonicalMetadataClaimOwner = 'services/letter/metadata-job.ts';
const canonicalEntityExtractionClaimOwner =
  'services/letter/entity-extraction-job.ts';

const allowedEntityExtractionStatusWriters = new Set([
  canonicalEntityExtractionClaimOwner,
  'services/entities/extraction.ts',
  'services/letter/bulk-operations.ts',
  'services/letter/metadata-job.ts',
  'services/letters.ts',
  'services/processing-queue.ts',
]);

const executionCall = /\b(?:processLetter|processMetadata|runTranscription|runRequestedTranscription|runMetadataExtractionV2|runEntityExtractionOnly|tryTranscribeExtras|regenerateTranscription|transcribeLetterOnly|transcribeExtras|processLettersAsync|startBatch)\s*\(|\.runBatch\s*\(/;

async function productionTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return productionTypeScriptFiles(absolutePath);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [absolutePath] : [];
  }));
  return files.flat();
}

describe('processing execution ownership', () => {
  it('keeps the retired API in-process executor deleted', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const retiredOwners: string[] = [];
    const retiredSymbols = new RegExp(
      String.raw`\b(?:processLettersAsync|getProcessingStatus|resetProcessingState`
      + String.raw`|startBatch|runLetterBatch|shouldAbortProcessing`
      + String.raw`|updateJobProgress|getJobProgress`
      + String.raw`|startTranscriptionProcessing|startMetadataProcessing`
      + String.raw`|startEntityExtractionProcessing|initProcessingStreamBroadcaster`
      + String.raw`|issueProcessingStreamToken)\b`,
    );

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (retiredSymbols.test(await readFile(absolutePath, 'utf8'))) {
        retiredOwners.push(relativePath);
      }
    }

    expect(retiredOwners.sort()).toEqual([]);
  });

  it('keeps the API lease reconciler until the scheduled handoff is proven', async () => {
    const api = await readFile(path.join(sourceRoot, 'index.ts'), 'utf8');

    expect(api).toContain('recoverExpiredProcessingJobs');
    expect(api).toContain(
      "ensureBackgroundWorkerForQueuedProcessing('api-lease-recovery')",
    );
    expect(api).toContain('apiLeaseRecovery.start()');
    expect(api).toContain('apiLeaseRecovery.stopAndWait()');
  });

  it('keeps processing-queue as durable queue orchestration, not a pipeline executor', async () => {
    const processingQueue = await readFile(
      path.join(sourceRoot, 'services/processing-queue.ts'),
      'utf8',
    );

    expect(processingQueue).not.toMatch(
      /from ['"]\.\.\/pipeline\/(?:processor|metadataV2)\.js['"]/,
    );
    expect(processingQueue).not.toMatch(/\bprocessLettersAsync\b/);
  });

  it('keeps the worker exit handoff trigger configured in its deployment', async () => {
    const workerJob = await readFile(
      path.join(repositoryRoot, 'deploy/cloudrun/backend-worker-job.yaml'),
      'utf8',
    );

    expect(workerJob).toMatch(/name:\s*CLOUD_RUN_REGION/);
    expect(workerJob).toMatch(/name:\s*CLOUD_RUN_WORKER_JOB_NAME/);
  });

  it('keeps scheduled worker reconciliation authenticated and ordered after invoker grants', async () => {
    const cloudBuild = await readFile(
      path.join(repositoryRoot, 'cloudbuild.yaml'),
      'utf8',
    );
    const backendGrant = cloudBuild.indexOf('id: grant-backend-worker-job-invoke');
    const schedulerGrant = cloudBuild.indexOf(
      'id: grant-scheduler-worker-job-invoke',
    );
    const scheduleStep = cloudBuild.indexOf(
      'id: configure-worker-reconciliation-schedule',
    );

    expect(cloudBuild).toContain(
      "_SCHEDULER_SERVICE_ACCOUNT: 'letter-archive-scheduler@${PROJECT_ID}.iam.gserviceaccount.com'",
    );
    expect(cloudBuild).toContain(
      "_WORKER_RECONCILIATION_SCHEDULE: '*/5 * * * *'",
    );
    expect(cloudBuild).toContain(
      "_ENABLE_WORKER_RECONCILIATION_SCHEDULE: 'false'",
    );
    expect(backendGrant).toBeGreaterThan(-1);
    expect(schedulerGrant).toBeGreaterThan(backendGrant);
    expect(scheduleStep).toBeGreaterThan(schedulerGrant);

    expect(cloudBuild.slice(backendGrant, schedulerGrant)).toContain(
      '--member=serviceAccount:${_SERVICE_ACCOUNT}',
    );
    expect(cloudBuild.slice(backendGrant, schedulerGrant)).toContain(
      '--role=roles/run.invoker',
    );
    expect(cloudBuild.slice(schedulerGrant, scheduleStep)).toContain(
      '--member="serviceAccount:${_SCHEDULER_SERVICE_ACCOUNT}"',
    );
    expect(cloudBuild.slice(schedulerGrant, scheduleStep)).toContain(
      '--role=roles/run.invoker',
    );
    expect(cloudBuild.slice(schedulerGrant, scheduleStep)).toContain(
      'if [[ "${_ENABLE_WORKER_RECONCILIATION_SCHEDULE}" != "true" ]]',
    );
    expect(cloudBuild.slice(schedulerGrant, scheduleStep)).toContain(
      "waitFor: ['grant-backend-worker-job-invoke']",
    );

    const scheduleContract = cloudBuild.slice(scheduleStep);
    expect(scheduleContract).toContain(
      "waitFor: ['grant-scheduler-worker-job-invoke']",
    );
    expect(scheduleContract).toContain(
      'if [[ "${_ENABLE_WORKER_RECONCILIATION_SCHEDULE}" != "true" ]]',
    );
    expect(scheduleContract).toContain(
      'gcloud scheduler jobs "$${scheduler_action}" http',
    );
    expect(scheduleContract).toContain(
      'gcloud scheduler jobs describe letter-archive-worker-reconcile',
    );
    expect(scheduleContract).toContain(
      '--schedule="${_WORKER_RECONCILIATION_SCHEDULE}"',
    );
    expect(scheduleContract).toContain('--time-zone=Etc/UTC');
    expect(scheduleContract).toContain(
      '--uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${_REGION}/jobs/letter-archive-worker:run"',
    );
    expect(scheduleContract).toContain(
      '--oauth-service-account-email="${_SCHEDULER_SERVICE_ACCOUNT}"',
    );
    expect(scheduleContract).toContain(
      '--oauth-token-scope=https://www.googleapis.com/auth/cloud-platform',
    );
    expect(scheduleContract).not.toContain('--oidc-service-account-email');
    expect(scheduleContract).toContain('--http-method=POST');
    expect(scheduleContract).toContain('--max-retry-attempts=0');
    expect(scheduleContract).toContain('--max-retry-duration=0s');
  });

  it('keeps dirty queued extra-content work in worker exit recovery', async () => {
    const worker = await readFile(path.join(sourceRoot, 'worker.ts'), 'utf8');

    expect(worker).toMatch(
      /extraContentJobStatus,\s*'RUNNING'[\s\S]*?isNotNull\(letters\.extraContentJobClaimKind\)[\s\S]*?extraContentJobClaimKind,\s*'QUEUED'[\s\S]*?extraContentJobDirty,\s*true/,
    );
  });

  it('allows existing execution owners to be deleted but not silently multiplied', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedOwners: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (pipelineDefinitions.has(relativePath)) continue;
      if (
        executionCall.test(await readFile(absolutePath, 'utf8')) &&
        !allowedExecutionOwners.has(relativePath)
      ) {
        unexpectedOwners.push(relativePath);
      }
    }

    expect(unexpectedOwners.sort()).toEqual([]);
  });

  it('allows direct RUNNING writers to be removed but not silently multiplied', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const directRunningWrite = /(?:(?:transcriptionStatus|metadataStatus|entityExtractionStatus|extraContentJobStatus)|\[[A-Za-z_$][\w$]*\])\s*:\s*['"]RUNNING['"]/;
    const unexpectedWriters: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (
        directRunningWrite.test(await readFile(absolutePath, 'utf8')) &&
        !allowedDirectRunningWriters.has(relativePath)
      ) {
        unexpectedWriters.push(relativePath);
      }
    }

    expect(unexpectedWriters.sort()).toEqual([]);
  });

  it('keeps the ambiguous generic claimJob boundary deleted', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const genericClaimOwners: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (/\bclaimJob\s*\(/.test(await readFile(absolutePath, 'utf8'))) {
        genericClaimOwners.push(relativePath);
      }
    }

    expect(genericClaimOwners.sort()).toEqual([]);
  });

  it('keeps raw transcription AI calls inside canonical producers', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedImageCallers: string[] = [];
    const unexpectedExtraContentCallers: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      const source = await readFile(absolutePath, 'utf8');
      if (
        /\btranscribeImage\s*\(/.test(source) &&
        !allowedTranscribeImageCallers.has(relativePath)
      ) {
        unexpectedImageCallers.push(relativePath);
      }
      if (
        /\btranscribeExtraContent\s*\(/.test(source) &&
        !allowedTranscribeExtraContentCallers.has(relativePath)
      ) {
        unexpectedExtraContentCallers.push(relativePath);
      }
    }

    expect(unexpectedImageCallers.sort()).toEqual([]);
    expect(unexpectedExtraContentCallers.sort()).toEqual([]);
  });

  it('keeps main-transcription RUNNING transitions inside the claim owner', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedWriters: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (
        /\btranscriptionStatus\s*:\s*['"]RUNNING['"]/.test(
          await readFile(absolutePath, 'utf8'),
        )
        && relativePath !== canonicalTranscriptionClaimOwner
      ) {
        unexpectedWriters.push(relativePath);
      }
    }

    expect(unexpectedWriters.sort()).toEqual([]);
  });

  it('keeps metadata RUNNING transitions inside the claim owner', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedWriters: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (
        /\bmetadataStatus\s*:\s*['"]RUNNING['"]/.test(
          await readFile(absolutePath, 'utf8'),
        )
        && relativePath !== canonicalMetadataClaimOwner
      ) {
        unexpectedWriters.push(relativePath);
      }
    }

    expect(unexpectedWriters.sort()).toEqual([]);
  });

  it('keeps entity-extraction RUNNING transitions inside the claim owner', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedWriters: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (
        /\bentityExtractionStatus\s*:\s*['"]RUNNING['"]/.test(
          await readFile(absolutePath, 'utf8'),
        )
        && relativePath !== canonicalEntityExtractionClaimOwner
      ) {
        unexpectedWriters.push(relativePath);
      }
    }

    expect(unexpectedWriters.sort()).toEqual([]);
  });

  it('keeps entity and extra-content producer claims mutually exclusive', async () => {
    const [entityOwner, extraContentOwner, eligibility] = await Promise.all([
      readFile(
        path.join(sourceRoot, canonicalEntityExtractionClaimOwner),
        'utf8',
      ),
      readFile(
        path.join(sourceRoot, canonicalExtraContentClaimOwner),
        'utf8',
      ),
      readFile(
        path.join(sourceRoot, 'services/processing-eligibility.ts'),
        'utf8',
      ),
    ]);

    expect(entityOwner).toMatch(
      /observedEntityExtractionStateConditions[\s\S]*eq\(letters\.extraContentJobStatus, observed\.extraContentJobStatus\)/,
    );
    expect(extraContentOwner).toMatch(
      /eq\(letters\.extraContentJobStatus, expectedStatus\),[\s\S]*ne\(letters\.entityExtractionStatus, 'RUNNING'\)/,
    );
    expect(eligibility).toMatch(
      /entityExtractionPrerequisiteConditions[\s\S]*ne\(letters\.extraContentJobStatus, 'RUNNING'\)/,
    );
    expect(eligibility).toMatch(
      /queuedExtraContentConditions[\s\S]*ne\(letters\.entityExtractionStatus, 'RUNNING'\)/,
    );
  });

  it('keeps non-null metadata run-token writes inside the claim owner', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedWriters: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === 'db/schema.ts' || relativePath === canonicalMetadataClaimOwner) {
        continue;
      }
      const source = await readFile(absolutePath, 'utf8');
      const writesRunId = [...source.matchAll(
        /\bmetadataRunId\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      const writesLease = [...source.matchAll(
        /\bmetadataLeaseExpiresAt\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      const writesLeaseRunId = [...source.matchAll(
        /\bmetadataLeaseRunId\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      const writesClaimKind = [...source.matchAll(
        /\bmetadataClaimKind\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      if (writesRunId || writesLease || writesLeaseRunId || writesClaimKind) {
        unexpectedWriters.push(relativePath);
      }
    }

    expect(unexpectedWriters.sort()).toEqual([]);
  });

  it('keeps non-null entity-extraction ownership writes inside the claim owner', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedWriters: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (
        relativePath === 'db/schema.ts'
        || relativePath === canonicalEntityExtractionClaimOwner
      ) {
        continue;
      }
      const source = await readFile(absolutePath, 'utf8');
      const writesRunId = [...source.matchAll(
        /\bentityExtractionRunId\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      const writesRunRevision = [...source.matchAll(
        /\bentityExtractionRunRevision\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      const writesLease = [...source.matchAll(
        /\bentityExtractionLeaseExpiresAt\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      const writesLeaseRunId = [...source.matchAll(
        /\bentityExtractionLeaseRunId\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      const writesClaimKind = [...source.matchAll(
        /\bentityExtractionClaimKind\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      if (
        writesRunId
        || writesRunRevision
        || writesLease
        || writesLeaseRunId
        || writesClaimKind
      ) {
        unexpectedWriters.push(relativePath);
      }
    }

    expect(unexpectedWriters.sort()).toEqual([]);
  });

  it('keeps every entity status writer on the complete ownership-clear boundary', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedWriters: string[] = [];
    const incompleteWriters: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      const source = await readFile(absolutePath, 'utf8');
      if (
        !/\bentityExtractionStatus\s*:\s*(?:['"]|sql)/.test(source)
      ) {
        continue;
      }
      if (!allowedEntityExtractionStatusWriters.has(relativePath)) {
        unexpectedWriters.push(relativePath);
      } else if (
        relativePath !== canonicalEntityExtractionClaimOwner
        && !source.includes('clearedEntityExtractionOwnership')
      ) {
        incompleteWriters.push(relativePath);
      }
    }

    expect(unexpectedWriters.sort()).toEqual([]);
    expect(incompleteWriters.sort()).toEqual([]);
  });

  it('keeps non-null transcription lease writes inside the claim owner', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedWriters: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === 'db/schema.ts' || relativePath === canonicalTranscriptionClaimOwner) {
        continue;
      }
      const source = await readFile(absolutePath, 'utf8');
      const writesLease = [...source.matchAll(
        /\btranscriptionLeaseExpiresAt\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      const writesClaimKind = [...source.matchAll(
        /\btranscriptionClaimKind\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      const writesLeaseRunId = [...source.matchAll(
        /\btranscriptionLeaseRunId\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      if (writesLease || writesLeaseRunId || writesClaimKind) {
        unexpectedWriters.push(relativePath);
      }
    }

    expect(unexpectedWriters.sort()).toEqual([]);
  });

  it('allows expired transcription recovery callers to be removed but not multiplied', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedCallers: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === canonicalTranscriptionClaimOwner) continue;
      if (
        /\brecoverExpiredTranscriptions\s*\(/.test(await readFile(absolutePath, 'utf8'))
        && !allowedExpiredTranscriptionRecoveryCallers.has(relativePath)
      ) {
        unexpectedCallers.push(relativePath);
      }
    }

    expect(unexpectedCallers.sort()).toEqual([]);
  });

  it('allows expired extra-content recovery callers to be removed but not multiplied', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedCallers: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === canonicalExtraContentClaimOwner) continue;
      if (
        /\brecoverExpiredExtraContentJobs\s*\(/.test(
          await readFile(absolutePath, 'utf8'),
        ) && !allowedExpiredExtraContentRecoveryCallers.has(relativePath)
      ) {
        unexpectedCallers.push(relativePath);
      }
    }

    expect(unexpectedCallers.sort()).toEqual([]);
  });

  it('allows expired metadata recovery callers to be removed but not multiplied', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedCallers: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === canonicalMetadataClaimOwner) continue;
      if (
        /\brecoverExpiredMetadataJobs\s*\(/.test(
          await readFile(absolutePath, 'utf8'),
        ) && !allowedExpiredMetadataRecoveryCallers.has(relativePath)
      ) {
        unexpectedCallers.push(relativePath);
      }
    }

    expect(unexpectedCallers.sort()).toEqual([]);
  });

  it('allows expired entity-extraction recovery callers to be removed but not multiplied', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedCallers: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === canonicalEntityExtractionClaimOwner) continue;
      if (
        /\brecoverExpiredEntityExtractionJobs\s*\(/.test(
          await readFile(absolutePath, 'utf8'),
        )
        && !allowedExpiredEntityExtractionRecoveryCallers.has(relativePath)
      ) {
        unexpectedCallers.push(relativePath);
      }
    }

    expect(unexpectedCallers.sort()).toEqual([]);
  });

  it('allows startup lease-recovery callers to be removed but not silently multiplied', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedCallers: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === 'services/processing-queue.ts') continue;
      if (
        /\brecoverExpiredProcessingJobs\s*\(/.test(
          await readFile(absolutePath, 'utf8'),
        ) &&
        !allowedRecoveryCallers.has(relativePath)
      ) {
        unexpectedCallers.push(relativePath);
      }
    }

    expect(unexpectedCallers.sort()).toEqual([]);
  });

  it('keeps rolling-deploy cross-stage exclusion in schema and migration', async () => {
    const schema = await readFile(path.join(sourceRoot, 'db/schema.ts'), 'utf8');
    const migration = await readFile(
      path.join(sourceRoot, 'db/migrations/0047_add_transcription_leases.sql'),
      'utf8',
    );

    expect(schema).toContain('transcription_excludes_downstream_running');
    expect(migration).toMatch(
      /ADD CONSTRAINT "transcription_excludes_downstream_running"[\s\S]*NOT VALID/,
    );
  });

  it('keeps main-transcription lease binding nullable, unbackfilled, and canonical', async () => {
    const schema = await readFile(path.join(sourceRoot, 'db/schema.ts'), 'utf8');
    const migration = await readFile(
      path.join(sourceRoot, 'db/migrations/0049_bind_transcription_leases_to_runs.sql'),
      'utf8',
    );
    const worker = await readFile(path.join(sourceRoot, 'worker.ts'), 'utf8');

    expect(schema).toContain("transcriptionLeaseRunId: uuid('transcription_lease_run_id')");
    expect(migration).toContain(
      'ALTER TABLE "letters" ADD COLUMN "transcription_lease_run_id" uuid',
    );
    expect(migration).not.toMatch(/\bUPDATE\s+"letters"/i);
    expect(migration).not.toMatch(/ADD CONSTRAINT/i);
    expect(worker).toMatch(
      /isNotNull\(letters\.transcriptionLeaseRunId\)[\s\S]*eq\(letters\.transcriptionLeaseRunId, letters\.transcriptionRunId\)/,
    );
  });

  it('keeps metadata ownership revision-bound and rolling-deploy compatible', async () => {
    const schema = await readFile(path.join(sourceRoot, 'db/schema.ts'), 'utf8');
    const migration = await readFile(
      path.join(sourceRoot, 'db/migrations/0050_add_metadata_job_ownership.sql'),
      'utf8',
    );

    expect(schema).toContain("metadataRevision: integer('metadata_revision')");
    expect(schema).toContain("metadataRunId: uuid('metadata_run_id')");
    expect(schema).toContain("metadataRunRevision: integer('metadata_run_revision')");
    expect(schema).toMatch(
      /metadataLeaseExpiresAt: timestamp\('metadata_lease_expires_at', \{[\s\S]*?precision: 3,[\s\S]*?\}\)/,
    );
    expect(schema).toContain("metadataLeaseRunId: uuid('metadata_lease_run_id')");
    expect(schema).toContain("metadataClaimKind: metadataClaimKindEnum('metadata_claim_kind')");
    expect(schema).toContain('metadata_revision_nonnegative');
    expect(schema).toContain('metadata_owner_shape');
    expect(schema).toMatch(
      /\$\{table\.metadataRunRevision\} = \$\{table\.metadataRevision\}/,
    );

    expect(migration).toContain(
      'ALTER TABLE "letters" ADD COLUMN "metadata_revision" integer DEFAULT 0 NOT NULL',
    );
    expect(migration).toContain(
      'ALTER TABLE "letters" ADD COLUMN "metadata_run_id" uuid',
    );
    expect(migration).toContain(
      'ALTER TABLE "letters" ADD COLUMN "metadata_run_revision" integer',
    );
    expect(migration).toContain(
      'ALTER TABLE "letters" ADD COLUMN "metadata_lease_expires_at" timestamp(3) with time zone',
    );
    expect(migration).toContain(
      'ALTER TABLE "letters" ADD COLUMN "metadata_lease_run_id" uuid',
    );
    expect(migration).toContain(
      'ALTER TABLE "letters" ADD COLUMN "metadata_claim_kind" "metadata_claim_kind"',
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "metadata_revision_nonnegative"\s+CHECK \("metadata_revision" >= 0\) NOT VALID/,
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "metadata_owner_shape"[\s\S]*?"metadata_run_id" IS NULL[\s\S]*?"metadata_run_revision" IS NULL[\s\S]*?"metadata_lease_expires_at" IS NULL[\s\S]*?"metadata_lease_run_id" IS NULL[\s\S]*?"metadata_claim_kind" IS NULL[\s\S]*?OR \([\s\S]*?"metadata_status" = 'RUNNING'[\s\S]*?"metadata_run_id" IS NOT NULL[\s\S]*?"metadata_run_revision" IS NOT NULL[\s\S]*?"metadata_run_revision" = "metadata_revision"[\s\S]*?"metadata_lease_expires_at" IS NOT NULL[\s\S]*?"metadata_lease_run_id" = "metadata_run_id"[\s\S]*?"metadata_claim_kind" IS NOT NULL[\s\S]*?\) NOT VALID/,
    );
    expect(migration).toMatch(
      /IF NEW\.metadata_status = 'RUNNING'[\s\S]*TG_OP = 'INSERT' OR OLD\.metadata_status <> 'RUNNING'[\s\S]*NEW\.metadata_run_id IS NULL THEN/,
    );
    expect(migration).toMatch(
      /OLD\.metadata_status = 'RUNNING'[\s\S]*OLD\.metadata_run_id IS NOT NULL[\s\S]*NEW\.metadata_status <> 'RUNNING'[\s\S]*NEW\.metadata_revision = OLD\.metadata_revision \+ 1/,
    );
    expect(migration).toMatch(
      /OLD\.metadata_status <> 'RUNNING'[\s\S]*NEW\.metadata_status <> 'RUNNING'[\s\S]*NEW\.metadata_status <> OLD\.metadata_status[\s\S]*NEW\.metadata_revision = OLD\.metadata_revision \+ 1/,
    );
    expect(migration).toMatch(
      /OLD\.metadata_status = 'SUCCESS'[\s\S]*NEW\.metadata_status = 'SUCCESS'[\s\S]*NEW\.metadata_revision <> OLD\.metadata_revision \+ 1/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER metadata_status_transition_guard[\s\S]*BEFORE INSERT OR UPDATE OF[\s\S]*metadata_status,[\s\S]*metadata_lease_expires_at,[\s\S]*metadata_claim_kind[\s\S]*ON "letters"/,
    );
    expect(migration).toMatch(
      /OLD\.metadata_status = 'RUNNING'[\s\S]*OLD\.metadata_run_id IS NOT NULL[\s\S]*NEW\.metadata_status = 'RUNNING'[\s\S]*metadata_running_owner_cannot_be_stripped/,
    );
    expect(migration).toMatch(
      /ROW\([\s\S]*NEW\.transcription_text[\s\S]*NEW\.metadata_v2_json[\s\S]*\) IS DISTINCT FROM ROW\([\s\S]*OLD\.transcription_text[\s\S]*OLD\.metadata_v2_json[\s\S]*CREATE TRIGGER metadata_owned_attempt_input_guard[\s\S]*BEFORE UPDATE OF[\s\S]*"transcription_text"[\s\S]*"metadata_v2_json"[\s\S]*ON "letters"/,
    );
    expect(migration).not.toMatch(/\bUPDATE\s+"letters"/i);
    expect(migration).not.toMatch(/VALIDATE CONSTRAINT/i);
  });

  it('keeps entity extraction ownership revision-bound across the rollout drain', async () => {
    const schema = await readFile(path.join(sourceRoot, 'db/schema.ts'), 'utf8');
    const migration = await readFile(
      path.join(
        sourceRoot,
        'db/migrations/0051_add_entity_extraction_commit_boundary.sql',
      ),
      'utf8',
    );

    expect(schema).toContain(
      "entityExtractionRevision: integer('entity_extraction_revision')",
    );
    expect(schema).toContain(
      "entityExtractionRunId: uuid('entity_extraction_run_id')",
    );
    expect(schema).toContain(
      "entityExtractionRunRevision: integer('entity_extraction_run_revision')",
    );
    expect(schema).toContain('entity_extraction_revision_nonnegative');
    expect(schema).toContain('entity_extraction_owner_shape');
    expect(schema).toMatch(
      /\$\{table\.entityExtractionRunRevision\} = \$\{table\.entityExtractionRevision\} \+ 1/,
    );

    expect(migration).toMatch(
      /ADD CONSTRAINT "entity_extraction_owner_shape"[\s\S]*?"entity_extraction_run_id" IS NULL[\s\S]*?"entity_extraction_run_revision" IS NULL[\s\S]*?OR \([\s\S]*?"entity_extraction_status" = 'RUNNING'[\s\S]*?"entity_extraction_run_revision" = "entity_extraction_revision" \+ 1[\s\S]*?\) NOT VALID/,
    );
    expect(migration).toMatch(
      /NEW\.entity_extraction_status = 'RUNNING'[\s\S]*?TG_OP = 'INSERT' OR OLD\.entity_extraction_status <> 'RUNNING'[\s\S]*?entity_extraction_running_requires_owner/,
    );
    expect(migration).toMatch(
      /OLD\.entity_extraction_status = 'RUNNING'[\s\S]*?OLD\.entity_extraction_run_id IS NOT NULL[\s\S]*?NEW\.entity_extraction_status <> 'RUNNING'[\s\S]*?entity_extraction_terminal_requires_owner_reconciliation/,
    );
    expect(migration).toMatch(
      /CREATE FUNCTION stamp_legacy_entity_extraction_output\(\)[\s\S]*?entity_extraction_status = 'RUNNING'[\s\S]*?entity_extraction_run_id IS NULL[\s\S]*?CREATE TRIGGER legacy_letter_person_extraction_revision[\s\S]*?CREATE TRIGGER legacy_letter_place_extraction_revision[\s\S]*?CREATE TRIGGER legacy_person_relationship_extraction_revision[\s\S]*?CREATE TRIGGER legacy_review_queue_extraction_revision/,
    );
    expect(migration).toMatch(
      /CREATE FUNCTION discard_legacy_entity_extraction_projection\([\s\S]*?DELETE FROM "letter_persons"[\s\S]*?DELETE FROM "letter_places"[\s\S]*?DELETE FROM "person_relationships"[\s\S]*?DELETE FROM "entity_review_queue"/,
    );
    expect(migration).not.toMatch(/VALIDATE CONSTRAINT/i);
  });

  it('keeps entity-extraction liveness nullable, bound, and rolling-deploy safe', async () => {
    const schema = await readFile(path.join(sourceRoot, 'db/schema.ts'), 'utf8');
    const migration = await readFile(
      path.join(
        sourceRoot,
        'db/migrations/0053_add_entity_extraction_liveness.sql',
      ),
      'utf8',
    );
    const worker = await readFile(path.join(sourceRoot, 'worker.ts'), 'utf8');

    expect(schema).toContain("pgEnum('entity_extraction_claim_kind'");
    expect(schema).toMatch(
      /entityExtractionLeaseExpiresAt: timestamp\('entity_extraction_lease_expires_at', \{[\s\S]*?precision: 3,[\s\S]*?\}\)/,
    );
    expect(schema).toContain(
      "entityExtractionLeaseRunId: uuid('entity_extraction_lease_run_id')",
    );
    expect(schema).toContain(
      "entityExtractionClaimKind: entityExtractionClaimKindEnum('entity_extraction_claim_kind')",
    );
    expect(schema).toContain('entity_extraction_lease_metadata_valid');
    expect(schema).toContain(
      'idx_letters_entity_extraction_lease_expires_at',
    );

    expect(migration).toContain(
      'CREATE TYPE "public"."entity_extraction_claim_kind" AS ENUM (\'QUEUED\', \'REQUESTED\')',
    );
    expect(migration).toContain(
      'ADD COLUMN "entity_extraction_lease_expires_at" timestamp(3) with time zone',
    );
    expect(migration).toContain(
      'ADD COLUMN "entity_extraction_lease_run_id" uuid',
    );
    expect(migration).toContain(
      'ADD COLUMN "entity_extraction_claim_kind" "entity_extraction_claim_kind"',
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "entity_extraction_lease_metadata_valid"[\s\S]*\("entity_extraction_lease_expires_at" IS NULL\)\s*=\s*\("entity_extraction_lease_run_id" IS NULL\)[\s\S]*\("entity_extraction_lease_expires_at" IS NULL\)\s*=\s*\("entity_extraction_claim_kind" IS NULL\)[\s\S]*NOT VALID/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "idx_letters_entity_extraction_lease_expires_at"[\s\S]*WHERE "entity_extraction_status" = 'RUNNING'[\s\S]*"entity_extraction_lease_expires_at" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /OLD\.entity_extraction_status = 'RUNNING'[\s\S]*OLD\.entity_extraction_lease_run_id = OLD\.entity_extraction_run_id[\s\S]*NEW\.entity_extraction_status = 'RUNNING'[\s\S]*NEW\.entity_extraction_run_id = OLD\.entity_extraction_run_id[\s\S]*entity_extraction_running_liveness_cannot_be_stripped/,
    );
    expect(migration).not.toMatch(/\bUPDATE\s+"letters"\b/i);
    expect(migration).not.toMatch(/\bDEFAULT\b/i);
    expect(migration).not.toMatch(/VALIDATE CONSTRAINT/i);

    expect(worker).toMatch(
      /entityExtractionStatus,\s*'RUNNING'[\s\S]*entityExtractionClaimKind,\s*'QUEUED'[\s\S]*entityExtractionRunRevision,[\s\S]*entityExtractionRevision/,
    );
    expect(worker).toMatch(
      /isNotNull\(letters\.entityExtractionLeaseExpiresAt\)[\s\S]*isNotNull\(letters\.entityExtractionLeaseRunId\)[\s\S]*entityExtractionLeaseRunId,[\s\S]*entityExtractionRunId/,
    );
  });

  it('keeps extra-content lease metadata stage-specific and rollout-compatible', async () => {
    const schema = await readFile(path.join(sourceRoot, 'db/schema.ts'), 'utf8');
    const migration = await readFile(
      path.join(sourceRoot, 'db/migrations/0048_add_extra_content_leases.sql'),
      'utf8',
    );

    expect(schema).toContain("pgEnum('extra_content_claim_kind'");
    expect(schema).toMatch(
      /extraContentJobLeaseExpiresAt: timestamp\('extra_content_job_lease_expires_at', \{[\s\S]*?precision: 3,[\s\S]*?\}\)/,
    );
    expect(schema).toContain("extraContentJobLeaseRunId: uuid('extra_content_job_lease_run_id')");
    expect(schema).toContain("extraContentJobClaimKind: extraContentClaimKindEnum('extra_content_job_claim_kind')");
    expect(schema).toContain('extra_content_job_lease_metadata_valid');
    expect(schema).toContain('idx_letters_extra_content_job_lease_expires_at');

    expect(migration).toContain(
      'CREATE TYPE "public"."extra_content_claim_kind" AS ENUM (\'QUEUED\', \'REQUESTED\')',
    );
    expect(migration).toContain(
      'ADD COLUMN "extra_content_job_lease_expires_at" timestamp(3) with time zone',
    );
    expect(migration).toContain(
      'ADD COLUMN "extra_content_job_lease_run_id" uuid',
    );
    expect(migration).toContain(
      'ADD COLUMN "extra_content_job_claim_kind" "extra_content_claim_kind"',
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "extra_content_job_lease_metadata_valid"[\s\S]*\("extra_content_job_lease_expires_at" IS NULL\)\s*=\s*\("extra_content_job_lease_run_id" IS NULL\)[\s\S]*\("extra_content_job_lease_expires_at" IS NULL\)\s*=\s*\("extra_content_job_claim_kind" IS NULL\)/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "idx_letters_extra_content_job_lease_expires_at"[\s\S]*WHERE "extra_content_job_status" = 'RUNNING'[\s\S]*"extra_content_job_lease_expires_at" IS NOT NULL/,
    );
    expect(migration).not.toMatch(/\bUPDATE\s+"letters"\b/i);
  });

  it('keeps non-null extra-content lease writes in the lifecycle owner', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedWriters: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === 'db/schema.ts' || relativePath === canonicalExtraContentClaimOwner) {
        continue;
      }
      const source = await readFile(absolutePath, 'utf8');
      const writesLease = [...source.matchAll(
        /\bextraContentJobLeaseExpiresAt\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      const writesLeaseRunId = [...source.matchAll(
        /\bextraContentJobLeaseRunId\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      const writesClaimKind = [...source.matchAll(
        /\bextraContentJobClaimKind\s*:\s*([^,\n}]+)/g,
      )].some(match => match[1].trim() !== 'null');
      if (writesLease || writesLeaseRunId || writesClaimKind) {
        unexpectedWriters.push(relativePath);
      }
    }

    expect(unexpectedWriters.sort()).toEqual([]);
  });
});

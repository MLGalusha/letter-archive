import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));

const pipelineDefinitions = new Set([
  'pipeline/metadataV2.ts',
  'pipeline/processor.ts',
  'pipeline/transcription.ts',
  'services/letter/extra-content.ts',
  'services/letter/regeneration.ts',
]);

const allowedExecutionOwners = new Set([
  'routes/admin/letters/content.ts',
  'routes/admin/letters/processes.ts',
  'services/letter/bulk-operations.ts',
  'services/processes/letter-process-helpers.ts',
  'services/processes/runner.ts',
  'services/processing-queue.ts',
  'worker.ts',
]);

const allowedDirectRunningWriters = new Set([
  'routes/admin/letters/content.ts',
  'services/letter/extra-content-job.ts',
  'services/letter/transcription-job.ts',
  'services/letters.ts',
]);

const allowedClaimJobCallers = new Set([
  'pipeline/metadataV2.ts',
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

const executionCall = /\b(?:processLetter|processMetadata|runTranscription|runRequestedTranscription|runMetadataExtractionV2|runEntityExtractionOnly|regenerateTranscription|transcribeLetterOnly|transcribeExtras|processLettersAsync|startBatch)\s*\(|\.runBatch\s*\(/;

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

  it('allows canonical claim callers to be removed but not silently multiplied', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedCallers: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === 'services/letters.ts') continue;
      if (
        /\bclaimJob\s*\(/.test(await readFile(absolutePath, 'utf8')) &&
        !allowedClaimJobCallers.has(relativePath)
      ) {
        unexpectedCallers.push(relativePath);
      }
    }

    expect(unexpectedCallers.sort()).toEqual([]);
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
      if (writesLease || writesClaimKind) unexpectedWriters.push(relativePath);
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
        /\brecoverExpiredTranscriptions\s*\(\)/.test(await readFile(absolutePath, 'utf8'))
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
        /\brecoverExpiredExtraContentJobs\s*\(\)/.test(
          await readFile(absolutePath, 'utf8'),
        ) && !allowedExpiredExtraContentRecoveryCallers.has(relativePath)
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
        /\brecoverExpiredProcessingJobs\s*\(\)/.test(
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

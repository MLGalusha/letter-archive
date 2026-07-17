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
  'services/letters.ts',
]);

const allowedClaimJobCallers = new Set([
  'pipeline/metadataV2.ts',
  'pipeline/transcription.ts',
]);

const allowedRecoveryCallers = new Set([
  'index.ts',
  'worker.ts',
]);

const executionCall = /\b(?:processLetter|processMetadata|runTranscription|runMetadataExtractionV2|runEntityExtractionOnly|regenerateTranscription|transcribeLetterOnly|transcribeExtras|processLettersAsync|startBatch)\s*\(|\.runBatch\s*\(/;

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

  it('allows startup recovery callers to be removed but not silently multiplied', async () => {
    const files = await productionTypeScriptFiles(sourceRoot);
    const unexpectedCallers: string[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === 'services/processing-queue.ts') continue;
      if (
        /\brecoverOrphanedJobs\s*\(\)/.test(await readFile(absolutePath, 'utf8')) &&
        !allowedRecoveryCallers.has(relativePath)
      ) {
        unexpectedCallers.push(relativePath);
      }
    }

    expect(unexpectedCallers.sort()).toEqual([]);
  });
});

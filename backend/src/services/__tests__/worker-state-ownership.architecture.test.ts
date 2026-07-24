import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('worker execution ownership architecture', () => {
  it('keeps worker execution ownership nullable, paired, and millisecond precise', async () => {
    const schema = await readFile(`${sourceRoot}/db/schema.ts`, 'utf8');

    expect(schema).toContain("executionToken: uuid('execution_token')");
    expect(schema).toMatch(
      /executionLeaseExpiresAt: timestamp\('execution_lease_expires_at', \{[\s\S]*?withTimezone: true,[\s\S]*?precision: 3,[\s\S]*?\}\)/,
    );
    expect(schema).toMatch(
      /check\([\s\S]*?'worker_execution_lease_shape'[\s\S]*?\$\{\s*table\.executionToken\s*\} IS NULL[\s\S]*?=\s*\(\$\{\s*table\.executionLeaseExpiresAt\s*\} IS NULL\)/,
    );
  });

  it('keeps every owned state mutation token-fenced and database-clock based', async () => {
    const service = await readFile(`${sourceRoot}/services/worker-state.ts`, 'utf8');

    expect(service).toContain('export const WORKER_EXECUTION_LEASE_MS = 120_000');
    expect(service).toContain('export async function acquireWorkerExecutionLease');
    expect(service).toContain('export async function renewWorkerExecutionLease');
    expect(service).toContain('export async function publishWorkerState');
    expect(service).toContain('export async function releaseWorkerExecutionLease');
    expect(service).toContain('export async function hasActiveWorkerExecutionLease');
    expect(service).toContain('export function createWorkerStatePublisher');
    expect(service).toContain('export function activeWorkerExecutionCondition');
    expect(service).toMatch(
      /function activeExecutionConditions\(token: string\)[\s\S]*?eq\(workerState\.executionToken, token\)[\s\S]*?gt\(workerState\.executionLeaseExpiresAt, databaseNow\(\)\)/,
    );
    expect(service).toMatch(
      /renewWorkerExecutionLease[\s\S]*?activeExecutionConditions\(token\)/,
    );
    expect(service).toMatch(
      /publishWorkerState[\s\S]*?activeExecutionConditions\(token\)/,
    );
    expect(service).toMatch(
      /releaseWorkerExecutionLease[\s\S]*?eq\(workerState\.executionToken, token\)/,
    );
    expect(service).toContain('clock_timestamp()');
    expect(service).not.toContain('new Date(');
    expect(service).not.toMatch(/\bdb\.insert\(workerState\)/);
    expect(service).not.toContain('resume(');
  });

  it('binds automatic stage claims and worker recovery to the live execution token', async () => {
    const [
      transcription,
      metadata,
      extraContent,
      entities,
      processingQueue,
      worker,
    ] = await Promise.all([
      readFile(`${sourceRoot}/services/letter/transcription-job.ts`, 'utf8'),
      readFile(`${sourceRoot}/services/letter/metadata-job.ts`, 'utf8'),
      readFile(`${sourceRoot}/services/letter/extra-content-job.ts`, 'utf8'),
      readFile(`${sourceRoot}/services/letters.ts`, 'utf8'),
      readFile(`${sourceRoot}/services/processing-queue.ts`, 'utf8'),
      readFile(`${sourceRoot}/worker.ts`, 'utf8'),
    ]);

    for (const claimOwner of [
      transcription,
      metadata,
      extraContent,
      entities,
    ]) {
      expect(claimOwner).toContain('activeWorkerExecutionCondition');
      expect(claimOwner).toContain('workerExecutionToken');
    }

    expect(processingQueue).toContain(
      'recoverExpiredTranscriptions(\n      options.workerExecutionToken',
    );
    expect(processingQueue).toContain(
      'recoverExpiredMetadataJobs(options.workerExecutionToken)',
    );
    expect(processingQueue).toContain(
      'recoverExpiredExtraContentJobs(\n      options.workerExecutionToken',
    );
    expect(worker).toContain(
      'recoverExpiredProcessingJobs({\n      workerExecutionToken: executionTokenForRecovery',
    );
  });

  it('does not let callers supply ownership or report timestamps', async () => {
    const service = await readFile(`${sourceRoot}/services/worker-state.ts`, 'utf8');
    const updateShape = service.match(
      /export interface WorkerStateUpdate \{([\s\S]*?)\n\}/,
    )?.[1];
    const snapshotShape = service.match(
      /export interface WorkerStateSnapshot \{([\s\S]*?)\n\}/,
    )?.[1];

    expect(updateShape).toContain('lastError?: string | null');
    expect(updateShape).toContain('currentBatchSize?: number | null');
    expect(updateShape).not.toContain('lastTickAt');
    expect(updateShape).not.toContain('isPolling');
    expect(updateShape).not.toContain('executionToken');
    expect(snapshotShape).not.toContain('executionToken');
    expect(snapshotShape).not.toContain('executionLeaseExpiresAt');
  });
});

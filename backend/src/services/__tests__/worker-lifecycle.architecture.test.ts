import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
let worker = '';
let database = '';
let api = '';

beforeAll(async () => {
  [worker, database, api] = await Promise.all([
    readFile(`${sourceRoot}/worker.ts`, 'utf8'),
    readFile(`${sourceRoot}/db/index.ts`, 'utf8'),
    readFile(`${sourceRoot}/index.ts`, 'utf8'),
  ]);
});

function section(start: string, end: string): string {
  const startIndex = worker.indexOf(start);
  const endIndex = worker.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return worker.slice(startIndex, endIndex);
}

describe('worker execution lifecycle architecture', () => {
  it('acquires before recovery or queue work and starts the heartbeat immediately', () => {
    const main = section('async function main()', '// Handle graceful shutdown');
    const acquisitionClock = main.indexOf(
      'const acquisitionStartedAtMs = performance.now()',
    );
    const acquire = main.indexOf(
      'const executionLease = await acquireWorkerExecutionLease()',
    );
    const loserExit = main.indexOf('if (!executionLease)');
    const heartbeat = main.indexOf(
      'const executionHeartbeat = createWorkerExecutionHeartbeat',
    );
    const recovery = main.indexOf('await leaseRecovery.reconcile()');
    const processing = main.indexOf('processedAny = await processPendingJobs');

    expect(acquisitionClock).toBeLessThan(acquire);
    expect(acquire).toBeLessThan(loserExit);
    expect(loserExit).toBeLessThan(heartbeat);
    expect(heartbeat).toBeLessThan(recovery);
    expect(recovery).toBeLessThan(processing);
    expect(main.slice(loserExit, heartbeat)).toContain('return;');
    expect(main).toContain(
      'initialConfirmationStartedAtMs: acquisitionStartedAtMs',
    );
  });

  it('gates every queue scan and stage claim on live execution ownership', () => {
    const processing = section(
      'async function processPendingJobs(',
      '/**\n * Sleep utility.',
    );
    const gate = 'if (!canStartWorkerOperation(executionHeartbeat))';
    const scans = [
      'findLettersNeedingTranscription()',
      'findLettersNeedingExtraContent()',
      'findLettersNeedingMetadata()',
      'findLettersNeedingEntityExtraction()',
    ];

    let previousScan = -1;
    for (const scan of scans) {
      const scanIndex = processing.indexOf(`await ${scan}`, previousScan + 1);
      const gateBefore = processing.lastIndexOf(gate, scanIndex);
      const gateAfter = processing.indexOf(gate, scanIndex);

      expect(scanIndex).toBeGreaterThan(previousScan);
      expect(gateBefore).toBeGreaterThan(previousScan);
      expect(gateAfter).toBeGreaterThan(scanIndex);
      previousScan = scanIndex;
    }

    for (const queue of [
      'needingTranscription',
      'needingExtraContent',
      'needingMetadata',
      'needingEntityExtraction',
    ]) {
      expect(processing).toMatch(
        new RegExp(
          `for \\(const letter of ${queue}\\) \\{\\s*`
          + 'if \\(!canStartWorkerOperation\\(executionHeartbeat\\)\\)',
        ),
      );
    }
  });

  it('defers worker follow-ons to their durable stage queues', () => {
    const processing = section(
      'async function processPendingJobs(',
      '/**\n * Sleep utility.',
    );

    expect(processing).toMatch(
      /processLetter\(letter\.id,\s*\{[\s\S]*?extraContent:\s*'skip',[\s\S]*?workerExecutionToken:\s*executionToken,[\s\S]*?\}\)/,
    );
    expect(processing).toMatch(
      /processMetadata\(letter\.id,\s*\{[\s\S]*?entityExtraction:\s*'deferred',[\s\S]*?workerExecutionToken:\s*executionToken,[\s\S]*?\}\)/,
    );
    expect(processing).toMatch(
      /tryTranscribeExtras\(letter\.id,\s*\{[\s\S]*?claimKind:\s*'QUEUED',[\s\S]*?workerExecutionToken:\s*executionToken,[\s\S]*?\}\)/,
    );
    expect(processing).toMatch(
      /runEntityExtractionOnly\(letter\.id,\s*\{\s*workerExecutionToken:\s*executionToken,\s*\}\)/,
    );
  });

  it('keeps the execution lease during signal drain and releases in terminal order', () => {
    const shutdown = section(
      'function gracefulShutdown(signal: string)',
      "process.on('SIGINT'",
    );
    const cleanup = section(
      '// Keep renewal alive until the current fenced stage',
      "log.info({ mode: EXIT_WHEN_EMPTY ? 'job' : 'poll' }",
    );
    const stopRecovery = cleanup.indexOf('await leaseRecovery.stopAndWait()');
    const stopHeartbeat = cleanup.indexOf(
      'await executionHeartbeat.stopAndWait()',
    );
    const release = cleanup.indexOf(
      'await workerStatePublisher.release',
    );
    const handoff = cleanup.indexOf(
      "await ensureBackgroundWorkerForQueuedProcessing('worker-exit-handoff')",
    );

    expect(shutdown).toContain('shuttingDown = true');
    expect(shutdown).toContain('void leaseRecovery.stopAndWait()');
    expect(shutdown).not.toContain('executionHeartbeat.stopAndWait');
    expect(shutdown).not.toContain('workerStatePublisher.release');
    expect(shutdown).not.toContain('closeDatabase');
    expect(worker).toContain('const SHUTDOWN_TIMEOUT_MS = 8_000');
    expect(shutdown).toContain('}, SHUTDOWN_TIMEOUT_MS).unref()');

    expect(stopRecovery).toBeGreaterThanOrEqual(0);
    expect(stopRecovery).toBeLessThan(stopHeartbeat);
    expect(stopHeartbeat).toBeLessThan(release);
    expect(release).toBeLessThan(handoff);
    expect(cleanup).toContain('if (completedNormally && released)');
  });

  it('closes the database only after lifecycle cleanup and keeps fatal exits nonzero', () => {
    const entrypoint = worker.slice(worker.indexOf('main().then'));

    expect(entrypoint).toMatch(
      /main\(\)\.then\(async \(\) => \{\s*await closeDatabase\(\);\s*process\.exit\(0\)/,
    );
    expect(entrypoint).toMatch(
      /\.catch\(async \(error\) => \{[\s\S]*await closeDatabase\(\);[\s\S]*process\.exit\(1\)/,
    );
    expect(worker).toMatch(
      /if \(EXIT_WHEN_EMPTY\) \{[\s\S]*throw error;/,
    );
  });

  it('keeps database shutdown owned by the API and worker lifecycles', () => {
    expect(database).toContain('export function closeDatabase()');
    expect(database).not.toMatch(/process\.on\(['"]SIG(?:INT|TERM)['"]/);

    const apiShutdown = api.slice(api.indexOf('function gracefulShutdown'));
    const recovery = apiShutdown.indexOf('await recoveryStopped');
    const close = apiShutdown.indexOf('await closeDatabase()');
    expect(recovery).toBeGreaterThanOrEqual(0);
    expect(recovery).toBeLessThan(close);
  });

  it('does not retain the unfenced worker-state or release-and-resume APIs', () => {
    expect(worker).not.toContain('setWorkerState');
    expect(worker).not.toContain('publishHeartbeat({');
    expect(worker).not.toContain('.relinquish(');
    expect(worker).not.toContain('.resume(');
    expect(worker).not.toContain('decideEmptyWorkerJobWithHandoff');
    expect(worker).not.toContain('requestBackgroundWorkerRun');
  });
});

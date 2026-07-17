#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const skippedSteps = [];

function runStep(label, cwd, command, args) {
  process.stdout.write(`\n==> ${label}\n`);

  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.signal) {
    process.stderr.write(`${label} terminated by signal ${result.signal}\n`);
    process.exit(1);
  }
}

runStep('Backend tests', path.join(rootDir, 'backend'), 'npm', ['test']);

if (process.env.VERIFY_SKIP_TYPECHECK !== '1') {
  runStep('Backend typecheck', path.join(rootDir, 'backend'), 'npm', [
    'run',
    'typecheck',
  ]);
} else {
  skippedSteps.push('Backend typecheck');
}

runStep('Frontend tests', path.join(rootDir, 'frontend'), 'npm', ['test']);

if (process.env.VERIFY_SKIP_BUILD !== '1') {
  runStep('Frontend build', path.join(rootDir, 'frontend'), 'npm', [
    'run',
    'build',
  ]);
} else {
  skippedSteps.push('Frontend build');
}

if (process.env.VERIFY_SKIP_E2E !== '1') {
  runStep('Mocked e2e', path.join(rootDir, 'e2e'), 'npm', [
    'run',
    'test:mocked',
  ]);
} else {
  skippedSteps.push('Mocked e2e');
}

if (skippedSteps.length > 0) {
  process.stdout.write(`\nSkipped by environment: ${skippedSteps.join(', ')}.\n`);
  process.stdout.write('Verification complete for executed steps.\n');
} else {
  process.stdout.write('\nVerification complete.\n');
}

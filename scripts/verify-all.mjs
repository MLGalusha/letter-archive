#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');

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
}

runStep('Frontend tests', path.join(rootDir, 'frontend'), 'npm', ['test']);

if (process.env.VERIFY_SKIP_BUILD !== '1') {
  runStep('Frontend build', path.join(rootDir, 'frontend'), 'npm', [
    'run',
    'build',
  ]);
}

process.stdout.write('\n==> Mocked e2e\n');
process.stdout.write(
  'Run "cd e2e && npm run test:mocked" separately to include the mocked Playwright suite.\n',
);

process.stdout.write('\nVerification complete.\n');

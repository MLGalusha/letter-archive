#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDirectory, '..');
const defaultPython = path.join(backendRoot, 'python', 'venv', 'bin', 'python');
const python = process.env.LAYOUT_BENCHMARK_PYTHON || defaultPython;

if (!existsSync(python)) {
  console.error(
    [
      `Layout benchmark orchestrator Python not found: ${python}`,
      'Create the preserved Kraken-6 environment first with backend/python/setup.sh,',
      'or set LAYOUT_BENCHMARK_PYTHON to a Python with Pillow installed.',
    ].join('\n'),
  );
  process.exit(2);
}

const pythonPath = [
  path.join(backendRoot, 'python'),
  process.env.PYTHONPATH,
].filter(Boolean).join(path.delimiter);

const result = spawnSync(
  python,
  ['-m', 'layout_benchmark', ...process.argv.slice(2)],
  {
    cwd: backendRoot,
    env: {
      ...process.env,
      PYTHONPATH: pythonPath,
      PYTHONHASHSEED: '0',
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(`Could not start layout benchmark: ${result.error.message}`);
  process.exit(2);
}
if (result.signal) {
  console.error(`Layout benchmark terminated by signal ${result.signal}`);
  process.exit(2);
}
process.exit(result.status ?? 2);

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function runFixture(application: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'archive-bootstrap-'));
  roots.push(root);
  mkdirSync(path.join(root, 'utils'));
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  for (const file of ['bootstrap', 'utils/startup-timing']) {
    const source = readFileSync(new URL(`../../${file}.ts`, import.meta.url), 'utf8');
    writeFileSync(path.join(root, `${file}.js`), ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText);
  }
  writeFileSync(path.join(root, 'index.js'), application);
  return spawnSync(process.execPath, [path.join(root, 'bootstrap.js')], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, NODE_OPTIONS: '' },
  });
}

describe('API bootstrap entry', () => {
  it('starts timing before evaluating the app and lets successful imports complete', () => {
    const result = runFixture("import {startupTiming} from './utils/startup-timing.js'; console.log(JSON.stringify(startupTiming.snapshot()));");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ bootstrapElapsedMs: expect.any(Number) });
  });
  it.each([
    "throw new Error('startup-failure-sentinel');",
    "await Promise.reject(new Error('startup-failure-sentinel'));",
    "import './missing-startup-failure-sentinel.js';",
  ])('does not swallow a fatal startup failure: %s', (source) => {
    const result = runFixture(source);
    expect(result.signal).toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('startup-failure-sentinel');
  });
});

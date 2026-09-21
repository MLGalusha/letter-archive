import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { selectBrowserChecks, selectFromGit } from './select-browser-checks.mjs';

const changed = (...paths) => paths.map(path => ({ status: 'M', path }));

test('isolated backend source and docs omit only mocked/native browser work', () => {
  assert.equal(selectBrowserChecks(changed('backend/src/services/letter-queries.ts')).runBrowser, false);
  assert.equal(selectBrowserChecks(changed('docs/deployment.md')).runBrowser, false);
  assert.equal(selectBrowserChecks(changed('backend/src/routes/admin/letters/list.ts', 'docs/api/admin.md')).runBrowser, false);
  assert.equal(selectBrowserChecks([{ status: 'A', path: 'backend/src/services/__tests__/new.test.ts' }]).runBrowser, false);
});

for (const path of [
  'frontend/src/components/Header/Header.tsx', 'frontend/src/App.css',
  'frontend/src/pages/admin/AdminDashboard.tsx', 'frontend/package-lock.json',
  'backend/src/contracts/admin-wire-contracts.ts', 'backend/package-lock.json',
  'backend/storage/collections/009/page.jpg', 'backend/python/line_finder.py',
  'e2e/tests/reader-focus-mode.mocked.spec.ts', 'e2e/tests/utils/reader-viewer-fixture.ts',
  'e2e/playwright.mocked.config.ts', '.github/workflows/ci.yml',
  'scripts/select-browser-checks.mjs', 'scripts/sync-admin-wire-contracts.mjs',
  '.nvmrc', 'shared/types.ts', 'docs/data.json', 'unknown/new-file',
]) {
  test(`full fallback: ${path}`, () => {
    assert.equal(selectBrowserChecks(changed('docs/README.md', path)).runBrowser, true);
  });
}

test('empty, deleted, renamed and type-changed paths run full coverage', () => {
  assert.equal(selectBrowserChecks([]).runBrowser, true);
  for (const status of ['D', 'R100', 'T', 'U']) {
    assert.equal(selectBrowserChecks([{ status, path: 'docs/README.md' }]).runBrowser, true);
  }
});

test('main/manual always run full coverage, even with an otherwise eligible diff', () => {
  for (const eventName of ['push', 'workflow_dispatch', undefined]) {
    assert.equal(selectFromGit({ eventName }).runBrowser, true);
  }
});

test('real Git history covers the whole PR and fails safe on missing history', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'browser-selection-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const save = (path, value) => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), value); };
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  save('docs/start.md', 'base'); const base = commit();
  save('backend/src/a.ts', 'export const a = 1'); const backend = commit();
  const select = (head, baseSha = base) => selectFromGit({ eventName: 'pull_request', head, base: baseSha, cwd });
  assert.equal(select(backend).runBrowser, false);
  save('frontend/src/a.ts', 'export const a = 1'); const frontend = commit();
  save('docs/start.md', 'later docs commit'); const head = commit();
  assert.equal(select(head).runBrowser, true, 'earlier frontend commit must not disappear behind the last docs commit');
  assert.equal(select(head, frontend).runBrowser, false);
  assert.equal(select(head, 'a'.repeat(40)).runBrowser, true);
  assert.equal(select(head, 'invalid').runBrowser, true);
  assert.equal(select(backend).runBrowser, true, 'event and checkout must agree');
  git('mv', 'docs/start.md', 'docs/moved.md'); const renamed = commit();
  assert.equal(select(renamed, head).runBrowser, true);
  save('docs/a\nfile.md', 'newline path'); const newline = commit();
  assert.equal(select(newline, renamed).runBrowser, false, 'NUL parsing must preserve filenames');
});


test('shallow PR merge checkout compares against the base parent', t => {
  const root = mkdtempSync(join(tmpdir(), 'browser-merge-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin');
  mkdirSync(origin);
  const git = (...args) => execFileSync('git', args, { cwd: origin, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  mkdirSync(join(origin, 'docs'));
  writeFileSync(join(origin, 'docs/a.md'), 'base');
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  git('checkout', '-qb', 'topic');
  writeFileSync(join(origin, 'docs/a.md'), 'topic');
  git('add', '.'); git('commit', '-qm', 'topic');
  git('checkout', '-q', 'main'); git('merge', '--no-ff', '-qm', 'PR merge', 'topic');
  const head = git('rev-parse', 'HEAD');
  const cwd = join(root, 'checkout');
  execFileSync('git', ['clone', '-q', '--depth=2', `file://${origin}`, cwd]);
  assert.equal(selectFromGit({ eventName: 'pull_request', base, head, cwd }).runBrowser, false);
});

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const scopeScript = path.join(
  repositoryRoot,
  'deploy/cloudrun/select-release-scope.sh',
);
const temporaryDirectories: string[] = [];

function createRepository(): {
  directory: string;
  commits: string[];
} {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'letter-archive-release-scope-'),
  );
  temporaryDirectories.push(directory);
  execFileSync('git', ['init', '--quiet'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'test@example.test'], {
    cwd: directory,
  });
  execFileSync('git', ['config', 'user.name', 'Release Scope Test'], {
    cwd: directory,
  });

  const commits: string[] = [];
  const commit = (file: string, contents: string): void => {
    const absolutePath = path.join(directory, file);
    writeFileSync(absolutePath, contents);
    execFileSync('git', ['add', file], { cwd: directory });
    execFileSync('git', ['commit', '--quiet', '-m', file], { cwd: directory });
    commits.push(
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: directory,
        encoding: 'utf8',
      }).trim(),
    );
  };

  commit('README.md', 'initial\n');
  execFileSync('mkdir', ['-p', 'frontend'], { cwd: directory });
  commit('frontend/app.ts', 'frontend one\n');
  execFileSync('mkdir', ['-p', 'backend'], { cwd: directory });
  commit('backend/app.ts', 'backend one\n');
  return { directory, commits };
}

function selectScope(
  directory: string,
  backendRevision: string,
  frontendRevision: string,
  headRevision: string,
): string {
  return execFileSync(
    'bash',
    [scopeScript, backendRevision, frontendRevision, headRevision],
    { cwd: directory, encoding: 'utf8' },
  ).trim();
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('production release scope selection', () => {
  it('skips an older workflow after a newer full release', () => {
    const { directory, commits } = createRepository();
    expect(selectScope(
      directory,
      commits[2],
      commits[2],
      commits[1],
    )).toBe('stale');
  });

  it('skips an older workflow when only one live marker is newer', () => {
    const { directory, commits } = createRepository();
    expect(selectScope(
      directory,
      commits[0],
      commits[2],
      commits[1],
    )).toBe('stale');
  });

  it('carries a missed backend release into a later full release', () => {
    const { directory, commits } = createRepository();
    expect(selectScope(
      directory,
      commits[0],
      commits[1],
      commits[2],
    )).toBe('full');
  });

  it('converges the frontend after a partial full release', () => {
    const { directory, commits } = createRepository();
    expect(selectScope(
      directory,
      commits[2],
      commits[1],
      commits[2],
    )).toBe('frontend');
  });

  it('selects a frontend-only release from matching backend state', () => {
    const { directory, commits } = createRepository();
    expect(selectScope(
      directory,
      commits[0],
      commits[0],
      commits[1],
    )).toBe('frontend');
  });
});

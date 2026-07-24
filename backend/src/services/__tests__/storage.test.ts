import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeChecksum,
  isImmutableStoragePath,
  removeStoredFile,
  storeImmutableFile,
} from '../storage.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'letter-archive-storage-'));
  tempDirs.push(dir);
  return dir;
}

function writeFileOfSize(filePath: string, size: number, fill = 'a'): void {
  fs.writeFileSync(filePath, fill.repeat(size));
}

describe('storage helpers', () => {
  it('computes stable SHA256 checksums', async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'sample.txt');
    fs.writeFileSync(filePath, 'hello world');

    await expect(computeChecksum(filePath)).resolves.toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  it('stores each accepted upload at a unique immutable object path', async () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'source.jpg');
    const logicalPath = path.join(dir, 'nested', 'dest.jpg');
    writeFileOfSize(sourcePath, 11 * 1024);

    const first = await storeImmutableFile(sourcePath, logicalPath);
    const second = await storeImmutableFile(sourcePath, logicalPath);

    expect(first.storagePath).not.toBe(logicalPath);
    expect(second.storagePath).not.toBe(first.storagePath);
    expect(first.storagePath).toContain(`${path.sep}objects${path.sep}dest${path.sep}`);
    expect(path.basename(first.storagePath)).toMatch(
      new RegExp(`^${first.checksumSha256}-[0-9a-f-]+\\.jpg$`),
    );
    expect(isImmutableStoragePath(first.storagePath)).toBe(true);
    expect(isImmutableStoragePath(logicalPath)).toBe(false);
    expect(fs.existsSync(first.storagePath)).toBe(true);
    expect(fs.existsSync(second.storagePath)).toBe(true);
  });

  it('verifies the completed immutable object and never overwrites the logical path', async () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'source.jpg');
    const logicalPath = path.join(dir, 'dest.jpg');
    writeFileOfSize(sourcePath, 11 * 1024, 'b');
    writeFileOfSize(logicalPath, 11 * 1024, 'a');
    const originalChecksum = await computeChecksum(logicalPath);

    const stored = await storeImmutableFile(sourcePath, logicalPath);

    await expect(computeChecksum(stored.storagePath)).resolves.toBe(
      stored.checksumSha256,
    );
    await expect(computeChecksum(logicalPath)).resolves.toBe(originalChecksum);
  });

  it('leaves the live logical object intact when candidate materialization fails', async () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'source.jpg');
    const logicalPath = path.join(dir, 'dest.jpg');
    const objectsPath = path.join(dir, 'objects');
    writeFileOfSize(sourcePath, 11 * 1024, 'b');
    writeFileOfSize(logicalPath, 11 * 1024, 'a');
    fs.writeFileSync(objectsPath, 'not a directory');
    const originalChecksum = await computeChecksum(logicalPath);

    await expect(storeImmutableFile(sourcePath, logicalPath)).rejects.toThrow();
    await expect(computeChecksum(logicalPath)).resolves.toBe(originalChecksum);
  });

  it('rejects tiny files that are likely corrupt placeholders', async () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'tiny.jpg');
    const destPath = path.join(dir, 'dest.jpg');
    writeFileOfSize(sourcePath, 128);

    await expect(storeImmutableFile(sourcePath, destPath)).rejects.toThrow('File too small');
  });

  it('never removes an absolute path outside the configured storage root', async () => {
    const dir = makeTempDir();
    const outsidePath = path.join(dir, 'outside.jpg');
    writeFileOfSize(outsidePath, 11 * 1024);

    await expect(removeStoredFile(outsidePath)).rejects.toThrow(
      'Path traversal detected',
    );
    expect(fs.existsSync(outsidePath)).toBe(true);
  });
});

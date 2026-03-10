import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeChecksum, fileExists, storeFile } from '../storage.js';

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

  it('reports file existence correctly', async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'exists.txt');
    fs.writeFileSync(filePath, 'hi');

    await expect(fileExists(filePath)).resolves.toBe(true);
    await expect(fileExists(path.join(dir, 'missing.txt'))).resolves.toBe(false);
  });

  it('stores large enough files and skips overwriting by default', async () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'source.jpg');
    const destPath = path.join(dir, 'nested', 'dest.jpg');
    writeFileOfSize(sourcePath, 11 * 1024);

    const first = await storeFile(sourcePath, destPath);
    const second = await storeFile(sourcePath, destPath);

    expect(first.alreadyExists).toBe(false);
    expect(second.alreadyExists).toBe(true);
    expect(fs.existsSync(destPath)).toBe(true);
  });

  it('overwrites existing files when force is true', async () => {
    const dir = makeTempDir();
    const sourceA = path.join(dir, 'source-a.jpg');
    const sourceB = path.join(dir, 'source-b.jpg');
    const destPath = path.join(dir, 'dest.jpg');
    writeFileOfSize(sourceA, 11 * 1024, 'a');
    writeFileOfSize(sourceB, 11 * 1024, 'b');

    await storeFile(sourceA, destPath);
    const replaced = await storeFile(sourceB, destPath, true);
    const checksum = await computeChecksum(destPath);

    expect(replaced.alreadyExists).toBe(false);
    expect(checksum).toBe(replaced.checksumSha256);
  });

  it('rejects tiny files that are likely corrupt placeholders', async () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'tiny.jpg');
    const destPath = path.join(dir, 'dest.jpg');
    writeFileOfSize(sourcePath, 128);

    await expect(storeFile(sourcePath, destPath)).rejects.toThrow('File too small');
  });
});

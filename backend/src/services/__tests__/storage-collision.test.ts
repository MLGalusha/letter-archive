import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const objectId = '54000000-0000-4000-8000-000000000099';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: vi.fn(() => objectId),
  };
});

import {
  computeChecksum,
  storeImmutableFile,
} from '../storage.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('immutable storage collision handling', () => {
  it('never deletes an exclusive destination that this attempt did not create', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'letter-archive-storage-collision-'),
    );
    tempDirs.push(directory);
    const sourcePath = path.join(directory, 'source.jpg');
    const logicalPath = path.join(directory, 'dest.jpg');
    fs.writeFileSync(sourcePath, 'source'.repeat(2_000));
    const sourceChecksum = await computeChecksum(sourcePath);
    const collisionPath = path.join(
      directory,
      'objects',
      'dest',
      `${sourceChecksum}-${objectId}.jpg`,
    );
    fs.mkdirSync(path.dirname(collisionPath), { recursive: true });
    fs.writeFileSync(collisionPath, 'existing immutable object');
    const collisionChecksum = await computeChecksum(collisionPath);

    await expect(
      storeImmutableFile(sourcePath, logicalPath, sourceChecksum),
    ).rejects.toMatchObject({ code: 'EEXIST' });

    expect(fs.existsSync(collisionPath)).toBe(true);
    await expect(computeChecksum(collisionPath)).resolves.toBe(collisionChecksum);
  });
});

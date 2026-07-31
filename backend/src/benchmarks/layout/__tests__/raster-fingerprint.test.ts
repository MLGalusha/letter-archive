import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { computePreparedRasterFingerprint } from '../raster-fingerprint.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => (
      rm(path, { recursive: true, force: true })
    )),
  );
});

describe('prepared raster fingerprint', () => {
  it('is identical across PNG encodings and matches the RGB8 framing contract', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'raster-fingerprint-'));
    temporaryDirectories.push(directory);
    const pixels = Buffer.from([255, 0, 0, 0, 255, 0]);
    const [compact, compressed] = await Promise.all([
      sharp(pixels, { raw: { width: 2, height: 1, channels: 3 } })
        .png({ compressionLevel: 0 })
        .toBuffer(),
      sharp(pixels, { raw: { width: 2, height: 1, channels: 3 } })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ]);
    const compactPath = join(directory, 'compact.png');
    const compressedPath = join(directory, 'compressed.png');
    await Promise.all([
      writeFile(compactPath, compact),
      writeFile(compressedPath, compressed),
    ]);

    expect(compact.equals(compressed)).toBe(false);
    await expect(computePreparedRasterFingerprint(
      compactPath,
      { width: 2, height: 1 },
    )).resolves.toEqual({
      algorithm: 'sha256-rgb8-v1',
      sha256: '26124663c1a612b12452329a6ea42dec60ab15e2c42676ec8d3dde537e62bb70',
    });
    await expect(computePreparedRasterFingerprint(
      compressedPath,
      { width: 2, height: 1 },
    )).resolves.toEqual({
      algorithm: 'sha256-rgb8-v1',
      sha256: '26124663c1a612b12452329a6ea42dec60ab15e2c42676ec8d3dde537e62bb70',
    });
  });

  it('rejects a non-RGB prepared artifact instead of silently changing channels', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'raster-fingerprint-'));
    temporaryDirectories.push(directory);
    const grayscalePath = join(directory, 'grayscale.png');
    await writeFile(
      grayscalePath,
      await sharp(Buffer.from([0, 0, 0, 255, 255, 255]), {
        raw: { width: 2, height: 1, channels: 3 },
      }).toColourspace('b-w').png().toBuffer(),
    );

    await expect(computePreparedRasterFingerprint(
      grayscalePath,
      { width: 2, height: 1 },
    )).rejects.toThrow('8-bit RGB PNG');
  });
});

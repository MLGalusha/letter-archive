import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import sharp, { type OutputInfo } from 'sharp';

export const PREPARED_RASTER_FINGERPRINT_ALGORITHM = 'sha256-rgb8-v1' as const;

export interface PreparedRasterFingerprint {
  algorithm: typeof PREPARED_RASTER_FINGERPRINT_ALGORITHM;
  sha256: string;
}

interface PreparedRasterLike {
  width: number;
  height: number;
  rasterFingerprint?: PreparedRasterFingerprint | null;
}

async function assertEncodedRgb8Png(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(26);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    if (
      bytesRead < header.length
      || !header.subarray(0, 8).equals(pngSignature)
      || header.subarray(12, 16).toString('ascii') !== 'IHDR'
      || header[24] !== 8
      || header[25] !== 2
    ) {
      throw new Error(
        'Prepared raster must be an 8-bit RGB PNG in the declared dimensions',
      );
    }
  } finally {
    await handle.close();
  }
}

/**
 * Hashes the decoded prepared image, independent of PNG encoder output.
 *
 * sha256-rgb8-v1 is SHA-256 over:
 *   ASCII "rgb8:<width>x<height>\n"
 *   followed by row-major, top-to-bottom, interleaved 8-bit RGB pixels.
 */
export async function computePreparedRasterFingerprint(
  filePath: string,
  expected: { width: number; height: number },
): Promise<PreparedRasterFingerprint> {
  // Sharp expands grayscale and palette PNGs while decoding. Inspect IHDR
  // first so this stays equivalent to Pillow's strict `image.mode == "RGB"`
  // preparation contract instead of silently changing the detector input.
  await assertEncodedRgb8Png(filePath);
  const metadata = await sharp(filePath, {
    failOn: 'error',
    sequentialRead: true,
  }).metadata();
  if (
    metadata.width !== expected.width
    || metadata.height !== expected.height
    || metadata.channels !== 3
    || metadata.depth !== 'uchar'
  ) {
    throw new Error(
      'Prepared raster must be an 8-bit RGB PNG in the declared dimensions',
    );
  }
  const decoder = sharp(filePath, {
    failOn: 'error',
    sequentialRead: true,
  }).raw();
  const hash = createHash('sha256')
    .update(`rgb8:${expected.width}x${expected.height}\n`, 'ascii');
  let decodedBytes = 0;
  let decodedInfo: OutputInfo | null = null;
  await new Promise<void>((resolve, reject) => {
    decoder.on('info', (info) => {
      decodedInfo = info;
    });
    decoder.on('data', (chunk: Buffer) => {
      decodedBytes += chunk.length;
      hash.update(chunk);
    });
    decoder.on('error', reject);
    decoder.on('end', resolve);
  });
  const info = decodedInfo as OutputInfo | null;

  if (
    !info
    || info.width !== expected.width
    || info.height !== expected.height
    || info.channels !== 3
    || decodedBytes !== expected.width * expected.height * 3
  ) {
    throw new Error(
      'Prepared raster must decode exactly as the declared dimensions in 8-bit RGB',
    );
  }

  return {
    algorithm: PREPARED_RASTER_FINGERPRINT_ALGORITHM,
    sha256: hash.digest('hex'),
  };
}

export function preparedRastersMatch(
  left: PreparedRasterLike | null | undefined,
  right: PreparedRasterLike | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.width === right.width
    && left.height === right.height
    && left.rasterFingerprint
    && right.rasterFingerprint
    && left.rasterFingerprint.algorithm
      === PREPARED_RASTER_FINGERPRINT_ALGORITHM
    && right.rasterFingerprint.algorithm
      === PREPARED_RASTER_FINGERPRINT_ALGORITHM
    && left.rasterFingerprint.sha256 === right.rasterFingerprint.sha256,
  );
}

export function preparedRasterComparisonKey(
  prepared: PreparedRasterLike | null | undefined,
): string | null {
  if (
    !prepared?.rasterFingerprint
    || prepared.rasterFingerprint.algorithm
      !== PREPARED_RASTER_FINGERPRINT_ALGORITHM
  ) {
    return null;
  }
  return [
    prepared.rasterFingerprint.algorithm,
    prepared.rasterFingerprint.sha256,
    `${prepared.width}x${prepared.height}`,
  ].join(':');
}

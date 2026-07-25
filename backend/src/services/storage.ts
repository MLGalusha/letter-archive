import { mkdir, copyFile, stat, unlink } from 'node:fs/promises';
import { constants as fsConstants, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

// Backend project root, used to resolve relative paths reliably regardless of cwd
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const log = createLogger({ module: 'storage' });

// Minimum file size for images (10KB) - rejects tiny/corrupt/placeholder files
const MIN_IMAGE_SIZE = 10 * 1024;

export interface ImmutableStorageResult {
  storagePath: string;
  checksumSha256: string;
}

export interface InspectedUploadFile {
  checksumSha256: string;
  sizeBytes: number;
}

/**
 * Builds storage path: storage/collections/{collectionCode}/{dateRaw}/{type}{typeSequencePadded}/{originalFilename}
 */
export function buildStoragePath(
  collectionCode: string,
  dateRaw: string,
  type: string,
  typeSequence: number,
  originalFilename: string
): string {
  const typeDir = `${type}${String(typeSequence).padStart(2, '0')}`;
  return join(
    env.STORAGE_DIR,
    'collections',
    collectionCode,
    dateRaw,
    typeDir,
    originalFilename
  );
}

/**
 * Computes SHA256 checksum of a file.
 */
export async function computeChecksum(filePath: string): Promise<string> {
  const start = Date.now();
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const checksum = await new Promise<string>((resolveChecksum, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      sizeBytes += Buffer.byteLength(chunk);
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolveChecksum(hash.digest('hex')));
  });
  const duration = Date.now() - start;
  log.debug(
    { filePath, sizeBytes, duration, checksum: checksum.substring(0, 12) + '...' },
    'Computed checksum'
  );
  return checksum;
}

/** Validates an incoming upload and returns its stable content identity. */
export async function inspectUploadFile(filePath: string): Promise<InspectedUploadFile> {
  const fileStats = await stat(filePath);
  if (fileStats.size < MIN_IMAGE_SIZE) {
    log.warn(
      { filePath, sizeBytes: fileStats.size, minSize: MIN_IMAGE_SIZE },
      'File rejected: too small',
    );
    throw new Error(
      `File too small (${fileStats.size} bytes). Minimum size is ${MIN_IMAGE_SIZE} bytes. `
      + 'This may indicate a corrupted or placeholder file.',
    );
  }

  return {
    checksumSha256: await computeChecksum(filePath),
    sizeBytes: fileStats.size,
  };
}

function buildImmutableStoragePath(
  logicalPath: string,
  checksumSha256: string,
  objectId = randomUUID(),
): string {
  const extension = extname(logicalPath);
  const pageName = basename(logicalPath, extension);
  return join(
    dirname(logicalPath),
    'objects',
    pageName,
    `${checksumSha256}-${objectId}${extension.toLowerCase()}`,
  );
}

const IMMUTABLE_OBJECT_FILENAME =
  /^[a-f0-9]{64}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.[^./]+$/;

/** Identifies checksum-and-UUID paths materialized by storeImmutableFile. */
export function isImmutableStoragePath(storagePath: string): boolean {
  return (
    basename(dirname(dirname(storagePath))) === 'objects'
    && IMMUTABLE_OBJECT_FILENAME.test(basename(storagePath))
  );
}

/**
 * Materializes a complete upload at a never-before-used path.
 *
 * The caller decides whether this source may replace a conceptual page. Storage
 * never overwrites the currently referenced object, so a failed copy or database
 * transaction cannot change bytes behind an older page pointer.
 */
export async function storeImmutableFile(
  sourcePath: string,
  logicalPath: string,
  expectedChecksum?: string,
): Promise<ImmutableStorageResult> {
  const start = Date.now();
  const context = { sourcePath, logicalPath };

  log.debug(context, 'Starting immutable file storage');

  const inspected = expectedChecksum
    ? { checksumSha256: expectedChecksum, sizeBytes: (await stat(sourcePath)).size }
    : await inspectUploadFile(sourcePath);
  if (inspected.sizeBytes < MIN_IMAGE_SIZE) {
    throw new Error(
      `File too small (${inspected.sizeBytes} bytes). Minimum size is ${MIN_IMAGE_SIZE} bytes. `
      + 'This may indicate a corrupted or placeholder file.',
    );
  }
  const { checksumSha256 } = inspected;

  const storagePath = buildImmutableStoragePath(logicalPath, checksumSha256);
  const absoluteStoragePath = storagePath.startsWith('/')
    ? storagePath
    : getAbsoluteStoragePath(storagePath);
  const dir = dirname(absoluteStoragePath);
  await mkdir(dir, { recursive: true });
  let copiedByThisAttempt = false;
  try {
    await copyFile(sourcePath, absoluteStoragePath, fsConstants.COPYFILE_EXCL);
    copiedByThisAttempt = true;
    const storedChecksum = await computeChecksum(absoluteStoragePath);
    if (storedChecksum !== checksumSha256) {
      throw new Error('Stored upload checksum does not match the prepared source');
    }

    const duration = Date.now() - start;
    log.info(
      {
        ...context,
        storagePath,
        sizeBytes: inspected.sizeBytes,
        duration,
        checksumSha256: checksumSha256.substring(0, 12) + '...',
      },
      'Immutable file stored successfully',
    );

    return { storagePath, checksumSha256 };
  } catch (error) {
    if (copiedByThisAttempt) {
      await unlink(absoluteStoragePath).catch(() => {
        // An unreferenced partial object is safe to leave for later garbage collection.
      });
    }
    throw error;
  }
}

/** Removes only a path already resolved by the storage layer. */
export async function removeStoredFile(storagePath: string): Promise<void> {
  await unlink(getAbsoluteStoragePath(storagePath));
}

/**
 * Gets the full absolute path for a storage path.
 * Resolves relative paths against the backend project root (not process.cwd()).
 * Validates the resolved path is within the expected storage directory to prevent path traversal.
 */
export function getAbsoluteStoragePath(storagePath: string): string {
  const absolutePath = storagePath.startsWith('/')
    ? storagePath
    : join(PROJECT_ROOT, storagePath);

  // Resolve to canonical path (eliminates ../ sequences)
  const resolved = resolve(absolutePath);
  const allowedRoot = resolve(PROJECT_ROOT, env.STORAGE_DIR);

  if (!resolved.startsWith(allowedRoot + '/') && resolved !== allowedRoot) {
    throw new Error('Path traversal detected: resolved path is outside storage directory');
  }

  return resolved;
}

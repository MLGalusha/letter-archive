import { mkdir, copyFile, access, readFile, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

// Backend project root, used to resolve relative paths reliably regardless of cwd
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const log = createLogger({ module: 'storage' });

// Minimum file size for images (10KB) - rejects tiny/corrupt/placeholder files
const MIN_IMAGE_SIZE = 10 * 1024;

export interface StorageResult {
  storagePath: string;
  checksumSha256: string;
  alreadyExists: boolean;
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
  const content = await readFile(filePath);
  const checksum = createHash('sha256').update(content).digest('hex');
  const duration = Date.now() - start;
  log.debug(
    { filePath, sizeBytes: content.length, duration, checksum: checksum.substring(0, 12) + '...' },
    'Computed checksum'
  );
  return checksum;
}

/**
 * Checks if a file exists at the given path.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stores a file from source to destination path.
 * Creates directories if needed.
 * If file exists and force=false, returns alreadyExists: true.
 * If file exists and force=true, deletes existing and replaces.
 */
export async function storeFile(
  sourcePath: string,
  destPath: string,
  force = false
): Promise<StorageResult> {
  const start = Date.now();
  const context = { sourcePath, destPath, force };

  log.debug(context, 'Starting file storage');

  // Check file size first - reject tiny files that are likely placeholders or corrupt
  const fileStats = await stat(sourcePath);
  if (fileStats.size < MIN_IMAGE_SIZE) {
    log.warn(
      { ...context, sizeBytes: fileStats.size, minSize: MIN_IMAGE_SIZE },
      'File rejected: too small'
    );
    throw new Error(
      `File too small (${fileStats.size} bytes). Minimum size is ${MIN_IMAGE_SIZE} bytes. ` +
      `This may indicate a corrupted or placeholder file.`
    );
  }

  // Compute checksum
  const checksumSha256 = await computeChecksum(sourcePath);

  // Check if file already exists
  const exists = await fileExists(destPath);
  if (exists && !force) {
    log.debug({ ...context, checksumSha256 }, 'File already exists, skipping');
    return {
      storagePath: destPath,
      checksumSha256,
      alreadyExists: true,
    };
  }

  // If force=true and file exists, delete existing file first
  if (exists && force) {
    log.debug(context, 'Deleting existing file (force=true)');
    await unlink(destPath);
  }

  // Create directory structure
  const dir = dirname(destPath);
  await mkdir(dir, { recursive: true });
  log.debug({ dir }, 'Created directory structure');

  // Copy file
  await copyFile(sourcePath, destPath);

  const duration = Date.now() - start;
  log.info(
    { ...context, sizeBytes: fileStats.size, duration, checksumSha256: checksumSha256.substring(0, 12) + '...' },
    'File stored successfully'
  );

  return {
    storagePath: destPath,
    checksumSha256,
    alreadyExists: false,
  };
}

/**
 * Gets the full absolute path for a storage path.
 * Resolves relative paths against the backend project root (not process.cwd()).
 */
export function getAbsoluteStoragePath(storagePath: string): string {
  if (storagePath.startsWith('/')) {
    return storagePath;
  }
  return join(PROJECT_ROOT, storagePath);
}

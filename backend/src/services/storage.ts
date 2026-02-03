import { mkdir, copyFile, access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { env } from '../config/env.js';

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
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
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
 * Returns error if file already exists (no silent overwrite).
 */
export async function storeFile(
  sourcePath: string,
  destPath: string
): Promise<StorageResult> {
  // Compute checksum first
  const checksumSha256 = await computeChecksum(sourcePath);

  // Check if file already exists
  if (await fileExists(destPath)) {
    return {
      storagePath: destPath,
      checksumSha256,
      alreadyExists: true,
    };
  }

  // Create directory structure
  await mkdir(dirname(destPath), { recursive: true });

  // Copy file
  await copyFile(sourcePath, destPath);

  return {
    storagePath: destPath,
    checksumSha256,
    alreadyExists: false,
  };
}

/**
 * Gets the full absolute path for a storage path.
 */
export function getAbsoluteStoragePath(storagePath: string): string {
  if (storagePath.startsWith('/')) {
    return storagePath;
  }
  return join(process.cwd(), storagePath);
}

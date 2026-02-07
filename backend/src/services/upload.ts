import { parseFilename, isValidFilename } from './filename-parser.js';
import { buildStoragePath, storeFile } from './storage.js';
import { findOrCreateCollection } from './collections.js';
import { findOrCreateLetter } from './letters.js';
import { findOrCreatePage } from './letter-pages.js';
import type { Collection, Letter, LetterPage } from '../db/index.js';

export interface UploadResult {
  collection: Collection;
  letter: Letter;
  page: LetterPage;
  storagePath: string;
  alreadyExists: boolean;
}

export interface UploadError {
  filename: string;
  error: string;
}

/**
 * Processes an uploaded file:
 * 1. Parses the filename
 * 2. Creates/finds collection
 * 3. Creates/finds letter
 * 4. Stores file to local storage
 * 5. Creates/finds page record
 *
 * @param force - If true, overwrites existing files instead of skipping
 */
export async function processUploadedFile(
  tempPath: string,
  originalFilename: string,
  force = false
): Promise<UploadResult> {
  // Validate and parse filename
  if (!isValidFilename(originalFilename)) {
    throw new Error(
      `Invalid filename format: "${originalFilename}". Expected format: 003-18XX0706-L01-01.jpg`
    );
  }

  const parsed = parseFilename(originalFilename);
  if (!parsed) {
    throw new Error(`Failed to parse filename: "${originalFilename}"`);
  }

  // Get or create collection
  const collection = await findOrCreateCollection(parsed.collectionCode);

  // Get or create letter
  const letter = await findOrCreateLetter({
    collectionId: collection.id,
    dateRaw: parsed.dateRaw,
    type: parsed.type,
    typeSequence: parsed.typeSequence,
    letterDate: parsed.letterDate,
    dateConfidence: parsed.dateConfidence,
  });

  // Build storage path and store file
  const destPath = buildStoragePath(
    parsed.collectionCode,
    parsed.dateRaw,
    parsed.type,
    parsed.typeSequence,
    originalFilename
  );

  const { storagePath, checksumSha256, alreadyExists } = await storeFile(tempPath, destPath, force);

  // Get or create page record (pass force to update checksum if replacing)
  const page = await findOrCreatePage({
    letterId: letter.id,
    pageNumber: parsed.pageNumber,
    storagePath,
    originalFilename,
    checksumSha256,
    force,
  });

  return {
    collection,
    letter,
    page,
    storagePath,
    alreadyExists,
  };
}

/**
 * Processes multiple uploaded files.
 * Returns successful results and errors separately.
 */
export async function processUploadedFiles(
  files: Array<{ tempPath: string; originalFilename: string }>
): Promise<{ results: UploadResult[]; errors: UploadError[] }> {
  const results: UploadResult[] = [];
  const errors: UploadError[] = [];

  for (const file of files) {
    try {
      const result = await processUploadedFile(file.tempPath, file.originalFilename);
      results.push(result);
    } catch (error) {
      errors.push({
        filename: file.originalFilename,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return { results, errors };
}

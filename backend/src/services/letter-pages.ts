import { eq, and } from 'drizzle-orm';
import sharp from 'sharp';
import { db, letterPages, type Database, type LetterPage } from '../db/index.js';
import { getAbsoluteStoragePath } from './storage.js';
import {
  invalidateExtraContentJobForSourceChange,
  type ExtraContentGroupIdentity,
} from './letters.js';

export interface CreatePageParams {
  letterId: string;
  pageNumber: number;
  storagePath: string;
  originalFilename: string;
  checksumSha256?: string;
  force?: boolean;
}

export interface PageChangeEffects {
  extraContentSource?: ExtraContentGroupIdentity;
}

type PageDatabase = Pick<Database, 'query' | 'insert' | 'update'>;

/** Read width/height from an image file's header (no full decode). */
async function getImageDimensions(storagePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const absolutePath = getAbsoluteStoragePath(storagePath);
    const { width, height } = await sharp(absolutePath).metadata();
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

/**
 * Finds an existing page by letter ID and page number, or creates a new one.
 * If force=true and page exists, updates the checksum and storage path.
 */
async function persistPage(
  params: CreatePageParams,
  database: PageDatabase,
): Promise<{ page: LetterPage; changed: boolean }> {
  const existing = await database.query.letterPages.findFirst({
    where: and(
      eq(letterPages.letterId, params.letterId),
      eq(letterPages.pageNumber, params.pageNumber)
    ),
  });

  if (existing) {
    // If force=true, update the checksum and storage path
    if (
      params.force &&
      (params.checksumSha256 !== existing.checksumSha256 ||
        params.storagePath !== existing.storagePath)
    ) {
      const dims = await getImageDimensions(params.storagePath);
      const [updated] = await database
        .update(letterPages)
        .set({
          checksumSha256: params.checksumSha256,
          storagePath: params.storagePath,
          ...(dims && { width: dims.width, height: dims.height }),
          updatedAt: new Date(),
        })
        .where(eq(letterPages.id, existing.id))
        .returning();
      return { page: updated, changed: true };
    }
    return { page: existing, changed: false };
  }

  const dims = await getImageDimensions(params.storagePath);
  const [created] = await database
    .insert(letterPages)
    .values({
      letterId: params.letterId,
      pageNumber: params.pageNumber,
      storagePath: params.storagePath,
      originalFilename: params.originalFilename,
      checksumSha256: params.checksumSha256,
      ...(dims && { width: dims.width, height: dims.height }),
    })
    .returning();

  return { page: created, changed: true };
}

/**
 * Persist a page and any derived-content invalidation in one database transaction.
 * If invalidation fails, the page mutation rolls back so a retry cannot mistake the
 * source as already reconciled.
 */
export async function findOrCreatePage(
  params: CreatePageParams,
  effects: PageChangeEffects = {},
): Promise<{ page: LetterPage; changed: boolean }> {
  const { extraContentSource } = effects;
  if (!extraContentSource) {
    return persistPage(params, db);
  }

  return db.transaction(async (tx) => {
    const result = await persistPage(params, tx);
    if (result.changed) {
      await invalidateExtraContentJobForSourceChange(extraContentSource, tx);
    }
    return result;
  });
}

/**
 * Gets all pages for a letter, ordered by page number.
 */
export async function getPagesByLetterId(letterId: string): Promise<LetterPage[]> {
  return db.query.letterPages.findMany({
    where: eq(letterPages.letterId, letterId),
    orderBy: (pages, { asc }) => [asc(pages.pageNumber)],
  });
}

/**
 * Gets a specific page by letter ID and page number.
 */
export async function getPage(
  letterId: string,
  pageNumber: number
): Promise<LetterPage | undefined> {
  return db.query.letterPages.findFirst({
    where: and(
      eq(letterPages.letterId, letterId),
      eq(letterPages.pageNumber, pageNumber)
    ),
  });
}

/**
 * Checks if a page with the given checksum already exists for any letter.
 */
export async function findPageByChecksum(checksum: string): Promise<LetterPage | undefined> {
  return db.query.letterPages.findFirst({
    where: eq(letterPages.checksumSha256, checksum),
  });
}

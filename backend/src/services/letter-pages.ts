import { eq, and } from 'drizzle-orm';
import { db, letterPages, type LetterPage } from '../db/index.js';

export interface CreatePageParams {
  letterId: string;
  pageNumber: number;
  storagePath: string;
  originalFilename: string;
  checksumSha256?: string;
  force?: boolean;
}

/**
 * Finds an existing page by letter ID and page number, or creates a new one.
 * If force=true and page exists, updates the checksum and storage path.
 */
export async function findOrCreatePage(params: CreatePageParams): Promise<LetterPage> {
  const existing = await db.query.letterPages.findFirst({
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
      const [updated] = await db
        .update(letterPages)
        .set({
          checksumSha256: params.checksumSha256,
          storagePath: params.storagePath,
          updatedAt: new Date(),
        })
        .where(eq(letterPages.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  const [created] = await db
    .insert(letterPages)
    .values({
      letterId: params.letterId,
      pageNumber: params.pageNumber,
      storagePath: params.storagePath,
      originalFilename: params.originalFilename,
      checksumSha256: params.checksumSha256,
    })
    .returning();

  return created;
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

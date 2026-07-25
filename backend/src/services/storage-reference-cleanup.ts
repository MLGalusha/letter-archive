import { eq } from 'drizzle-orm';
import {
  db,
  letterPages,
} from '../db/index.js';
import {
  isImmutableStoragePath,
  removeStoredFile,
} from './storage.js';

export type PageStorageReclamationResult =
  | 'removed'
  | 'already-missing'
  | 'still-referenced'
  | 'legacy-path-retained';

interface PageStorageReclamationDependencies {
  findPageReference?: (
    storagePath: string,
  ) => Promise<{ id: string } | null | undefined>;
  removeFile?: (storagePath: string) => Promise<void>;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
  );
}

async function findPageReference(
  storagePath: string,
): Promise<{ id: string } | undefined> {
  return db.query.letterPages.findFirst({
    columns: { id: true },
    where: eq(letterPages.storagePath, storagePath),
  });
}

/**
 * Reclaims one application-owned immutable page object only after proving that
 * no committed page still references its exact path.
 *
 * Legacy logical paths are deliberately retained. They historically had reuse
 * semantics, while UUID-backed immutable paths are never reattached by the
 * supported page-source owner.
 */
export async function reclaimUnreferencedPageStoragePath(
  storagePath: string,
  dependencies: PageStorageReclamationDependencies = {},
): Promise<PageStorageReclamationResult> {
  if (!isImmutableStoragePath(storagePath)) {
    return 'legacy-path-retained';
  }

  const lookupReference = dependencies.findPageReference ?? findPageReference;
  const removeFile = dependencies.removeFile ?? removeStoredFile;
  const reference = await lookupReference(storagePath);
  if (reference) {
    return 'still-referenced';
  }

  try {
    await removeFile(storagePath);
    return 'removed';
  } catch (error) {
    if (isMissingFileError(error)) {
      return 'already-missing';
    }
    throw error;
  }
}

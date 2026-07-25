import { asc, inArray } from 'drizzle-orm';
import {
  db,
  letterPages,
  letters,
  type Database,
} from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import { advanceCollectionProfileRevision } from '../collection-profile-mutations.js';
import {
  reclaimUnreferencedPageStoragePath,
  type PageStorageReclamationResult,
} from '../storage-reference-cleanup.js';
import { lockCorrespondenceGroupByLetterId } from './correspondence-group.js';
import { sourceRevisionChanged } from './source-revision.js';

const log = createLogger({ module: 'correspondence-deletion' });

export interface CorrespondenceDeletionResult {
  letterId: string;
  deletedCount: number;
  storageObjectCount: number;
  removedStorageObjectCount: number;
  alreadyMissingStoragePaths: string[];
  retainedStoragePaths: string[];
  cleanupFailedStoragePaths: string[];
  collectionProfileInvalidated: boolean;
}

interface CorrespondenceDeletionDependencies {
  database?: Database;
  reclaimStoragePath?: (
    storagePath: string,
  ) => Promise<PageStorageReclamationResult>;
}

/**
 * Deletes one correspondence unit without exposing committed data to
 * pre-commit filesystem failures.
 *
 * PostgreSQL owns the authoritative outcome: the collection and every group
 * member are locked in the shared order, page paths are snapshotted, and all
 * member rows are removed by one statement in one transaction. After commit,
 * UUID-backed objects are reclaimed only when no surviving page references the
 * exact path. Legacy and shared paths are retained. A failed reclamation
 * therefore leaves an object for later garbage collection instead of exposing
 * a live database row whose bytes have disappeared.
 */
export async function deleteCorrespondenceGroup(
  letterId: string,
  expectedPrimarySourceRevision: number,
  dependencies: CorrespondenceDeletionDependencies = {},
): Promise<CorrespondenceDeletionResult | null> {
  const database = dependencies.database ?? db;
  const reclaimStoragePath = dependencies.reclaimStoragePath
    ?? reclaimUnreferencedPageStoragePath;

  const committed = await database.transaction(async (tx) => {
    const group = await lockCorrespondenceGroupByLetterId(letterId, tx);
    if (!group) {
      return null;
    }

    if (group.members.some(
      ({ primarySourceRevision }) =>
        primarySourceRevision !== expectedPrimarySourceRevision,
    )) {
      throw sourceRevisionChanged(
        'Correspondence source changed; reload and confirm deletion again',
      );
    }

    const groupIds = group.members.map((member) => member.id);
    const pages = await tx
      .select({
        id: letterPages.id,
        storagePath: letterPages.storagePath,
      })
      .from(letterPages)
      .where(inArray(letterPages.letterId, groupIds))
      .orderBy(asc(letterPages.id));

    const storagePaths = Array.from(
      new Set(pages.map((page) => page.storagePath)),
    );
    const publicCorpusChanged = group.members.some(
      (member) => member.type === 'L' && member.visibility === 'PUBLISHED',
    );
    const highlightImageRemoved = group.collection.highlightImageId !== null
      && pages.some((page) => page.id === group.collection.highlightImageId);
    const collectionProfileInvalidated =
      publicCorpusChanged || highlightImageRemoved;

    if (collectionProfileInvalidated) {
      await advanceCollectionProfileRevision(
        group.identity.collectionId,
        tx,
        { clearHighlightImage: highlightImageRemoved },
      );
    }

    const deleted = await tx
      .delete(letters)
      .where(inArray(letters.id, groupIds))
      .returning({ id: letters.id });
    if (deleted.length !== groupIds.length) {
      throw new Error(
        `Correspondence deletion removed ${deleted.length} of ${groupIds.length} locked rows`,
      );
    }

    return {
      deletedCount: deleted.length,
      storagePaths,
      collectionProfileInvalidated,
    };
  });
  if (!committed) return null;

  const alreadyMissingStoragePaths: string[] = [];
  const retainedStoragePaths: string[] = [];
  const cleanupFailedStoragePaths: string[] = [];
  let removedStorageObjectCount = 0;
  for (const storagePath of committed.storagePaths) {
    try {
      const reclamation = await reclaimStoragePath(storagePath);
      if (reclamation === 'removed') {
        removedStorageObjectCount += 1;
      } else if (reclamation === 'already-missing') {
        alreadyMissingStoragePaths.push(storagePath);
      } else if (
        reclamation === 'still-referenced'
        || reclamation === 'legacy-path-retained'
      ) {
        retainedStoragePaths.push(storagePath);
      }
    } catch (err) {
      cleanupFailedStoragePaths.push(storagePath);
      log.warn(
        { err, letterId, storagePath },
        'Deleted correspondence storage cleanup failed',
      );
    }
  }

  return {
    letterId,
    deletedCount: committed.deletedCount,
    storageObjectCount: committed.storagePaths.length,
    removedStorageObjectCount,
    alreadyMissingStoragePaths,
    retainedStoragePaths,
    cleanupFailedStoragePaths,
    collectionProfileInvalidated: committed.collectionProfileInvalidated,
  };
}

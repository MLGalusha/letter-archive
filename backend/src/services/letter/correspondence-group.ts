import { and, asc, eq } from 'drizzle-orm';
import {
  collections,
  letters,
  type ContentStatus,
  type Database,
  type LetterType,
  type VisibilityState,
} from '../../db/index.js';

type CorrespondenceGroupDatabase = Pick<Database, 'select'>;

export interface CorrespondenceGroupIdentity {
  collectionId: string;
  dateRaw: string;
  typeSequence: number;
}

export interface LockedCorrespondenceMember {
  id: string;
  collectionId: string;
  dateRaw: string;
  typeSequence: number;
  type: LetterType;
  primarySourceRevision: number;
  visibility: VisibilityState;
  transcriptPublished: boolean;
  metadataPublished: boolean;
  transcriptStatus: ContentStatus;
  metadataContentStatus: ContentStatus;
}

export interface LockedCorrespondenceGroup {
  identity: CorrespondenceGroupIdentity;
  collection: {
    id: string;
    highlightImageId: string | null;
  };
  owner: LockedCorrespondenceMember;
  members: LockedCorrespondenceMember[];
  nextSourceRevision: number;
}

/**
 * Locks a complete correspondence unit using the global mutation order:
 * collection first, then every member in UUID order.
 *
 * The initial identity lookup is deliberately non-locking. Locking the target
 * row before an earlier UUID in its group would invert the shared order and
 * allow otherwise independent page/publication/deletion transactions to
 * deadlock.
 */
export async function lockCorrespondenceGroupByLetterId(
  letterId: string,
  database: CorrespondenceGroupDatabase,
): Promise<LockedCorrespondenceGroup | null> {
  const observed = await database
    .select({
      id: letters.id,
      collectionId: letters.collectionId,
      dateRaw: letters.dateRaw,
      typeSequence: letters.typeSequence,
    })
    .from(letters)
    .where(eq(letters.id, letterId));
  const target = observed[0];
  if (!target) return null;

  const lockedCollections = await database
    .select({
      id: collections.id,
      highlightImageId: collections.highlightImageId,
    })
    .from(collections)
    .where(eq(collections.id, target.collectionId))
    .for('update');
  const collection = lockedCollections[0];
  if (!collection) return null;

  const members = await database
    .select({
      id: letters.id,
      collectionId: letters.collectionId,
      dateRaw: letters.dateRaw,
      typeSequence: letters.typeSequence,
      type: letters.type,
      primarySourceRevision: letters.primarySourceRevision,
      visibility: letters.visibility,
      transcriptPublished: letters.transcriptPublished,
      metadataPublished: letters.metadataPublished,
      transcriptStatus: letters.transcriptStatus,
      metadataContentStatus: letters.metadataContentStatus,
    })
    .from(letters)
    .where(and(
      eq(letters.collectionId, target.collectionId),
      eq(letters.dateRaw, target.dateRaw),
      eq(letters.typeSequence, target.typeSequence),
    ))
    .orderBy(asc(letters.id))
    .for('update');
  const owner = members.find((member) => member.id === letterId);
  if (!owner) return null;

  return {
    identity: {
      collectionId: target.collectionId,
      dateRaw: target.dateRaw,
      typeSequence: target.typeSequence,
    },
    collection,
    owner,
    members,
    nextSourceRevision:
      Math.max(...members.map((member) => member.primarySourceRevision)) + 1,
  };
}

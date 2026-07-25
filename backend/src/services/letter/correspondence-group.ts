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

export interface LockedCorrespondenceMembers {
  identity: CorrespondenceGroupIdentity;
  collection: {
    id: string;
    highlightImageId: string | null;
  };
  members: LockedCorrespondenceMember[];
  currentSourceRevision: number;
  nextSourceRevision: number;
}

export interface LockedCorrespondenceGroup extends LockedCorrespondenceMembers {
  owner: LockedCorrespondenceMember;
}

/**
 * Locks a complete correspondence unit using the global mutation order:
 * collection first, then every member in UUID order.
 *
 * Identity-based locking also supports a correspondence whose requested member
 * has not been created yet. The collection lock prevents another supported
 * membership writer from appearing between the member snapshot and this
 * transaction's insert.
 */
export async function lockCorrespondenceGroupByIdentity(
  identity: CorrespondenceGroupIdentity,
  database: CorrespondenceGroupDatabase,
): Promise<LockedCorrespondenceMembers | null> {
  const lockedCollections = await database
    .select({
      id: collections.id,
      highlightImageId: collections.highlightImageId,
    })
    .from(collections)
    .where(eq(collections.id, identity.collectionId))
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
      eq(letters.collectionId, identity.collectionId),
      eq(letters.dateRaw, identity.dateRaw),
      eq(letters.typeSequence, identity.typeSequence),
    ))
    .orderBy(asc(letters.id))
    .for('update');
  const currentSourceRevision = members.length === 0
    ? 0
    : Math.max(...members.map((member) => member.primarySourceRevision));

  return {
    identity,
    collection,
    members,
    currentSourceRevision,
    nextSourceRevision: currentSourceRevision + 1,
  };
}

/**
 * Resolves a letter ID to its identity before taking the shared collection-first,
 * members-in-UUID-order correspondence lock.
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

  const group = await lockCorrespondenceGroupByIdentity(
    {
      collectionId: target.collectionId,
      dateRaw: target.dateRaw,
      typeSequence: target.typeSequence,
    },
    database,
  );
  if (!group) return null;

  const owner = group.members.find((member) => member.id === letterId);
  if (!owner) return null;

  return {
    ...group,
    owner,
  };
}

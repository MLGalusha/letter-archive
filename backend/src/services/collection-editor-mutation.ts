import { asc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  collections,
  db,
  letters,
  type Collection,
  type Database,
  type Letter,
} from '../db/index.js';
import { AppError } from '../utils/response-helpers.js';
import { createLogger } from '../utils/logger.js';
import {
  commitDirectIdentityField,
  isIdentityRevisionConflict,
  observeIdentityField,
  propagateName,
  type IdentityField,
  type IdentityState,
} from './name-propagation.js';
import { computeCollectionProfileSourceFingerprint } from './collection-profile-source.js';
import {
  commitAtomicCollectionEditorProfile,
  type CollectionEditorProfilePatch,
} from './collection-profile-mutations.js';
import { syncLetterParticipantsFromMetadata } from './entities/participant-sync.js';
import {
  isPublicCatalogueLetterType,
  selectPublicCatalogueRepresentative,
} from './public-catalogue-unit.js';

const log = createLogger({ module: 'collection-editor-mutation' });

export interface CollectionProfileCorrespondentInput {
  name: string;
  hook: string | null;
  biography: string | null;
}

export interface CollectionCorrespondentRename {
  oldName: string;
  newName: string;
  roles: IdentityField[];
}

export interface CollectionEditorMutationInput {
  code: string;
  expectedProfileRevision?: number;
  expectedIdentityFingerprint?: string;
  description?: string | null;
  hook?: string | null;
  profileNarrative?: string;
  profileStartHereLetterId?: string | null;
  profileCorrespondents?: CollectionProfileCorrespondentInput[];
  correspondentRenames?: CollectionCorrespondentRename[];
}

export interface CollectionEditorMutationResult {
  profileRevision: number;
  identityFingerprint: string;
  updatedLetterCount: number;
  changed: boolean;
}

interface ParticipantSyncPatch {
  letterId: string;
  sender?: string;
  recipient?: string;
}

interface CollectionEditorMutationDependencies {
  database?: Database;
  propagateIdentity?: typeof propagateName;
  commitDirectIdentity?: typeof commitDirectIdentityField;
  computeSourceFingerprint?: typeof computeCollectionProfileSourceFingerprint;
  synchronizeParticipants?: typeof syncLetterParticipantsFromMetadata;
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase();
}

export function collectionIdentityFingerprint(
  collectionLetters: Array<Pick<Letter, 'id' | 'sender' | 'recipient'>>,
): string {
  const identitySnapshot = [...collectionLetters]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, sender, recipient }) => [id, sender, recipient]);
  return createHash('sha256')
    .update(JSON.stringify(identitySnapshot))
    .digest('hex');
}

function buildRenameMaps(
  requests: CollectionCorrespondentRename[],
): Record<IdentityField, Map<string, string>> {
  const maps: Record<IdentityField, Map<string, string>> = {
    sender: new Map(),
    recipient: new Map(),
  };
  const targetsBySource = new Map<string, string>();

  for (const request of requests) {
    const oldName = request.oldName.trim();
    const newName = request.newName.trim();
    const oldKey = normalizedName(oldName);
    if (!oldKey || !newName || oldKey === normalizedName(newName)) continue;

    const newKey = normalizedName(newName);
    const existingTarget = targetsBySource.get(oldKey);
    if (existingTarget && existingTarget !== newKey) {
      throw new AppError(
        400,
        `Conflicting correspondent renames were requested for ${oldName}`,
      );
    }
    targetsBySource.set(oldKey, newKey);

    for (const role of request.roles) {
      const existing = maps[role].get(oldKey);
      if (existing && normalizedName(existing) !== newKey) {
        throw new AppError(
          400,
          `Conflicting ${role} renames were requested for ${oldName}`,
        );
      }
      maps[role].set(oldKey, newName);
    }
  }

  for (const [source, target] of targetsBySource) {
    if (targetsBySource.has(target)) {
      throw new AppError(
        400,
        `Overlapping correspondent renames involving ${source} must be saved separately`,
      );
    }
  }

  return maps;
}

function resolveStartHereFromLockedLetters(
  requestedId: string,
  collectionLetters: Letter[],
): string | null {
  const target = collectionLetters.find((letter) => letter.id === requestedId);
  if (!target) return null;

  const eligible = collectionLetters.filter((letter) => (
    letter.dateRaw === target.dateRaw
    && letter.typeSequence === target.typeSequence
    && letter.visibility === 'PUBLISHED'
    && isPublicCatalogueLetterType(letter.type)
  ));
  return selectPublicCatalogueRepresentative(eligible)?.id ?? null;
}

async function applyLockedCorrespondentRenames(input: {
  collectionLetters: Letter[];
  renameMaps: Record<IdentityField, Map<string, string>>;
  database: Parameters<Parameters<Database['transaction']>[0]>[0];
  propagateIdentity: typeof propagateName;
  commitDirectIdentity: typeof commitDirectIdentityField;
}): Promise<{
  updatedLetterCount: number;
  participantSyncs: ParticipantSyncPatch[];
}> {
  const participantSyncs: ParticipantSyncPatch[] = [];
  let updatedLetterCount = 0;

  for (const letter of input.collectionLetters) {
    const originalSender = letter.sender;
    const originalRecipient = letter.recipient;
    const fieldRenames: Array<[IdentityField, string]> = [];
    if (originalSender) {
      const senderRename = input.renameMaps.sender.get(normalizedName(originalSender));
      if (senderRename) fieldRenames.push(['sender', senderRename]);
    }
    if (originalRecipient) {
      const recipientRename =
        input.renameMaps.recipient.get(normalizedName(originalRecipient));
      if (recipientRename) fieldRenames.push(['recipient', recipientRename]);
    }
    if (fieldRenames.length === 0) continue;

    let current: IdentityState = letter;
    const participantSync: ParticipantSyncPatch = { letterId: letter.id };

    for (const [field, newName] of fieldRenames) {
      const oldName = current[field];
      if (!oldName || normalizedName(oldName) === normalizedName(newName)) {
        continue;
      }

      try {
        const result = await input.propagateIdentity({
          letterId: current.id,
          field,
          oldName,
          newName,
          observed: observeIdentityField(current, field),
        }, input.database);
        current = result.letter;
      } catch (error) {
        if (isIdentityRevisionConflict(error)) throw error;

        log.warn(
          { error, letterId: current.id, field },
          'Collection correspondent propagation failed, using guarded direct update',
        );
        current = await input.commitDirectIdentity({
          letter: current,
          field,
          value: newName,
        }, input.database);
      }

      participantSync[field] = newName;
    }

    if (participantSync.sender !== undefined || participantSync.recipient !== undefined) {
      letter.sender = current.sender;
      letter.recipient = current.recipient;
      updatedLetterCount += 1;
      participantSyncs.push(participantSync);
    }
  }

  return { updatedLetterCount, participantSyncs };
}

/**
 * Canonical persistence boundary for the collection editor's Update action.
 *
 * The collection revision and every collection letter are locked in a stable
 * order. Profile content, collection description, and all requested identity
 * propagation and participant projections therefore commit together or roll
 * back together.
 */
export async function applyCollectionEditorMutation(
  input: CollectionEditorMutationInput,
  dependencies: CollectionEditorMutationDependencies = {},
): Promise<CollectionEditorMutationResult> {
  const database = dependencies.database ?? db;
  const propagateIdentity = dependencies.propagateIdentity ?? propagateName;
  const commitDirectIdentity =
    dependencies.commitDirectIdentity ?? commitDirectIdentityField;
  const computeSourceFingerprint =
    dependencies.computeSourceFingerprint ?? computeCollectionProfileSourceFingerprint;
  const synchronizeParticipants =
    dependencies.synchronizeParticipants ?? syncLetterParticipantsFromMetadata;

  return database.transaction(async (tx) => {
    const lockedCollections = await tx
      .select()
      .from(collections)
      .where(eq(collections.collectionCode, input.code))
      .for('update');
    const collection = lockedCollections[0] as Collection | undefined;
    if (!collection) {
      throw new AppError(404, 'Collection not found');
    }
    if (
      input.expectedProfileRevision !== undefined
      && input.expectedProfileRevision !== collection.profileRevision
    ) {
      throw new AppError(
        409,
        'Collection sources or profile content changed; reload before saving',
      );
    }

    const collectionLetters = await tx
      .select()
      .from(letters)
      .where(eq(letters.collectionId, collection.id))
      .orderBy(asc(letters.id))
      .for('update') as Letter[];
    if (
      input.expectedIdentityFingerprint !== undefined
      && input.expectedIdentityFingerprint
        !== collectionIdentityFingerprint(collectionLetters)
    ) {
      throw new AppError(
        409,
        'Collection correspondents changed; reload before saving',
      );
    }

    const collectionPatch: CollectionEditorProfilePatch = {};
    let profileContentChanged = false;

    if (input.hook !== undefined && input.hook !== collection.hook) {
      collectionPatch.hook = input.hook;
      profileContentChanged = true;
    }
    if (
      input.profileNarrative !== undefined
      && input.profileNarrative !== collection.profileNarrative
    ) {
      collectionPatch.profileNarrative = input.profileNarrative;
      profileContentChanged = true;
    }
    if (input.profileStartHereLetterId !== undefined) {
      const resolvedStartHereLetterId = input.profileStartHereLetterId === null
        ? null
        : resolveStartHereFromLockedLetters(
          input.profileStartHereLetterId,
          collectionLetters,
        );
      if (input.profileStartHereLetterId !== null && !resolvedStartHereLetterId) {
        throw new AppError(400, 'Featured letter must be published');
      }
      if (resolvedStartHereLetterId !== collection.profileStartHereLetterId) {
        collectionPatch.profileStartHereLetterId = resolvedStartHereLetterId;
        profileContentChanged = true;
      }
    }
    if (
      input.profileCorrespondents !== undefined
      && !isDeepStrictEqual(
        input.profileCorrespondents,
        collection.profileCorrespondents,
      )
    ) {
      collectionPatch.profileCorrespondents = input.profileCorrespondents;
      profileContentChanged = true;
    }

    const descriptionChanged =
      input.description !== undefined
      && input.description !== collection.description;
    if (descriptionChanged) {
      collectionPatch.description = input.description;
    }

    const renameMaps = buildRenameMaps(input.correspondentRenames ?? []);
    const renameResult = await applyLockedCorrespondentRenames({
      collectionLetters,
      renameMaps,
      database: tx,
      propagateIdentity,
      commitDirectIdentity,
    });

    const changed =
      Object.keys(collectionPatch).length > 0
      || renameResult.updatedLetterCount > 0;
    if (!changed) {
      return {
        profileRevision: collection.profileRevision,
        identityFingerprint: collectionIdentityFingerprint(collectionLetters),
        updatedLetterCount: 0,
        changed: false,
      };
    }

    for (const participantSync of renameResult.participantSyncs) {
      await synchronizeParticipants({
        ...participantSync,
        database: tx,
      });
    }

    const profileRevision = await commitAtomicCollectionEditorProfile({
      collection,
      patch: collectionPatch,
      profileContentChanged,
    }, {
      database: tx,
      computeSourceFingerprint,
    });

    return {
      profileRevision,
      identityFingerprint: collectionIdentityFingerprint(collectionLetters),
      updatedLetterCount: renameResult.updatedLetterCount,
      changed: true,
    };
  });
}

import { and, eq, sql, type SQL } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import {
  collections,
  db,
  type Collection,
  type ContentStatus,
  type Database,
} from '../db/index.js';
import { AppError } from '../utils/response-helpers.js';
import { computeCollectionProfileSourceFingerprint } from './collection-profile-source.js';

type CollectionProfileWriteDatabase = Pick<Database, 'update'>;
type CollectionProfileMutationDatabase = Pick<Database, 'execute' | 'update'>;

export interface ProfileCorrespondent {
  name: string;
  hook: string | null;
  biography: string | null;
}

export interface ProfileReadingPath {
  title: string;
  description: string;
  letterIds: string[];
}

export interface ProfileGap {
  startDate: string;
  endDate: string;
  description: string;
}

export interface ProfileTheme {
  name: string;
  description: string;
  letterIds: string[];
}

export interface CollectionProfileChanges {
  hook?: string | null;
  profileNarrative?: string;
  profileStartHereLetterId?: string | null;
  profileStartHereReason?: string;
  profileReadingPaths?: ProfileReadingPath[];
  profileGapAnalysis?: ProfileGap[];
  profileThemes?: ProfileTheme[];
  profileCorrespondents?: ProfileCorrespondent[];
  profileStatus?: ContentStatus;
  highlightImageId?: string | null;
}

export interface GeneratedCollectionProfile {
  sourceFingerprint: string;
  hook: string;
  narrative: string;
  correspondents: ProfileCorrespondent[];
}

export interface CollectionEditorProfilePatch {
  description?: string | null;
  hook?: string | null;
  profileNarrative?: string;
  profileStartHereLetterId?: string | null;
  profileCorrespondents?: ProfileCorrespondent[];
}

type ComputeSourceFingerprint = typeof computeCollectionProfileSourceFingerprint;

const PROFILE_CONTENT_FIELDS = new Set<keyof CollectionProfileChanges>([
  'hook',
  'profileNarrative',
  'profileStartHereLetterId',
  'profileStartHereReason',
  'profileReadingPaths',
  'profileGapAnalysis',
  'profileThemes',
  'profileCorrespondents',
  'highlightImageId',
]);

function profileConflict(message: string): AppError {
  return new AppError(409, message);
}

// Canonical collection-profile write boundary. Callers own request validation
// and any wider transaction; this module alone owns profile content,
// provenance, publication status, and revision persistence.

/**
 * Invalidates the optimistic-concurrency epoch for data that feeds a
 * collection profile. A verified profile becomes an editable stale draft, but
 * existing profile content is retained so reviewers can reconcile it.
 */
export async function advanceCollectionProfileRevision(
  collectionId: string,
  database: CollectionProfileWriteDatabase,
  options: { clearHighlightImage?: boolean } = {},
): Promise<void> {
  await database
    .update(collections)
    .set({
      profileRevision: sql<number>`${collections.profileRevision} + 1`,
      profileStatus: sql<ContentStatus>`CASE
        WHEN ${collections.profileStatus} = 'VERIFIED'
          THEN 'EDITED'::content_status
        ELSE ${collections.profileStatus}
      END`,
      ...(options.clearHighlightImage ? { highlightImageId: null } : {}),
    })
    .where(eq(collections.id, collectionId));
}

/**
 * Updates the two human-facing collection source fields. They are part of the
 * canonical profile fingerprint, so a real change advances and, when needed,
 * demotes the profile in the same statement.
 */
export async function updateCollectionSourceMetadata(
  input: {
    collection: Collection;
    expectedProfileRevision: number;
    title?: string;
    description?: string | null;
  },
  database: CollectionProfileWriteDatabase = db,
): Promise<Collection> {
  const updates: Pick<
    Partial<typeof collections.$inferInsert>,
    'title' | 'description'
  > = {};
  if (
    input.title !== undefined
    && input.title !== input.collection.title
  ) {
    updates.title = input.title;
  }
  if (
    input.description !== undefined
    && input.description !== input.collection.description
  ) {
    updates.description = input.description;
  }
  if (Object.keys(updates).length === 0) return input.collection;
  if (input.expectedProfileRevision !== input.collection.profileRevision) {
    throw profileConflict(
      'Collection sources changed; reload before saving its metadata',
    );
  }

  const [updated] = await database
    .update(collections)
    .set({
      ...updates,
      profileRevision: sql<number>`${collections.profileRevision} + 1`,
      profileStatus: sql<ContentStatus>`CASE
        WHEN ${collections.profileStatus} = 'VERIFIED'
          THEN 'EDITED'::content_status
        ELSE ${collections.profileStatus}
      END`,
    })
    .where(and(
      eq(collections.id, input.collection.id),
      eq(collections.profileRevision, input.expectedProfileRevision),
    ))
    .returning();
  if (!updated) {
    throw profileConflict(
      'Collection changed while its metadata was saved; reload and try again',
    );
  }
  return updated;
}

/**
 * Commits generated output only if both the observed revision and the exact
 * source snapshot used by generation are still current.
 */
export async function storeGeneratedCollectionProfile(
  input: {
    collectionId: string;
    expectedProfileRevision: number;
    profile: GeneratedCollectionProfile;
    generatedAt?: Date;
  },
  database: CollectionProfileWriteDatabase = db,
): Promise<number> {
  const [updated] = await database
    .update(collections)
    .set({
      hook: input.profile.hook,
      profileNarrative: input.profile.narrative,
      profileCorrespondents: input.profile.correspondents,
      profileSourceFingerprint: input.profile.sourceFingerprint,
      profileStatus: 'AI_DRAFT',
      profileGeneratedAt: input.generatedAt ?? new Date(),
      profileRevision: sql<number>`${collections.profileRevision} + 1`,
    })
    .where(and(
      eq(collections.id, input.collectionId),
      eq(collections.profileRevision, input.expectedProfileRevision),
      sql`compute_collection_profile_source_fingerprint(
        ${input.collectionId}::uuid
      ) = ${input.profile.sourceFingerprint}`,
    ))
    .returning({ profileRevision: collections.profileRevision });
  if (!updated) {
    throw profileConflict(
      'Collection sources changed while the profile was generated; reload and try again',
    );
  }
  return updated.profileRevision;
}

/**
 * Applies one revision-guarded profile edit or verification transition.
 * Featured-letter and highlight ownership are resolved by the route before
 * entering this persistence boundary.
 */
export async function updateCollectionProfile(
  input: {
    collection: Collection;
    expectedProfileRevision: number;
    changes: CollectionProfileChanges;
  },
  dependencies: {
    database?: CollectionProfileMutationDatabase;
    computeSourceFingerprint?: ComputeSourceFingerprint;
  } = {},
): Promise<Collection> {
  const database = dependencies.database ?? db;
  const computeSourceFingerprint =
    dependencies.computeSourceFingerprint
    ?? computeCollectionProfileSourceFingerprint;
  const { collection, changes } = input;
  if (input.expectedProfileRevision !== collection.profileRevision) {
    throw profileConflict(
      'Collection sources or profile content changed; reload before saving',
    );
  }

  const updates: Partial<typeof collections.$inferInsert> = {};
  if (changes.hook !== undefined) updates.hook = changes.hook;
  if (changes.profileNarrative !== undefined) {
    updates.profileNarrative = changes.profileNarrative;
  }
  if (changes.profileStartHereLetterId !== undefined) {
    updates.profileStartHereLetterId = changes.profileStartHereLetterId;
  }
  if (changes.profileStartHereReason !== undefined) {
    updates.profileStartHereReason = changes.profileStartHereReason;
  }
  if (changes.profileReadingPaths !== undefined) {
    updates.profileReadingPaths = changes.profileReadingPaths;
  }
  if (changes.profileGapAnalysis !== undefined) {
    updates.profileGapAnalysis = changes.profileGapAnalysis;
  }
  if (changes.profileThemes !== undefined) {
    updates.profileThemes = changes.profileThemes;
  }
  if (changes.profileCorrespondents !== undefined) {
    updates.profileCorrespondents = changes.profileCorrespondents;
  }
  if (changes.profileStatus !== undefined) {
    updates.profileStatus = changes.profileStatus;
  }
  if (changes.highlightImageId !== undefined) {
    updates.highlightImageId = changes.highlightImageId;
  }

  if (changes.profileStatus === 'EMPTY') {
    updates.hook = null;
    updates.profileNarrative = null;
    updates.profileCorrespondents = null;
    updates.profileStartHereLetterId = null;
    updates.profileStartHereReason = null;
    updates.profileReadingPaths = null;
    updates.profileGapAnalysis = null;
    updates.profileThemes = null;
    updates.highlightImageId = null;
    updates.profileGeneratedAt = null;
    updates.profileSourceFingerprint = null;
  }

  const collectionValues = collection as Record<string, unknown>;
  for (const [key, value] of Object.entries(updates)) {
    if (isDeepStrictEqual(value, collectionValues[key])) {
      delete updates[key as keyof typeof updates];
    }
  }
  const profileContentChanged = Object.keys(updates)
    .some((key) => PROFILE_CONTENT_FIELDS.has(
      key as keyof CollectionProfileChanges,
    ));

  const sourceConditions: SQL[] = [];
  let sourceFingerprint = collection.profileSourceFingerprint;
  if (
    profileContentChanged
    && changes.profileStatus !== 'EMPTY'
    && !sourceFingerprint
  ) {
    sourceFingerprint = await computeSourceFingerprint(
      collection.id,
      database,
    );
    if (!sourceFingerprint) {
      throw profileConflict(
        'Collection sources changed; reload before saving the profile',
      );
    }
    updates.profileSourceFingerprint = sourceFingerprint;
    sourceConditions.push(
      sql`${collections.profileSourceFingerprint} IS NULL`,
      sql`compute_collection_profile_source_fingerprint(
        ${collection.id}::uuid
      ) = ${sourceFingerprint}`,
    );
  }

  // A content edit is not itself a verification decision. Keep draft edits
  // editable and revoke an existing verification unless the same guarded
  // request explicitly verifies the resulting content.
  if (
    !changes.profileStatus
    && profileContentChanged
    && (
      collection.profileStatus === 'AI_DRAFT'
      || collection.profileStatus === 'VERIFIED'
    )
  ) {
    updates.profileStatus = 'EDITED';
  }

  if (changes.profileStatus === 'VERIFIED') {
    if (!sourceFingerprint) {
      throw profileConflict(
        'Profile content is not bound to the current collection sources; save the profile before verifying',
      );
    }
    const currentSourceFingerprint = await computeSourceFingerprint(
      collection.id,
      database,
    );
    if (currentSourceFingerprint !== sourceFingerprint) {
      throw profileConflict(
        'Collection sources changed after this profile was created; regenerate the profile before verifying',
      );
    }
    if (collection.profileSourceFingerprint) {
      sourceConditions.push(
        eq(
          collections.profileSourceFingerprint,
          collection.profileSourceFingerprint,
        ),
        sql`compute_collection_profile_source_fingerprint(
          ${collection.id}::uuid
        ) = ${collection.profileSourceFingerprint}`,
      );
    }
  }

  if (Object.keys(updates).length === 0) return collection;

  const [updated] = await database
    .update(collections)
    .set({
      ...updates,
      profileRevision: sql<number>`${collections.profileRevision} + 1`,
    })
    .where(and(
      eq(collections.id, collection.id),
      eq(collections.profileRevision, input.expectedProfileRevision),
      ...sourceConditions,
    ))
    .returning();
  if (!updated) {
    throw profileConflict(
      'Collection sources or profile content changed; reload before saving',
    );
  }
  return updated;
}

/**
 * Persists the collection-facing portion of the atomic editor transaction.
 * The caller has already locked the collection and its letters and owns the
 * wider identity/participant transaction.
 */
export async function commitAtomicCollectionEditorProfile(
  input: {
    collection: Collection;
    patch: CollectionEditorProfilePatch;
    profileContentChanged: boolean;
  },
  dependencies: {
    database: CollectionProfileMutationDatabase;
    computeSourceFingerprint?: ComputeSourceFingerprint;
  },
): Promise<number> {
  const { collection } = input;
  const computeSourceFingerprint =
    dependencies.computeSourceFingerprint
    ?? computeCollectionProfileSourceFingerprint;
  let nextProfileStatus: ContentStatus = collection.profileStatus;
  if (
    collection.profileStatus === 'VERIFIED'
    || (
      input.profileContentChanged
      && collection.profileStatus === 'AI_DRAFT'
    )
  ) {
    nextProfileStatus = 'EDITED';
  }

  let nextSourceFingerprint = collection.profileSourceFingerprint;
  const shouldBindSource =
    input.profileContentChanged
    && !nextSourceFingerprint;
  const finalPatch = { ...input.patch };
  const descriptionChanged =
    input.patch.description !== undefined
    && input.patch.description !== collection.description;
  if (shouldBindSource && descriptionChanged) {
    await dependencies.database
      .update(collections)
      .set({ description: input.patch.description })
      .where(and(
        eq(collections.id, collection.id),
        eq(collections.profileRevision, collection.profileRevision),
      ));
    delete finalPatch.description;
  }
  if (shouldBindSource) {
    nextSourceFingerprint = await computeSourceFingerprint(
      collection.id,
      dependencies.database,
    );
    if (!nextSourceFingerprint) {
      throw profileConflict(
        'Collection sources changed; reload before saving the profile',
      );
    }
  }

  const nextProfileRevision = collection.profileRevision + 1;
  const [updated] = await dependencies.database
    .update(collections)
    .set({
      ...finalPatch,
      profileStatus: nextProfileStatus,
      ...(shouldBindSource
        ? { profileSourceFingerprint: nextSourceFingerprint }
        : {}),
      profileRevision: nextProfileRevision,
    })
    .where(and(
      eq(collections.id, collection.id),
      eq(collections.profileRevision, collection.profileRevision),
    ))
    .returning({ profileRevision: collections.profileRevision });
  if (!updated) {
    throw profileConflict(
      'Collection sources or profile content changed; reload before saving',
    );
  }
  return updated.profileRevision;
}

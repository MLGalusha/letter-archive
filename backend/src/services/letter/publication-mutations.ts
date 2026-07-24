import { and, eq, ne, type SQL } from 'drizzle-orm';
import {
  db,
  letters,
  type Database,
  type VisibilityState,
} from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import { advanceCollectionProfileRevision } from '../collection-profile-mutations.js';
import { selectPublicCatalogueRepresentative } from '../public-catalogue-unit.js';
import { canPublishMetadata, canPublishTranscript } from './publication.js';
import {
  lockCorrespondenceGroupByLetterId,
  type LockedCorrespondenceGroup,
} from './correspondence-group.js';

export const PUBLICATION_ACTIONS = [
  'PUBLISH_LETTER',
  'HIDE_LETTER',
  'PUBLISH_TRANSCRIPT',
  'HIDE_TRANSCRIPT',
  'PUBLISH_METADATA',
  'HIDE_METADATA',
] as const;

export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];

export type PublicationSkipCode =
  | 'NOT_FOUND'
  | 'SOURCE_CHANGED_OR_INELIGIBLE'
  | 'MUTATION_FAILED';

const log = createLogger({ module: 'publication-mutations' });

export interface PublicationSource {
  letterId: string;
  primarySourceRevision: number;
}

export interface BulkPublicationMutationResult {
  requested: number;
  applied: number;
  skipped: number;
  skipReasons: Array<{
    letterId: string;
    code: PublicationSkipCode;
  }>;
}

export type PublicationMutationDatabase = Pick<
  Database,
  'delete' | 'execute' | 'insert' | 'query' | 'select' | 'update'
>;

export interface PublicationIntent {
  visibility?: VisibilityState;
  transcriptPublished?: boolean;
  metadataPublished?: boolean;
  autoPublishVerifiedContentOnVisibilityTransition?: boolean;
}

export interface PublicationMutationRequest {
  source: PublicationSource;
  intent: PublicationIntent;
  userId: string;
  /**
   * Safe revocations deliberately tolerate a stale page-source epoch. Every
   * authority-granting or content-bearing mutation must set this to true.
   */
  requireCurrentSourceRevision: boolean;
  /**
   * A single-letter save can commit its ordinary content patch in the same
   * transaction as publication and companion synchronization.
   */
  rootPatch?: Record<string, unknown>;
  rootConditions?: SQL[];
  /**
   * Keeps projections derived from the root patch inside the same commit.
   * Throwing from this callback rolls back the root, group, and profile work.
   */
  afterRootMutation?: (
    database: PublicationMutationDatabase,
  ) => Promise<void>;
  blocksTranscriptGrant?: boolean;
  blocksMetadataGrant?: boolean;
}

export type PublicationMutationOutcome =
  | { kind: 'applied'; publicCorpusChanged: boolean }
  | { kind: 'not_found' }
  | { kind: 'source_changed_or_ineligible' }
  | { kind: 'root_conflict' };

interface BulkGroupMutationResult {
  outcome: PublicationMutationOutcome;
  memberIds: string[];
}

class BulkGroupMutationError extends Error {
  readonly memberIds: string[];

  constructor(memberIds: string[], cause: unknown) {
    super('Publication mutation failed for a correspondence group', { cause });
    this.name = 'BulkGroupMutationError';
    this.memberIds = memberIds;
  }
}

function intentForAction(action: PublicationAction): {
  intent: PublicationIntent;
  requireCurrentSourceRevision: boolean;
} {
  switch (action) {
    case 'PUBLISH_LETTER':
      return {
        intent: {
          visibility: 'PUBLISHED',
          autoPublishVerifiedContentOnVisibilityTransition: true,
        },
        requireCurrentSourceRevision: true,
      };
    case 'HIDE_LETTER':
      return {
        intent: { visibility: 'HIDDEN' },
        requireCurrentSourceRevision: false,
      };
    case 'PUBLISH_TRANSCRIPT':
      return {
        intent: { transcriptPublished: true },
        requireCurrentSourceRevision: true,
      };
    case 'HIDE_TRANSCRIPT':
      return {
        intent: { transcriptPublished: false },
        requireCurrentSourceRevision: false,
      };
    case 'PUBLISH_METADATA':
      return {
        intent: { metadataPublished: true },
        requireCurrentSourceRevision: true,
      };
    case 'HIDE_METADATA':
      return {
        intent: { metadataPublished: false },
        requireCurrentSourceRevision: false,
      };
  }
}

function hasOwnField(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function finalBoolean(
  current: boolean,
  patch: Record<string, unknown>,
  field: 'transcriptPublished' | 'metadataPublished',
): boolean {
  return hasOwnField(patch, field)
    ? Boolean(patch[field])
    : current;
}

function finalVisibility(
  current: VisibilityState,
  patch: Record<string, unknown>,
): VisibilityState {
  return patch.visibility === 'PUBLISHED' || patch.visibility === 'HIDDEN'
    ? patch.visibility
    : current;
}

function publicationRoot(group: LockedCorrespondenceGroup) {
  return selectPublicCatalogueRepresentative(group.members)
    ?? group.members[0]
    ?? group.owner;
}

async function synchronizeGroupVisibility(
  group: LockedCorrespondenceGroup,
  visibility: VisibilityState,
  userId: string,
  database: PublicationMutationDatabase,
): Promise<void> {
  await database
    .update(letters)
    .set({
      visibility,
      ...(visibility === 'PUBLISHED'
        ? { reviewedAt: new Date(), reviewedBy: userId }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.collectionId, group.identity.collectionId),
      eq(letters.dateRaw, group.identity.dateRaw),
      eq(letters.typeSequence, group.identity.typeSequence),
      ne(letters.visibility, visibility),
    ));
}

async function applyLockedPublicationMutation(
  group: LockedCorrespondenceGroup,
  request: PublicationMutationRequest,
  database: PublicationMutationDatabase,
): Promise<PublicationMutationOutcome> {
  const contentOwner = group.owner;
  const catalogueOwner = publicationRoot(group);
  const sharesOwner = contentOwner.id === catalogueOwner.id;
  if (
    request.requireCurrentSourceRevision
    && catalogueOwner.primarySourceRevision
      !== request.source.primarySourceRevision
  ) {
    return { kind: 'source_changed_or_ineligible' };
  }

  const contentPatch = { ...(request.rootPatch ?? {}) };
  const publicationPatch = sharesOwner ? contentPatch : {};
  const intendedTranscriptStatus =
    typeof publicationPatch.transcriptStatus === 'string'
      ? publicationPatch.transcriptStatus
      : catalogueOwner.transcriptStatus;
  const intendedMetadataStatus =
    typeof publicationPatch.metadataContentStatus === 'string'
      ? publicationPatch.metadataContentStatus
      : catalogueOwner.metadataContentStatus;

  if (
    request.intent.transcriptPublished === true
    && (
      request.blocksTranscriptGrant
      || !canPublishTranscript({ transcriptStatus: intendedTranscriptStatus })
    )
  ) {
    return { kind: 'source_changed_or_ineligible' };
  }
  if (
    request.intent.metadataPublished === true
    && (
      request.blocksMetadataGrant
      || !canPublishMetadata({ metadataContentStatus: intendedMetadataStatus })
    )
  ) {
    return { kind: 'source_changed_or_ineligible' };
  }

  const visibilityTransition = request.intent.visibility !== undefined
    && request.intent.visibility !== catalogueOwner.visibility;
  if (
    visibilityTransition
    && request.intent.visibility === 'PUBLISHED'
    && request.intent.autoPublishVerifiedContentOnVisibilityTransition
  ) {
    publicationPatch.transcriptPublished = !request.blocksTranscriptGrant
      && canPublishTranscript({ transcriptStatus: intendedTranscriptStatus });
    publicationPatch.metadataPublished = !request.blocksMetadataGrant
      && canPublishMetadata({ metadataContentStatus: intendedMetadataStatus });
  }

  if (visibilityTransition && request.intent.visibility !== undefined) {
    publicationPatch.visibility = request.intent.visibility;
    if (request.intent.visibility === 'PUBLISHED') {
      publicationPatch.reviewedAt = new Date();
      publicationPatch.reviewedBy = request.userId;
    }
  }
  if (request.intent.transcriptPublished !== undefined) {
    publicationPatch.transcriptPublished = request.intent.transcriptPublished;
  }
  if (request.intent.metadataPublished !== undefined) {
    publicationPatch.metadataPublished = request.intent.metadataPublished;
  }

  const groupVisibilityChanged = request.intent.visibility !== undefined
    && group.members.some(
      (member) => member.visibility !== request.intent.visibility,
    );
  const contentMetadataPublicationChanged = finalBoolean(
    contentOwner.metadataPublished,
    contentPatch,
    'metadataPublished',
  ) !== contentOwner.metadataPublished
    && finalVisibility(contentOwner.visibility, contentPatch) === 'PUBLISHED';
  const catalogueMetadataPublicationChanged = !sharesOwner
    && finalBoolean(
      catalogueOwner.metadataPublished,
      publicationPatch,
      'metadataPublished',
    ) !== catalogueOwner.metadataPublished
    && finalVisibility(
      catalogueOwner.visibility,
      publicationPatch,
    ) === 'PUBLISHED';
  const contentMutationRequested = Object.keys(contentPatch).length > 0;

  if (contentMutationRequested) {
    contentPatch.updatedAt = new Date();
    const updated = await database
      .update(letters)
      .set(contentPatch)
      .where(and(
        eq(letters.id, contentOwner.id),
        ...(request.rootConditions ?? []),
      ))
      .returning({ id: letters.id });
    if (updated.length !== 1) return { kind: 'root_conflict' };
  }

  await request.afterRootMutation?.(database);

  if (!sharesOwner && Object.keys(publicationPatch).length > 0) {
    publicationPatch.updatedAt = new Date();
    const updated = await database
      .update(letters)
      .set(publicationPatch)
      .where(eq(letters.id, catalogueOwner.id))
      .returning({ id: letters.id });
    if (updated.length !== 1) {
      throw new Error(
        `Locked publication root ${catalogueOwner.id} disappeared during mutation`,
      );
    }
  }

  if (request.intent.visibility !== undefined) {
    await synchronizeGroupVisibility(
      group,
      request.intent.visibility,
      request.userId,
      database,
    );
  }

  const publicCorpusChanged = groupVisibilityChanged
    || contentMetadataPublicationChanged
    || catalogueMetadataPublicationChanged;
  if (publicCorpusChanged) {
    await advanceCollectionProfileRevision(
      group.identity.collectionId,
      database,
    );
  }

  return { kind: 'applied', publicCorpusChanged };
}

/**
 * Canonical transaction boundary for a single publication-bearing mutation.
 * Root content, publication flags, companion visibility, and collection
 * profile invalidation either all commit or all roll back.
 */
export async function applyPublicationMutation(
  request: PublicationMutationRequest,
): Promise<PublicationMutationOutcome> {
  return db.transaction(async (tx) => {
    const group = await lockCorrespondenceGroupByLetterId(
      request.source.letterId,
      tx,
    );
    if (!group) return { kind: 'not_found' };
    return applyLockedPublicationMutation(group, request, tx);
  });
}

async function applyBulkGroupPublicationMutation(
  candidate: PublicationSource,
  requestedSources: ReadonlyMap<string, PublicationSource>,
  action: PublicationAction,
  userId: string,
): Promise<BulkGroupMutationResult> {
  const actionRequest = intentForAction(action);
  return db.transaction(async (tx) => {
    const group = await lockCorrespondenceGroupByLetterId(
      candidate.letterId,
      tx,
    );
    if (!group) {
      return {
        outcome: { kind: 'not_found' },
        memberIds: [candidate.letterId],
      };
    }

    const memberIds = group.members.map((member) => member.id);
    const root = publicationRoot(group);
    const canonicalSource = requestedSources.get(root.id) ?? candidate;
    try {
      return {
        outcome: await applyLockedPublicationMutation(group, {
          source: canonicalSource,
          ...actionRequest,
          userId,
        }, tx),
        memberIds,
      };
    } catch (error) {
      throw new BulkGroupMutationError(memberIds, error);
    }
  });
}

function outcomeCode(
  outcome: PublicationMutationOutcome,
): PublicationSkipCode | 'APPLIED' {
  if (outcome.kind === 'applied') return 'APPLIED';
  if (outcome.kind === 'not_found') return 'NOT_FOUND';
  return 'SOURCE_CHANGED_OR_INELIGIBLE';
}

/**
 * Applies one explicit action per source. Each correspondence unit owns a
 * short transaction, so a stale or ineligible row cannot roll back unrelated
 * selections and every successful unit remains internally atomic.
 */
export async function applyBulkPublicationAction(
  sources: PublicationSource[],
  action: PublicationAction,
  userId: string,
): Promise<BulkPublicationMutationResult> {
  const outcomes = new Map<string, PublicationSkipCode | 'APPLIED'>();
  const requestedSources = new Map(
    sources.map((source) => [source.letterId, source]),
  );

  // Stable ordering plus group-member outcome reuse makes caller order
  // irrelevant while keeping one short transaction per correspondence unit.
  const ordered = [...sources].sort((left, right) =>
    left.letterId.localeCompare(right.letterId));
  for (const source of ordered) {
    if (outcomes.has(source.letterId)) continue;
    try {
      const result = await applyBulkGroupPublicationMutation(
        source,
        requestedSources,
        action,
        userId,
      );
      const code = outcomeCode(result.outcome);
      for (const memberId of result.memberIds) {
        if (requestedSources.has(memberId)) {
          outcomes.set(memberId, code);
        }
      }
      outcomes.set(source.letterId, code);
    } catch (err) {
      const failedMemberIds = err instanceof BulkGroupMutationError
        ? err.memberIds
        : [source.letterId];
      for (const memberId of failedMemberIds) {
        if (requestedSources.has(memberId)) {
          outcomes.set(memberId, 'MUTATION_FAILED');
        }
      }
      outcomes.set(source.letterId, 'MUTATION_FAILED');
      log.error(
        {
          err: err instanceof BulkGroupMutationError ? err.cause : err,
          letterId: source.letterId,
          action,
        },
        'Bulk publication item failed',
      );
    }
  }

  const skipReasons = sources.flatMap(({ letterId }) => {
    const code = outcomes.get(letterId);
    return code && code !== 'APPLIED' ? [{ letterId, code }] : [];
  });

  return {
    requested: sources.length,
    applied: sources.length - skipReasons.length,
    skipped: skipReasons.length,
    skipReasons,
  };
}

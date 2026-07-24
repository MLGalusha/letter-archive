import { and, eq, ne, sql } from 'drizzle-orm';
import {
  letterPages,
  letters,
  type ContentStatus,
  type Database,
} from '../../db/index.js';
import { advanceCollectionProfileRevision } from '../collection-profile-mutations.js';
import { deleteReplaceableEntityProjection } from '../entities/extraction.js';
import type {
  CorrespondenceGroupIdentity,
  LockedCorrespondenceGroup,
} from './correspondence-group.js';
import { buildExtraContentSourceInvalidationPatch } from './extra-content-job.js';
import {
  buildMetadataSourceInvalidationPatch,
} from './metadata-job.js';
import { clearedTranscriptionOwnership } from './transcription-job.js';

type SourceInvalidationDatabase = Pick<
  Database,
  'select' | 'update' | 'delete'
>;

function demotedTranscriptStatus() {
  return sql<ContentStatus>`CASE
    WHEN ${letters.transcriptionText} IS NULL
      OR btrim(${letters.transcriptionText}) = ''
      THEN 'EMPTY'::content_status
    WHEN ${letters.transcriptStatus} = 'EDITED'
      THEN 'EDITED'::content_status
    ELSE 'AI_DRAFT'::content_status
  END`;
}

function withoutTranscriptMapping(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((segment) => {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
      return segment;
    }
    const {
      isMapped: _isMapped,
      mappedText: _mappedText,
      ...geometry
    } = segment as Record<string, unknown>;
    return geometry;
  });
}

async function clearPrimaryPageTranscriptMappings(
  letterId: string,
  database: SourceInvalidationDatabase,
): Promise<void> {
  const pages = await database
    .select({
      id: letterPages.id,
      lineSegments: letterPages.lineSegments,
      segmentTrustState: letterPages.segmentTrustState,
    })
    .from(letterPages)
    .where(eq(letterPages.letterId, letterId));

  for (const page of pages) {
    const lineSegments = withoutTranscriptMapping(page.lineSegments);
    const mappingChanged = JSON.stringify(lineSegments) !== JSON.stringify(page.lineSegments);
    if (!mappingChanged && page.segmentTrustState === 'unverified') continue;
    await database
      .update(letterPages)
      .set({
        ...(mappingChanged ? { lineSegments } : {}),
        segmentTrustState: 'unverified',
        updatedAt: new Date(),
      })
      .where(eq(letterPages.id, page.id));
  }
}

function primarySourceInvalidationPatch(sourceRevision: number) {
  return {
    ...buildMetadataSourceInvalidationPatch(),
    workflow: 'UPLOADED' as const,
    visibility: 'HIDDEN' as const,
    reviewedAt: null,
    reviewedBy: null,
    transcriptionStatus: 'PENDING' as const,
    ...clearedTranscriptionOwnership(),
    transcriptionError: null,
    transcriptionAttemptCount: 0,
    transcriptStatus: demotedTranscriptStatus(),
    transcriptionJson: null,
    readingText: null,
    transcriptConfirmedAt: null,
    transcriptConfirmedBy: null,
    transcriptVerifiedAt: null,
    transcriptVerifiedBy: null,
    transcriptPublished: false,
    metadataPublished: false,
    deadLetter: false,
    primarySourceRevision: sourceRevision,
    updatedAt: new Date(),
  };
}

async function hideCompanionSources(
  identity: CorrespondenceGroupIdentity,
  excludedLetterId: string,
  sourceRevision: number,
  database: SourceInvalidationDatabase,
): Promise<void> {
  await database
    .update(letters)
    .set({
      visibility: 'HIDDEN',
      reviewedAt: null,
      reviewedBy: null,
      primarySourceRevision: sourceRevision,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.collectionId, identity.collectionId),
      eq(letters.dateRaw, identity.dateRaw),
      eq(letters.typeSequence, identity.typeSequence),
      ne(letters.id, excludedLetterId),
    ));
}

/**
 * Revokes every authority derived from the ordered primary L-page source.
 *
 * The caller owns the surrounding page transaction. Exact run/revision
 * predicates on each producer make either race order safe: an older producer
 * commits first and is invalidated here, or this write clears its ownership and
 * its later terminal compare-and-set loses.
 */
export async function invalidatePrimaryLetterSource(
  group: LockedCorrespondenceGroup,
  database: SourceInvalidationDatabase,
): Promise<void> {
  const { owner, identity, nextSourceRevision: sourceRevision } = group;
  if (owner.type !== 'L') {
    throw new Error(`Primary page source owner ${owner.id} is not an L letter`);
  }

  const updated = await database
    .update(letters)
    .set(primarySourceInvalidationPatch(sourceRevision))
    .where(and(eq(letters.id, owner.id), eq(letters.type, 'L')))
    .returning({ id: letters.id });
  if (updated.length !== 1) {
    throw new Error(`Primary page source owner ${owner.id} changed before invalidation`);
  }

  await clearPrimaryPageTranscriptMappings(owner.id, database);
  await deleteReplaceableEntityProjection(database, owner.id);
  await hideCompanionSources(identity, owner.id, sourceRevision, database);
  await advanceCollectionProfileRevision(owner.collectionId, database);
}

/**
 * Invalidates a T/C/E source and withdraws its public correspondence unit.
 *
 * A running extra-content producer remains fenced by its existing dirty-source
 * contract, while metadata/entity owners are revoked immediately because both
 * derive from the extra-content transcript.
 */
export async function invalidateExtraContentSource(
  group: LockedCorrespondenceGroup,
  database: SourceInvalidationDatabase,
): Promise<void> {
  const { identity, nextSourceRevision: sourceRevision } = group;
  const primaryLetter = group.members.find((member) => member.type === 'L');
  if (primaryLetter) {
    await database
      .update(letters)
      .set({
        ...buildExtraContentSourceInvalidationPatch(),
        ...buildMetadataSourceInvalidationPatch(),
        visibility: 'HIDDEN',
        reviewedAt: null,
        reviewedBy: null,
        extraContentVerifiedAt: null,
        extraContentVerifiedBy: null,
        extraContentStatus: sql<ContentStatus>`CASE
          WHEN ${letters.extraContentStatus} IN ('EMPTY', 'EDITED')
            THEN ${letters.extraContentStatus}
          ELSE 'AI_DRAFT'::content_status
        END`,
        updatedAt: new Date(),
      })
      .where(eq(letters.id, primaryLetter.id));
    await deleteReplaceableEntityProjection(database, primaryLetter.id);
  }

  await database
    .update(letters)
    .set({
      visibility: 'HIDDEN',
      reviewedAt: null,
      reviewedBy: null,
      primarySourceRevision: sourceRevision,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.collectionId, identity.collectionId),
      eq(letters.dateRaw, identity.dateRaw),
      eq(letters.typeSequence, identity.typeSequence),
    ));
  await advanceCollectionProfileRevision(identity.collectionId, database);
}

/**
 * Withdraws a P/V/A/D/N page-bearing correspondence unit and revokes any
 * photo description derived from a P source in the group.
 */
export async function invalidateRelatedPageSource(
  group: LockedCorrespondenceGroup,
  database: SourceInvalidationDatabase,
): Promise<void> {
  const { identity, nextSourceRevision: sourceRevision } = group;

  await database
    .update(letters)
    .set({
      visibility: 'HIDDEN',
      reviewedAt: null,
      reviewedBy: null,
      primarySourceRevision: sourceRevision,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.collectionId, identity.collectionId),
      eq(letters.dateRaw, identity.dateRaw),
      eq(letters.typeSequence, identity.typeSequence),
    ));

  await database
    .update(letters)
    .set({
      photoDescriptionStatus: sql<ContentStatus>`CASE
        WHEN ${letters.photoDescription} IS NULL
          OR btrim(${letters.photoDescription}) = ''
          THEN 'EMPTY'::content_status
        WHEN ${letters.photoDescriptionStatus} = 'EDITED'
          THEN 'EDITED'::content_status
        ELSE 'AI_DRAFT'::content_status
      END`,
      photoDescriptionVerifiedAt: null,
      photoDescriptionVerifiedBy: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.collectionId, identity.collectionId),
      eq(letters.dateRaw, identity.dateRaw),
      eq(letters.typeSequence, identity.typeSequence),
      eq(letters.type, 'P'),
    ));

  await advanceCollectionProfileRevision(identity.collectionId, database);
}

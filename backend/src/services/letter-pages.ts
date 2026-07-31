import { eq, and, inArray, isNull, or } from 'drizzle-orm';
import {
  collections,
  db,
  letterPages,
  letters,
  type Database,
  type Letter,
  type LetterType,
  type LetterPage,
} from '../db/index.js';
import type { CreateLetterParams } from './letters.js';
import {
  invalidateExtraContentSource,
  invalidatePrimaryLetterSource,
  invalidateRelatedPageSource,
} from './letter/page-source-invalidation.js';
import {
  lockCorrespondenceGroupByIdentity,
  type LockedCorrespondenceGroup,
  type LockedCorrespondenceMember,
  type LockedCorrespondenceMembers,
} from './letter/correspondence-group.js';
import { sourceRevisionChanged } from './letter/source-revision.js';

export interface UploadSourceExpectation {
  pageId: string;
  primarySourceRevision: number;
  storagePath: string;
  checksumSha256: string | null;
}

export type LetterOwnerObservation =
  | { kind: 'present'; letterId: string }
  | { kind: 'absent' };

export interface CreatePageParams {
  letterIdentity: CreateLetterParams;
  ownerObservation: LetterOwnerObservation;
  pageNumber: number;
  storagePath: string;
  originalFilename: string;
  checksumSha256: string;
  width?: number | null;
  height?: number | null;
  existingPagePolicy?: ExistingPagePolicy;
  expectedExistingSource?: {
    storagePath: string;
    checksumSha256: string | null;
  };
  expectedReplacementSource?: UploadSourceExpectation;
}

export type ExistingPagePolicy =
  | 'keep'
  | 'replace'
  | 'repair'
  | 'reconcile'
  | 'invalidate';

type PageChangeEffect =
  | { kind: 'primary-letter' }
  | { kind: 'extra-content' }
  | { kind: 'related-page' };

export type PageMutationOutcome =
  | 'created'
  | 'replaced'
  | 'relocated'
  | 'unchanged';

export interface PageMutationResult {
  letter: Letter;
  page: LetterPage;
  outcome: PageMutationOutcome;
  sourceChanged: boolean;
  primarySourceRevision: number;
  previousStoragePath?: string;
}

type PersistedPageMutationResult = Omit<
  PageMutationResult,
  'letter' | 'primarySourceRevision'
>;

export interface UploadPageIdentity {
  collectionCode: string;
  dateRaw: string;
  type: LetterType;
  typeSequence: number;
  pageNumber: number;
}

export interface ObservedPageSource {
  pageId: string;
  storagePath: string;
  checksumSha256: string | null;
}

export interface ContentDuplicateIdentity {
  collectionId?: string;
  dateRaw: string;
  type: LetterType;
  typeSequence: number;
  pageNumber: number;
}

export interface DurableContentLookup {
  checksumSha256: string;
  isDurableSource: (page: LetterPage) => Promise<boolean>;
}

export function uploadPageIdentityKey(identity: UploadPageIdentity): string {
  return [
    identity.collectionCode,
    identity.dateRaw,
    identity.type,
    identity.typeSequence,
    identity.pageNumber,
  ].join('\u0000');
}

/**
 * Returns the exact committed page source observed for each requested identity.
 *
 * The joined rows come from one PostgreSQL statement, so the pointer and source
 * revision form one immutable confirmation token rather than two racy reads.
 */
export async function findObservedPageSourcesByIdentity(
  identities: UploadPageIdentity[],
): Promise<Map<string, UploadSourceExpectation>> {
  if (identities.length === 0) return new Map();

  const rows = await db
    .select({
      pageId: letterPages.id,
      collectionCode: collections.collectionCode,
      dateRaw: letters.dateRaw,
      type: letters.type,
      typeSequence: letters.typeSequence,
      pageNumber: letterPages.pageNumber,
      primarySourceRevision: letters.primarySourceRevision,
      storagePath: letterPages.storagePath,
      checksumSha256: letterPages.checksumSha256,
    })
    .from(letterPages)
    .innerJoin(letters, eq(letterPages.letterId, letters.id))
    .innerJoin(collections, eq(letters.collectionId, collections.id))
    .where(or(...identities.map((identity) => and(
      eq(collections.collectionCode, identity.collectionCode),
      eq(letters.dateRaw, identity.dateRaw),
      eq(letters.type, identity.type),
      eq(letters.typeSequence, identity.typeSequence),
      eq(letterPages.pageNumber, identity.pageNumber),
    ))));

  return new Map(rows.map((row) => [
    uploadPageIdentityKey(row),
    {
      pageId: row.pageId,
      primarySourceRevision: row.primarySourceRevision,
      storagePath: row.storagePath,
      checksumSha256: row.checksumSha256,
    },
  ]));
}

type PageDatabase = Pick<
  Database,
  'query' | 'select' | 'insert' | 'update'
>;

type PersistPageParams = Omit<
  CreatePageParams,
  'letterIdentity' | 'ownerObservation'
> & {
  letterId: string;
};

function lockedMemberFromLetter(letter: Letter): LockedCorrespondenceMember {
  return {
    id: letter.id,
    collectionId: letter.collectionId,
    dateRaw: letter.dateRaw,
    typeSequence: letter.typeSequence,
    type: letter.type,
    primarySourceRevision: letter.primarySourceRevision,
    visibility: letter.visibility,
    transcriptPublished: letter.transcriptPublished,
    metadataPublished: letter.metadataPublished,
    transcriptStatus: letter.transcriptStatus,
    metadataContentStatus: letter.metadataContentStatus,
  };
}

async function loadLockedLetter(
  letterId: string,
  database: PageDatabase,
): Promise<Letter> {
  const letter = await database.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });
  if (!letter) {
    throw new Error(`Locked page source owner ${letterId} could not be reloaded`);
  }
  return letter;
}

/**
 * Finds a durable page with matching content while preserving target identity.
 *
 * The caller must hold the checksum-scoped advisory lock for the full upload
 * workflow. This transaction locks any requested or matching correspondence
 * group so force replacement cannot invalidate the duplicate decision while
 * its stored object is being verified.
 */
export async function findDurableContentDuplicateByIdentity(
  identity: ContentDuplicateIdentity,
  lookup: DurableContentLookup,
): Promise<PageMutationResult | undefined> {
  return db.transaction(async (tx) => {
    if (identity.collectionId) {
      const targetGroup = await lockCorrespondenceGroupByIdentity(
        {
          collectionId: identity.collectionId,
          dateRaw: identity.dateRaw,
          typeSequence: identity.typeSequence,
        },
        tx,
      );
      const targetOwner = targetGroup?.members.find(
        (member) => member.type === identity.type,
      );
      const targetPage = targetOwner
        ? await tx.query.letterPages.findFirst({
            where: and(
              eq(letterPages.letterId, targetOwner.id),
              eq(letterPages.pageNumber, identity.pageNumber),
            ),
          })
        : undefined;
      if (targetPage) return undefined;
    }

    const matchingPages = await tx.query.letterPages.findMany({
      where: eq(letterPages.checksumSha256, lookup.checksumSha256),
    });
    for (const observedPage of matchingPages) {
      const observedOwner = await tx.query.letters.findFirst({
        where: eq(letters.id, observedPage.letterId),
      });
      if (!observedOwner) continue;

      const ownerGroup = await lockCorrespondenceGroupByIdentity(
        {
          collectionId: observedOwner.collectionId,
          dateRaw: observedOwner.dateRaw,
          typeSequence: observedOwner.typeSequence,
        },
        tx,
      );
      if (
        !ownerGroup
        || !ownerGroup.members.some((member) => member.id === observedOwner.id)
      ) {
        continue;
      }

      const currentPage = await tx.query.letterPages.findFirst({
        where: eq(letterPages.id, observedPage.id),
      });
      if (
        !currentPage
        || currentPage.letterId !== observedPage.letterId
        || currentPage.storagePath !== observedPage.storagePath
        || currentPage.checksumSha256 !== lookup.checksumSha256
        || !(await lookup.isDurableSource(currentPage))
      ) {
        continue;
      }

      const confirmedPage = await tx.query.letterPages.findFirst({
        where: eq(letterPages.id, currentPage.id),
      });
      const confirmedOwner = await loadLockedLetter(observedOwner.id, tx);
      if (
        confirmedPage
        && confirmedPage.letterId === confirmedOwner.id
        && confirmedPage.storagePath === currentPage.storagePath
        && confirmedPage.checksumSha256 === lookup.checksumSha256
      ) {
        return {
          letter: confirmedOwner,
          page: confirmedPage,
          outcome: 'unchanged',
          sourceChanged: false,
          primarySourceRevision: confirmedOwner.primarySourceRevision,
        };
      }
    }

    return undefined;
  });
}

async function resolvePageOwner(
  params: CreatePageParams,
  locked: LockedCorrespondenceMembers,
  database: PageDatabase,
): Promise<{ letter: Letter; group: LockedCorrespondenceGroup }> {
  const exactMember = locked.members.find(
    (member) => member.type === params.letterIdentity.type,
  );

  if (params.ownerObservation.kind === 'present') {
    if (exactMember?.id !== params.ownerObservation.letterId) {
      throw sourceRevisionChanged(
        'Page source owner changed after upload observation; retry the upload',
      );
    }
    return {
      letter: await loadLockedLetter(exactMember.id, database),
      group: { ...locked, owner: exactMember },
    };
  }

  if (exactMember) {
    return {
      letter: await loadLockedLetter(exactMember.id, database),
      group: { ...locked, owner: exactMember },
    };
  }

  const [created] = await database
    .insert(letters)
    .values({
      ...params.letterIdentity,
      primarySourceRevision: locked.currentSourceRevision,
    })
    .onConflictDoNothing({
      target: [
        letters.collectionId,
        letters.dateRaw,
        letters.type,
        letters.typeSequence,
      ],
    })
    .returning();
  const letter = created ?? await database.query.letters.findFirst({
    where: and(
      eq(letters.collectionId, params.letterIdentity.collectionId),
      eq(letters.dateRaw, params.letterIdentity.dateRaw),
      eq(letters.type, params.letterIdentity.type),
      eq(letters.typeSequence, params.letterIdentity.typeSequence),
    ),
  });
  if (!letter) {
    throw new Error('Letter identity conflicted after locking but could not be reloaded');
  }

  const owner = lockedMemberFromLetter(letter);
  const members = [...locked.members, owner]
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    letter,
    group: {
      ...locked,
      owner,
      members,
    },
  };
}

function pageChangeEffectForOwner(
  owner: {
    type: LetterType;
    collectionId: string;
    dateRaw: string;
    typeSequence: number;
  },
): PageChangeEffect {
  switch (owner.type) {
    case 'L':
      return { kind: 'primary-letter' };
    case 'T':
    case 'C':
    case 'E':
      return { kind: 'extra-content' };
    case 'P':
    case 'V':
    case 'A':
    case 'D':
    case 'N':
      return { kind: 'related-page' };
    default: {
      const unsupportedType: never = owner.type;
      throw new Error(`Unsupported page source type ${unsupportedType}`);
    }
  }
}

/**
 * Finds an existing page for the resolved owner and page number, or creates one.
 * Existing-page policy is explicit so upload acceptance, pointer repair, and
 * authoritative source replacement cannot be conflated.
 */
async function persistPage(
  params: PersistPageParams,
  database: PageDatabase,
): Promise<PersistedPageMutationResult> {
  const existing = await database.query.letterPages.findFirst({
    where: and(
      eq(letterPages.letterId, params.letterId),
      eq(letterPages.pageNumber, params.pageNumber)
    ),
  });

  const expectedReplacement = params.expectedReplacementSource;
  if (
    expectedReplacement
    && (
      !existing
      || existing.id !== expectedReplacement.pageId
      || existing.storagePath !== expectedReplacement.storagePath
      || existing.checksumSha256 !== expectedReplacement.checksumSha256
    )
  ) {
    throw sourceRevisionChanged(
      'Page source changed after duplicate confirmation; check duplicates again before replacing it',
    );
  }

  if (existing) {
    const policy = params.existingPagePolicy ?? 'keep';
    const expected = params.expectedExistingSource;
    if (
      expected
      && (
        existing.storagePath !== expected.storagePath
        || existing.checksumSha256 !== expected.checksumSha256
      )
    ) {
      return { page: existing, outcome: 'unchanged', sourceChanged: false };
    }
    const checksumChanged = params.checksumSha256 !== existing.checksumSha256;
    const pointerChanged = params.storagePath !== existing.storagePath;

    if (policy === 'keep') {
      return { page: existing, outcome: 'unchanged', sourceChanged: false };
    }
    if (policy === 'repair' && checksumChanged) {
      throw new Error('A page pointer repair must preserve the committed checksum');
    }
    if (
      !checksumChanged
      && (
        !pointerChanged
        || policy === 'replace'
      )
    ) {
      return { page: existing, outcome: 'unchanged', sourceChanged: false };
    }

    const sourceChanged = checksumChanged || policy === 'invalidate';
    const [updated] = await database
      .update(letterPages)
      .set(sourceChanged
        ? {
            checksumSha256: params.checksumSha256,
            storagePath: params.storagePath,
            originalFilename: params.originalFilename,
            width: params.width ?? null,
            height: params.height ?? null,
            pageLayout: null,
            pageLayoutChecksumSha256: null,
            lineSegments: null,
            geometryRevision: 0,
            geometryChecksumSha256: null,
            segmentTrustState: 'unverified',
            approvedGeometryRevision: null,
            approvedGeometryChecksumSha256: null,
            geometryApprovedBy: null,
            geometryApprovedAt: null,
            updatedAt: new Date(),
          }
        : {
            checksumSha256: params.checksumSha256,
            storagePath: params.storagePath,
            originalFilename: params.originalFilename,
            ...(params.width !== null && params.width !== undefined
              ? { width: params.width }
              : {}),
            ...(params.height !== null && params.height !== undefined
              ? { height: params.height }
              : {}),
            updatedAt: new Date(),
          })
      .where(eq(letterPages.id, existing.id))
      .returning();
    return {
      page: updated,
      outcome: sourceChanged ? 'replaced' : 'relocated',
      sourceChanged,
      previousStoragePath: existing.storagePath,
    };
  }

  const [created] = await database
    .insert(letterPages)
    .values({
      letterId: params.letterId,
      pageNumber: params.pageNumber,
      storagePath: params.storagePath,
      originalFilename: params.originalFilename,
      checksumSha256: params.checksumSha256,
      width: params.width ?? null,
      height: params.height ?? null,
    })
    .returning();

  return { page: created, outcome: 'created', sourceChanged: true };
}

/**
 * Resolve or create correspondence membership, persist the page, and invalidate
 * derived content in one transaction. If any step fails, membership and source
 * mutation roll back together.
 */
export async function findOrCreatePage(
  params: CreatePageParams,
): Promise<PageMutationResult> {
  return db.transaction(async (tx) => {
    const locked = await lockCorrespondenceGroupByIdentity(
      {
        collectionId: params.letterIdentity.collectionId,
        dateRaw: params.letterIdentity.dateRaw,
        typeSequence: params.letterIdentity.typeSequence,
      },
      tx,
    );
    if (!locked) {
      throw new Error(
        `Page source collection ${params.letterIdentity.collectionId} does not exist`,
      );
    }
    const { letter, group: sourceGroup } = await resolvePageOwner(
      params,
      locked,
      tx,
    );
    if (
      params.expectedReplacementSource
      && sourceGroup.owner.primarySourceRevision
        !== params.expectedReplacementSource.primarySourceRevision
    ) {
      throw sourceRevisionChanged(
        'Page source changed after duplicate confirmation; check duplicates again before replacing it',
      );
    }
    const effect = pageChangeEffectForOwner(sourceGroup.owner);

    const {
      letterIdentity: _letterIdentity,
      ownerObservation: _ownerObservation,
      ...pageParams
    } = params;
    const result = await persistPage(
      { ...pageParams, letterId: sourceGroup.owner.id },
      tx,
    );
    if (!result.sourceChanged) {
      return {
        letter,
        ...result,
        primarySourceRevision: sourceGroup.owner.primarySourceRevision,
      };
    }

    switch (effect.kind) {
      case 'primary-letter':
        await invalidatePrimaryLetterSource(sourceGroup, tx);
        break;
      case 'extra-content':
        await invalidateExtraContentSource(sourceGroup, tx);
        break;
      case 'related-page':
        await invalidateRelatedPageSource(sourceGroup, tx);
        break;
    }
    const committedLetter = await loadLockedLetter(sourceGroup.owner.id, tx);
    return {
      letter: committedLetter,
      ...result,
      primarySourceRevision: sourceGroup.nextSourceRevision,
    };
  });
}

/**
 * Commits dimensions only while the page still points at the object that was
 * inspected. Replacement owns dimensions for its new object, so a stale
 * backfill must lose instead of overwriting them after the pointer switches.
 */
export async function updatePageDimensionsIfSourceCurrent(
  observed: ObservedPageSource,
  dimensions: { width: number; height: number },
): Promise<boolean> {
  const updated = await db
    .update(letterPages)
    .set(dimensions)
    .where(and(
      eq(letterPages.id, observed.pageId),
      eq(letterPages.storagePath, observed.storagePath),
      observed.checksumSha256 === null
        ? isNull(letterPages.checksumSha256)
        : eq(letterPages.checksumSha256, observed.checksumSha256),
    ))
    .returning({ id: letterPages.id });
  return updated.length === 1;
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

/**
 * Gets every page matching any checksum in one query.
 */
export async function findPagesByChecksums(checksums: string[]): Promise<LetterPage[]> {
  if (checksums.length === 0) return [];
  return db.query.letterPages.findMany({
    where: inArray(letterPages.checksumSha256, checksums),
  });
}

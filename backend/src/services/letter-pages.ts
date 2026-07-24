import { eq, and, isNull, or } from 'drizzle-orm';
import {
  collections,
  db,
  letterPages,
  letters,
  type Database,
  type LetterType,
  type LetterPage,
} from '../db/index.js';
import {
  invalidateExtraContentSource,
  invalidatePrimaryLetterSource,
  invalidateRelatedPageSource,
} from './letter/page-source-invalidation.js';
import {
  lockCorrespondenceGroupByLetterId,
} from './letter/correspondence-group.js';
import { sourceRevisionChanged } from './letter/source-revision.js';

export interface UploadSourceExpectation {
  pageId: string;
  primarySourceRevision: number;
  storagePath: string;
  checksumSha256: string | null;
}

export interface CreatePageParams {
  collectionId: string;
  letterId: string;
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
  page: LetterPage;
  outcome: PageMutationOutcome;
  sourceChanged: boolean;
  primarySourceRevision: number;
  previousStoragePath?: string;
}

type PersistedPageMutationResult = Omit<
  PageMutationResult,
  'primarySourceRevision'
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
 * Finds an existing page by letter ID and page number, or creates a new one.
 * Existing-page policy is explicit so upload acceptance, pointer repair, and
 * authoritative source replacement cannot be conflated.
 */
async function persistPage(
  params: CreatePageParams,
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
            lineSegments: null,
            segmentTrustState: 'unverified',
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
 * Persist a page and any derived-content invalidation in one database transaction.
 * If invalidation fails, the page mutation rolls back so a retry cannot mistake the
 * source as already reconciled.
 */
export async function findOrCreatePage(
  params: CreatePageParams,
): Promise<PageMutationResult> {
  return db.transaction(async (tx) => {
    const sourceGroup = await lockCorrespondenceGroupByLetterId(
      params.letterId,
      tx,
    );
    if (!sourceGroup) {
      throw new Error(`Page source owner ${params.letterId} does not exist`);
    }
    if (sourceGroup.identity.collectionId !== params.collectionId) {
      throw new Error(`Page source owner ${params.letterId} is in another collection`);
    }
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

    const result = await persistPage(params, tx);
    if (!result.sourceChanged) {
      return {
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
    return {
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

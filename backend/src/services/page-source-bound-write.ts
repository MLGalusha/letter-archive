import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, letterPages, letters } from '../db/index.js';

export interface PageSourceExpectation {
  primarySourceRevision: number;
  sourceChecksum: string | null;
}

export type PageSourceBoundPatch = {
  pageLayout?: unknown;
  pageLayoutChecksumSha256?: string | null;
  lineSegments?: unknown;
  geometryRevision?: number;
  geometryChecksumSha256?: string | null;
  segmentTrustState?: 'unverified' | 'trusted';
  approvedGeometryRevision?: number | null;
  approvedGeometryChecksumSha256?: string | null;
  geometryApprovedBy?: string | null;
  geometryApprovedAt?: Date | null;
  updatedAt: Date;
};

export interface PageSourceBoundWriteOptions {
  /**
   * Makes detector evidence first-writer-wins for an unchanged source.
   * Replacing immutable evidence requires a separate, explicit lifecycle.
   */
  requirePageLayoutAbsent?: boolean;
  /**
   * Prevents a detector upload from replacing legacy or human-reviewed
   * geometry. Existing segments need a separate, explicit migration flow.
   */
  requireLineSegmentsAbsent?: boolean;
}

function currentPageSourceConditions(
  pageId: string,
  expected: PageSourceExpectation,
  options: PageSourceBoundWriteOptions,
) {
  return [
    eq(letterPages.id, pageId),
    expected.sourceChecksum === null
      ? isNull(letterPages.checksumSha256)
      : eq(letterPages.checksumSha256, expected.sourceChecksum),
    sql`EXISTS (
      SELECT 1
      FROM ${letters}
      WHERE ${letters.id} = ${letterPages.letterId}
        AND ${letters.primarySourceRevision} = ${expected.primarySourceRevision}
    )`,
    ...(options.requirePageLayoutAbsent
      ? [isNull(letterPages.pageLayout)]
      : []),
    ...(options.requireLineSegmentsAbsent
      ? [isNull(letterPages.lineSegments)]
      : []),
  ];
}

export async function updateSourceBoundPage(
  pageId: string,
  patch: PageSourceBoundPatch,
  expected: PageSourceExpectation,
  options: PageSourceBoundWriteOptions = {},
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const page = await tx.query.letterPages.findFirst({
      where: eq(letterPages.id, pageId),
      columns: { letterId: true },
    });
    if (!page) return false;

    const owner = await tx
      .select({ id: letters.id })
      .from(letters)
      .where(eq(letters.id, page.letterId))
      .for('update');
    if (owner.length !== 1) return false;

    const updated = await tx
      .update(letterPages)
      .set(patch)
      .where(and(...currentPageSourceConditions(pageId, expected, options)))
      .returning({ id: letterPages.id });
    return updated.length === 1;
  });
}

export type PageLayoutProjectionAction = 'created' | 'preserved';

export interface SourceBoundPageLayoutWriteResult {
  saved: boolean;
  projectionAction: PageLayoutProjectionAction | null;
}

/**
 * Inserts immutable PageLayout evidence without replacing mutable review work.
 *
 * The letter-owner lock serializes all normal source/segment writes. If the
 * page has no review projection, the canonical layout and its initial
 * projection are created together. If review geometry already exists, only
 * the canonical document and digest are inserted.
 */
export async function insertSourceBoundPageLayout(
  pageId: string,
  canonicalPatch: Pick<
    PageSourceBoundPatch,
    'pageLayout' | 'pageLayoutChecksumSha256' | 'updatedAt'
  >,
  projectionPatch: Pick<
    PageSourceBoundPatch,
    | 'lineSegments'
    | 'geometryRevision'
    | 'geometryChecksumSha256'
    | 'segmentTrustState'
  >,
  expected: PageSourceExpectation,
): Promise<SourceBoundPageLayoutWriteResult> {
  return db.transaction(async (tx) => {
    const page = await tx.query.letterPages.findFirst({
      where: eq(letterPages.id, pageId),
      columns: { letterId: true },
    });
    if (!page) return { saved: false, projectionAction: null };

    const owner = await tx
      .select({ id: letters.id })
      .from(letters)
      .where(eq(letters.id, page.letterId))
      .for('update');
    if (owner.length !== 1) {
      return { saved: false, projectionAction: null };
    }

    const lockedPage = await tx.query.letterPages.findFirst({
      where: eq(letterPages.id, pageId),
      columns: { lineSegments: true },
    });
    if (!lockedPage) return { saved: false, projectionAction: null };

    const baseConditions = currentPageSourceConditions(pageId, expected, {
      requirePageLayoutAbsent: true,
    });

    if (lockedPage.lineSegments === null) {
      const withProjection = await tx
        .update(letterPages)
        .set({ ...canonicalPatch, ...projectionPatch })
        .where(and(...baseConditions, isNull(letterPages.lineSegments)))
        .returning({ id: letterPages.id });
      if (withProjection.length === 1) {
        return { saved: true, projectionAction: 'created' };
      }
      // Fail safely if an out-of-band writer inserted review geometry without
      // taking the owner lock between the read and update.
    }

    const canonicalOnly = await tx
      .update(letterPages)
      .set(canonicalPatch)
      .where(and(...baseConditions))
      .returning({ id: letterPages.id });
    return canonicalOnly.length === 1
      ? { saved: true, projectionAction: 'preserved' }
      : { saved: false, projectionAction: null };
  });
}

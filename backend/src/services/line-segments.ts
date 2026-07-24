import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, letterPages, letters } from '../db/index.js';

export interface LineSegment {
  line: number;
  baseline: number[][];
  bbox: [number, number, number, number];
  ocrText: string;
  words?: { text: string; bbox: [number, number, number, number] }[];
  boundary?: { x: number; y: number }[];
}

export interface PageSourceExpectation {
  primarySourceRevision: number;
  sourceChecksum: string | null;
}

type PageSourceBoundPatch = {
  lineSegments?: LineSegment[];
  segmentTrustState?: 'unverified' | 'trusted';
  updatedAt: Date;
};

function currentPageSourceConditions(
  pageId: string,
  expected: PageSourceExpectation,
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
  ];
}

async function updateSourceBoundPage(
  pageId: string,
  patch: PageSourceBoundPatch,
  expected: PageSourceExpectation,
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
      .where(and(...currentPageSourceConditions(pageId, expected)))
      .returning({ id: letterPages.id });
    return updated.length === 1;
  });
}

/** Persists line segments produced by the standalone local detection workflow. */
export async function savePageLineSegments(
  pageId: string,
  segments: LineSegment[],
  expected: PageSourceExpectation,
): Promise<boolean> {
  return updateSourceBoundPage(
    pageId,
    {
      lineSegments: segments,
      updatedAt: new Date(),
    },
    expected,
  );
}

export async function updatePageSegmentTrust(
  pageId: string,
  trustState: 'unverified' | 'trusted',
  expected: PageSourceExpectation,
): Promise<boolean> {
  return updateSourceBoundPage(
    pageId,
    { segmentTrustState: trustState, updatedAt: new Date() },
    expected,
  );
}

export async function updateLetterSegmentTrust(
  letterId: string,
  trustState: 'unverified' | 'trusted',
  expectedRevision: number,
  expectedPages: Array<{ pageId: string; sourceChecksum: string | null }>,
): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const [letter] = await tx
        .select({ primarySourceRevision: letters.primarySourceRevision })
        .from(letters)
        .where(eq(letters.id, letterId))
        .for('update');
      const pages = await tx.query.letterPages.findMany({
        where: eq(letterPages.letterId, letterId),
        columns: { id: true, checksumSha256: true },
      });
      const expectedById = new Map(
        expectedPages.map((page) => [page.pageId, page.sourceChecksum]),
      );
      if (
        letter?.primarySourceRevision !== expectedRevision
        || pages.length !== expectedById.size
        || pages.some((page) => (
          !expectedById.has(page.id)
          || expectedById.get(page.id) !== page.checksumSha256
        ))
      ) {
        throw new Error('page-source-conflict');
      }

      const updated = await tx
        .update(letterPages)
        .set({ segmentTrustState: trustState, updatedAt: new Date() })
        .where(eq(letterPages.letterId, letterId))
        .returning({ id: letterPages.id });
      if (updated.length !== pages.length) {
        throw new Error('page-source-conflict');
      }
      return true;
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'page-source-conflict') {
      return false;
    }
    throw error;
  }
}
